import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, ParamMap, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PACKAGED_RUSSIAN } from '../../../core/i18n/packaged-russian';
import { FieldErrorItem, ProblemDetail } from '../../../core/models/common.models';
import { PermissionService } from '../../../core/services/permission.service';
import { RptApiService, RptCellQuery, RptCellRows, RptLine, RptReportView } from '../shared/rpt-api';
import { RptViewPage } from './rpt-view.page';

const NBSP = ' ';

function cells(first: string | null, second: string | null = null): (string | null)[] {
  return [first, second, ...Array.from({ length: 10 }, () => null)];
}

function line(first: string | null, second: string | null, total: string | null): RptLine {
  return { cells: cells(first, second), total, count: 3, m2: null, ratio: null };
}

function reportView(patch: Partial<RptReportView> = {}): RptReportView {
  return {
    reportId: 7,
    name: 'Svod TEST',
    year: 2026,
    years: [2025, 2026],
    divisor: 1000000,
    decimals: 2,
    labels: { level1: 'Gruppa TEST', level2: 'Podgruppa TEST', measure: 'Summa TEST' },
    grand: line('26435.3102', '42.56', '146.2'),
    lines: [
      {
        key: 'test-a',
        name: 'TEST-A',
        ...line('10', '12.5', '40'),
        lines: [
          { key: 'test-a-1', name: 'TEST-A-1', ...line('6', '8.5', '25') },
          { key: 'test-a-2', name: 'TEST-A-2', ...line('4', '4', '15') }
        ]
      },
      { key: null, name: null, ...line(null, '0', '0'), lines: [{ key: null, name: null, ...line(null, '0', '0') }] }
    ],
    undated: null,
    refDuplicateKeys: 0,
    ytdMonth: 12,
    measures: [{ name: null, divisor: 1000000, decimals: 2, byMonthColumns: false }],
    undated2: null,
    ...patch
  };
}

const cellRows: RptCellRows = { total: 1, offset: 0, limit: 200, value: '8500000', items: [] };

function problem(status: number, detail: string, errors?: FieldErrorItem[]): ProblemDetail {
  return { title: 'TEST', status, code: 'TEST', detail, errors };
}

function ru(key: string, params: Record<string, string | number> = {}): string {
  return PACKAGED_RUSSIAN[key].replace(/\{(\w+)\}/g, (_: string, name: string) => String(params[name]));
}

interface FixtureOptions {
  view?: Observable<RptReportView>;
  canEdit?: boolean;
  query?: Record<string, string>;
}

async function createFixture(options: FixtureOptions = {}) {
  const query$ = new BehaviorSubject<ParamMap>(convertToParamMap(options.query ?? {}));
  const api = {
    view: vi.fn((_id: number, _year: number | null) => options.view ?? of(reportView())),
    cells: vi.fn((_id: number, _query: RptCellQuery) => of(cellRows))
  };
  const permissions = {
    hasPermission: vi.fn((_form: string, action: string) => action === 'view' || (action === 'edit' && options.canEdit === true))
  };
  await TestBed.configureTestingModule({
    imports: [RptViewPage],
    providers: [
      provideRouter([]),
      { provide: RptApiService, useValue: api },
      { provide: PermissionService, useValue: permissions },
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: '7' })), queryParamMap: query$ } }
    ]
  }).compileComponents();
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockImplementation((_commands, extras) => {
    const current: Record<string, string> = {};
    for (const key of query$.value.keys) {
      current[key] = query$.value.get(key) as string;
    }
    for (const [key, value] of Object.entries(extras?.queryParams ?? {})) {
      current[key] = String(value);
    }
    query$.next(convertToParamMap(current));
    return Promise.resolve(true);
  });
  const fixture = TestBed.createComponent(RptViewPage);
  fixture.detectChanges();
  return { fixture, api, navigate };
}

function byTestId(fixture: ComponentFixture<RptViewPage>, id: string): HTMLElement[] {
  return fixture.debugElement.queryAll(By.css(`[data-testid="${id}"]`)).map(node => node.nativeElement as HTMLElement);
}

function click(fixture: ComponentFixture<RptViewPage>, id: string, index = 0): void {
  const host = byTestId(fixture, id)[index];
  (host.querySelector('button') ?? host).click();
  fixture.detectChanges();
}

function bodyRows(fixture: ComponentFixture<RptViewPage>): HTMLTableRowElement[] {
  return Array.from(byTestId(fixture, 'rpt-view-table')[0].querySelectorAll('tbody tr'));
}

function rowNames(fixture: ComponentFixture<RptViewPage>): string[] {
  return bodyRows(fixture).map(row => row.querySelector('[data-testid="rpt-row-name"]')?.textContent?.trim() ?? '');
}

function rowCells(row: HTMLTableRowElement): string[] {
  return Array.from(row.querySelectorAll('td')).map(cell => cell.textContent?.trim() ?? '');
}

describe('RptViewPage', () => {
  it('shows the grand total first and the lines without a name last', async () => {
    const { fixture, api } = await createFixture();

    expect(api.view).toHaveBeenCalledWith(7, null);
    expect(rowNames(fixture)).toEqual([
      ru('rpt.view.grand'),
      'TEST-A',
      'TEST-A-1',
      'TEST-A-2',
      ru('rpt.view.no_name'),
      ru('rpt.view.no_name')
    ]);
    expect(bodyRows(fixture)[0].getAttribute('data-testid')).toBe('rpt-row-grand');
    expect(bodyRows(fixture)[4].getAttribute('data-testid')).toBe('rpt-row-l1');
    expect(byTestId(fixture, 'rpt-view-title')[0].textContent).toContain('Svod TEST');
    expect(byTestId(fixture, 'rpt-view-digits')[0].textContent).toContain(ru('rpt.view.digits', { unit: ru('rpt.unit_short.1000000'), n: 2 }));
    expect(byTestId(fixture, 'rpt-view-measure')[0].textContent).toContain(ru('rpt.view.measure', { label: 'Summa TEST' }));
    const head = Array.from(byTestId(fixture, 'rpt-view-table')[0].querySelectorAll('thead th')).map(cell => cell.textContent?.trim());
    expect(head).toHaveLength(14);
    expect(head[1]).toBe(ru('rpt.month.1'));
    expect(head[13]).toBe(ru('rpt.view.total'));
  });

  it('rounds the numbers to the digits of the report and groups the thousands', async () => {
    const { fixture } = await createFixture();

    const grand = rowCells(bodyRows(fixture)[0]);
    expect(grand[1]).toBe(`26${NBSP}435,31`);
    expect(grand[2]).toBe('42,56');
    expect(grand[13]).toBe('146,20');
  });

  it('leaves an empty cell without a link and shows zero with a link', async () => {
    const { fixture } = await createFixture();

    const noName = bodyRows(fixture)[4];
    const values = rowCells(noName);
    expect(values[1]).toBe('');
    expect(values[2]).toBe('0,00');
    expect(noName.querySelectorAll('td')[1].querySelector('[data-testid="rpt-cell"]')).toBeNull();
    expect(noName.querySelectorAll('td')[2].querySelector('[data-testid="rpt-cell"]')).not.toBeNull();
  });

  it('hides the level 2 lines of a collapsed group and brings them back', async () => {
    const { fixture } = await createFixture();

    click(fixture, 'rpt-view-toggle', 0);
    expect(rowNames(fixture)).toEqual([ru('rpt.view.grand'), 'TEST-A', ru('rpt.view.no_name'), ru('rpt.view.no_name')]);
    expect(byTestId(fixture, 'rpt-view-toggle')[0].textContent).toContain('▸');

    click(fixture, 'rpt-view-toggle', 0);
    expect(rowNames(fixture)).toHaveLength(6);
  });

  it('collapses and expands all groups at once', async () => {
    const { fixture } = await createFixture();

    click(fixture, 'rpt-view-collapse-all');
    expect(rowNames(fixture)).toEqual([ru('rpt.view.grand'), 'TEST-A', ru('rpt.view.no_name')]);
    click(fixture, 'rpt-view-expand-all');
    expect(rowNames(fixture)).toHaveLength(6);
  });

  it('writes the chosen year into the address and asks the server again', async () => {
    const { fixture, api, navigate } = await createFixture({ query: { y: '2026' } });
    expect(api.view).toHaveBeenLastCalledWith(7, 2026);

    const select = byTestId(fixture, 'rpt-view-year')[0] as HTMLSelectElement;
    select.value = select.options[0].value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith([], { queryParams: { y: 2025 }, queryParamsHandling: 'merge' });
    expect(api.view).toHaveBeenCalledTimes(2);
    expect(api.view).toHaveBeenLastCalledWith(7, 2025);
  });

  it('opens the panel with the path and the period of the clicked number', async () => {
    const { fixture, api } = await createFixture();

    const child = bodyRows(fixture)[2];
    (child.querySelectorAll('[data-testid="rpt-cell"]')[1] as HTMLElement).click();
    fixture.detectChanges();

    expect(api.cells).toHaveBeenCalledWith(7, { year: 2026, period: { kind: 'month', month: 2 }, path: ['test-a', 'test-a-1'], offset: 0 });
    expect(byTestId(fixture, 'rpt-panel-heading')[0].textContent).toContain(
      `TEST-A · TEST-A-1 · ${ru('rpt.month_year', { month: ru('rpt.month.2'), year: 2026 })}`
    );

    (bodyRows(fixture)[0].querySelector('[data-testid="rpt-cell-total"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(api.cells).toHaveBeenLastCalledWith(7, { year: 2026, period: { kind: 'year' }, path: [], offset: 0 });

    (bodyRows(fixture)[4].querySelector('[data-testid="rpt-cell"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(api.cells).toHaveBeenLastCalledWith(7, { year: 2026, period: { kind: 'month', month: 2 }, path: [null], offset: 0 });
  });

  it('shows the undated strip and opens its rows in the panel', async () => {
    const { fixture, api } = await createFixture({ view: of(reportView({ undated: { count: 3, value: '1.2549' } })) });

    expect(byTestId(fixture, 'rpt-view-undated')[0].textContent).toContain(ru('rpt.view.undated', { n: 3, value: '1,25' }));
    click(fixture, 'rpt-view-show-undated');
    expect(api.cells).toHaveBeenCalledWith(7, { year: 2026, period: { kind: 'undated' }, path: [], offset: 0 });
    expect(byTestId(fixture, 'rpt-panel-heading')[0].textContent).toContain(ru('rpt.panel.undated'));
  });

  it('shows neither the undated strip nor the duplicates hint when there is nothing to tell', async () => {
    const { fixture } = await createFixture();

    expect(byTestId(fixture, 'rpt-view-undated')).toHaveLength(0);
    expect(byTestId(fixture, 'rpt-view-duplicates')).toHaveLength(0);
  });

  it('shows the hint about keys met twice in the reference', async () => {
    const { fixture } = await createFixture({ view: of(reportView({ refDuplicateKeys: 2 })) });

    expect(byTestId(fixture, 'rpt-view-duplicates')[0].textContent).toContain(ru('rpt.view.ref_duplicates', { n: 2 }));
  });

  it('shows the stale description strip and the edit link to a user who may describe reports', async () => {
    const stale = problem(409, 'RPT_DEFINITION_STALE', [{ field: 'dateField', code: 'RPT_COLUMN_UNKNOWN', message: 'RPT_COLUMN_UNKNOWN' }]);
    const { fixture } = await createFixture({ view: throwError(() => stale), canEdit: true });

    const strip = byTestId(fixture, 'rpt-view-stale')[0];
    expect(strip.textContent).toContain(ru('rpt.err.RPT_DEFINITION_STALE'));
    expect(byTestId(fixture, 'rpt-view-stale-field')[0].textContent).toContain(ru('rpt.view.stale_field', { field: 'dateField' }));
    expect(byTestId(fixture, 'rpt-view-stale-edit')[0].getAttribute('href')).toBe('/rpt/reports/7/edit');
    expect(byTestId(fixture, 'rpt-view-stale-ask')).toHaveLength(0);
    expect(byTestId(fixture, 'rpt-view-table')).toHaveLength(0);
  });

  it('asks to call the administrator about a stale description when the user may not describe reports', async () => {
    const stale = problem(409, 'RPT_DEFINITION_STALE', [{ field: 'level1.field', code: 'RPT_COLUMN_UNKNOWN', message: 'RPT_COLUMN_UNKNOWN' }]);
    const { fixture } = await createFixture({ view: throwError(() => stale) });

    expect(byTestId(fixture, 'rpt-view-stale-ask')[0].textContent).toContain(ru('rpt.view.stale_ask_admin'));
    expect(byTestId(fixture, 'rpt-view-stale-edit')).toHaveLength(0);
  });

  it('shows the edit link only with the right to describe reports', async () => {
    const withRight = await createFixture({ canEdit: true });
    expect(byTestId(withRight.fixture, 'rpt-view-edit')[0].getAttribute('href')).toBe('/rpt/reports/7/edit');

    TestBed.resetTestingModule();
    const withoutRight = await createFixture();
    expect(byTestId(withoutRight.fixture, 'rpt-view-edit')).toHaveLength(0);
  });

  it('says there is no data instead of the table when the source has no dated rows', async () => {
    const empty = reportView({ year: null, years: [], lines: [], grand: { cells: cells(null), total: null, count: 0, m2: null, ratio: null } });
    const { fixture } = await createFixture({ view: of(empty) });

    expect(byTestId(fixture, 'rpt-view-no-data')[0].textContent).toContain(ru('rpt.view.no_data'));
    expect(byTestId(fixture, 'rpt-view-table')).toHaveLength(0);
  });

  it('shows the text of too many lines, of a slow query and of a missing report', async () => {
    const tooMany = await createFixture({ view: throwError(() => problem(422, 'RPT_TOO_MANY_LINES')) });
    expect(byTestId(tooMany.fixture, 'rpt-view-error')[0].textContent).toContain(ru('rpt.err.RPT_TOO_MANY_LINES', { limit: 2000 }));

    TestBed.resetTestingModule();
    const slow = await createFixture({ view: throwError(() => problem(503, 'TEST')) });
    expect(byTestId(slow.fixture, 'rpt-view-error')[0].textContent).toContain(ru('rpt.err.RPT_QUERY_TIMEOUT'));

    TestBed.resetTestingModule();
    const missing = await createFixture({ view: throwError(() => problem(404, 'TEST')) });
    expect(byTestId(missing.fixture, 'rpt-view-error')[0].textContent).toContain(ru('rpt.err.RPT_REPORT_NOT_FOUND'));
  });

  it('greys the table and says the report is being counted while the server answers', async () => {
    const answer = new BehaviorSubject<RptReportView | null>(null);
    const pending = new Observable<RptReportView>(subscriber => {
      const inner = answer.subscribe(value => {
        if (value !== null) {
          subscriber.next(value);
          subscriber.complete();
        }
      });
      return () => inner.unsubscribe();
    });
    const { fixture } = await createFixture({ view: pending });

    expect(byTestId(fixture, 'rpt-view-loading')[0].textContent).toContain(ru('rpt.view.loading'));
    answer.next(reportView());
    fixture.detectChanges();
    expect(byTestId(fixture, 'rpt-view-loading')).toHaveLength(0);
    expect(bodyRows(fixture)).toHaveLength(6);
  });
});
