import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { EMPTY, Observable, combineLatest } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { ProblemDetail } from '../../../core/models/common.models';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { PermissionService } from '../../../core/services/permission.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { parseUplProblem } from '../../upl/formats/upl-format-errors';
import { RptApiService, RptDivisor, RptMeasureInfo, RptPeriod, RptReportView, RptUndated } from '../shared/rpt-api';
import { formatRptNumber, rptUnitKey } from '../shared/rpt-format';
import { RptRow, rptAllGroupIds, rptVisibleRows } from '../shared/rpt-tree';
import { RptCellPanelComponent, RptCellTarget, RptMeasureNo, RptPanelLabels } from './rpt-cell-panel.component';

/** Everything the panel "where the number comes from" needs about the clicked cell. */
export interface RptPanelState {
  target: RptCellTarget;
  heading: string;
  tableValue: string;
  divisor: RptDivisor;
  decimals: number;
  labels: RptPanelLabels;
}

/** One "undated" strip: the measure it belongs to and its rows. */
export interface RptUndatedStrip {
  measure: RptMeasureNo;
  undated: RptUndated;
}

const REPORTS_FORM = 'rpt.reports';
const STALE_CODE = 'RPT_DEFINITION_STALE';
/** Server limit of lines in a report (contract, section 5): the text of `RPT_TOO_MANY_LINES` shows it. */
const MAX_LINES = 2000;
const YEAR_PATTERN = /^\d{4}$/;
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
/** Status of the answer → our code when the status alone tells what happened. */
const STATUS_CODES: Record<number, string> = {
  404: 'RPT_REPORT_NOT_FOUND',
  503: 'RPT_QUERY_TIMEOUT'
};

function parseYear(value: string | null): number | null {
  return value !== null && YEAR_PATTERN.test(value) ? Number(value) : null;
}

/** A report without the list of measures is an old answer with one measure by date. */
function hasDatedMeasure(view: RptReportView): boolean {
  return view.measures.length === 0 || view.measures.some(measure => !measure.byMonthColumns);
}

@Component({
  selector: 'app-rpt-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rpt-view.page.html',
  styleUrl: './rpt-view.page.scss',
  imports: [FormsModule, RouterLink, TranslatePipe, UiButtonComponent, RptCellPanelComponent]
})
export class RptViewPage implements OnInit {
  private readonly api = inject(RptApiService);
  private readonly i18n = inject(I18nService);
  private readonly permissions = inject(PermissionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly months = MONTHS;
  readonly reportId = signal<number | null>(null);
  readonly view = signal<RptReportView | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  /** Fields of the description that no longer fit the questionnaire; null — the description is fine. */
  readonly staleFields = signal<string[] | null>(null);
  readonly collapsed = signal<ReadonlySet<string>>(new Set());
  readonly panel = signal<RptPanelState | null>(null);

  readonly canEdit = computed(() => this.permissions.hasPermission(REPORTS_FORM, 'edit'));
  readonly rows = computed<RptRow[]>(() => {
    const current = this.view();
    return current === null ? [] : rptVisibleRows(current, this.collapsed());
  });
  readonly hasLevel2 = computed(() => (this.view()?.labels.level2 ?? null) !== null);
  readonly twoMeasures = computed(() => (this.view()?.measures.length ?? 0) > 1);
  /** Measures of the caption above the table, in the order of the report. */
  readonly measureList = computed<RptMeasureNo[]>(() => (this.twoMeasures() ? [1, 2] : [1]));
  /** The table is drawn when there are dated rows or when no measure needs a date at all. */
  readonly tableVisible = computed(() => {
    const current = this.view();
    return current !== null && (current.years.length > 0 || !hasDatedMeasure(current));
  });
  readonly noDatedRows = computed(() => {
    const current = this.view();
    return current !== null && current.years.length === 0 && hasDatedMeasure(current);
  });
  readonly undatedStrips = computed<RptUndatedStrip[]>(() => {
    const current = this.view();
    if (current === null) {
      return [];
    }
    const strips: RptUndatedStrip[] = [];
    if (current.undated !== null) {
      strips.push({ measure: 1, undated: current.undated });
    }
    if (current.undated2 !== null && current.measures.length > 1) {
      strips.push({ measure: 2, undated: current.undated2 });
    }
    return strips;
  });

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(
        switchMap(([params, query]) => this.load(params, query)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  // ---- header ----

  selectYear(year: number): void {
    if (year === this.view()?.year) {
      return;
    }
    void this.router.navigate([], { queryParams: { y: year }, queryParamsHandling: 'merge' });
  }

  digitsText(measure: RptMeasureNo): string {
    const current = this.view();
    if (current === null) {
      return '';
    }
    const info = this.measureInfo(measure);
    return this.i18n.translate('rpt.view.digits', {
      unit: this.i18n.translate(rptUnitKey(info?.divisor ?? current.divisor)),
      n: info?.decimals ?? current.decimals
    });
  }

  measureText(measure: RptMeasureNo): string {
    return this.i18n.translate('rpt.view.measure', { label: this.measureName(measure) });
  }

  byMonthColumns(measure: RptMeasureNo): boolean {
    return this.measureInfo(measure)?.byMonthColumns ?? false;
  }

  /**
   * Name of the measure from the description; the first measure without a name keeps the former caption.
   * A measure by month columns always sums values, so it is never called "number of rows".
   */
  measureName(measure: RptMeasureNo): string {
    const current = this.view();
    const name = current?.measures[measure - 1]?.name ?? null;
    if (name !== null) {
      return name;
    }
    if (measure === 2) {
      return this.i18n.translate('rpt.edit.block_measure2');
    }
    const fallbackKey = this.byMonthColumns(1) ? 'rpt.edit.block_measure1' : 'rpt.view.count_measure';
    return current?.labels.measure ?? this.i18n.translate(fallbackKey);
  }

  /** Caption of the last block: "January – <month N>", just "January" when N = 1. */
  ytdText(): string {
    const month = this.view()?.ytdMonth ?? 12;
    if (month <= 1) {
      return this.monthName(1);
    }
    return this.i18n.translate('rpt.view.ytd', { month: this.monthName(month).toLowerCase() });
  }

  expandAll(): void {
    this.collapsed.set(new Set());
  }

  collapseAll(): void {
    const current = this.view();
    if (current !== null) {
      this.collapsed.set(new Set(rptAllGroupIds(current)));
    }
  }

  editLink(): (string | number)[] {
    return ['/rpt/reports', this.reportId() ?? '', 'edit'];
  }

  // ---- table ----

  toggle(row: RptRow): void {
    if (!row.hasChildren) {
      return;
    }
    this.collapsed.update(all => {
      const next = new Set(all);
      if (next.has(row.id)) {
        next.delete(row.id);
      } else {
        next.add(row.id);
      }
      return next;
    });
  }

  rowName(row: RptRow): string {
    if (row.kind === 'grand') {
      return this.i18n.translate('rpt.view.grand');
    }
    return row.name ?? this.i18n.translate('rpt.view.no_name');
  }

  number(value: string | null): string {
    return formatRptNumber(value, this.view()?.decimals ?? 0);
  }

  number2(value: string | null): string {
    return formatRptNumber(value, this.measureInfo(2)?.decimals ?? 0);
  }

  /** The ratio comes from the server; the screen only rounds it to an integer. */
  percent(value: string | null): string {
    return formatRptNumber(value, 0);
  }

  monthName(month: number): string {
    return this.i18n.translate('rpt.month.' + month);
  }

  openMonth(row: RptRow, month: number, measure: RptMeasureNo = 1): void {
    const cells = measure === 1 ? row.cells : row.m2?.cells ?? [];
    this.openCell(row.path, { kind: 'month', month }, cells[month - 1] ?? null, measure);
  }

  openYear(row: RptRow, measure: RptMeasureNo = 1): void {
    const total = measure === 1 ? row.total : row.m2?.total ?? null;
    this.openCell(row.path, { kind: 'year' }, total, measure);
  }

  openUndated(strip: RptUndatedStrip): void {
    this.openCell([], { kind: 'undated' }, strip.undated.value, strip.measure);
  }

  closePanel(): void {
    this.panel.set(null);
  }

  undatedText(strip: RptUndatedStrip): string {
    const count = formatRptNumber(String(strip.undated.count), 0);
    const value = formatRptNumber(strip.undated.value, this.measureInfo(strip.measure)?.decimals ?? this.view()?.decimals ?? 0);
    if (!this.twoMeasures()) {
      return this.i18n.translate('rpt.view.undated', { n: count, value });
    }
    return this.i18n.translate('rpt.view.undated_measure', { measure: this.measureName(strip.measure), count, value });
  }

  duplicatesText(): string {
    return this.i18n.translate('rpt.view.ref_duplicates', { n: this.view()?.refDuplicateKeys ?? 0 });
  }

  // ---- loading ----

  private load(params: ParamMap, query: ParamMap): Observable<unknown> {
    const id = Number(params.get('id'));
    const year = parseYear(query.get('y'));
    this.reportId.set(id);
    this.panel.set(null);
    this.loading.set(true);
    this.loadError.set(null);
    this.staleFields.set(null);
    return this.api.view(id, year).pipe(
      tap(view => {
        this.collapsed.set(new Set());
        this.view.set(view);
        this.loading.set(false);
      }),
      catchError((problem: ProblemDetail) => {
        this.showFailure(problem);
        return EMPTY;
      })
    );
  }

  private showFailure(problem: ProblemDetail): void {
    this.view.set(null);
    this.loading.set(false);
    if (problem?.status === 409 && problem.detail === STALE_CODE) {
      this.staleFields.set(parseUplProblem(problem).map(error => error.field));
      return;
    }
    this.loadError.set(this.problemText(problem));
  }

  /** Our code by the status or in `detail`, then in `errors[]`; an unknown code — the text of the framework. */
  private problemText(problem: ProblemDetail): string {
    const codes = [STATUS_CODES[problem?.status] ?? '', problem?.detail ?? '', parseUplProblem(problem)[0]?.code ?? ''];
    for (const code of codes) {
      const key = 'rpt.err.' + code;
      const text = this.i18n.translate(key, { limit: MAX_LINES });
      if (code !== '' && text !== key) {
        return text;
      }
    }
    return problem?.detail || problem?.title || this.i18n.translate('common.error');
  }

  private measureInfo(measure: RptMeasureNo): RptMeasureInfo | null {
    return this.view()?.measures[measure - 1] ?? null;
  }

  private openCell(path: (string | null)[], period: RptPeriod, value: string | null, measure: RptMeasureNo): void {
    const current = this.view();
    if (value === null || current === null) {
      return;
    }
    const two = this.twoMeasures();
    const info = this.measureInfo(measure);
    this.panel.set({
      target: two ? { period, path, measure } : { period, path },
      heading: this.heading(path, period, measure, two),
      tableValue: value,
      divisor: info?.divisor ?? current.divisor,
      decimals: info?.decimals ?? current.decimals,
      labels: this.panelLabels(current, measure)
    });
  }

  /** The value column of the second measure is captioned with its name; the first one keeps the column caption. */
  private panelLabels(view: RptReportView, measure: RptMeasureNo): RptPanelLabels {
    const caption = measure === 1 ? view.labels.measure : this.measureName(2);
    return { measure: caption, level1: view.labels.level1, level2: view.labels.level2 };
  }

  /** "<measure> · <line names> · <period>"; the measure name only when the report has two measures. */
  private heading(path: (string | null)[], period: RptPeriod, measure: RptMeasureNo, named: boolean): string {
    const periodText = this.periodText(period, measure);
    const parts = period.kind === 'undated' ? [periodText] : [...this.pathNames(path), periodText];
    return (named ? [this.measureName(measure), ...parts] : parts).join(' · ');
  }

  private pathNames(path: (string | null)[]): string[] {
    const noName = this.i18n.translate('rpt.view.no_name');
    if (path.length === 0) {
      return [this.i18n.translate('rpt.view.grand')];
    }
    const line = this.view()?.lines.find(item => item.key === path[0]) ?? null;
    const names = [line?.name ?? noName];
    if (path.length > 1) {
      const child = line?.lines.find(item => item.key === path[1]) ?? null;
      names.push(child?.name ?? noName);
    }
    return names;
  }

  /**
   * Period of the panel heading: the total cell carries the same caption as the head of the table;
   * a month of a measure by month columns, or of a report without a year, is written without a year.
   */
  private periodText(period: RptPeriod, measure: RptMeasureNo): string {
    if (period.kind === 'year') {
      return this.ytdText();
    }
    if (period.kind === 'undated') {
      return this.i18n.translate('rpt.panel.undated');
    }
    const month = this.monthName(period.month);
    const year = this.view()?.year ?? null;
    if (year === null || this.byMonthColumns(measure)) {
      return month;
    }
    return this.i18n.translate('rpt.month_year', { month, year });
  }
}
