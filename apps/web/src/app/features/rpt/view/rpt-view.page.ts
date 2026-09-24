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
import { RptApiService, RptPeriod, RptReportView } from '../shared/rpt-api';
import { formatRptNumber, rptUnitKey } from '../shared/rpt-format';
import { RptRow, rptAllGroupIds, rptVisibleRows } from '../shared/rpt-tree';
import { RptCellPanelComponent, RptCellTarget, RptPanelLabels } from './rpt-cell-panel.component';

/** Everything the panel "where the number comes from" needs about the clicked cell. */
export interface RptPanelState {
  target: RptCellTarget;
  heading: string;
  tableValue: string;
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
  readonly panelLabels = computed<RptPanelLabels | null>(() => {
    const labels = this.view()?.labels ?? null;
    return labels === null ? null : { measure: labels.measure, level1: labels.level1, level2: labels.level2 };
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

  digitsText(): string {
    const current = this.view();
    if (current === null) {
      return '';
    }
    return this.i18n.translate('rpt.view.digits', {
      unit: this.i18n.translate(rptUnitKey(current.divisor)),
      n: current.decimals
    });
  }

  measureText(): string {
    const measure = this.view()?.labels.measure ?? null;
    return this.i18n.translate('rpt.view.measure', { label: measure ?? this.i18n.translate('rpt.view.count_measure') });
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

  monthName(month: number): string {
    return this.i18n.translate('rpt.month.' + month);
  }

  openMonth(row: RptRow, month: number): void {
    this.openCell(row.path, { kind: 'month', month }, row.cells[month - 1]);
  }

  openYear(row: RptRow): void {
    this.openCell(row.path, { kind: 'year' }, row.total);
  }

  openUndated(): void {
    const undated = this.view()?.undated ?? null;
    if (undated !== null) {
      this.openCell([], { kind: 'undated' }, undated.value);
    }
  }

  closePanel(): void {
    this.panel.set(null);
  }

  undatedText(): string {
    const current = this.view();
    if (current?.undated == null) {
      return '';
    }
    return this.i18n.translate('rpt.view.undated', {
      n: formatRptNumber(String(current.undated.count), 0),
      value: formatRptNumber(current.undated.value, current.decimals)
    });
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

  private openCell(path: (string | null)[], period: RptPeriod, value: string | null): void {
    if (value === null) {
      return;
    }
    this.panel.set({ target: { period, path }, heading: this.heading(path, period), tableValue: value });
  }

  private heading(path: (string | null)[], period: RptPeriod): string {
    const periodText = this.periodText(period);
    if (period.kind === 'undated') {
      return periodText;
    }
    return [...this.pathNames(path), periodText].join(' · ');
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

  private periodText(period: RptPeriod): string {
    const year = this.view()?.year ?? '';
    if (period.kind === 'month') {
      return this.i18n.translate('rpt.month_year', { month: this.monthName(period.month), year });
    }
    if (period.kind === 'year') {
      return this.i18n.translate('rpt.panel.year_total', { year });
    }
    return this.i18n.translate('rpt.panel.undated');
  }
}
