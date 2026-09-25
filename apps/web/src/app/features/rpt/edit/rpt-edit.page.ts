import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, forkJoin, of } from 'rxjs';
import { RecordNavigationDecision, RecordNavigationPage } from '../../../core/guards/record-navigation.guard';
import { ProblemDetail } from '../../../core/models/common.models';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import { UplFieldError, parseUplProblem, uplFieldErrorText } from '../../upl/formats/upl-format-errors';
import {
  RPT_DECIMALS,
  RPT_DIVISORS,
  RptApiService,
  RptColumn,
  RptDecimals,
  RptDefinition,
  RptDivisor,
  RptMeasureKind,
  RptSourceItem,
  RptSourceLayout,
} from '../shared/rpt-api';
import {
  RPT_FIELD,
  RPT_MONTHS,
  RptFormChange,
  RptFormLevel,
  RptFormState,
  RptLevelOption,
  RptMeasureFormState,
  RptMeasureNo,
  RptPeriodKind,
  rptDateColumns,
  rptEmptyForm,
  rptFillMonthsInOrder,
  rptFormFromDefinition,
  rptFormToInput,
  rptKeyColumns,
  rptLevelOptions,
  rptMeasureColumns,
  rptMonthColumns,
  rptOnRefChanged,
  rptOnSourceChanged,
  rptSyncSecondLevels,
} from '../shared/rpt-definition-form';

type RptEditState = 'loading' | 'ready' | 'error';
type RptLevelSlot = 'level1' | 'level2';
type RptLayoutKind = 'source' | 'ref';
type RptMeasureFields = Omit<RptMeasureFormState, 'name'>;

/** Columns and options one measure block of the form offers, from the layouts of its source and reference. */
interface RptMeasureView {
  refSources: RptSourceItem[];
  dateColumns: RptColumn[];
  measureColumns: RptColumn[];
  monthColumns: RptColumn[];
  sourceKeyColumns: RptColumn[];
  refKeyColumns: RptColumn[];
  noDateColumns: boolean;
  levelOptions: RptLevelOption[];
  levelSourceOptions: RptLevelOption[];
  levelRefOptions: RptLevelOption[];
}

/** Field names of the contract (2.2, 10.3) that the form model has no constant for. */
const FIELD_NAME = 'name';
const FIELD_SOURCE = 'sourceId';
const FIELD_REF_SOURCE = 'ref.sourceId';
const FIELD_KEYS = 'ref.keys';
const FIELD_MONTHS = 'monthFields';
/** `RPT_LEVELS_MISMATCH` comes at `second.level2` (contract 10.9), not at `second.level2.field`. */
const FIELD_LEVEL2 = 'level2';
const KEY_FIELD = /^ref\.keys\[(\d+)\]\.(field|refField)$/;
const MONTH_FIELD = /^monthFields\[(\d+)\]$/;
const TEST_ID_FIRST = 'rpt-edit-';
const TEST_ID_SECOND = 'rpt-edit-m2-';
const MAX_KEY_PAIRS = 2;
const CONFLICT_CODE = 'RPT_CONFLICT';
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;

/** Value of a level option in the `<select>`: `source:<field>` or `ref:<field>`. */
export function rptLevelKey(level: RptFormLevel | RptLevelOption | null): string | null {
  return level === null ? null : `${level.origin}:${level.field}`;
}

/** Field name without the `second.` prefix of the second measure. */
function baseField(name: string): string {
  return name.startsWith(RPT_FIELD.secondPrefix) ? name.slice(RPT_FIELD.secondPrefix.length) : name;
}

/** What kind of column a field needs: the text for `{need}` of `RPT_COLUMN_TYPE`. */
function needKey(name: string): string {
  const field = baseField(name);
  if (field === RPT_FIELD.dateField) {
    return 'rpt.edit.need.date';
  }
  if (field === RPT_FIELD.measureField || MONTH_FIELD.test(field)) {
    return 'rpt.edit.need.number';
  }
  return 'rpt.edit.need.not_date';
}

function layoutSignals(): Record<RptLayoutKind, WritableSignal<RptSourceLayout | null>> {
  return { source: signal<RptSourceLayout | null>(null), ref: signal<RptSourceLayout | null>(null) };
}

@Component({
  selector: 'app-rpt-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rpt-edit.page.html',
  styleUrl: './rpt-edit.page.scss',
  imports: [FormsModule, NgTemplateOutlet, TranslatePipe, UiButtonComponent, UiModalComponent]
})
export class RptEditPage implements OnInit, RecordNavigationPage {
  private readonly api = inject(RptApiService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly navigationDecision = new RecordNavigationDecision();

  readonly divisors = RPT_DIVISORS;
  readonly decimalsList = RPT_DECIMALS;
  readonly maxKeyPairs = MAX_KEY_PAIRS;
  readonly field = RPT_FIELD;
  readonly monthIndexes = Array.from({ length: RPT_MONTHS }, (_, index) => index);

  readonly reportId = signal<number | null>(null);
  readonly state = signal<RptEditState>('loading');
  readonly loadError = signal<string | null>(null);
  readonly form = signal<RptFormState>(rptEmptyForm());
  readonly savedName = signal<string | null>(null);
  readonly sources = signal<RptSourceItem[]>([]);
  readonly chooseAgain = signal<ReadonlySet<string>>(new Set());
  readonly fieldErrors = signal<UplFieldError[]>([]);
  readonly saveError = signal<string | null>(null);
  readonly conflict = signal(false);
  readonly saving = signal(false);
  readonly touched = signal(false);
  readonly isLeaveOpen = signal(false);
  private lockVersion: number | undefined;

  private readonly layouts: Record<RptMeasureNo, Record<RptLayoutKind, WritableSignal<RptSourceLayout | null>>> = {
    1: layoutSignals(),
    2: layoutSignals(),
  };
  private readonly views: Record<RptMeasureNo, Signal<RptMeasureView>> = {
    1: computed(() => this.buildView(1)),
    2: computed(() => this.buildView(2)),
  };

  readonly canSave = computed(
    () =>
      this.state() === 'ready' &&
      !this.saving() &&
      !this.isPeriodBlocked(1) &&
      !(this.form().useSecond && this.isPeriodBlocked(2))
  );

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.reportId.set(id === null ? null : Number(id));
    this.load();
  }

  title(): string {
    return this.savedName() ?? this.i18n.translate('rpt.edit.new_title');
  }

  sourceOption(source: RptSourceItem): string {
    return this.i18n.translate('rpt.edit.source_option', { name: source.name, code: source.code });
  }

  levelOptionLabel(option: RptLevelOption): string {
    const key = option.origin === 'source' ? 'rpt.edit.origin_source' : 'rpt.edit.origin_ref';
    return this.i18n.translate(key, { label: option.label });
  }

  /** Fields of one measure: the first lives at the top of the form state, the second in `second`. */
  fields(measure: RptMeasureNo): RptMeasureFields {
    return this.fieldsIn(this.form(), measure);
  }

  view(measure: RptMeasureNo): RptMeasureView {
    return this.views[measure]();
  }

  layoutOf(measure: RptMeasureNo, kind: RptLayoutKind): RptSourceLayout | null {
    return this.layouts[measure][kind]();
  }

  /** `data-testid` and element id of a control: the second measure gets its own prefix. */
  tid(measure: RptMeasureNo, name: string): string {
    return (measure === 2 ? TEST_ID_SECOND : TEST_ID_FIRST) + name;
  }

  /** Server field name of a measure field (contract 10.3): the second measure has the `second.` prefix. */
  fieldOf(measure: RptMeasureNo, name: string): string {
    return measure === 2 ? RPT_FIELD.secondPrefix + name : name;
  }

  measureNameOf(measure: RptMeasureNo): string {
    const state = this.form();
    return measure === 1 ? state.measureName : state.second.name;
  }

  measureNameField(measure: RptMeasureNo): string {
    return measure === 1 ? RPT_FIELD.measureName : RPT_FIELD.secondName;
  }

  levelValue(slot: RptLevelSlot, measure: RptMeasureNo = 1): string | null {
    return rptLevelKey(this.fields(measure)[slot]);
  }

  /** The second measure has level 2 only when the first one has it. */
  showsLevel2(measure: RptMeasureNo): boolean {
    return measure === 1 || this.form().level2 !== null;
  }

  /** "matches «label» of measure 1" next to a level of the second measure; null while the first measure has no such level. */
  levelMatch(slot: RptLevelSlot): string | null {
    const level = this.form()[slot];
    if (level === null) {
      return null;
    }
    const label = this.labelIn(this.layoutOf(1, level.origin), level.field);
    return this.i18n.translate('rpt.edit.level_matches', { label });
  }

  isChooseAgain(name: string): boolean {
    return this.chooseAgain().has(name);
  }

  /** Text of the server error at the field, or null. */
  fieldError(name: string): string | null {
    const error = this.fieldErrors().find(item => item.field === name);
    if (!error) {
      return null;
    }
    const label = this.chosenLabel(name);
    const params = { field: label, label, need: this.i18n.translate(needKey(name)) };
    return uplFieldErrorText({ ...error, key: 'rpt.err.' + error.code }, key => this.i18n.translate(key, params));
  }

  /** Error at a level; level 2 of the second measure also shows the level count mismatch. */
  levelError(measure: RptMeasureNo, slot: RptLevelSlot): string | null {
    const field = slot === 'level1' ? RPT_FIELD.level1 : RPT_FIELD.level2;
    const error = this.fieldError(this.fieldOf(measure, field));
    if (error !== null || slot === 'level1') {
      return error;
    }
    return this.fieldError(this.fieldOf(measure, FIELD_LEVEL2));
  }

  setName(name: string): void {
    this.patch({ name }, [FIELD_NAME]);
  }

  setMeasureName(measure: RptMeasureNo, name: string): void {
    if (measure === 1) {
      this.patch({ measureName: name }, [RPT_FIELD.measureName]);
      return;
    }
    this.patch({ second: { ...this.form().second, name } }, [RPT_FIELD.secondName]);
  }

  /** Unticked — the block is hidden and the body carries `second = null`; the typed fields stay until the page is left. */
  setUseSecond(useSecond: boolean): void {
    this.patch({ useSecond }, []);
    if (useSecond) {
      this.loadMissingLayouts(2);
    }
  }

  setSource(measure: RptMeasureNo, sourceId: number | null): void {
    if (sourceId === this.fields(measure).sourceId) {
      return;
    }
    let change = rptOnSourceChanged(this.withMeasure(this.form(), measure, { sourceId }), measure);
    if (sourceId !== null && this.fieldsIn(change.state, measure).refSourceId === sourceId) {
      change = this.dropRefSource(change, measure);
    }
    this.applyChange(change, [this.fieldOf(measure, FIELD_SOURCE)]);
    this.layouts[measure].source.set(null);
    if (sourceId !== null) {
      this.loadLayout(measure, 'source', sourceId, null);
    }
  }

  setSourceSheet(measure: RptMeasureNo, sheet: number | null): void {
    const current = this.fields(measure);
    if (sheet === current.sourceSheet || current.sourceId === null) {
      return;
    }
    const name = this.fieldOf(measure, RPT_FIELD.sourceSheet);
    const change = rptOnSourceChanged(this.form(), measure);
    this.applyChange(this.keepValue(change, measure, { sourceSheet: sheet }, name), [name]);
    this.loadLayout(measure, 'source', current.sourceId, sheet);
  }

  setPeriodKind(measure: RptMeasureNo, periodKind: RptPeriodKind): void {
    this.patchMeasure(measure, { periodKind }, [RPT_FIELD.dateField, FIELD_MONTHS]);
  }

  setDateField(measure: RptMeasureNo, dateField: string | null): void {
    this.patchMeasure(measure, { dateField }, [RPT_FIELD.dateField]);
  }

  setMonthField(measure: RptMeasureNo, index: number, field: string | null): void {
    const monthFields = this.fields(measure).monthFields.map((month, i) => (i === index ? field : month));
    this.patchMeasure(measure, { monthFields }, [RPT_FIELD.monthField(index), FIELD_MONTHS]);
  }

  /** "Fill in order": the number columns of the form one after another, starting with the one chosen for January. */
  fillMonths(measure: RptMeasureNo): void {
    const layout = this.layoutOf(measure, 'source');
    if (layout === null) {
      return;
    }
    const monthFields = rptFillMonthsInOrder(layout.columns, this.fields(measure).monthFields[0] ?? null);
    const filled = this.monthIndexes.map(index => RPT_FIELD.monthField(index));
    this.patchMeasure(measure, { monthFields }, [FIELD_MONTHS, ...filled]);
  }

  setMeasureKind(measure: RptMeasureNo, measureKind: RptMeasureKind): void {
    this.patchMeasure(measure, { measureKind }, [RPT_FIELD.measureField]);
  }

  setMeasureField(measure: RptMeasureNo, measureField: string | null): void {
    const current = this.fields(measure);
    const cleared: string[] = [];
    const level1 = this.dropMeasureLevel(current.level1, measureField, this.fieldOf(measure, RPT_FIELD.level1), cleared);
    const level2 = this.dropMeasureLevel(current.level2, measureField, this.fieldOf(measure, RPT_FIELD.level2), cleared);
    const state = this.withMeasure(this.form(), measure, { measureField, level1, level2 });
    this.applyChange({ state, cleared }, [this.fieldOf(measure, RPT_FIELD.measureField)]);
  }

  setDivisor(measure: RptMeasureNo, divisor: RptDivisor): void {
    this.patchMeasure(measure, { divisor }, ['divisor']);
  }

  setDecimals(measure: RptMeasureNo, decimals: RptDecimals): void {
    this.patchMeasure(measure, { decimals }, ['decimals']);
  }

  setUseRef(measure: RptMeasureNo, useRef: boolean): void {
    const current = this.fields(measure);
    if (useRef) {
      this.patchMeasure(measure, { useRef }, []);
      if (current.refSourceId !== null && this.layoutOf(measure, 'ref') === null) {
        this.loadLayout(measure, 'ref', current.refSourceId, current.refSheet);
      }
      return;
    }
    const cleared: string[] = [];
    const level1 = this.dropRefLevel(current.level1, this.fieldOf(measure, RPT_FIELD.level1), cleared);
    const level2 = this.dropRefLevel(current.level2, this.fieldOf(measure, RPT_FIELD.level2), cleared);
    this.applyChange({ state: this.withMeasure(this.form(), measure, { useRef, level1, level2 }), cleared }, []);
  }

  setRefSource(measure: RptMeasureNo, refSourceId: number | null): void {
    if (refSourceId === this.fields(measure).refSourceId) {
      return;
    }
    const change = rptOnRefChanged(this.withMeasure(this.form(), measure, { refSourceId }), measure);
    this.applyChange(change, [this.fieldOf(measure, FIELD_REF_SOURCE)]);
    this.layouts[measure].ref.set(null);
    if (refSourceId !== null) {
      this.loadLayout(measure, 'ref', refSourceId, null);
    }
  }

  setRefSheet(measure: RptMeasureNo, sheet: number | null): void {
    const current = this.fields(measure);
    if (sheet === current.refSheet || current.refSourceId === null) {
      return;
    }
    const name = this.fieldOf(measure, RPT_FIELD.refSheet);
    const change = rptOnRefChanged(this.form(), measure);
    this.applyChange(this.keepValue(change, measure, { refSheet: sheet }, name), [name]);
    this.loadLayout(measure, 'ref', current.refSourceId, sheet);
  }

  setKeyField(measure: RptMeasureNo, index: number, field: string | null): void {
    const keys = this.fields(measure).keys.map((key, i) => (i === index ? { ...key, field } : key));
    this.patchMeasure(measure, { keys }, [RPT_FIELD.keyField(index), FIELD_KEYS]);
  }

  setKeyRefField(measure: RptMeasureNo, index: number, refField: string | null): void {
    const keys = this.fields(measure).keys.map((key, i) => (i === index ? { ...key, refField } : key));
    this.patchMeasure(measure, { keys }, [RPT_FIELD.keyRefField(index), FIELD_KEYS]);
  }

  addPair(measure: RptMeasureNo): void {
    const keys = this.fields(measure).keys;
    if (keys.length >= MAX_KEY_PAIRS) {
      return;
    }
    this.patchMeasure(measure, { keys: [...keys, { field: null, refField: null }] }, [FIELD_KEYS]);
  }

  removePair(measure: RptMeasureNo, index: number): void {
    const keys = this.fields(measure).keys;
    if (keys.length <= 1) {
      return;
    }
    this.patchMeasure(measure, { keys: keys.filter((_key, i) => i !== index) }, [
      FIELD_KEYS,
      RPT_FIELD.keyField(index),
      RPT_FIELD.keyRefField(index),
    ]);
  }

  setLevel(measure: RptMeasureNo, slot: RptLevelSlot, value: string | null): void {
    const option = this.view(measure).levelOptions.find(item => rptLevelKey(item) === value) ?? null;
    const next: RptFormLevel | null = option === null ? null : { origin: option.origin, field: option.field };
    const current = this.fields(measure);
    if (slot === 'level1') {
      const sameAsLevel2 = next !== null && rptLevelKey(next) === rptLevelKey(current.level2);
      this.patchMeasure(measure, { level1: next, level2: sameAsLevel2 ? null : current.level2 }, [RPT_FIELD.level1]);
      return;
    }
    this.patchMeasure(measure, { level2: next }, [RPT_FIELD.level2, FIELD_LEVEL2]);
  }

  /** Level 2 cannot repeat level 1. */
  isLevel2Blocked(measure: RptMeasureNo, option: RptLevelOption): boolean {
    return rptLevelKey(option) === this.levelValue('level1', measure);
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }
    const id = this.reportId();
    const input = rptFormToInput(this.form(), id === null ? undefined : this.lockVersion);
    const request: Observable<RptDefinition> = id === null ? this.api.create(input) : this.api.update(id, input);
    this.saving.set(true);
    this.saveError.set(null);
    this.fieldErrors.set([]);
    this.conflict.set(false);
    request.subscribe({
      next: saved => {
        this.saving.set(false);
        this.touched.set(false);
        void this.router.navigate(['/rpt/reports', saved.id]);
      },
      error: (problem: ProblemDetail) => {
        this.saving.set(false);
        this.handleSaveProblem(problem);
      }
    });
  }

  cancel(): void {
    const id = this.reportId();
    void this.router.navigate(id === null ? ['/rpt/reports'] : ['/rpt/reports', id]);
  }

  reopen(): void {
    this.load();
  }

  canLeaveRecordPage(): boolean | Observable<boolean> {
    if (!this.touched()) {
      return true;
    }
    return this.navigationDecision.request(
      () => this.isLeaveOpen.set(true),
      () => this.isLeaveOpen.set(false)
    );
  }

  settleLeave(allow: boolean): void {
    this.isLeaveOpen.set(false);
    this.navigationDecision.settle(allow);
  }

  private load(): void {
    const id = this.reportId();
    this.state.set('loading');
    this.loadError.set(null);
    this.resetMessages();
    forkJoin({ sources: this.api.sources(), definition: id === null ? of(null) : this.api.report(id) }).subscribe({
      next: ({ sources, definition }) => {
        this.sources.set(sources ?? []);
        this.applyDefinition(definition);
        this.state.set('ready');
      },
      error: (problem: ProblemDetail) => {
        this.state.set('error');
        this.loadError.set(this.problemText(problem));
      }
    });
  }

  private applyDefinition(definition: RptDefinition | null): void {
    this.touched.set(false);
    ([1, 2] as const).forEach(measure => {
      this.layouts[measure].source.set(null);
      this.layouts[measure].ref.set(null);
    });
    if (definition === null) {
      this.form.set(rptEmptyForm());
      this.chooseAgain.set(new Set());
      return;
    }
    const loaded = rptFormFromDefinition(definition);
    this.form.set(loaded.state);
    this.chooseAgain.set(new Set(loaded.staleFields));
    this.savedName.set(definition.name);
    this.lockVersion = definition.lockVersion;
    this.loadMissingLayouts(1);
    if (loaded.state.useSecond) {
      this.loadMissingLayouts(2);
    }
  }

  /** Loads the source and reference layouts of a measure that are chosen but not loaded yet. */
  private loadMissingLayouts(measure: RptMeasureNo): void {
    const fields = this.fields(measure);
    if (fields.sourceId !== null && this.layoutOf(measure, 'source') === null) {
      this.loadLayout(measure, 'source', fields.sourceId, fields.sourceSheet);
    }
    if (fields.useRef && fields.refSourceId !== null && this.layoutOf(measure, 'ref') === null) {
      this.loadLayout(measure, 'ref', fields.refSourceId, fields.refSheet);
    }
  }

  private loadLayout(measure: RptMeasureNo, kind: RptLayoutKind, sourceId: number, sheet: number | null): void {
    const target = this.layouts[measure][kind];
    target.set(null);
    this.api.layout(sourceId, sheet).subscribe({
      next: layout => {
        const fields = this.fields(measure);
        if ((kind === 'source' ? fields.sourceId : fields.refSourceId) !== sourceId) {
          return;
        }
        target.set(layout);
        this.takeLayoutSheet(measure, kind, layout.sheet);
      },
      error: (problem: ProblemDetail) => this.saveError.set(this.problemText(problem))
    });
  }

  /** An empty sheet takes the sheet the server read the columns from; the field is filled, so "choose again" goes away. */
  private takeLayoutSheet(measure: RptMeasureNo, kind: RptLayoutKind, sheet: number | null): void {
    const fields = this.fields(measure);
    const current = kind === 'source' ? fields.sourceSheet : fields.refSheet;
    if (current !== null || sheet === null) {
      return;
    }
    const values: Partial<RptMeasureFields> = kind === 'source' ? { sourceSheet: sheet } : { refSheet: sheet };
    this.form.update(state => this.withMeasure(state, measure, values));
    const again = new Set(this.chooseAgain());
    again.delete(this.fieldOf(measure, kind === 'source' ? RPT_FIELD.sourceSheet : RPT_FIELD.refSheet));
    this.chooseAgain.set(again);
  }

  private handleSaveProblem(problem: ProblemDetail): void {
    if (problem?.status === HTTP_CONFLICT && problem?.detail === CONFLICT_CODE) {
      this.conflict.set(true);
      return;
    }
    if (problem?.status === HTTP_UNPROCESSABLE) {
      this.fieldErrors.set(parseUplProblem(problem));
    }
    this.saveError.set(this.problemText(problem));
  }

  /** Our code in `detail` → the screen text; anything else — the text the application framework put into the problem. */
  private problemText(problem: ProblemDetail): string {
    const code = problem?.detail ?? '';
    const key = 'rpt.err.' + code;
    const text = this.i18n.translate(key);
    if (text !== key) {
      return text;
    }
    return problem?.detail || problem?.title || this.i18n.translate('common.error');
  }

  private resetMessages(): void {
    this.fieldErrors.set([]);
    this.saveError.set(null);
    this.conflict.set(false);
  }

  /** User change: new values, the fields become filled again and lose their server error. */
  private patch(values: Partial<RptFormState>, filled: string[]): void {
    this.applyChange({ state: { ...this.form(), ...values }, cleared: [] }, filled);
  }

  /** User change of one measure; `filled` are the field names without the measure prefix. */
  private patchMeasure(measure: RptMeasureNo, values: Partial<RptMeasureFields>, filled: string[]): void {
    const state = this.withMeasure(this.form(), measure, values);
    this.applyChange({ state, cleared: [] }, filled.map(name => this.fieldOf(measure, name)));
  }

  /** Every change keeps the second measure at the level count of the first one. */
  private applyChange(change: RptFormChange, filled: string[]): void {
    const synced = rptSyncSecondLevels(change.state);
    const again = new Set(this.chooseAgain());
    filled.forEach(name => again.delete(name));
    [...change.cleared, ...synced.cleared].forEach(name => again.add(name));
    this.form.set(synced.state);
    this.chooseAgain.set(again);
    this.fieldErrors.update(list => list.filter(error => !filled.includes(error.field)));
    this.touched.set(true);
  }

  private keepValue(
    change: RptFormChange,
    measure: RptMeasureNo,
    values: Partial<RptMeasureFields>,
    name: string,
  ): RptFormChange {
    return { state: this.withMeasure(change.state, measure, values), cleared: change.cleared.filter(item => item !== name) };
  }

  private fieldsIn(state: RptFormState, measure: RptMeasureNo): RptMeasureFields {
    return measure === 1 ? state : state.second;
  }

  private withMeasure(state: RptFormState, measure: RptMeasureNo, values: Partial<RptMeasureFields>): RptFormState {
    return measure === 1 ? { ...state, ...values } : { ...state, second: { ...state.second, ...values } };
  }

  /** The reference cannot be the source itself: a source equal to the chosen reference drops the reference. */
  private dropRefSource(change: RptFormChange, measure: RptMeasureNo): RptFormChange {
    const refChange = rptOnRefChanged(this.withMeasure(change.state, measure, { refSourceId: null }), measure);
    this.layouts[measure].ref.set(null);
    return {
      state: refChange.state,
      cleared: [...change.cleared, ...refChange.cleared, this.fieldOf(measure, FIELD_REF_SOURCE)],
    };
  }

  private dropRefLevel(level: RptFormLevel | null, name: string, cleared: string[]): RptFormLevel | null {
    if (level === null || level.origin !== 'ref') {
      return level;
    }
    cleared.push(name);
    return null;
  }

  private dropMeasureLevel(
    level: RptFormLevel | null,
    measureField: string | null,
    name: string,
    cleared: string[],
  ): RptFormLevel | null {
    if (level === null || level.origin !== 'source' || level.field !== measureField) {
      return level;
    }
    cleared.push(name);
    return null;
  }

  /** A measure by a date column cannot be saved while its source has no date column. */
  private isPeriodBlocked(measure: RptMeasureNo): boolean {
    return this.fields(measure).periodKind === 'date' && this.view(measure).noDateColumns;
  }

  private buildView(measure: RptMeasureNo): RptMeasureView {
    const fields = this.fields(measure);
    const source = this.layoutOf(measure, 'source');
    const ref = this.layoutOf(measure, 'ref');
    const levelOptions = this.buildLevelOptions(fields, source, ref);
    return {
      refSources: this.sources().filter(item => item.id !== fields.sourceId),
      dateColumns: this.columnsOf(source, rptDateColumns),
      measureColumns: this.columnsOf(source, rptMeasureColumns),
      monthColumns: this.columnsOf(source, rptMonthColumns),
      sourceKeyColumns: this.columnsOf(source, rptKeyColumns),
      refKeyColumns: this.columnsOf(ref, rptKeyColumns),
      noDateColumns: source !== null && rptDateColumns(source).length === 0,
      levelOptions,
      levelSourceOptions: levelOptions.filter(option => option.origin === 'source'),
      levelRefOptions: levelOptions.filter(option => option.origin === 'ref'),
    };
  }

  private buildLevelOptions(
    fields: RptMeasureFields,
    source: RptSourceLayout | null,
    ref: RptSourceLayout | null,
  ): RptLevelOption[] {
    if (source === null) {
      return [];
    }
    const byColumn = fields.periodKind === 'date' && fields.measureKind === 'total';
    return rptLevelOptions(source, fields.useRef ? ref : null, byColumn ? fields.measureField : null);
  }

  private columnsOf(layout: RptSourceLayout | null, pick: (layout: RptSourceLayout) => RptColumn[]): RptColumn[] {
    return layout === null ? [] : pick(layout);
  }

  /** Label of the column chosen in the field (for the error text); the raw field name when the column is unknown. */
  private chosenLabel(name: string): string {
    const measure: RptMeasureNo = name.startsWith(RPT_FIELD.secondPrefix) ? 2 : 1;
    const field = baseField(name);
    const fields = this.fields(measure);
    const source = this.layoutOf(measure, 'source');
    const keyMatch = KEY_FIELD.exec(field);
    if (keyMatch) {
      const key = fields.keys[Number(keyMatch[1])];
      return keyMatch[2] === 'field'
        ? this.labelIn(source, key?.field ?? null)
        : this.labelIn(this.layoutOf(measure, 'ref'), key?.refField ?? null);
    }
    const monthMatch = MONTH_FIELD.exec(field);
    if (monthMatch) {
      return this.labelIn(source, fields.monthFields[Number(monthMatch[1])] ?? null);
    }
    if (field === RPT_FIELD.dateField) {
      return this.labelIn(source, fields.dateField);
    }
    if (field === RPT_FIELD.measureField) {
      return this.labelIn(source, fields.measureField);
    }
    return this.chosenLevelLabel(measure, field);
  }

  private chosenLevelLabel(measure: RptMeasureNo, field: string): string {
    if (field !== RPT_FIELD.level1 && field !== RPT_FIELD.level2 && field !== FIELD_LEVEL2) {
      return '';
    }
    const level = field === RPT_FIELD.level1 ? this.fields(measure).level1 : this.fields(measure).level2;
    return this.labelIn(this.layoutOf(measure, level?.origin ?? 'source'), level?.field ?? null);
  }

  private labelIn(layout: RptSourceLayout | null, field: string | null): string {
    if (field === null) {
      return '';
    }
    return layout?.columns.find(column => column.field === field)?.label ?? field;
  }
}
