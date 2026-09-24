import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PACKAGED_RUSSIAN } from '../../../core/i18n/packaged-russian';
import { ProblemDetail } from '../../../core/models/common.models';
import { RptApiService, RptCellItem, RptCellQuery, RptCellRows, RptDivisor } from '../shared/rpt-api';
import { RptCellPanelComponent, RptCellTarget, RptPanelLabels } from './rpt-cell-panel.component';

const NBSP = ' ';

function item(index: number): RptCellItem {
  return {
    file: 'jan_feb.xlsx',
    sheet: 'TEST',
    excelRow: index + 5,
    date: '2026-02-01',
    measure: '500000',
    level1: 'TEST-A',
    level2: null,
    column: null
  };
}

function page(offset: number, total = 450): RptCellRows {
  const count = Math.min(200, total - offset);
  return { total, offset, limit: 200, value: '8500000', items: Array.from({ length: count }, (_, index) => item(offset + index)) };
}

function ru(key: string, params: Record<string, string | number> = {}): string {
  return PACKAGED_RUSSIAN[key].replace(/\{(\w+)\}/g, (_: string, name: string) => String(params[name]));
}

const twoLevels: RptPanelLabels = { measure: 'Summa TEST', level1: 'Gruppa TEST', level2: 'Podgruppa TEST' };

interface FixtureOptions {
  target?: RptCellTarget;
  labels?: RptPanelLabels;
  divisor?: RptDivisor;
  total?: number;
  failure?: ProblemDetail;
}

async function createFixture(options: FixtureOptions = {}) {
  const api = {
    cells: vi.fn((_id: number, query: RptCellQuery) =>
      options.failure ? throwError(() => options.failure) : of(page(query.offset, options.total))
    )
  };
  await TestBed.configureTestingModule({
    imports: [RptCellPanelComponent],
    providers: [{ provide: RptApiService, useValue: api }]
  }).compileComponents();
  const fixture = TestBed.createComponent(RptCellPanelComponent);
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  fixture.componentRef.setInput('reportId', 7);
  fixture.componentRef.setInput('year', 2026);
  fixture.componentRef.setInput('target', options.target ?? { period: { kind: 'month', month: 2 }, path: ['test-a', 'test-a-1'] });
  fixture.componentRef.setInput('heading', 'TEST-A · TEST-A-1');
  fixture.componentRef.setInput('tableValue', '8.5');
  fixture.componentRef.setInput('divisor', options.divisor ?? 1000000);
  fixture.componentRef.setInput('decimals', 2);
  fixture.componentRef.setInput('labels', options.labels ?? twoLevels);
  fixture.detectChanges();
  return { fixture, api, closed };
}

function byTestId(fixture: ComponentFixture<RptCellPanelComponent>, id: string): HTMLElement[] {
  return fixture.debugElement.queryAll(By.css(`[data-testid="${id}"]`)).map(node => node.nativeElement as HTMLElement);
}

function click(fixture: ComponentFixture<RptCellPanelComponent>, id: string): void {
  const host = byTestId(fixture, id)[0];
  (host.querySelector('button') ?? host).click();
  fixture.detectChanges();
}

describe('RptCellPanelComponent', () => {
  it('asks for the first 200 rows of the cell and shows where each came from', async () => {
    const { fixture, api } = await createFixture();

    expect(api.cells).toHaveBeenCalledTimes(1);
    expect(api.cells).toHaveBeenCalledWith(7, { year: 2026, period: { kind: 'month', month: 2 }, path: ['test-a', 'test-a-1'], offset: 0 });
    expect(byTestId(fixture, 'rpt-panel-heading')[0].textContent).toContain('TEST-A · TEST-A-1');
    const rows = byTestId(fixture, 'rpt-panel-row');
    expect(rows).toHaveLength(200);
    const cells = Array.from(rows[0].querySelectorAll('td')).map(cell => cell.textContent?.trim());
    expect(cells).toEqual(['jan_feb.xlsx · TEST · 5', '01.02.2026', `500${NBSP}000`]);
    expect(byTestId(fixture, 'rpt-panel-page')[0].textContent).toContain(ru('rpt.panel.page', { page: 1, pages: 3 }));
  });

  it('asks the next page from offset 200', async () => {
    const { fixture, api } = await createFixture();

    click(fixture, 'rpt-panel-next');
    expect(api.cells).toHaveBeenLastCalledWith(7, { year: 2026, period: { kind: 'month', month: 2 }, path: ['test-a', 'test-a-1'], offset: 200 });
    expect(byTestId(fixture, 'rpt-panel-page')[0].textContent).toContain(ru('rpt.panel.page', { page: 2, pages: 3 }));
    click(fixture, 'rpt-panel-last');
    expect(api.cells).toHaveBeenLastCalledWith(7, expect.objectContaining({ offset: 400 }));
    expect(byTestId(fixture, 'rpt-panel-row')).toHaveLength(50);
  });

  it('puts the number of the table next to the sum before the divisor and the count of rows', async () => {
    const { fixture } = await createFixture();

    expect(byTestId(fixture, 'rpt-panel-summary')[0].textContent).toContain(
      ru('rpt.panel.summary', { value: '8,50', unit: ru('rpt.unit_short.1000000'), raw: `8${NBSP}500${NBSP}000`, n: 450 })
    );
  });

  it('shows only the sum and the count of rows when the report is not divided', async () => {
    const { fixture } = await createFixture({ divisor: 1 });

    expect(byTestId(fixture, 'rpt-panel-summary')[0].textContent).toContain(
      ru('rpt.panel.summary_plain', { raw: `8${NBSP}500${NBSP}000`, n: 450 })
    );
  });

  it('shows the level columns only where rows of different groups meet', async () => {
    const line = await createFixture();
    expect(byTestId(line.fixture, 'rpt-panel-col-level1')).toHaveLength(0);
    expect(byTestId(line.fixture, 'rpt-panel-col-level2')).toHaveLength(0);

    TestBed.resetTestingModule();
    const subtotal = await createFixture({ target: { period: { kind: 'year' }, path: ['test-a'] } });
    expect(byTestId(subtotal.fixture, 'rpt-panel-col-level1')).toHaveLength(0);
    expect(byTestId(subtotal.fixture, 'rpt-panel-col-level2')[0].textContent).toContain('Podgruppa TEST');
    const cells = Array.from(byTestId(subtotal.fixture, 'rpt-panel-row')[0].querySelectorAll('td')).map(cell => cell.textContent?.trim());
    expect(cells[3]).toBe(ru('rpt.view.no_name'));

    TestBed.resetTestingModule();
    const grand = await createFixture({ target: { period: { kind: 'undated' }, path: [] } });
    expect(byTestId(grand.fixture, 'rpt-panel-col-level1')[0].textContent).toContain('Gruppa TEST');
    expect(byTestId(grand.fixture, 'rpt-panel-col-level2')).toHaveLength(1);
  });

  it('has no measure column when the report counts rows', async () => {
    const { fixture } = await createFixture({ labels: { measure: null, level1: 'Gruppa TEST', level2: null } });

    expect(byTestId(fixture, 'rpt-panel-col-measure')).toHaveLength(0);
    expect(byTestId(fixture, 'rpt-panel-row')[0].querySelectorAll('td')).toHaveLength(2);
  });

  it('closes on Esc and on the cross', async () => {
    const { fixture, closed } = await createFixture();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toHaveBeenCalledTimes(1);
    click(fixture, 'rpt-panel-close');
    expect(closed).toHaveBeenCalledTimes(2);
  });

  it('shows the text of the error code', async () => {
    const failure: ProblemDetail = {
      title: 'TEST',
      status: 422,
      code: 'TEST',
      detail: 'TEST',
      errors: [{ field: 'path', code: 'RPT_CELL_INVALID', message: 'RPT_CELL_INVALID' }]
    };
    const { fixture } = await createFixture({ failure });

    expect(byTestId(fixture, 'rpt-panel-error')[0].textContent).toContain(ru('rpt.err.RPT_CELL_INVALID'));
    expect(byTestId(fixture, 'rpt-panel-table')).toHaveLength(0);
  });
});
