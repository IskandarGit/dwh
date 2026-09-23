import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { BehaviorSubject, EMPTY, Observable, combineLatest, of } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { ProblemDetail } from '../../../core/models/common.models';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { parseUplFieldErrors } from '../../upl/formats/upl-format-errors';
import {
  OVW_PAGE_SIZE,
  OvwApiService,
  OvwColumn,
  OvwColumnKind,
  OvwFilter,
  OvwGroupsResult,
  OvwLayout,
  OvwPackage,
  OvwRowsPage,
  OvwSource,
  ovwKind
} from './ovw-api';
import { OvwFormattedValue, formatOvwValue, parseOvwDateInput, parseOvwNumberInput } from './ovw-format';
import {
  OvwDropReason,
  OvwDropped,
  OvwView,
  OvwViewFilter,
  parseOvwView,
  sanitizeOvwView,
  serializeOvwView,
  toOvwGroupsQuery,
  toOvwRowsQuery
} from './ovw-view-url';

/** Column of the current sheet with the screen-side kind (filter editor, value format). */
export interface OvwScreenColumn extends OvwColumn {
  kind: OvwColumnKind;
}

/** What the user typed in the filter row, before it becomes part of the view. */
interface OvwFilterDraft {
  text: string;
  from: string;
  to: string;
}

interface OvwRowView {
  origin: string;
  cells: OvwFormattedValue[];
}

type OvwSourcesState = 'loading' | 'ready' | 'empty' | 'error';

const MAX_PACKAGES_SHOWN = 3;
const MAX_FILTERS = 20;
const FILTER_ADDRESS = /^filters\[(\d+)\]$/;
const PAGE_INVALID = 'OVW_PAGE_INVALID';

const DROP_KEYS: Record<OvwDropReason, string> = {
  column: 'ovw.url.dropped_column',
  value: 'ovw.url.dropped_value',
  page: 'ovw.url.dropped_page',
  source: 'ovw.url.dropped_source'
};

function emptyDraft(): OvwFilterDraft {
  return { text: '', from: '', to: '' };
}

function sameView(left: OvwView, right: OvwView): boolean {
  return JSON.stringify(serializeOvwView(left)) === JSON.stringify(serializeOvwView(right));
}

function shortDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}.${month}.${year.slice(-2)}` : iso;
}

function formatCount(value: number): string {
  return formatOvwValue('number', String(value)).text;
}

@Component({
  selector: 'app-ovw-data',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ovw-data.page.html',
  styleUrl: './ovw-data.page.scss',
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, UiButtonComponent]
})
export class OvwDataPage implements OnInit {
  private readonly api = inject(OvwApiService);
  private readonly i18n = inject(I18nService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly sources = signal<OvwSource[]>([]);
  readonly sourcesState = signal<OvwSourcesState>('loading');
  readonly layout = signal<OvwLayout | null>(null);
  readonly view = signal<OvwView | null>(null);
  readonly rows = signal<OvwRowsPage | null>(null);
  readonly groups = signal<OvwGroupsResult | null>(null);
  readonly dropped = signal<OvwDropped[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly drafts = signal<Record<string, OvwFilterDraft>>({});
  readonly showAllPackages = signal(false);

  readonly columns = computed<OvwScreenColumn[]>(() =>
    (this.layout()?.columns ?? []).map(column => ({ ...column, kind: ovwKind(column.type) }))
  );
  readonly summableColumns = computed(() => this.columns().filter(column => column.summable));
  readonly groupColumn = computed(() => {
    const field = this.view()?.groupBy ?? null;
    return this.columns().find(column => column.field === field) ?? null;
  });
  readonly mode = computed<'rows' | 'groups' | 'group-rows'>(() => {
    const current = this.view();
    if (current === null || current.groupBy === null) {
      return 'rows';
    }
    return current.group === null ? 'groups' : 'group-rows';
  });
  readonly rowViews = computed<OvwRowView[]>(() => {
    const columns = this.columns();
    return (this.rows()?.items ?? []).map(row => ({
      origin: `${row.file} · ${row.sheet} · ${row.excelRow}`,
      cells: columns.map(column => formatOvwValue(column.kind, row.values[column.field] ?? null))
    }));
  });
  readonly hasFilters = computed(() => (this.view()?.filters.length ?? 0) > 0);
  readonly currentPage = computed(() => this.view()?.page ?? 1);
  readonly pageCount = computed(() => Math.max(1, Math.ceil((this.rows()?.total ?? 0) / OVW_PAGE_SIZE)));
  readonly visiblePackages = computed<OvwPackage[]>(() => {
    const packages = this.layout()?.packages ?? [];
    return this.showAllPackages() ? packages : packages.slice(0, MAX_PACKAGES_SHOWN);
  });
  readonly hiddenPackages = computed(() => {
    const total = this.layout()?.packages.length ?? 0;
    return this.showAllPackages() ? 0 : Math.max(0, total - MAX_PACKAGES_SHOWN);
  });

  private readonly refresh$ = new BehaviorSubject<void>(undefined);
  private layoutCache: { key: string; layout: OvwLayout } | null = null;
  private carriedDropped: OvwDropped[] = [];
  private paramsSubscribed = false;

  ngOnInit(): void {
    this.loadSources();
  }

  retry(): void {
    if (this.sourcesState() === 'error') {
      this.loadSources();
      return;
    }
    this.layoutCache = null;
    this.refresh$.next();
  }

  // ---- header ----

  selectSource(sourceId: number): void {
    this.go({ src: sourceId, sh: null, filters: [], sort: null, groupBy: null, group: null, page: 1 }, true);
  }

  selectSheet(sheet: number): void {
    const current = this.view();
    if (current === null) {
      return;
    }
    this.go({ ...current, sh: sheet, filters: [], sort: null, groupBy: null, group: null, page: 1 }, true);
  }

  selectGroupBy(field: string | null): void {
    const current = this.view();
    if (current === null || current.groupBy === field) {
      return;
    }
    this.go({ ...current, groupBy: field, group: null, page: 1 }, true);
  }

  resetView(): void {
    const current = this.view();
    if (current === null) {
      return;
    }
    this.go({ ...current, filters: [], sort: null, groupBy: null, group: null, page: 1 }, true);
  }

  resetFilters(): void {
    const current = this.view();
    if (current === null) {
      return;
    }
    this.go({ ...current, filters: [], page: 1 }, true);
  }

  expandPackages(): void {
    this.showAllPackages.set(true);
  }

  packageText(item: OvwPackage): string {
    return `${item.fileName} (${shortDate(item.periodFrom)}–${shortDate(item.periodTo)})`;
  }

  count(value: number): string {
    return formatCount(value);
  }

  // ---- rows table ----

  toggleSort(field: string): void {
    const current = this.view();
    if (current === null) {
      return;
    }
    const sort = current.sort;
    let next: OvwView['sort'];
    if (sort === null || sort.field !== field) {
      next = { field, dir: 'asc' };
    } else {
      next = sort.dir === 'asc' ? { field, dir: 'desc' } : null;
    }
    this.go({ ...current, sort: next, page: 1 }, true);
  }

  sortMark(field: string): string {
    const sort = this.view()?.sort ?? null;
    if (sort === null || sort.field !== field) {
      return '';
    }
    return sort.dir === 'asc' ? '▲' : '▼';
  }

  goToPage(page: number): void {
    const current = this.view();
    const target = Math.min(Math.max(1, page), this.pageCount());
    if (current === null || target === current.page) {
      return;
    }
    this.go({ ...current, page: target }, true);
  }

  rangeText(): string {
    const page = this.rows();
    if (page === null) {
      return '';
    }
    const from = page.items.length === 0 ? 0 : page.offset + 1;
    const range = this.i18n.translate('ovw.rows_range', {
      from: formatCount(from),
      to: formatCount(page.offset + page.items.length),
      total: formatCount(page.total)
    });
    if (!this.hasFilters()) {
      return range;
    }
    const all = this.i18n.translate('ovw.rows_filtered', { all: formatCount(this.layout()?.rowsTotal ?? 0) });
    return `${range} ${all}`;
  }

  pageText(): string {
    return this.i18n.translate('ovw.page_of', { page: formatCount(this.currentPage()), pages: formatCount(this.pageCount()) });
  }

  // ---- filters ----

  draft(field: string): OvwFilterDraft {
    return this.drafts()[field] ?? emptyDraft();
  }

  editDraft(field: string, part: keyof OvwFilterDraft, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.drafts.update(all => ({ ...all, [field]: { ...(all[field] ?? emptyDraft()), [part]: value } }));
  }

  applyFilter(column: OvwScreenColumn): void {
    const current = this.view();
    if (current === null) {
      return;
    }
    const filter = this.draftToFilter(column);
    if (filter === 'invalid') {
      return;
    }
    this.clearFieldError(column.field);
    const others = current.filters.filter(item => item.field !== column.field);
    const filters = filter === null ? others : [...others, filter];
    if (JSON.stringify(filters) === JSON.stringify(current.filters)) {
      return;
    }
    this.go({ ...current, filters, page: 1 }, true);
  }

  // ---- groups ----

  groupValueText(value: string | null): string {
    const column = this.groupColumn();
    if (value === null || column === null) {
      return this.i18n.translate('ovw.empty_value');
    }
    return formatOvwValue(column.kind, value).text;
  }

  sumText(sums: Record<string, string>, field: string): string {
    return formatOvwValue('number', sums[field] ?? null).text;
  }

  sumHeader(column: OvwScreenColumn): string {
    return this.i18n.translate('ovw.col.sum', { label: column.label });
  }

  groupsCaption(): string {
    const result = this.groups();
    if (result === null) {
      return '';
    }
    if (result.groupsShown < result.groupsTotal) {
      return this.i18n.translate('ovw.groups_limited', {
        shown: formatCount(result.groupsShown),
        total: formatCount(result.groupsTotal)
      });
    }
    return this.i18n.translate('ovw.groups_total', { n: formatCount(result.groupsTotal) });
  }

  openGroup(value: string | null): void {
    const current = this.view();
    if (current === null) {
      return;
    }
    this.go({ ...current, group: { value }, page: 1 }, false);
  }

  backToGroups(): void {
    const current = this.view();
    if (current === null) {
      return;
    }
    this.go({ ...current, group: null, page: 1 }, false);
  }

  openGroupText(): string {
    const column = this.groupColumn();
    const group = this.view()?.group ?? null;
    if (column === null || group === null) {
      return '';
    }
    return `${column.label} = ${this.groupValueText(group.value)}`;
  }

  droppedText(item: OvwDropped): string {
    return this.i18n.translate(DROP_KEYS[item.reason], { field: item.field ?? '' });
  }

  // ---- loading ----

  private loadSources(): void {
    this.sourcesState.set('loading');
    this.loadError.set(null);
    this.api.sources().subscribe({
      next: list => {
        const sources = list ?? [];
        this.sources.set(sources);
        if (sources.length === 0) {
          this.sourcesState.set('empty');
          return;
        }
        this.sourcesState.set('ready');
        this.watchAddress();
      },
      error: (problem: ProblemDetail) => {
        this.sourcesState.set('error');
        this.loadError.set(this.problemText(problem));
      }
    });
  }

  /** All data requests start here: the address is the only source of the view. */
  private watchAddress(): void {
    if (this.paramsSubscribed) {
      return;
    }
    this.paramsSubscribed = true;
    combineLatest([this.route.queryParams, this.refresh$])
      .pipe(
        switchMap(([params]) => this.load(params)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private load(params: Params): Observable<unknown> {
    const parsed = parseOvwView(params);
    const carried = this.carriedDropped;
    this.carriedDropped = [];
    const known = this.sources().some(source => source.id === parsed.src);
    const src = known ? (parsed.src as number) : this.sources()[0].id;
    const sourceDropped: OvwDropped[] =
      parsed.src !== null && !known ? [{ reason: 'source', field: String(parsed.src) }] : [];
    const wanted: OvwView = { ...parsed, src };

    this.loading.set(true);
    this.loadError.set(null);
    this.fieldErrors.set({});
    return this.layoutFor(src, parsed.sh).pipe(
      switchMap(layout => {
        const clean = sanitizeOvwView(wanted, layout.columns);
        const dropped = [...carried, ...sourceDropped, ...clean.dropped];
        if (!sameView(parsed, clean.view)) {
          this.carriedDropped = dropped;
          this.go(clean.view, true);
          return EMPTY;
        }
        this.applyLayout(layout);
        this.dropped.set(dropped);
        this.view.set(clean.view);
        this.syncDrafts(clean.view);
        return this.query(clean.view, layout);
      }),
      catchError((problem: ProblemDetail) => {
        this.showFailure(problem);
        return EMPTY;
      })
    );
  }

  private layoutFor(src: number, sheet: number | null): Observable<OvwLayout> {
    const key = `${src}|${sheet ?? ''}`;
    if (this.layoutCache !== null && this.layoutCache.key === key) {
      return of(this.layoutCache.layout);
    }
    return this.api.layout(src, sheet).pipe(tap(layout => (this.layoutCache = { key, layout })));
  }

  private applyLayout(layout: OvwLayout): void {
    if (this.layout() !== layout) {
      this.showAllPackages.set(false);
      this.layout.set(layout);
    }
  }

  private sheetOf(layout: OvwLayout, view: OvwView): number {
    return layout.sheet ?? view.sh ?? layout.sheets[0]?.ordinal ?? 1;
  }

  private query(view: OvwView, layout: OvwLayout): Observable<unknown> {
    const src = view.src as number;
    const sheet = this.sheetOf(layout, view);
    if (view.groupBy !== null && view.group === null) {
      const request = toOvwGroupsQuery(view, sheet);
      return this.api.groups(src, request).pipe(
        tap(result => {
          this.rows.set(null);
          this.groups.set(result);
          this.loading.set(false);
        }),
        catchError((problem: ProblemDetail) => this.queryFailed(problem, view, request.filters))
      );
    }
    const request = toOvwRowsQuery(view, sheet);
    return this.api.rows(src, request).pipe(
      tap(page => {
        this.groups.set(null);
        this.rows.set(page);
        this.loading.set(false);
      }),
      catchError((problem: ProblemDetail) => this.queryFailed(problem, view, request.filters))
    );
  }

  private queryFailed(problem: ProblemDetail, view: OvwView, sent: OvwFilter[]): Observable<never> {
    const errors = parseUplFieldErrors(problem?.errors);
    if (problem?.status === 422 && view.page > 1 && errors.some(error => error.code === PAGE_INVALID)) {
      this.carriedDropped = [...this.dropped(), { reason: 'page', field: null }];
      this.go({ ...view, page: 1 }, true);
      return EMPTY;
    }
    this.rows.set(null);
    this.groups.set(null);
    this.loading.set(false);
    if (problem?.status !== 422 || errors.length === 0) {
      this.loadError.set(this.problemText(problem));
      return EMPTY;
    }
    const byField: Record<string, string> = {};
    const banner: string[] = [];
    for (const error of errors) {
      const match = FILTER_ADDRESS.exec(error.field);
      const field = match ? sent[Number(match[1])]?.field : undefined;
      const text = this.codeText(error.code, field ?? error.field);
      if (field !== undefined && this.columns().some(column => column.field === field)) {
        byField[field] = text;
      } else {
        banner.push(text);
      }
    }
    this.fieldErrors.set(byField);
    this.loadError.set(banner.length > 0 ? banner.join(' · ') : null);
    return EMPTY;
  }

  private showFailure(problem: ProblemDetail): void {
    this.rows.set(null);
    this.groups.set(null);
    this.loading.set(false);
    this.loadError.set(this.problemText(problem));
  }

  /** 404, 400, 503 and the rest: our code is in `detail`, otherwise in `errors[]`. */
  private problemText(problem: ProblemDetail): string {
    const code = problem?.detail ?? parseUplFieldErrors(problem?.errors)[0]?.code ?? '';
    return this.codeText(code, '');
  }

  private codeText(code: string, field: string): string {
    const key = 'ovw.err.' + code;
    const label = this.columns().find(column => column.field === field)?.label ?? field;
    const text = this.i18n.translate(key, { field, label, limit: MAX_FILTERS });
    return text === key ? this.i18n.translate('ovw.load_error') : text;
  }

  private go(view: OvwView, replace: boolean): void {
    const queryParams = serializeOvwView(view);
    void this.router.navigate([], replace ? { queryParams, replaceUrl: true } : { queryParams });
  }

  // ---- filter drafts ----

  private syncDrafts(view: OvwView): void {
    const drafts: Record<string, OvwFilterDraft> = {};
    for (const column of this.columns()) {
      drafts[column.field] = this.draftOf(column, view.filters.find(filter => filter.field === column.field));
    }
    this.drafts.set(drafts);
  }

  private draftOf(column: OvwScreenColumn, filter: OvwViewFilter | undefined): OvwFilterDraft {
    if (filter === undefined) {
      return emptyDraft();
    }
    if (filter.kind === 'c') {
      return { ...emptyDraft(), text: filter.text };
    }
    return {
      text: '',
      from: formatOvwValue(column.kind, filter.from).text,
      to: formatOvwValue(column.kind, filter.to).text
    };
  }

  private draftToFilter(column: OvwScreenColumn): OvwViewFilter | null | 'invalid' {
    const draft = this.draft(column.field);
    if (column.kind === 'text') {
      const text = draft.text.trim();
      return text === '' ? null : { field: column.field, kind: 'c', text };
    }
    const parse = column.kind === 'number' ? parseOvwNumberInput : parseOvwDateInput;
    const from = draft.from.trim() === '' ? null : parse(draft.from);
    const to = draft.to.trim() === '' ? null : parse(draft.to);
    if ((draft.from.trim() !== '' && from === null) || (draft.to.trim() !== '' && to === null)) {
      const key = column.kind === 'number' ? 'ovw.filter.need_number' : 'ovw.filter.need_date';
      this.fieldErrors.update(all => ({ ...all, [column.field]: this.i18n.translate(key) }));
      return 'invalid';
    }
    return from === null && to === null ? null : { field: column.field, kind: 'r', from, to };
  }

  private clearFieldError(field: string): void {
    if (!(field in this.fieldErrors())) {
      return;
    }
    this.fieldErrors.update(all => {
      const next = { ...all };
      delete next[field];
      return next;
    });
  }
}
