import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
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
  RptFormChange,
  RptFormLevel,
  RptFormState,
  RptLevelOption,
  rptDateColumns,
  rptEmptyForm,
  rptFormFromDefinition,
  rptFormToInput,
  rptKeyColumns,
  rptLevelOptions,
  rptMeasureColumns,
  rptOnRefChanged,
  rptOnSourceChanged,
} from '../shared/rpt-definition-form';

type RptEditState = 'loading' | 'ready' | 'error';
type RptLevelSlot = 'level1' | 'level2';

/** Field names of the contract (2.2) that the form model has no constant for. */
const FIELD_NAME = 'name';
const FIELD_SOURCE = 'sourceId';
const FIELD_REF_SOURCE = 'ref.sourceId';
const FIELD_KEYS = 'ref.keys';
const MAX_KEY_PAIRS = 2;
const CONFLICT_CODE = 'RPT_CONFLICT';
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;

/** Value of a level option in the `<select>`: `source:<field>` or `ref:<field>`. */
export function rptLevelKey(level: RptFormLevel | RptLevelOption | null): string | null {
  return level === null ? null : `${level.origin}:${level.field}`;
}

/** What kind of column a field needs: the text for `{need}` of `RPT_COLUMN_TYPE`. */
function needKey(field: string): string {
  if (field === RPT_FIELD.dateField) {
    return 'rpt.edit.need.date';
  }
  if (field === RPT_FIELD.measureField) {
    return 'rpt.edit.need.number';
  }
  return 'rpt.edit.need.not_date';
}

@Component({
  selector: 'app-rpt-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rpt-edit.page.html',
  styleUrl: './rpt-edit.page.scss',
  imports: [FormsModule, TranslatePipe, UiButtonComponent, UiModalComponent]
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

  readonly reportId = signal<number | null>(null);
  readonly state = signal<RptEditState>('loading');
  readonly loadError = signal<string | null>(null);
  readonly form = signal<RptFormState>(rptEmptyForm());
  readonly savedName = signal<string | null>(null);
  readonly sources = signal<RptSourceItem[]>([]);
  readonly sourceLayout = signal<RptSourceLayout | null>(null);
  readonly refLayout = signal<RptSourceLayout | null>(null);
  readonly chooseAgain = signal<ReadonlySet<string>>(new Set());
  readonly fieldErrors = signal<UplFieldError[]>([]);
  readonly saveError = signal<string | null>(null);
  readonly conflict = signal(false);
  readonly saving = signal(false);
  readonly touched = signal(false);
  readonly isLeaveOpen = signal(false);
  private lockVersion: number | undefined;

  readonly refSources = computed(() => this.sources().filter(source => source.id !== this.form().sourceId));
  readonly dateColumns = computed(() => this.columnsOf(this.sourceLayout(), rptDateColumns));
  readonly measureColumns = computed(() => this.columnsOf(this.sourceLayout(), rptMeasureColumns));
  readonly sourceKeyColumns = computed(() => this.columnsOf(this.sourceLayout(), rptKeyColumns));
  readonly refKeyColumns = computed(() => this.columnsOf(this.refLayout(), rptKeyColumns));
  readonly noDateColumns = computed(() => this.sourceLayout() !== null && this.dateColumns().length === 0);
  readonly levelOptions = computed(() => this.buildLevelOptions());
  readonly levelSourceOptions = computed(() => this.levelOptions().filter(option => option.origin === 'source'));
  readonly levelRefOptions = computed(() => this.levelOptions().filter(option => option.origin === 'ref'));
  readonly canSave = computed(() => this.state() === 'ready' && !this.saving() && !this.noDateColumns());

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

  levelValue(slot: RptLevelSlot): string | null {
    return rptLevelKey(this.form()[slot]);
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

  setName(name: string): void {
    this.patch({ name }, [FIELD_NAME]);
  }

  setSource(sourceId: number | null): void {
    const current = this.form();
    if (sourceId === current.sourceId) {
      return;
    }
    let change = rptOnSourceChanged({ ...current, sourceId });
    if (sourceId !== null && change.state.refSourceId === sourceId) {
      change = this.dropRefSource(change);
    }
    this.applyChange(change, [FIELD_SOURCE]);
    this.sourceLayout.set(null);
    if (sourceId !== null) {
      this.loadSourceLayout(sourceId, null);
    }
  }

  setSourceSheet(sheet: number | null): void {
    const current = this.form();
    if (sheet === current.sourceSheet || current.sourceId === null) {
      return;
    }
    const change = rptOnSourceChanged(current);
    this.applyChange(this.keepValue(change, { sourceSheet: sheet }, RPT_FIELD.sourceSheet), [RPT_FIELD.sourceSheet]);
    this.loadSourceLayout(current.sourceId, sheet);
  }

  setDateField(dateField: string | null): void {
    this.patch({ dateField }, [RPT_FIELD.dateField]);
  }

  setMeasureKind(measureKind: RptMeasureKind): void {
    this.patch({ measureKind }, [RPT_FIELD.measureField]);
  }

  setMeasureField(measureField: string | null): void {
    const current = this.form();
    const cleared: string[] = [];
    const level1 = this.dropMeasureLevel(current.level1, measureField, RPT_FIELD.level1, cleared);
    const level2 = this.dropMeasureLevel(current.level2, measureField, RPT_FIELD.level2, cleared);
    this.applyChange({ state: { ...current, measureField, level1, level2 }, cleared }, [RPT_FIELD.measureField]);
  }

  setDivisor(divisor: RptDivisor): void {
    this.patch({ divisor }, ['divisor']);
  }

  setDecimals(decimals: RptDecimals): void {
    this.patch({ decimals }, ['decimals']);
  }

  setUseRef(useRef: boolean): void {
    const current = this.form();
    if (useRef) {
      this.patch({ useRef }, []);
      if (current.refSourceId !== null && this.refLayout() === null) {
        this.loadRefLayout(current.refSourceId, current.refSheet);
      }
      return;
    }
    const cleared: string[] = [];
    const level1 = this.dropRefLevel(current.level1, RPT_FIELD.level1, cleared);
    const level2 = this.dropRefLevel(current.level2, RPT_FIELD.level2, cleared);
    this.applyChange({ state: { ...current, useRef, level1, level2 }, cleared }, []);
  }

  setRefSource(refSourceId: number | null): void {
    const current = this.form();
    if (refSourceId === current.refSourceId) {
      return;
    }
    this.applyChange(rptOnRefChanged({ ...current, refSourceId }), [FIELD_REF_SOURCE]);
    this.refLayout.set(null);
    if (refSourceId !== null) {
      this.loadRefLayout(refSourceId, null);
    }
  }

  setRefSheet(sheet: number | null): void {
    const current = this.form();
    if (sheet === current.refSheet || current.refSourceId === null) {
      return;
    }
    const change = rptOnRefChanged(current);
    this.applyChange(this.keepValue(change, { refSheet: sheet }, RPT_FIELD.refSheet), [RPT_FIELD.refSheet]);
    this.loadRefLayout(current.refSourceId, sheet);
  }

  setKeyField(index: number, field: string | null): void {
    const keys = this.form().keys.map((key, i) => (i === index ? { ...key, field } : key));
    this.patch({ keys }, [RPT_FIELD.keyField(index), FIELD_KEYS]);
  }

  setKeyRefField(index: number, refField: string | null): void {
    const keys = this.form().keys.map((key, i) => (i === index ? { ...key, refField } : key));
    this.patch({ keys }, [RPT_FIELD.keyRefField(index), FIELD_KEYS]);
  }

  addPair(): void {
    const keys = this.form().keys;
    if (keys.length >= MAX_KEY_PAIRS) {
      return;
    }
    this.patch({ keys: [...keys, { field: null, refField: null }] }, [FIELD_KEYS]);
  }

  removePair(index: number): void {
    const keys = this.form().keys;
    if (keys.length <= 1) {
      return;
    }
    this.patch({ keys: keys.filter((_key, i) => i !== index) }, [
      FIELD_KEYS,
      RPT_FIELD.keyField(index),
      RPT_FIELD.keyRefField(index),
    ]);
  }

  setLevel(slot: RptLevelSlot, value: string | null): void {
    const level = this.levelOptions().find(option => rptLevelKey(option) === value) ?? null;
    const next: RptFormLevel | null = level === null ? null : { origin: level.origin, field: level.field };
    const current = this.form();
    if (slot === 'level1') {
      const sameAsLevel2 = next !== null && rptLevelKey(next) === rptLevelKey(current.level2);
      this.patch({ level1: next, level2: sameAsLevel2 ? null : current.level2 }, [RPT_FIELD.level1]);
      return;
    }
    this.patch({ level2: next }, [RPT_FIELD.level2]);
  }

  /** Level 2 cannot repeat level 1. */
  isLevel2Blocked(option: RptLevelOption): boolean {
    return rptLevelKey(option) === this.levelValue('level1');
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
    this.sourceLayout.set(null);
    this.refLayout.set(null);
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
    if (loaded.state.sourceId !== null) {
      this.loadSourceLayout(loaded.state.sourceId, loaded.state.sourceSheet);
    }
    if (loaded.state.useRef && loaded.state.refSourceId !== null) {
      this.loadRefLayout(loaded.state.refSourceId, loaded.state.refSheet);
    }
  }

  private loadSourceLayout(sourceId: number, sheet: number | null): void {
    this.sourceLayout.set(null);
    this.api.layout(sourceId, sheet).subscribe({
      next: layout => {
        if (this.form().sourceId !== sourceId) {
          return;
        }
        this.sourceLayout.set(layout);
        this.takeLayoutSheet('sourceSheet', RPT_FIELD.sourceSheet, layout.sheet);
      },
      error: (problem: ProblemDetail) => this.saveError.set(this.problemText(problem))
    });
  }

  private loadRefLayout(refSourceId: number, sheet: number | null): void {
    this.refLayout.set(null);
    this.api.layout(refSourceId, sheet).subscribe({
      next: layout => {
        if (this.form().refSourceId !== refSourceId) {
          return;
        }
        this.refLayout.set(layout);
        this.takeLayoutSheet('refSheet', RPT_FIELD.refSheet, layout.sheet);
      },
      error: (problem: ProblemDetail) => this.saveError.set(this.problemText(problem))
    });
  }

  /** An empty sheet takes the sheet the server read the columns from; the field is filled, so "choose again" goes away. */
  private takeLayoutSheet(slot: 'sourceSheet' | 'refSheet', name: string, sheet: number | null): void {
    if (this.form()[slot] !== null || sheet === null) {
      return;
    }
    this.form.update(state => ({ ...state, [slot]: sheet }));
    const again = new Set(this.chooseAgain());
    again.delete(name);
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

  private applyChange(change: RptFormChange, filled: string[]): void {
    const again = new Set(this.chooseAgain());
    filled.forEach(name => again.delete(name));
    change.cleared.forEach(name => again.add(name));
    this.form.set(change.state);
    this.chooseAgain.set(again);
    this.fieldErrors.update(list => list.filter(error => !filled.includes(error.field)));
    this.touched.set(true);
  }

  private keepValue(change: RptFormChange, values: Partial<RptFormState>, name: string): RptFormChange {
    return { state: { ...change.state, ...values }, cleared: change.cleared.filter(item => item !== name) };
  }

  /** The reference cannot be the source itself: a source equal to the chosen reference drops the reference. */
  private dropRefSource(change: RptFormChange): RptFormChange {
    const refChange = rptOnRefChanged({ ...change.state, refSourceId: null });
    this.refLayout.set(null);
    return { state: refChange.state, cleared: [...change.cleared, ...refChange.cleared, FIELD_REF_SOURCE] };
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

  private buildLevelOptions(): RptLevelOption[] {
    const source = this.sourceLayout();
    if (source === null) {
      return [];
    }
    const state = this.form();
    const measureField = state.measureKind === 'total' ? state.measureField : null;
    return rptLevelOptions(source, state.useRef ? this.refLayout() : null, measureField);
  }

  private columnsOf(layout: RptSourceLayout | null, pick: (layout: RptSourceLayout) => RptColumn[]): RptColumn[] {
    return layout === null ? [] : pick(layout);
  }

  /** Label of the column chosen in the field (for the error text); the raw field name when the column is unknown. */
  private chosenLabel(name: string): string {
    const state = this.form();
    const keyMatch = /^ref\.keys\[(\d+)\]\.(field|refField)$/.exec(name);
    if (keyMatch) {
      const key = state.keys[Number(keyMatch[1])];
      return keyMatch[2] === 'field'
        ? this.labelIn(this.sourceLayout(), key?.field ?? null)
        : this.labelIn(this.refLayout(), key?.refField ?? null);
    }
    if (name === RPT_FIELD.dateField) {
      return this.labelIn(this.sourceLayout(), state.dateField);
    }
    if (name === RPT_FIELD.measureField) {
      return this.labelIn(this.sourceLayout(), state.measureField);
    }
    if (name === RPT_FIELD.level1 || name === RPT_FIELD.level2) {
      const level = name === RPT_FIELD.level1 ? state.level1 : state.level2;
      return this.labelIn(level?.origin === 'ref' ? this.refLayout() : this.sourceLayout(), level?.field ?? null);
    }
    return '';
  }

  private labelIn(layout: RptSourceLayout | null, field: string | null): string {
    if (field === null) {
      return '';
    }
    return layout?.columns.find(column => column.field === field)?.label ?? field;
  }
}
