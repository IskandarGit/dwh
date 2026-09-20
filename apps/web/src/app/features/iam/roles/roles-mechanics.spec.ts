import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormTreeItem, Role } from '../../../core/models/rbac.models';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { RolesComponent } from './roles.component';

const roles: Role[] = [
  { id: 1, name: 'Role A', state: 'A', orderNo: 1, createdAt: '2026-09-07T00:00:00Z', modifiedAt: '2026-09-07T00:00:00Z' },
  { id: 2, name: 'Role B', state: 'A', orderNo: 2, createdAt: '2026-09-07T00:00:00Z', modifiedAt: '2026-09-07T00:00:00Z' },
  { id: 3, name: 'Administrator', pcode: 'admin', state: 'A', orderNo: 3, createdAt: '2026-09-07T00:00:00Z', modifiedAt: '2026-09-07T00:00:00Z' }
];
const forms: FormTreeItem[] = [
  { formCode: 'tasks.items', module: 'ms.task', formName: 'Tasks', action: 'view', actionName: 'View' },
  { formCode: 'tasks.items', module: 'ms.task', formName: 'Tasks', action: 'update', actionName: 'Update' }
];

describe('RolesComponent permission matrix lifecycle', () => {
  let fixture: ComponentFixture<RolesComponent>;
  let host: HTMLElement;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RolesComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), PermissionService,
        { provide: ToastService, useValue: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }
      ]
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(PermissionService).setPermissions(['rbac.roles.view', 'rbac.roles.grant']);
    fixture = TestBed.createComponent(RolesComponent);
    host = fixture.nativeElement;
    fixture.detectChanges();
    http.expectOne('/api/v1/rbac/forms').flush(forms);
    http.expectOne('/api/v1/rbac/roles').flush(roles);
    http.expectOne('/api/v1/iam/roles/user-counts').flush({});
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function selectRole(index: number) {
    host.querySelectorAll<HTMLButtonElement>('.role-select-btn')[index].click();
    fixture.detectChanges();
  }

  function loadRoleA() {
    http.expectOne('/api/v1/rbac/roles/1/permissions').flush(['tasks.items.view']);
    fixture.detectChanges();
  }

  function checkbox(action: string) {
    return host.querySelector<HTMLInputElement>(`label[title="tasks.items.${action}"] input`)!;
  }

  function saveButton() {
    return host.querySelector<HTMLButtonElement>('.matrix-actions-box .btn-primary')
      ?? host.querySelector<HTMLButtonElement>('.matrix-actions-box button');
  }

  it('saves only role B permissions after a late role A response', () => {
    const slowA = http.expectOne('/api/v1/rbac/roles/1/permissions');
    selectRole(1);
    http.expectOne('/api/v1/rbac/roles/2/permissions').flush(['tasks.items.update']);
    if (!slowA.cancelled) slowA.flush(['tasks.items.view']);
    fixture.detectChanges();
    saveButton()!.click();
    const write = http.expectOne('/api/v1/rbac/roles/2/permissions');

    expect.soft(write.request.body).toEqual([{ formCode: 'tasks.items', action: 'update' }]);
    expect.soft(checkbox('view').checked).toBe(false);
    expect.soft(checkbox('update').checked).toBe(true);
    write.flush(null);
  });

  it('cannot save or edit the previous matrix before role B permissions arrive', () => {
    loadRoleA();
    selectRole(1);
    const pendingB = http.expectOne('/api/v1/rbac/roles/2/permissions');

    expect.soft(checkbox('view').checked).toBe(false);
    expect.soft(checkbox('view').disabled).toBe(true);
    expect.soft(saveButton()?.disabled).toBe(true);
    saveButton()!.click();
    fixture.componentInstance.savePermissions();
    const writes = http.match(request => request.method === 'PUT');
    expect.soft(writes).toHaveLength(0);
    for (const write of writes) write.flush(null);

    pendingB.flush(['tasks.items.update']);
    fixture.detectChanges();
    expect(saveButton()?.disabled).toBe(false);
    expect(checkbox('update').checked).toBe(true);
  });

  it('cannot submit an accidental empty permission set during initial loading', () => {
    const pendingA = http.expectOne('/api/v1/rbac/roles/1/permissions');
    saveButton()!.click();
    fixture.componentInstance.savePermissions();
    const writes = http.match(request => request.method === 'PUT');
    expect.soft(writes).toHaveLength(0);
    for (const write of writes) write.flush(null);
    pendingA.flush(['tasks.items.view']);
  });

  it('keeps a failed role disabled and offers a retry for its own permissions', () => {
    loadRoleA();
    selectRole(1);
    http.expectOne('/api/v1/rbac/roles/2/permissions').flush(
      { detail: 'Permission lookup unavailable' }, { status: 503, statusText: 'Service Unavailable' }
    );
    fixture.detectChanges();

    expect.soft(host.querySelector('[role="alert"]')?.textContent ?? '').toContain('Permission lookup unavailable');
    expect.soft(saveButton()?.disabled).toBe(true);
    expect.soft(checkbox('view').disabled).toBe(true);
    fixture.componentInstance.savePermissions();
    const writes = http.match(request => request.method === 'PUT');
    expect.soft(writes).toHaveLength(0);
    for (const write of writes) write.flush(null);

    const retry = Array.from(host.querySelectorAll<HTMLButtonElement>('.matrix-card button'))
      .find(button => button.textContent?.trim() === 'Обновить');
    expect(retry).toBeDefined();
    retry!.click();
    http.expectOne('/api/v1/rbac/roles/2/permissions').flush(['tasks.items.update']);
    fixture.detectChanges();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(saveButton()?.disabled).toBe(false);
    expect(checkbox('update').checked).toBe(true);
  });

  it('freezes the saved matrix and role selection until its single PUT completes', () => {
    loadRoleA();
    saveButton()!.click();
    const firstWrite = http.expectOne('/api/v1/rbac/roles/1/permissions');
    fixture.detectChanges();

    expect.soft(checkbox('view').disabled).toBe(true);
    expect.soft(host.querySelector<HTMLButtonElement>('.role-select-btn')?.disabled).toBe(true);
    expect.soft(Array.from(host.querySelectorAll<HTMLButtonElement>('.batch-btn, .mini-toggle-btn'))
      .every(button => button.disabled)).toBe(true);
    fixture.componentInstance.savePermissions();
    const duplicates = http.match(request => request.method === 'PUT');
    expect.soft(duplicates).toHaveLength(0);
    for (const write of duplicates) write.flush(null);

    const component = fixture.componentInstance;
    checkbox('update').checked = true;
    component.togglePermission('tasks.items', 'update', { target: checkbox('update') } as unknown as Event);
    component.toggleAllForm(component.moduleGroups[0].forms[0], true);
    component.toggleAllModule(component.moduleGroups[0], false);
    component.selectRole(roles[1]);
    for (const request of http.match('/api/v1/rbac/roles/2/permissions')) request.flush(['tasks.items.update']);

    expect.soft(component.selectedRole()?.id).toBe(1);
    expect.soft(Array.from(component.rolePermissions())).toEqual(['tasks.items.view']);
    firstWrite.flush(null);
    fixture.detectChanges();
    expect(saveButton()?.disabled).toBe(false);
    expect(checkbox('view').disabled).toBe(false);
  });

  it('keeps the matrix draft available for a failed save retry', () => {
    loadRoleA();
    checkbox('update').click();
    fixture.detectChanges();
    saveButton()!.click();
    http.expectOne('/api/v1/rbac/roles/1/permissions').flush(
      { detail: 'Save unavailable' }, { status: 503, statusText: 'Service Unavailable' }
    );
    fixture.detectChanges();

    expect(saveButton()?.disabled).toBe(false);
    expect(checkbox('view').checked).toBe(true);
    expect(checkbox('update').checked).toBe(true);
    saveButton()!.click();
    const retry = http.expectOne('/api/v1/rbac/roles/1/permissions');
    expect(retry.request.body).toEqual([
      { formCode: 'tasks.items', action: 'view' }, { formCode: 'tasks.items', action: 'update' }
    ]);
    retry.flush(null);
  });

  it('requires grant permission rather than role update permission to edit a matrix', () => {
    loadRoleA();
    TestBed.inject(PermissionService).setPermissions(['rbac.roles.view', 'rbac.roles.update']);
    fixture.detectChanges();

    expect.soft(saveButton()).toBeNull();
    expect.soft(checkbox('view').disabled).toBe(true);
    const component = fixture.componentInstance;
    component.toggleAllModule(component.moduleGroups[0], false);
    component.savePermissions();
    const writes = http.match(request => request.method === 'PUT');
    expect.soft(writes).toHaveLength(0);
    for (const write of writes) write.flush(null);
    expect(Array.from(component.rolePermissions())).toEqual(['tasks.items.view']);
  });

  it('does not submit changes to the administrator matrix', () => {
    loadRoleA();
    selectRole(2);
    http.expectOne('/api/v1/rbac/roles/3/permissions').flush(['tasks.items.view']);
    fixture.detectChanges();
    saveButton()?.click();
    fixture.componentInstance.savePermissions();
    const writes = http.match(request => request.method === 'PUT');
    expect.soft(writes).toHaveLength(0);
    for (const write of writes) write.flush(null);
    expect(checkbox('update').checked).toBe(true);
    expect(checkbox('update').disabled).toBe(true);
  });

  it('ignores a permission response after leaving the roles screen', () => {
    const pending = http.expectOne('/api/v1/rbac/roles/1/permissions');
    const component = fixture.componentInstance;
    fixture.destroy();
    if (!pending.cancelled) pending.flush(['tasks.items.view']);
    expect(Array.from(component.rolePermissions())).toEqual([]);
  });
});
