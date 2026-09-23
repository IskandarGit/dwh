import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PACKAGED_RUSSIAN } from '../../../core/i18n/packaged-russian';
import { FieldErrorItem, ProblemDetail } from '../../../core/models/common.models';
import {
  OvwApiService,
  OvwGroupsResult,
  OvwLayout,
  OvwRow,
  OvwRowsPage,
  OvwRowsQuery,
  OvwSource
} from './ovw-api';
import { OvwDataPage } from './ovw-data.page';

const NBSP = ' ';

const sourceList: OvwSource[] = [
  { id: 1, code: 'tax.test', name: 'Nalogi TEST' },
  { id: 2, code: 'base.test', name: 'Baza TEST' }
];

function layout(patch: Partial<OvwLayout> = {}): OvwLayout {
  return {
    sourceId: 1,
    sheets: [{ ordinal: 1, name: 'TEST' }],
    sheet: 1,
    formatVersion: 2,
    columns: [
      { field: 'region', label: 'Region TEST', type: 'text', summable: false },
      { field: 'doc_date', label: 'Data TEST', type: 'date', summable: false },
      { field: 'amount', label: 'Summa TEST', type: 'number', summable: true }
    ],
    packages: [{ fileName: 'a.xlsx', periodFrom: '2024-01-01', periodTo: '2024-01-31' }],
    rowsTotal: 1883,
    ...patch
  };
}

function row(index: number): OvwRow {
  return {
    file: 'a.xlsx',
    sheet: 'TEST',
    excelRow: index + 5,
    values: { region: `TEST-${index}`, doc_date: '2024-01-31', amount: '1234.5' }
  };
}

function rowsPage(total = 450, count = 200): OvwRowsPage {
  return { total, offset: 0, limit: 200, items: Array.from({ length: count }, (_, index) => row(index)) };
}

const groupsResult: OvwGroupsResult = {
  groupsTotal: 1250,
  groupsShown: 1000,
  groups: [
    { value: 'TEST-A', count: 120, sums: { amount: '15000' } },
    { value: null, count: 3, sums: { amount: '10' } }
  ],
  total: { count: 1883, sums: { amount: '24510.5' } }
};

function problem(status: number, detail: string, errors?: FieldErrorItem[]): ProblemDetail {
  return { title: 'TEST', status, code: 'TEST', detail, errors };
}

function ru(key: string, params: Record<string, string | number> = {}): string {
  return PACKAGED_RUSSIAN[key].replace(/\{(\w+)\}/g, (_: string, name: string) => String(params[name]));
}

interface FixtureOptions {
  params?: Params;
  sources?: OvwSource[];
  rows?: Array<Observable<OvwRowsPage>>;
  layout?: (sourceId: number, sheet: number | null) => Observable<OvwLayout>;
}

async function createFixture(options: FixtureOptions = {}) {
  const params$ = new BehaviorSubject<Params>(options.params ?? {});
  const rowsResults = options.rows ?? [of(rowsPage())];
  let rowsCall = 0;
  const api = {
    sources: vi.fn(() => of(options.sources ?? sourceList)),
    layout: vi.fn(options.layout ?? (() => of(layout()))),
    rows: vi.fn((_sourceId: number, _query: OvwRowsQuery) => rowsResults[Math.min(rowsCall++, rowsResults.length - 1)]),
    groups: vi.fn(() => of(groupsResult))
  };
  const router = {
    navigate: vi.fn((_commands: unknown[], extras: { queryParams: Record<string, unknown> }) => {
      const next: Params = {};
      for (const [key, value] of Object.entries(extras.queryParams)) {
        if (value !== null && value !== undefined) {
          next[key] = value;
        }
      }
      params$.next(next);
      return Promise.resolve(true);
    })
  };
  await TestBed.configureTestingModule({
    imports: [OvwDataPage],
    providers: [
      { provide: OvwApiService, useValue: api },
      { provide: ActivatedRoute, useValue: { queryParams: params$ } },
      { provide: Router, useValue: router }
    ]
  }).compileComponents();
  const fixture = TestBed.createComponent(OvwDataPage);
  fixture.detectChanges();
  return { fixture, api, router };
}

function byTestId(fixture: ComponentFixture<OvwDataPage>, id: string): HTMLElement[] {
  return fixture.debugElement.queryAll(By.css(`[data-testid="${id}"]`)).map(node => node.nativeElement as HTMLElement);
}

function text(fixture: ComponentFixture<OvwDataPage>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function clickNative(fixture: ComponentFixture<OvwDataPage>, id: string, index = 0): void {
  byTestId(fixture, id)[index].click();
  fixture.detectChanges();
}

function typeAndEnter(fixture: ComponentFixture<OvwDataPage>, input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  fixture.detectChanges();
}

type NavigateExtras = { queryParams: Record<string, unknown>; replaceUrl?: boolean };

function lastNavigation(router: { navigate: ReturnType<typeof vi.fn> }): NavigateExtras {
  const calls = router.navigate.mock.calls;
  return calls[calls.length - 1][1] as NavigateExtras;
}

function lastRowsQuery(api: { rows: ReturnType<typeof vi.fn> }): OvwRowsQuery {
  const calls = api.rows.mock.calls;
  return calls[calls.length - 1][1] as OvwRowsQuery;
}

describe('OvwDataPage', () => {
  it('shows the empty state and asks nothing more when there are no applied uploads', async () => {
    const { fixture, api } = await createFixture({ sources: [] });

    expect(byTestId(fixture, 'ovw-empty-sources')).toHaveLength(1);
    expect(text(fixture)).toContain(ru('ovw.empty_sources'));
    expect(api.layout).not.toHaveBeenCalled();
    expect(api.rows).not.toHaveBeenCalled();
  });

  it('opens the first source without parameters and shows the first page of rows', async () => {
    const { fixture, api, router } = await createFixture();

    expect(lastNavigation(router)).toEqual(expect.objectContaining({ replaceUrl: true }));
    expect(lastNavigation(router).queryParams['src']).toBe('1');
    expect(api.layout).toHaveBeenCalledWith(1, null);
    expect(api.rows).toHaveBeenCalledTimes(1);
    expect(api.rows).toHaveBeenCalledWith(1, { sheet: 1, filters: [], sort: null, offset: 0 });
    const page = text(fixture);
    expect(page).toContain(ru('ovw.rows_range', { from: 1, to: 200, total: 450 }));
    expect(page).not.toContain(ru('ovw.rows_filtered', { all: `1${NBSP}883` }));
    const firstRow = byTestId(fixture, 'ovw-rows-table')[0].querySelectorAll('tbody tr')[0];
    const cells = Array.from(firstRow.querySelectorAll('td')).map(cell => cell.textContent?.trim());
    expect(cells).toEqual(['a.xlsx · TEST · 5', 'TEST-0', '31.01.2024', `1${NBSP}234,5`]);
    expect(byTestId(fixture, 'ovw-packages')[0].textContent).toContain('a.xlsx (01.01.24–31.01.24)');
  });

  it('cycles the sort of a column: ascending, descending, none', async () => {
    const { fixture, router } = await createFixture({ params: { src: '1' } });

    clickNative(fixture, 'ovw-sort-doc_date');
    expect(lastNavigation(router).queryParams['s']).toBe('doc_date~asc');
    expect(lastNavigation(router).replaceUrl).toBe(true);
    clickNative(fixture, 'ovw-sort-doc_date');
    expect(lastNavigation(router).queryParams['s']).toBe('doc_date~desc');
    clickNative(fixture, 'ovw-sort-doc_date');
    expect(lastNavigation(router).queryParams['s']).toBeNull();
  });

  it('keeps a wrong number in the filter on screen and sends a right one to the address', async () => {
    const { fixture, router } = await createFixture({ params: { src: '1', p: '2' } });
    router.navigate.mockClear();
    const from = byTestId(fixture, 'ovw-filter-amount')[0].querySelector('input') as HTMLInputElement;

    typeAndEnter(fixture, from, 'abc');
    expect(byTestId(fixture, 'ovw-filter-amount')[0].textContent).toContain(ru('ovw.filter.need_number'));
    expect(router.navigate).not.toHaveBeenCalled();

    const again = byTestId(fixture, 'ovw-filter-amount')[0].querySelector('input') as HTMLInputElement;
    typeAndEnter(fixture, again, '10');
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(lastNavigation(router).queryParams['f']).toEqual(['amount~r~10~']);
    expect(lastNavigation(router).queryParams['p']).toBeNull();
    expect(text(fixture)).not.toContain(ru('ovw.filter.need_number'));
  });

  it('asks for groups, not rows, when a grouping column is in the address', async () => {
    const { fixture, api } = await createFixture({ params: { src: '1', g: 'region' } });

    expect(api.groups).toHaveBeenCalledWith(1, { sheet: 1, filters: [], groupBy: 'region' });
    expect(api.rows).not.toHaveBeenCalled();
    const total = byTestId(fixture, 'ovw-total-row')[0].textContent ?? '';
    expect(total).toContain(ru('ovw.total'));
    expect(total).toContain(`1${NBSP}883`);
    expect(total).toContain(`24${NBSP}510,5`);
    expect(text(fixture)).toContain(ru('ovw.groups_limited', { shown: `1${NBSP}000`, total: `1${NBSP}250` }));
    expect(byTestId(fixture, 'ovw-group-row')[1].textContent).toContain(ru('ovw.empty_value'));
  });

  it('opens a group as a history step and asks its rows with the group filter last', async () => {
    const { fixture, api, router } = await createFixture({ params: { src: '1', g: 'region', f: 'region~c~TEST' } });

    clickNative(fixture, 'ovw-group-row', 0);
    expect(lastNavigation(router).queryParams['gv']).toBe('TEST-A');
    expect(lastNavigation(router).replaceUrl).toBeUndefined();
    const filters = lastRowsQuery(api).filters;
    expect(filters[filters.length - 1]).toEqual({ field: 'region', op: 'eq', value: 'TEST-A' });
    expect(filters[0]).toEqual({ field: 'region', op: 'contains', value: 'TEST' });
    expect(byTestId(fixture, 'ovw-back-to-groups')).toHaveLength(1);

    clickNative(fixture, 'ovw-back-to-groups');
    expect(lastNavigation(router).queryParams['gv']).toBeNull();
    expect(lastNavigation(router).replaceUrl).toBeUndefined();

    clickNative(fixture, 'ovw-group-row', 1);
    expect(lastNavigation(router).queryParams['gv']).toBe('~empty');
    const emptyFilters = lastRowsQuery(api).filters;
    expect(emptyFilters[emptyFilters.length - 1]).toEqual({ field: 'region', op: 'eq', value: null });
  });

  it('drops an unknown column from the link with a yellow line and asks rows without it', async () => {
    const { fixture, api, router } = await createFixture({ params: { src: '1', f: 'nope~c~x' } });

    expect(lastNavigation(router).queryParams['f']).toBeNull();
    expect(lastNavigation(router).replaceUrl).toBe(true);
    expect(byTestId(fixture, 'ovw-dropped')[0].textContent).toContain(ru('ovw.url.dropped_column', { field: 'nope' }));
    expect(api.rows).toHaveBeenCalledTimes(1);
    expect(lastRowsQuery(api).filters).toEqual([]);
  });

  it('falls back to the first source when the link names an unknown one', async () => {
    const { fixture, api } = await createFixture({ params: { src: '99' } });

    expect(api.layout).toHaveBeenCalledWith(1, null);
    expect(byTestId(fixture, 'ovw-dropped')[0].textContent).toContain(ru('ovw.url.dropped_source'));
  });

  it('goes to the first page when the server says the page does not exist', async () => {
    const pageInvalid = problem(422, 'OVW_QUERY_INVALID', [
      { field: 'offset', code: 'OVW_PAGE_INVALID', message: 'OVW_PAGE_INVALID' }
    ]);
    const { fixture, api, router } = await createFixture({
      params: { src: '1', p: '9' },
      rows: [throwError(() => pageInvalid), of(rowsPage())]
    });

    expect(api.rows.mock.calls[0][1].offset).toBe(1600);
    expect(lastNavigation(router).queryParams['p']).toBeNull();
    expect(lastNavigation(router).replaceUrl).toBe(true);
    expect(lastRowsQuery(api).offset).toBe(0);
    expect(byTestId(fixture, 'ovw-dropped')[0].textContent).toContain(ru('ovw.url.dropped_page'));
  });

  it('shows a timeout of the server as a line above the table', async () => {
    const { fixture } = await createFixture({
      params: { src: '1' },
      rows: [throwError(() => problem(503, 'OVW_QUERY_TIMEOUT'))]
    });

    expect(byTestId(fixture, 'ovw-load-error')[0].textContent).toContain(ru('ovw.err.OVW_QUERY_TIMEOUT'));
  });

  it('drops a range of the link with "from" after "to" and asks rows without it', async () => {
    const { fixture, api, router } = await createFixture({ params: { src: '1', f: ['amount~r~20~10', 'region~c~TEST'] } });

    expect(lastNavigation(router).queryParams['f']).toEqual(['region~c~TEST']);
    expect(lastNavigation(router).replaceUrl).toBe(true);
    expect(byTestId(fixture, 'ovw-dropped')[0].textContent).toContain(ru('ovw.url.dropped_value', { field: 'amount' }));
    expect(api.rows).toHaveBeenCalledTimes(1);
    expect(lastRowsQuery(api).filters).toEqual([{ field: 'region', op: 'contains', value: 'TEST' }]);
    expect(byTestId(fixture, 'ovw-load-error')).toHaveLength(0);
  });

  it('drops a sheet of the link that the questionnaire does not have and shows the first sheet', async () => {
    const sheetUnknown = problem(422, 'OVW_QUERY_INVALID', [
      { field: 'sheet', code: 'OVW_SHEET_UNKNOWN', message: 'OVW_SHEET_UNKNOWN' }
    ]);
    const { fixture, api, router } = await createFixture({
      params: { src: '1', sh: '5', f: 'region~c~TEST' },
      layout: (_sourceId, sheet) => (sheet === 5 ? throwError(() => sheetUnknown) : of(layout()))
    });

    expect(api.layout).toHaveBeenCalledWith(1, 5);
    expect(api.layout).toHaveBeenLastCalledWith(1, null);
    expect(lastNavigation(router).queryParams['sh']).toBeNull();
    expect(lastNavigation(router).queryParams['f']).toEqual(['region~c~TEST']);
    expect(lastNavigation(router).replaceUrl).toBe(true);
    expect(api.rows).toHaveBeenCalledTimes(1);
    expect(lastRowsQuery(api)).toEqual({
      sheet: 1,
      filters: [{ field: 'region', op: 'contains', value: 'TEST' }],
      sort: null,
      offset: 0
    });
    expect(byTestId(fixture, 'ovw-dropped')[0].textContent).toContain(ru('ovw.url.dropped_sheet'));
    expect(byTestId(fixture, 'ovw-load-error')).toHaveLength(0);
    expect(byTestId(fixture, 'ovw-rows-table')).toHaveLength(1);
  });

  it('drops a sheet of the link that is missing from the sheets of the layout', async () => {
    const { fixture, api, router } = await createFixture({ params: { src: '1', sh: '3' } });

    expect(api.layout).toHaveBeenCalledWith(1, 3);
    expect(lastNavigation(router).queryParams['sh']).toBeNull();
    expect(api.rows).toHaveBeenCalledTimes(1);
    expect(lastRowsQuery(api).sheet).toBe(1);
    expect(byTestId(fixture, 'ovw-dropped')[0].textContent).toContain(ru('ovw.url.dropped_sheet'));
  });

  it('shows a filter error of the server next to the filter of that column', async () => {
    const wrongValue = problem(422, 'OVW_QUERY_INVALID', [
      { field: 'filters[0]', code: 'OVW_FILTER_VALUE', message: 'OVW_FILTER_VALUE' }
    ]);
    const { fixture } = await createFixture({
      params: { src: '1', f: 'amount~r~10~20' },
      rows: [throwError(() => wrongValue)]
    });

    expect(byTestId(fixture, 'ovw-filter-amount')[0].textContent).toContain(
      ru('ovw.err.OVW_FILTER_VALUE', { label: 'Summa TEST' })
    );
    expect(byTestId(fixture, 'ovw-load-error')).toHaveLength(0);
  });
});
