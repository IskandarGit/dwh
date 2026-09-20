import { TestBed } from '@angular/core/testing';
import { Component, ViewChild } from '@angular/core';
import { Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrgUnitsApiService } from './org-units-api.service';
import { OrgUnit } from './org-units.models';
import { UserOrgUnitsPanelComponent } from './user-org-units-panel.component';

const units: OrgUnit[] = [
  { id: 7, parentId: null, code: 'HQ', name: 'Headquarters', kind: 'company', state: 'A', orderNo: 0, createdAt: '', modifiedAt: '' },
  { id: 8, parentId: 7, code: 'ACTIVE', name: 'Active child', kind: 'branch', state: 'A', orderNo: 0, createdAt: '', modifiedAt: '' },
  { id: 9, parentId: 7, code: 'LEGACY', name: 'Legacy branch', kind: 'branch', state: 'P', orderNo: 1, createdAt: '', modifiedAt: '' }
];

@Component({
  standalone: true,
  imports: [UserOrgUnitsPanelComponent],
  template: `<app-user-org-units-panel [userId]="selectedUserId" />`
})
class UserPanelHost {
  selectedUserId = 42;
  @ViewChild(UserOrgUnitsPanelComponent) panel!: UserOrgUnitsPanelComponent;
  requestTarget(userId: number): void {
    const decision = this.panel.canLeave();
    if (typeof decision === 'boolean') { if (decision) this.selectedUserId = userId; }
    else decision.subscribe(allow => { if (allow) this.selectedUserId = userId; });
  }
}

describe('UserOrgUnitsPanelComponent', () => {
  function setup(options: { writable?: boolean; target?: number; assigned?: number[]; legacy?: number | null; visible?: number[]; rule?: 'ALL' | 'SUBTREE' | 'UNITS' | 'SELF' } = {}) {
    const api = {
      list: vi.fn(() => of(units)),
      assignments: vi.fn((_userId: number) => of({ userId: options.target ?? 42, orgUnitIds: options.assigned ?? [7], legacyOrgUnitId: options.legacy === undefined ? 9 : options.legacy })),
      scope: vi.fn((_userId: number) => of({ rule: options.rule ?? 'SUBTREE', visibleOrgUnitIds: options.visible ?? [7, 8] })),
      saveAssignments: vi.fn((_userId: number, _orgUnitIds: number[]) => of(undefined))
    };
    const toast = { success: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: OrgUnitsApiService, useValue: api }, { provide: ToastService, useValue: toast }] });
    TestBed.inject(PermissionService).setPermissions(options.writable === false ? ['iam.org_units.view'] : ['iam.org_units.view', 'iam.org_units.assign']);
    const fixture = TestBed.createComponent(UserOrgUnitsPanelComponent);
    fixture.componentRef.setInput('userId', options.target ?? 42); fixture.detectChanges();
    return { fixture, panel: fixture.componentInstance, api, toast };
  }

  it('keeps assigned, effective and legacy organization IDs separate and never writes an unchanged draft', () => {
    const { fixture, panel, api } = setup();
    expect(panel.selectedOrgUnitIds()).toEqual([7]);
    expect((fixture.nativeElement.querySelector('input[data-check="7"]') as HTMLInputElement)?.checked).toBe(true);
    expect((fixture.nativeElement.querySelector('input[data-check="8"]') as HTMLInputElement)?.checked).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Legacy branch');
    expect(fixture.nativeElement.textContent).toContain('Active child');
    panel.save();
    expect(api.saveAssignments).not.toHaveBeenCalled();
  });

  it.each([
    ['ALL', 'не ограничивает данные оргструктурой'],
    ['SELF', 'не привязано к дереву подразделений']
  ] as const)('explains an empty %s effective scope semantically', (rule, explanation) => {
    const { fixture } = setup({ rule, visible: [], assigned: [] });
    expect(fixture.nativeElement.textContent).toContain(explanation);
    expect(fixture.nativeElement.textContent).not.toContain('Нет доступа');
  });

  it('supports explicit empty replacement, warns about inactive assignments and leaves legacy context unchanged', () => {
    const { fixture, panel, api } = setup({ assigned: [9] });
    expect(fixture.nativeElement.textContent).toContain('неактив');
    panel.toggleAssignment(units[2]); fixture.detectChanges();
    expect(panel.selectedOrgUnitIds()).toEqual([]);
    panel.save();
    expect(api.saveAssignments).toHaveBeenCalledWith(42, []);
    expect(panel.legacyOrgUnitId).toBe(9);
  });

  it('renders a successful snapshot read-only without assign permission', () => {
    const { fixture, panel, api } = setup({ writable: false });
    expect(panel.selectedOrgUnitIds()).toEqual([7]);
    expect((fixture.nativeElement.querySelector('input[data-check="7"]') as HTMLInputElement)?.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-action="save-assignments"]')).toBeNull();
    panel.toggleAssignment(units[1]); panel.save();
    expect(api.saveAssignments).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('does not read or mutate an unsafe user target %s', target => {
    const { panel, api } = setup({ target });
    panel.save();
    expect(api.list).not.toHaveBeenCalled(); expect(api.assignments).not.toHaveBeenCalled(); expect(api.scope).not.toHaveBeenCalled();
    expect(api.saveAssignments).not.toHaveBeenCalled();
  });

  it('rejects an imprecise assignment ID before mutation', () => {
    const { panel, api } = setup();
    panel.selectedOrgUnitIds.set([7, Number.MAX_SAFE_INTEGER + 1]); panel.save();
    expect(api.saveAssignments).not.toHaveBeenCalled();
  });

  it('drops stale target reads and cancels all reads on destruction', () => {
    const firstAssignments = new Subject<{ userId: number; orgUnitIds: number[]; legacyOrgUnitId: number | null }>();
    const firstScope = new Subject<{ rule: 'ALL'; visibleOrgUnitIds: number[] }>();
    const firstTree = new Subject<OrgUnit[]>();
    const api = {
      list: vi.fn().mockReturnValueOnce(firstTree).mockReturnValue(of(units)),
      assignments: vi.fn().mockReturnValueOnce(firstAssignments).mockReturnValue(of({ userId: 43, orgUnitIds: [8], legacyOrgUnitId: null })),
      scope: vi.fn().mockReturnValueOnce(firstScope).mockReturnValue(of({ rule: 'UNITS', visibleOrgUnitIds: [8] })),
      saveAssignments: vi.fn(() => of(undefined))
    };
    TestBed.configureTestingModule({ providers: [{ provide: OrgUnitsApiService, useValue: api }, { provide: ToastService, useValue: { success: vi.fn() } }] });
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.view', 'iam.org_units.assign']);
    const fixture = TestBed.createComponent(UserOrgUnitsPanelComponent); fixture.componentRef.setInput('userId', 42); fixture.detectChanges();
    fixture.componentRef.setInput('userId', 43); fixture.detectChanges();
    expect(firstTree.observed).toBe(false); expect(firstAssignments.observed).toBe(false); expect(firstScope.observed).toBe(false);
    firstAssignments.next({ userId: 42, orgUnitIds: [7], legacyOrgUnitId: 9 });
    expect(fixture.componentInstance.selectedOrgUnitIds()).toEqual([8]);
    const finalTree = new Subject<OrgUnit[]>();
    const finalAssignments = new Subject<{ userId: number; orgUnitIds: number[]; legacyOrgUnitId: number | null }>();
    const finalScope = new Subject<{ rule: 'ALL'; visibleOrgUnitIds: number[] }>();
    api.list.mockReturnValueOnce(finalTree); api.assignments.mockReturnValueOnce(finalAssignments); api.scope.mockReturnValueOnce(finalScope);
    fixture.componentInstance.reloadTree(); fixture.componentInstance.reloadAssignments(); fixture.componentInstance.reloadScope();
    expect(finalTree.observed).toBe(true); expect(finalAssignments.observed).toBe(true); expect(finalScope.observed).toBe(true);
    fixture.destroy();
    expect(finalTree.observed).toBe(false); expect(finalAssignments.observed).toBe(false); expect(finalScope.observed).toBe(false);
  });

  it('keeps dirty state through 409, blocks double submit while pending and permits an explicit retry', () => {
    const { fixture, panel, api } = setup();
    panel.toggleAssignment(units[1]);
    const write = new Subject<undefined>(); api.saveAssignments.mockReturnValueOnce(write);
    const busy = vi.fn(); panel.busyChange.subscribe(busy);
    panel.save(); panel.save();
    expect(api.saveAssignments).toHaveBeenCalledTimes(1); expect(panel.canLeave()).toBe(false);
    const unload = new Event('beforeunload', { cancelable: true }); panel.beforeUnload(unload as BeforeUnloadEvent); expect(unload.defaultPrevented).toBe(true);
    write.error({ status: 409, code: 'CONFLICT', title: 'Conflict', detail: 'Assignments changed elsewhere' }); fixture.detectChanges();
    expect(panel.selectedOrgUnitIds()).toEqual([7, 8]); expect(fixture.nativeElement.textContent).toContain('Assignments changed elsewhere');
    panel.save(); expect(api.saveAssignments).toHaveBeenCalledTimes(2);
    expect(busy.mock.calls.map(call => call[0])).toEqual([true, false, true, false]);
  });

  it('shows 403 read failure with retry and never enables save before a successful assignment GET', () => {
    const { fixture, panel, api } = setup();
    api.assignments.mockReturnValueOnce(throwError(() => ({ status: 403, detail: 'Forbidden assignments' }))).mockReturnValueOnce(of({ userId: 42, orgUnitIds: [8], legacyOrgUnitId: null }));
    panel.reloadAssignments(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Forbidden assignments'); panel.save();
    expect(api.saveAssignments).not.toHaveBeenCalled();
    panel.reloadAssignments(); fixture.detectChanges(); expect(panel.selectedOrgUnitIds()).toEqual([8]);
  });

  it('keeps assignment and scope snapshots usable when only the tree read fails and retries that read alone', () => {
    const { fixture, panel, api } = setup();
    api.list.mockReturnValueOnce(throwError(() => ({ status: 500, detail: 'Tree only failed' }))).mockReturnValueOnce(of(units));
    panel.reloadTree(); fixture.detectChanges();
    expect(panel.selectedOrgUnitIds()).toEqual([7]); expect(panel.effectiveScope?.visibleOrgUnitIds).toEqual([7, 8]);
    expect(fixture.nativeElement.textContent).toContain('Tree only failed');
    const retry = fixture.nativeElement.querySelector('[data-action="retry-assignment-tree"] button') as HTMLButtonElement;
    expect(retry).not.toBeNull(); retry.click(); fixture.detectChanges();
    expect(api.list).toHaveBeenCalledTimes(3); expect(api.assignments).toHaveBeenCalledTimes(1); expect(api.scope).toHaveBeenCalledTimes(1);
  });

  it('does not report a valid assignment missing until a successful tree snapshot is authoritative', () => {
    const tree = new Subject<OrgUnit[]>();
    const api = {
      list: vi.fn().mockReturnValueOnce(tree).mockReturnValueOnce(of(units)),
      assignments: vi.fn(() => of({ userId: 42, orgUnitIds: [8], legacyOrgUnitId: null })),
      scope: vi.fn(() => of({ rule: 'UNITS' as const, visibleOrgUnitIds: [8] })),
      saveAssignments: vi.fn(() => of(undefined))
    };
    TestBed.configureTestingModule({ providers: [{ provide: OrgUnitsApiService, useValue: api }, { provide: ToastService, useValue: { success: vi.fn() } }] });
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.view', 'iam.org_units.assign']);
    const fixture = TestBed.createComponent(UserOrgUnitsPanelComponent);
    fixture.componentRef.setInput('userId', 42);
    fixture.detectChanges();
    const panel = fixture.componentInstance;

    expect(panel.assignmentsLoaded).toBe(true);
    expect(panel.treeLoaded).toBe(false);
    expect(panel.unresolvedAssignmentIds).toEqual([]);
    expect(fixture.nativeElement.textContent).not.toContain('отсутствуют в загруженном дереве');

    tree.error({ status: 503, detail: 'Tree unavailable' });
    fixture.detectChanges();
    expect(panel.unresolvedAssignmentIds).toEqual([]);
    expect(fixture.nativeElement.textContent).not.toContain('отсутствуют в загруженном дереве');

    panel.reloadTree();
    fixture.detectChanges();
    expect(panel.treeLoaded).toBe(true);
    expect(panel.unresolvedAssignmentIds).toEqual([]);
  });

  it('clears protected data and discard decisions when view is revoked while assign remains', () => {
    const { fixture, panel, api } = setup(); panel.toggleAssignment(units[1]);
    const decision = vi.fn(); (panel.canLeave() as Observable<boolean>).subscribe(decision); fixture.detectChanges();
    expect(panel.discard.open()).toBe(true);
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.assign']); panel.save(); fixture.detectChanges();
    expect(api.saveAssignments).not.toHaveBeenCalled(); expect(panel.discard.open()).toBe(false); expect(decision).toHaveBeenCalledWith(false);
    expect(panel.units).toEqual([]); expect(panel.selectedOrgUnitIds()).toEqual([]); expect(panel.effectiveScope).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Headquarters');
  });

  it('owns an issued write through view revocation but never restores protected state from its late result', () => {
    const { fixture, panel, api, toast } = setup(); panel.toggleAssignment(units[1]);
    const write = new Subject<undefined>(); api.saveAssignments.mockReturnValueOnce(write); panel.save();
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.assign']); fixture.detectChanges();
    expect(panel.pending).toBe(true); expect(write.observed).toBe(true); expect(panel.canLeave()).toBe(false);
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.view', 'iam.org_units.assign']); fixture.detectChanges();
    write.next(undefined); fixture.detectChanges();
    expect(panel.pending).toBe(false); expect(panel.units).toEqual([]); expect(panel.selectedOrgUnitIds()).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled(); expect(api.scope).toHaveBeenCalledTimes(1);
  });

  it('queues a target changed during a write and never applies the old result under the new input', () => {
    const { fixture, panel, api, toast } = setup(); panel.toggleAssignment(units[1]);
    const write = new Subject<undefined>(); api.saveAssignments.mockReturnValueOnce(write); panel.save();
    api.assignments.mockImplementation((userId: number) => of({ userId, orgUnitIds: userId === 43 ? [9] : [7], legacyOrgUnitId: null }));
    api.scope.mockImplementation((userId: number) => of({ rule: 'UNITS', visibleOrgUnitIds: userId === 43 ? [9] : [7] }));
    fixture.componentRef.setInput('userId', 43); fixture.detectChanges();
    expect(panel.assignmentsLoaded).toBe(false); expect(panel.pending).toBe(true);

    write.next(undefined); fixture.detectChanges();
    expect(toast.success).not.toHaveBeenCalled(); expect(panel.selectedOrgUnitIds()).toEqual([9]);
    expect(api.assignments.mock.calls.map(call => call[0])).toEqual([42, 43]);
    expect(api.scope.mock.calls.map(call => call[0])).toEqual([42, 43]);
  });

  it('invalidates an old pending epoch even when the forced input changes away and back', () => {
    const { fixture, panel, api, toast } = setup(); panel.toggleAssignment(units[1]);
    const write = new Subject<undefined>(); api.saveAssignments.mockReturnValueOnce(write); panel.save();
    api.assignments.mockImplementation((userId: number) => of({ userId, orgUnitIds: [7], legacyOrgUnitId: null }));
    fixture.componentRef.setInput('userId', 43); fixture.detectChanges();
    fixture.componentRef.setInput('userId', 42); fixture.detectChanges();
    write.error({ status: 409, detail: 'Old target failure' }); fixture.detectChanges();
    expect(toast.success).not.toHaveBeenCalled(); expect(panel.saveError).toBeNull(); expect(panel.selectedOrgUnitIds()).toEqual([7]);
    expect(api.assignments.mock.calls.map(call => call[0])).toEqual([42, 42]);
    expect(fixture.nativeElement.textContent).not.toContain('Old target failure');
  });

  it('fails closed on a forced dirty input replacement instead of retaining the old draft under the new target', () => {
    const { fixture, panel, api } = setup(); panel.toggleAssignment(units[1]); fixture.detectChanges();
    api.assignments.mockImplementation((userId: number) => of({ userId, orgUnitIds: userId === 43 ? [9] : [7], legacyOrgUnitId: null }));
    fixture.componentRef.setInput('userId', 43); fixture.detectChanges();
    expect(panel.discard.open()).toBe(false); expect(panel.selectedOrgUnitIds()).toEqual([9]);
    expect((fixture.nativeElement.querySelector('input[data-check="7"]') as HTMLInputElement).checked).toBe(false);
    expect((fixture.nativeElement.querySelector('input[data-check="9"]') as HTMLInputElement).checked).toBe(true);
    expect(api.assignments.mock.calls.map(call => call[0])).toEqual([42, 43]);
  });

  it('lets a host cancel a dirty target change before committing the public input', () => {
    const api = {
      list: vi.fn(() => of(units)),
      assignments: vi.fn((userId: number) => of({ userId, orgUnitIds: userId === 43 ? [9] : [7], legacyOrgUnitId: null })),
      scope: vi.fn((userId: number) => of({ rule: 'UNITS' as const, visibleOrgUnitIds: userId === 43 ? [9] : [7] })),
      saveAssignments: vi.fn((_userId: number, _ids: number[]) => of(undefined))
    };
    TestBed.configureTestingModule({ providers: [{ provide: OrgUnitsApiService, useValue: api }, { provide: ToastService, useValue: { success: vi.fn() } }] });
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.view', 'iam.org_units.assign']);
    const fixture = TestBed.createComponent(UserPanelHost); fixture.detectChanges();
    const host = fixture.componentInstance; host.panel.toggleAssignment(units[1]); host.requestTarget(43); fixture.detectChanges();
    expect(host.selectedUserId).toBe(42); expect(host.panel.discard.open()).toBe(true);
    host.panel.discard.cancel(); fixture.detectChanges();
    expect(host.selectedUserId).toBe(42); expect(host.panel.selectedOrgUnitIds()).toEqual([7, 8]); expect(api.assignments).toHaveBeenCalledTimes(1);
    host.requestTarget(43); host.panel.discard.confirm(); fixture.detectChanges();
    expect(host.selectedUserId).toBe(43); expect(host.panel.selectedOrgUnitIds()).toEqual([9]);
  });

  it('marks a completed save clean before isolated effective-scope refresh failure', () => {
    const { fixture, panel, api, toast } = setup(); panel.toggleAssignment(units[1]);
    api.scope.mockReturnValueOnce(throwError(() => ({ status: 500, detail: 'Scope refresh failed' })));
    panel.save(); fixture.detectChanges();
    expect(toast.success).toHaveBeenCalledTimes(1); expect(panel.hasUnsavedWork()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Сохранено');
    panel.save(); expect(api.saveAssignments).toHaveBeenCalledTimes(1);
    expect(api.assignments).toHaveBeenCalledTimes(1); expect(api.scope).toHaveBeenCalledTimes(2);
  });

  it('requires confirmation to discard dirty edits and cancellation keeps them', () => {
    const { panel } = setup(); panel.toggleAssignment(units[1]);
    const result = vi.fn(); (panel.canLeave() as Observable<boolean>).subscribe(result);
    expect(panel.discard.open()).toBe(true); panel.discard.cancel(); expect(result).toHaveBeenCalledWith(false);
    expect(panel.selectedOrgUnitIds()).toEqual([7, 8]);
    (panel.canLeave() as Observable<boolean>).subscribe(result); panel.discard.confirm();
    expect(result).toHaveBeenCalledWith(true); expect(panel.selectedOrgUnitIds()).toEqual([7]);
  });
});
