import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PACKAGED_RUSSIAN } from '../../../core/i18n/packaged-russian';
import { ProblemDetail } from '../../../core/models/common.models';
import { PermissionService } from '../../../core/services/permission.service';
import { RptApiService, RptReportItem } from '../shared/rpt-api';
import { RptListPage, formatRptModified } from './rpt-list.page';

const reportList: RptReportItem[] = [
  { id: 7, name: 'Svod TEST', sourceName: 'Vydachi TEST', modifiedAt: new Date(2026, 8, 23, 14, 5).toISOString() },
  { id: 9, name: 'Eksport TEST', sourceName: 'Tamozhnya TEST', modifiedAt: new Date(2026, 8, 22, 10, 12).toISOString() }
];

interface FixtureOptions {
  reports?: RptReportItem[];
  failure?: ProblemDetail;
  canEdit?: boolean;
}

async function createFixture(options: FixtureOptions = {}) {
  const api = {
    reports: vi.fn(() => (options.failure ? throwError(() => options.failure) : of(options.reports ?? reportList)))
  };
  const permissions = {
    hasPermission: vi.fn((_form: string, action: string) => action === 'view' || (action === 'edit' && options.canEdit === true))
  };
  const router = { navigate: vi.fn(() => Promise.resolve(true)) };
  await TestBed.configureTestingModule({
    imports: [RptListPage],
    providers: [
      { provide: RptApiService, useValue: api },
      { provide: PermissionService, useValue: permissions },
      { provide: Router, useValue: router }
    ]
  }).compileComponents();
  const fixture = TestBed.createComponent(RptListPage);
  fixture.detectChanges();
  return { fixture, api, router, permissions };
}

function byTestId(fixture: ComponentFixture<RptListPage>, id: string): HTMLElement[] {
  return fixture.debugElement.queryAll(By.css(`[data-testid="${id}"]`)).map(node => node.nativeElement as HTMLElement);
}

function click(fixture: ComponentFixture<RptListPage>, id: string, index = 0): void {
  const host = byTestId(fixture, id)[index];
  (host.querySelector('button') ?? host).click();
  fixture.detectChanges();
}

describe('RptListPage', () => {
  it('shows every report with its source and the time of the last change', async () => {
    const { fixture, api } = await createFixture();

    expect(api.reports).toHaveBeenCalledTimes(1);
    const rows = byTestId(fixture, 'rpt-list-row');
    expect(rows).toHaveLength(2);
    const cells = Array.from(rows[0].querySelectorAll('td')).map(cell => cell.textContent?.trim());
    expect(cells).toEqual(['Svod TEST', 'Vydachi TEST', '23.09.2026 14:05']);
    const head = byTestId(fixture, 'rpt-list-table')[0].querySelector('thead')?.textContent ?? '';
    expect(head).toContain(PACKAGED_RUSSIAN['rpt.list.name']);
    expect(head).toContain(PACKAGED_RUSSIAN['rpt.list.source']);
    expect(head).toContain(PACKAGED_RUSSIAN['rpt.list.modified']);
  });

  it('opens the report without a year: the server takes the last one', async () => {
    const { fixture, router } = await createFixture();

    click(fixture, 'rpt-list-row', 1);
    expect(router.navigate).toHaveBeenCalledWith(['/rpt/reports', 9]);
  });

  it('offers a new report only to a user with the right to describe reports', async () => {
    const withRight = await createFixture({ canEdit: true });
    expect(byTestId(withRight.fixture, 'rpt-list-new')).toHaveLength(1);
    click(withRight.fixture, 'rpt-list-new');
    expect(withRight.router.navigate).toHaveBeenCalledWith(['/rpt/reports/new']);
    expect(withRight.permissions.hasPermission).toHaveBeenCalledWith('rpt.reports', 'edit');

    TestBed.resetTestingModule();
    const withoutRight = await createFixture({ canEdit: false });
    expect(byTestId(withoutRight.fixture, 'rpt-list-new')).toHaveLength(0);
  });

  it('shows the empty state with the hint and the button for a user who may describe reports', async () => {
    const { fixture } = await createFixture({ reports: [], canEdit: true });

    expect(byTestId(fixture, 'rpt-list-table')).toHaveLength(0);
    expect(byTestId(fixture, 'rpt-list-empty')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.list.empty']);
    expect(byTestId(fixture, 'rpt-list-empty-hint')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.list.empty_hint']);
    expect(byTestId(fixture, 'rpt-list-new')).toHaveLength(1);
  });

  it('shows only the empty text to a user who may only look', async () => {
    const { fixture } = await createFixture({ reports: [] });

    expect(byTestId(fixture, 'rpt-list-empty')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.list.empty']);
    expect(byTestId(fixture, 'rpt-list-empty-hint')).toHaveLength(0);
    expect(byTestId(fixture, 'rpt-list-new')).toHaveLength(0);
  });

  it('shows the error text when the list cannot be loaded', async () => {
    const failure: ProblemDetail = { title: 'TEST', status: 400, code: 'TEST', detail: 'RPT_MODULE_DISABLED' };
    const { fixture } = await createFixture({ failure });

    expect(byTestId(fixture, 'rpt-list-error')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.err.RPT_MODULE_DISABLED']);
    expect(byTestId(fixture, 'rpt-list-table')).toHaveLength(0);
  });

  it('keeps an unreadable timestamp as it came', () => {
    expect(formatRptModified('TEST')).toBe('TEST');
  });
});
