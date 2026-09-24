import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  computed,
  inject,
  signal
} from '@angular/core';
import { Subscription } from 'rxjs';
import { ProblemDetail } from '../../../core/models/common.models';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { formatOvwValue } from '../../ovw/overview/ovw-format';
import { parseUplFieldErrors } from '../../upl/formats/upl-format-errors';
import { RPT_PAGE_SIZE, RptApiService, RptCellItem, RptCellQuery, RptCellRows, RptDivisor, RptPeriod } from '../shared/rpt-api';
import { formatRptNumber, formatRptRaw, rptUnitKey } from '../shared/rpt-format';

/** Measure number of the report: 1 — the first measure, 2 — the second one. */
export type RptMeasureNo = 1 | 2;

/** Which cell of the report the panel explains: period, path and measure as the cell query wants them. */
export interface RptCellTarget {
  period: RptPeriod;
  path: (string | null)[];
  /** Missing — the first measure (a report with one measure). */
  measure?: RptMeasureNo;
}

/** Column captions of the panel: measure null — the report counts rows, the column is not shown; level2 null — one level. */
export interface RptPanelLabels {
  measure: string | null;
  level1: string;
  level2: string | null;
}

interface RptPanelRow {
  origin: string;
  date: string;
  column: string;
  measure: string;
  level1: string;
  level2: string;
}

@Component({
  selector: 'app-rpt-cell-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rpt-cell-panel.component.html',
  styleUrl: './rpt-cell-panel.component.scss',
  imports: [TranslatePipe, UiButtonComponent]
})
export class RptCellPanelComponent implements OnChanges {
  private readonly api = inject(RptApiService);
  private readonly i18n = inject(I18nService);

  @Input({ required: true }) reportId!: number;
  @Input({ required: true }) year!: number | null;
  @Input({ required: true }) target!: RptCellTarget;
  @Input({ required: true }) heading!: string;
  /** The number of the table cell as the server sent it (already divided). */
  @Input({ required: true }) tableValue!: string;
  @Input({ required: true }) divisor!: RptDivisor;
  @Input({ required: true }) decimals!: number;
  @Input({ required: true }) labels!: RptPanelLabels;
  @Output() readonly closed = new EventEmitter<void>();

  readonly rows = signal<RptCellRows | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly page = signal(1);

  readonly pageCount = computed(() => Math.max(1, Math.ceil((this.rows()?.total ?? 0) / RPT_PAGE_SIZE)));
  readonly items = computed<RptPanelRow[]>(() => (this.rows()?.items ?? []).map(item => this.rowOf(item)));
  /** A measure by month columns names the month column of each row instead of its date. */
  readonly byColumns = computed(() => (this.rows()?.items ?? []).some(item => item.column !== null));

  private request: Subscription | null = null;

  ngOnChanges(): void {
    this.load(1);
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.closed.emit();
  }

  /** Level columns only where rows of different groups meet: the grand total and a level 1 subtotal. */
  showLevel1(): boolean {
    return this.target.path.length < 1;
  }

  showLevel2(): boolean {
    return this.labels.level2 !== null && this.target.path.length < 2;
  }

  summary(): string {
    const rows = this.rows();
    if (rows === null) {
      return '';
    }
    const raw = formatRptRaw(rows.value);
    const n = formatRptRaw(String(rows.total));
    if (this.divisor > 1) {
      return this.i18n.translate('rpt.panel.summary', {
        value: formatRptNumber(this.tableValue, this.decimals),
        unit: this.i18n.translate(rptUnitKey(this.divisor)),
        raw,
        n
      });
    }
    return this.i18n.translate('rpt.panel.summary_plain', { raw, n });
  }

  pageText(): string {
    return this.i18n.translate('rpt.panel.page', {
      page: formatRptRaw(String(this.page())),
      pages: formatRptRaw(String(this.pageCount()))
    });
  }

  goToPage(page: number): void {
    const target = Math.min(Math.max(1, page), this.pageCount());
    if (target !== this.page()) {
      this.load(target);
    }
  }

  private load(page: number): void {
    this.request?.unsubscribe();
    this.page.set(page);
    this.loading.set(true);
    this.loadError.set(null);
    const query: RptCellQuery = {
      year: this.year,
      period: this.target.period,
      path: this.target.path,
      offset: (page - 1) * RPT_PAGE_SIZE
    };
    if (this.target.measure !== undefined) {
      query.measure = this.target.measure;
    }
    this.request = this.api.cells(this.reportId, query).subscribe({
      next: rows => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (problem: ProblemDetail) => {
        this.rows.set(null);
        this.loading.set(false);
        this.loadError.set(this.problemText(problem));
      }
    });
  }

  private rowOf(item: RptCellItem): RptPanelRow {
    const noName = this.i18n.translate('rpt.view.no_name');
    return {
      origin: `${item.file} · ${item.sheet} · ${item.excelRow}`,
      date: formatOvwValue('date', item.date).text,
      column: item.column ?? '',
      measure: formatRptRaw(item.measure),
      level1: item.level1 ?? noName,
      level2: item.level2 ?? noName
    };
  }

  /** Our code is in `detail` (404, 409, 503) or in `errors[]` (422); unknown code — the text of the framework. */
  private problemText(problem: ProblemDetail): string {
    const codes = [problem?.detail ?? '', parseUplFieldErrors(problem?.errors)[0]?.code ?? ''];
    for (const code of codes) {
      const key = 'rpt.err.' + code;
      const text = this.i18n.translate(key);
      if (code !== '' && text !== key) {
        return text;
      }
    }
    return problem?.detail || problem?.title || this.i18n.translate('common.error');
  }
}
