import { TestBed } from '@angular/core/testing';
import { Component, ViewChild } from '@angular/core';
import { Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrgUnitsApiService } from './org-units-api.service';
import { RoleRuleSnapshot, ScopeRule } from './org-units.models';
import { RoleScopePanelComponent } from './role-scope-panel.component';

@Component({
  standalone: true,
  imports: [RoleScopePanelComponent],
  template: `<app-role-scope-panel [roleId]="selectedRoleId" />`
})
class RolePanelHost {
  selectedRoleId = 5;
  @ViewChild(RoleScopePanelComponent) panel!: RoleScopePanelComponent;
  requestTarget(roleId: number): void {
    const decision = this.panel.canLeave();
    if (typeof decision === 'boolean') { if (decision) this.selectedRoleId = roleId; }
    else decision.subscribe(allow => { if (allow) this.selectedRoleId = roleId; });
  }
}

describe('RoleScopePanelComponent', () => {
  function setup(options: { target?: number; rule?: ScopeRule; permissions?: string[] } = {}) {
    const api = {
      roleRule: vi.fn((_roleId: number) => of({ roleId: options.target ?? 5, rule: options.rule ?? 'ALL' })),
      saveRoleRule: vi.fn((_roleId: number, _rule: ScopeRule) => of(undefined))
    };
    const toast = { success: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: OrgUnitsApiService, useValue: api }, { provide: ToastService, useValue: toast }] });
    TestBed.inject(PermissionService).setPermissions(options.permissions ?? ['iam.org_units.view', 'iam.org_units.assign']);
    const fixture = TestBed.createComponent(RoleScopePanelComponent);
    fixture.componentRef.setInput('roleId', options.target ?? 5); fixture.detectChanges();
    return { fixture, panel: fixture.componentInstance, api, toast };
  }

  it('does not persist an initial ALL fallback or save before a successful GET', () => {
    const { panel, api } = setup();
    expect(panel.selectedRule()).toBe('ALL'); panel.save(); panel.confirmSave();
    expect(api.saveRoleRule).not.toHaveBeenCalled();

    const slow = new Subject<RoleRuleSnapshot>(); api.roleRule.mockReturnValueOnce(slow); panel.reload();
    panel.selectRule('SELF'); panel.save(); panel.confirmSave();
    expect(api.saveRoleRule).not.toHaveBeenCalled();
    slow.next({ roleId: 5, rule: 'ALL' }); slow.complete();
  });

  it('uses iam.org_units.assign independently from rbac.roles.grant', () => {
    const grantOnly = setup({ permissions: ['iam.org_units.view', 'rbac.roles.grant'] });
    grantOnly.panel.selectRule('SELF'); grantOnly.panel.save(); grantOnly.panel.confirmSave();
    expect(grantOnly.api.saveRoleRule).not.toHaveBeenCalled();
    expect(grantOnly.fixture.nativeElement.querySelector('[data-action="save-rule"]')).toBeNull();
  });

  it('requires confirmation naming previous and new rules plus widest-rule semantics', () => {
    const { fixture, panel, api } = setup({ rule: 'UNITS' });
    panel.selectRule('SUBTREE'); panel.save(); fixture.detectChanges();
    expect(api.saveRoleRule).not.toHaveBeenCalled(); expect(panel.confirmationOpen).toBe(true);
    const dialog = fixture.nativeElement.querySelector('[data-rule-confirm]') as HTMLElement;
    expect(dialog.textContent).toContain('Только свои подразделения');
    expect(dialog.textContent).toContain('Свои подразделения и подчинённые');
    expect(dialog.textContent).toContain('самое широкое правило');
    panel.confirmSave();
    expect(api.saveRoleRule).toHaveBeenCalledWith(5, 'SUBTREE');
  });

  it('shows all four typed rules and read-only explanations with view permission alone', () => {
    const { fixture, panel, api } = setup({ permissions: ['iam.org_units.view'], rule: 'SELF' });
    const radios = Array.from(fixture.nativeElement.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
    expect(radios.map(input => input.value)).toEqual(['ALL', 'SUBTREE', 'UNITS', 'SELF']);
    expect(radios.every(input => input.disabled)).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Связь определяется правилами конкретной сущности');
    panel.selectRule('ALL'); panel.save(); panel.confirmSave(); expect(api.saveRoleRule).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('does not read or mutate an unsafe role target %s', target => {
    const { panel, api } = setup({ target }); panel.selectRule('SELF'); panel.save(); panel.confirmSave();
    expect(api.roleRule).not.toHaveBeenCalled(); expect(api.saveRoleRule).not.toHaveBeenCalled();
  });

  it('drops a stale role response and cancels the active read on destruction', () => {
    const first = new Subject<RoleRuleSnapshot>(); const second = new Subject<RoleRuleSnapshot>();
    const api = { roleRule: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second), saveRoleRule: vi.fn(() => of(undefined)) };
    TestBed.configureTestingModule({ providers: [{ provide: OrgUnitsApiService, useValue: api }, { provide: ToastService, useValue: { success: vi.fn() } }] });
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.view', 'iam.org_units.assign']);
    const fixture = TestBed.createComponent(RoleScopePanelComponent); fixture.componentRef.setInput('roleId', 5); fixture.detectChanges();
    fixture.componentRef.setInput('roleId', 6); fixture.detectChanges();
    expect(first.observed).toBe(false); first.next({ roleId: 5, rule: 'SELF' }); expect(fixture.componentInstance.selectedRule()).toBe('ALL');
    expect(second.observed).toBe(true); fixture.destroy(); expect(second.observed).toBe(false);
  });

  it('preserves a dirty rule through 409, blocks double submit and retries explicitly', () => {
    const { fixture, panel, api } = setup({ rule: 'ALL' }); panel.selectRule('UNITS'); panel.save();
    const write = new Subject<undefined>(); api.saveRoleRule.mockReturnValueOnce(write);
    const busy = vi.fn(); panel.busyChange.subscribe(busy); panel.confirmSave(); panel.confirmSave();
    expect(api.saveRoleRule).toHaveBeenCalledTimes(1); expect(panel.canLeave()).toBe(false);
    const unload = new Event('beforeunload', { cancelable: true }); panel.beforeUnload(unload as BeforeUnloadEvent); expect(unload.defaultPrevented).toBe(true);
    write.error({ status: 409, code: 'CONFLICT', title: 'Conflict', detail: 'Rule changed elsewhere' }); fixture.detectChanges();
    expect(panel.selectedRule()).toBe('UNITS'); expect(fixture.nativeElement.textContent).toContain('Rule changed elsewhere');
    panel.save(); panel.confirmSave(); expect(api.saveRoleRule).toHaveBeenCalledTimes(2);
    expect(busy.mock.calls.map(call => call[0])).toEqual([true, false, true, false]);
  });

  it('shows a 403 read failure with retry and keeps save disabled before success', () => {
    const { fixture, panel, api } = setup();
    api.roleRule.mockReturnValueOnce(throwError(() => ({ status: 403, detail: 'Forbidden rule' }))).mockReturnValueOnce(of({ roleId: 5, rule: 'SELF' }));
    panel.reload(); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('Forbidden rule');
    panel.selectRule('UNITS'); panel.save(); panel.confirmSave(); expect(api.saveRoleRule).not.toHaveBeenCalled();
    panel.reload(); fixture.detectChanges(); expect(panel.selectedRule()).toBe('SELF');
  });

  it('clears the loaded rule and open confirmation when view is revoked while assign remains', () => {
    const { fixture, panel, api } = setup({ rule: 'ALL' }); panel.selectRule('SELF'); panel.save(); fixture.detectChanges();
    expect(panel.confirmationOpen).toBe(true);
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.assign']); panel.confirmSave(); fixture.detectChanges();
    expect(api.saveRoleRule).not.toHaveBeenCalled(); expect(panel.confirmationOpen).toBe(false); expect(panel.loaded).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Только связанные со мной данные');
  });

  it('owns an issued request through view revocation and ignores its late result after view returns', () => {
    const { fixture, panel, api, toast } = setup({ rule: 'ALL' }); panel.selectRule('SELF'); panel.save();
    const write = new Subject<undefined>(); api.saveRoleRule.mockReturnValueOnce(write); panel.confirmSave();
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.assign']); fixture.detectChanges();
    expect(panel.pending).toBe(true); expect(write.observed).toBe(true); expect(panel.canLeave()).toBe(false);
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.view', 'iam.org_units.assign']); fixture.detectChanges();
    write.next(undefined); fixture.detectChanges();
    expect(panel.pending).toBe(false); expect(panel.loaded).toBe(false); expect(toast.success).not.toHaveBeenCalled();
    expect(api.roleRule).toHaveBeenCalledTimes(1);
  });

  it('queues a target changed during a write and never applies the old rule result under the new input', () => {
    const { fixture, panel, api, toast } = setup({ rule: 'ALL' }); panel.selectRule('SELF'); panel.save();
    const write = new Subject<undefined>(); api.saveRoleRule.mockReturnValueOnce(write); panel.confirmSave();
    api.roleRule.mockImplementation((roleId: number) => of({ roleId, rule: roleId === 6 ? 'UNITS' : 'ALL' }));
    fixture.componentRef.setInput('roleId', 6); fixture.detectChanges();
    expect(panel.loaded).toBe(false); expect(panel.pending).toBe(true);

    write.next(undefined); fixture.detectChanges();
    expect(toast.success).not.toHaveBeenCalled(); expect(panel.selectedRule()).toBe('UNITS');
    expect(api.roleRule.mock.calls.map(call => call[0])).toEqual([5, 6]);
  });

  it('invalidates an old pending epoch even when the forced input changes away and back', () => {
    const { fixture, panel, api, toast } = setup({ rule: 'ALL' }); panel.selectRule('SELF'); panel.save();
    const write = new Subject<undefined>(); api.saveRoleRule.mockReturnValueOnce(write); panel.confirmSave();
    api.roleRule.mockImplementation((roleId: number) => of({ roleId, rule: 'ALL' as const }));
    fixture.componentRef.setInput('roleId', 6); fixture.detectChanges();
    fixture.componentRef.setInput('roleId', 5); fixture.detectChanges();
    write.error({ status: 409, detail: 'Old target rule failure' }); fixture.detectChanges();
    expect(toast.success).not.toHaveBeenCalled(); expect(panel.saveError).toBeNull(); expect(panel.selectedRule()).toBe('ALL');
    expect(api.roleRule.mock.calls.map(call => call[0])).toEqual([5, 5]);
    expect(fixture.nativeElement.textContent).not.toContain('Old target rule failure');
  });

  it('fails closed on a forced dirty input replacement instead of retaining the old rule draft', () => {
    const { fixture, panel, api } = setup({ rule: 'ALL' }); panel.selectRule('SELF'); fixture.detectChanges();
    api.roleRule.mockImplementation((roleId: number) => of({ roleId, rule: roleId === 6 ? 'UNITS' as const : 'ALL' as const }));
    fixture.componentRef.setInput('roleId', 6); fixture.detectChanges();
    expect(panel.discard.open()).toBe(false); expect(panel.selectedRule()).toBe('UNITS');
    expect(api.roleRule.mock.calls.map(call => call[0])).toEqual([5, 6]);
  });

  it('lets a host cancel a dirty target change before committing the public input', () => {
    const api = {
      roleRule: vi.fn((roleId: number) => of({ roleId, rule: roleId === 6 ? 'UNITS' as const : 'ALL' as const })),
      saveRoleRule: vi.fn((_roleId: number, _rule: ScopeRule) => of(undefined))
    };
    TestBed.configureTestingModule({ providers: [{ provide: OrgUnitsApiService, useValue: api }, { provide: ToastService, useValue: { success: vi.fn() } }] });
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.view', 'iam.org_units.assign']);
    const fixture = TestBed.createComponent(RolePanelHost); fixture.detectChanges();
    const host = fixture.componentInstance; host.panel.selectRule('SELF'); host.requestTarget(6); fixture.detectChanges();
    expect(host.selectedRoleId).toBe(5); expect(host.panel.discard.open()).toBe(true);
    host.panel.discard.cancel(); fixture.detectChanges();
    expect(host.selectedRoleId).toBe(5); expect(host.panel.selectedRule()).toBe('SELF'); expect(api.roleRule).toHaveBeenCalledTimes(1);
    host.requestTarget(6); host.panel.discard.confirm(); fixture.detectChanges();
    expect(host.selectedRoleId).toBe(6); expect(host.panel.selectedRule()).toBe('UNITS');
  });

  it('marks a successful save clean before a failed refresh and does not resubmit it', () => {
    const { fixture, panel, api, toast } = setup({ rule: 'ALL' }); panel.selectRule('SELF'); panel.save();
    api.roleRule.mockReturnValueOnce(throwError(() => ({ status: 500, detail: 'Rule refresh failed' })));
    panel.confirmSave(); fixture.detectChanges();
    expect(toast.success).toHaveBeenCalledTimes(1); expect(panel.hasUnsavedWork()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Сохранено');
    panel.save(); panel.confirmSave(); expect(api.saveRoleRule).toHaveBeenCalledTimes(1);
  });

  it('cancels a dirty exit without losing the selected rule and confirms a later exit', () => {
    const { panel } = setup({ rule: 'ALL' }); panel.selectRule('SELF');
    const result = vi.fn(); (panel.canLeave() as Observable<boolean>).subscribe(result);
    expect(panel.discard.open()).toBe(true); panel.discard.cancel(); expect(result).toHaveBeenCalledWith(false); expect(panel.selectedRule()).toBe('SELF');
    (panel.canLeave() as Observable<boolean>).subscribe(result); panel.discard.confirm();
    expect(result).toHaveBeenCalledWith(true); expect(panel.selectedRule()).toBe('ALL');
  });
});
