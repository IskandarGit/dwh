import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { OrgUnitsComponent } from './org-units.component';
import { OrgUnitsApiService } from './org-units-api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrgUnit } from './org-units.models';

const root: OrgUnit = { id: 1, parentId: null, code: 'ROOT', name: 'Root', kind: 'company', state: 'A', orderNo: 0, createdAt: '', modifiedAt: '' };
const child: OrgUnit = { ...root, id: 2, parentId: 1, code: 'CHILD', name: 'Child' };
describe('OrgUnitsComponent lifecycle', () => {
  function setup(units: OrgUnit[] = [root, child], writable = true) {
    const api = { list: vi.fn(() => of(units)), get: vi.fn((id: number) => of(units.find(u => u.id === id)!)), create: vi.fn(() => of(root)), update: vi.fn(() => of(undefined)), remove: vi.fn(() => of(undefined)) };
    const toast = { success: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: OrgUnitsApiService, useValue: api }, { provide: ToastService, useValue: toast }] });
    TestBed.inject(PermissionService).setPermissions(writable ? ['iam.org_units.*'] : ['iam.org_units.view']);
    const fixture = TestBed.createComponent(OrgUnitsComponent); fixture.detectChanges();
    return { fixture, page: fixture.componentInstance, api, toast };
  }
  it('empty state offers explicit root creation and opening never writes', () => {
    const { fixture, page, api } = setup([]);
    const create = fixture.nativeElement.querySelector('[data-action="create"] button') as HTMLButtonElement;
    expect(create?.textContent ?? '').toContain('корень'); create.click(); fixture.detectChanges();
    expect(page.editorInitial).toMatchObject({ parentId: null });
    expect(api.create).not.toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled();
  });
  it('view-only renders readable selected details without write controls', () => {
    const { fixture, page } = setup([root], false);
    page.select(root); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('ROOT');
    expect(fixture.nativeElement.querySelector('[data-action="create"], [data-action="edit"], [data-action="delete"]')).toBeNull();
  });
  it('reload failure retains error/retry and selection survives successful refresh', () => {
    const { fixture, page, api } = setup(); page.select(child);
    api.list.mockReturnValueOnce(throwError(() => ({ detail: 'Read failed' })));
    page.reload(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent ?? '').toContain('Read failed');
    expect(fixture.nativeElement.querySelector('[data-action="retry-tree"]')).not.toBeNull();
    expect(page.units).toHaveLength(2);
    api.list.mockReturnValueOnce(of([root, { ...child, name: 'Updated' }])); page.reload();
    expect(page.selected).toMatchObject({ id: 2, name: 'Updated' });
  });
  it('cancels stale detail GET when selecting a different node', () => {
    const { fixture, page, api } = setup();
    const slow = new Subject<OrgUnit>(); api.get.mockReturnValueOnce(slow);
    page.select(root); page.edit();
    expect(slow.observed).toBe(true);
    page.select(child); page.edit(); slow.next({ ...root, name: 'Stale' }); fixture.detectChanges();
    expect(slow.observed).toBe(false); expect(page.editorInitial).toMatchObject({ id: 2, name: 'Child' });
  });
  it('requires discard on dirty close and route leave, supports canceled navigation', () => {
    const { fixture, page } = setup(); page.select(child); page.edit(); fixture.detectChanges();
    expect(page.editor).toBeDefined(); page.editor!.draft.name = 'Draft';
    page.closeEditor(); fixture.detectChanges(); expect(page.editorOpen).toBe(true);
    page.discard.cancel();
    const decision = page.canLeaveRecordPage(); const result = vi.fn();
    expect(typeof decision).not.toBe('boolean'); const subscription = (decision as Observable<boolean>).subscribe(result);
    subscription.unsubscribe(); page.discard.confirm(); expect(result).not.toHaveBeenCalled(); expect(page.editorOpen).toBe(true);
    (page.canLeaveRecordPage() as Observable<boolean>).subscribe(result); page.discard.confirm();
    expect(result).toHaveBeenCalledWith(true); expect(page.editorOpen).toBe(false);
  });
  it('locks repeated save/close/target change while pending; write failure preserves draft', () => {
    const { fixture, page, api } = setup(); page.select(child); page.edit(); fixture.detectChanges();
    expect(page.editor).toBeDefined(); page.editor!.draft.name = 'Draft';
    const save = new Subject<undefined>(); api.update.mockReturnValueOnce(save);
    page.editor!.submit(); fixture.detectChanges(); page.editor!.submit(); page.closeEditor(); page.select(root);
    expect(api.update).toHaveBeenCalledTimes(1); expect(page.selected?.id).toBe(2); expect(page.editorOpen).toBe(true);
    expect(page.canLeaveRecordPage()).toBe(false);
    const event = new Event('beforeunload', { cancelable: true }); page.beforeUnload(event as BeforeUnloadEvent); expect(event.defaultPrevented).toBe(true);
    save.error({ detail: 'Write failed', status: 409 }); fixture.detectChanges();
    expect(page.editor!.draft.name).toBe('Draft'); expect(fixture.nativeElement.textContent).toContain('Write failed');
    page.editor!.submit(); expect(api.update).toHaveBeenCalledTimes(2);
  });
  it('reports successful write plus failed refresh without retrying the write', () => {
    const { fixture, page, api, toast } = setup(); page.select(child); page.edit(); fixture.detectChanges();
    expect(page.editor).toBeDefined(); page.editor!.draft.name = 'New';
    api.list.mockReturnValueOnce(throwError(() => ({ detail: 'Refresh failed' })));
    page.editor!.submit(); fixture.detectChanges();
    expect(toast.success).toHaveBeenCalledTimes(1); expect(page.editorOpen).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Сохранено');
    page.reload(); expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('preserves unsafe record context as read-only and makes no detail or mutation request', () => {
    const unsafe = { ...root, id: Number.MAX_SAFE_INTEGER + 1 };
    const { fixture, page, api } = setup([unsafe]); page.select(unsafe); page.edit(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('ROOT');
    expect(fixture.nativeElement.textContent).toContain('только для просмотра');
    expect(api.get).not.toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled();
  });
  it('requires named deletion confirmation and retains selection on server conflict', () => {
    const { fixture, page, api } = setup(); page.select(child); fixture.detectChanges();
    const remove = fixture.nativeElement.querySelector('[data-action="delete"] button') as HTMLButtonElement;
    expect(remove).not.toBeNull(); remove.click(); fixture.detectChanges();
    expect(api.remove).not.toHaveBeenCalled();
    const dialog = fixture.nativeElement.querySelector('[data-delete-confirm]');
    expect(dialog.textContent).toContain('CHILD'); expect(dialog.textContent).toContain('Child');
    api.remove.mockReturnValueOnce(throwError(() => ({ status: 409, detail: 'Assigned employees' })));
    (fixture.nativeElement.querySelector('[data-action="confirm-delete"] button') as HTMLButtonElement).click(); fixture.detectChanges();
    expect(api.remove).toHaveBeenCalledWith(2); expect(page.selected?.id).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Assigned employees');
  });
  it('removes a successfully deleted target before a failed tree refresh', () => {
    const { fixture, page, api, toast } = setup();
    page.select(child);
    page.requestDelete();
    api.list.mockReturnValueOnce(throwError(() => ({ status: 503, detail: 'Refresh failed after delete' })));

    page.confirmDelete();
    fixture.detectChanges();

    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(page.deleteTarget).toBeNull();
    expect(page.selected).toBeNull();
    expect(page.units.map(unit => unit.id)).toEqual([1]);
    expect(page.treeError?.detail).toBe('Refresh failed after delete');
    expect(fixture.nativeElement.querySelector('[data-action="retry-tree"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-action="edit"], [data-action="delete"]')).toBeNull();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
  it('recreates a clean editor when the target changes within one render cycle', () => {
    const { fixture, page, api } = setup(); page.select(child); page.edit(); fixture.detectChanges();
    page.select(root); page.edit(); fixture.detectChanges();
    page.editor!.draft.name = 'Root renamed'; page.editor!.submit();
    expect(api.update).toHaveBeenCalledWith(1, { name: 'Root renamed' });
  });
  it('does not replace draft context with a tree reload while editing', () => {
    const { fixture, page, api } = setup(); page.select(child); page.edit(); fixture.detectChanges();
    page.editor!.draft.name = 'Unsaved'; page.reload();
    expect(api.list).toHaveBeenCalledTimes(1); expect(page.editor!.draft.name).toBe('Unsaved');
  });
  it('cancels detail reads on destruction', () => {
    const { fixture, page, api, toast } = setup(); const detail = new Subject<OrgUnit>(); api.get.mockReturnValueOnce(detail);
    page.select(child); page.edit(); expect(detail.observed).toBe(true); fixture.destroy(); expect(detail.observed).toBe(false);
    detail.next(child); expect(toast.success).not.toHaveBeenCalled();
  });
  it('shows a detail error and explicit retry without offering save before successful read', () => {
    const { fixture, page, api } = setup();
    api.get.mockReturnValueOnce(throwError(() => ({ status: 403, detail: 'Forbidden detail' })));
    page.select(child); page.edit(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Forbidden detail'); expect(page.editor).toBeUndefined();
    page.save({ mode: 'edit', id: 2, patch: { name: 'No read' } }); expect(api.update).not.toHaveBeenCalled();
    page.loadDetail(); fixture.detectChanges(); expect(page.editor?.draft.name).toBe('Child');
  });
  it('warns on dirty Escape and keeps the draft when discard is canceled', () => {
    const { fixture, page } = setup(); page.select(child); page.edit(); fixture.detectChanges();
    page.editor!.draft.name = 'Unsaved';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); fixture.detectChanges();
    expect(page.discard.open()).toBe(true); page.discard.cancel(); fixture.detectChanges();
    expect(page.editor!.draft.name).toBe('Unsaved');
  });
  it('unsubscribes a pending write on destruction and ignores a late success', () => {
    const { fixture, page, api, toast } = setup(); page.select(child); page.edit(); fixture.detectChanges();
    const write = new Subject<undefined>(); api.update.mockReturnValueOnce(write); page.editor!.draft.name = 'New'; page.editor!.submit();
    fixture.destroy(); expect(write.observed).toBe(false); write.next(undefined);
    expect(toast.success).not.toHaveBeenCalled(); expect(api.list).toHaveBeenCalledTimes(1);
  });
  it('does not fetch or permit creation without view permission', () => {
    const { fixture, page, api } = setup(); TestBed.inject(PermissionService).clear(); fixture.detectChanges();
    page.reload(); page.create();
    expect(api.list).toHaveBeenCalledTimes(1); expect(page.editorOpen).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Нет права просмотра');
  });
  it.each(['create', 'update'] as const)('clears the open %s editor and blocks immediate save when only view is revoked', action => {
    const { fixture, page, api } = setup();
    page.select(child); action === 'create' ? page.create() : page.edit(); fixture.detectChanges();
    const editor = page.editor!; editor.draft.name = 'Unsaved'; editor.draft.code = 'NEW';
    TestBed.inject(PermissionService).setPermissions([`iam.org_units.${action}`]);
    // Entry points must deny immediately, before the permission effect renders.
    editor.submit();
    expect(api.create).not.toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(page.editorOpen).toBe(false); expect(page.editorInitial).toBeNull();
    expect(page.editor).toBeUndefined();
    expect(page.selected).toBeNull(); expect(page.units).toEqual([]);
    page.create(); page.edit(); expect(page.editorOpen).toBe(false);
  });
  it('clears the deletion dialog and blocks confirmation while delete is retained without view', () => {
    const { fixture, page, api } = setup(); page.select(child); page.requestDelete(); fixture.detectChanges();
    expect(page.deleteTarget?.id).toBe(2);
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.delete']); page.confirmDelete();
    expect(api.remove).not.toHaveBeenCalled(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull(); expect(page.deleteTarget).toBeNull();
    page.requestDelete(); page.confirmDelete(); expect(api.remove).not.toHaveBeenCalled();
  });
  it('clears dirty editor and pending discard navigation when only view is revoked', () => {
    const { fixture, page, api } = setup(); page.select(child); page.edit(); fixture.detectChanges();
    page.editor!.draft.name = 'Unsaved';
    const decision = vi.fn(); (page.canLeaveRecordPage() as Observable<boolean>).subscribe(decision); fixture.detectChanges();
    expect(page.discard.open()).toBe(true);
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.create', 'iam.org_units.update', 'iam.org_units.delete']);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(page.discard.open()).toBe(false); expect(page.editorInitial).toBeNull(); expect(decision).toHaveBeenCalledWith(false);
    page.discard.confirm(); expect(page.canLeaveRecordPage()).toBe(true);
    expect(api.create).not.toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled(); expect(api.remove).not.toHaveBeenCalled();
  });
  it('cancels stale detail completion after view revocation even with update retained', () => {
    const { fixture, page, api } = setup(); const detail = new Subject<OrgUnit>(); api.get.mockReturnValueOnce(detail);
    page.select(child); page.edit(); fixture.detectChanges();
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.update']);
    detail.next({ ...child, name: 'Late private detail' }); fixture.detectChanges();
    expect(detail.observed).toBe(false); expect(page.editorInitial).toBeNull(); expect(page.selected).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Late private detail');
    page.loadDetail(); expect(api.get).toHaveBeenCalledTimes(1);
  });
  it('drops a stale tree response when view is revoked', () => {
    const { fixture, page, api } = setup(); const tree = new Subject<OrgUnit[]>(); api.list.mockReturnValueOnce(tree); page.reload();
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.create']); tree.next([root]); fixture.detectChanges();
    expect(tree.observed).toBe(false); expect(page.units).toEqual([]); expect(page.loaded).toBe(false);
  });
  it.each([
    ['create', 'success'], ['create', 'error'], ['update', 'success'], ['update', 'error'], ['delete', 'success'], ['delete', 'error']
  ] as const)('keeps the issued %s owned through revocation and ignores its late %s after view returns', (action, outcome) => {
    const { fixture, page, api, toast } = setup();
    const created = new Subject<OrgUnit>(); const changed = new Subject<undefined>();
    page.select(child);
    if (action === 'create') {
      api.create.mockReturnValueOnce(created); page.create(); fixture.detectChanges();
      page.editor!.draft.code = 'NEW'; page.editor!.draft.name = 'New'; page.editor!.submit();
    } else if (action === 'update') {
      api.update.mockReturnValueOnce(changed); page.edit(); fixture.detectChanges(); page.editor!.draft.name = 'New'; page.editor!.submit();
    } else {
      api.remove.mockReturnValueOnce(changed); page.requestDelete(); page.confirmDelete();
    }
    expect(page.pending).toBe(true);
    TestBed.inject(PermissionService).setPermissions([`iam.org_units.${action}`]); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(page.pending).toBe(true); expect(action === 'create' ? created.observed : changed.observed).toBe(true);
    expect(page.canLeaveRecordPage()).toBe(false);
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.*']); fixture.detectChanges();
    if (outcome === 'error') (action === 'create' ? created : changed).error({ status: 409, detail: 'Late private failure' });
    else if (action === 'create') created.next({ ...child, id: 3, name: 'Late private created' });
    else changed.next(undefined);
    fixture.detectChanges();
    expect(page.pending).toBe(false); expect(page.selected).toBeNull(); expect(page.units).toEqual([]);
    expect(page.saveError).toBeNull(); expect(page.deleteError).toBeNull(); expect(page.editorOpen).toBe(false);
    expect(toast.success).not.toHaveBeenCalled(); expect(api.list).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).not.toContain('Late private');
  });
  it('preserves dirty and pending edit behavior when a permission update retains view', () => {
    const { fixture, page, api } = setup(); page.select(child); page.edit(); fixture.detectChanges();
    const editor = page.editor!; editor.draft.name = 'Unsaved';
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.view', 'iam.org_units.update']); fixture.detectChanges();
    expect(page.editor).toBe(editor); expect(editor.dirty).toBe(true);
    const write = new Subject<undefined>(); api.update.mockReturnValueOnce(write); editor.submit();
    TestBed.inject(PermissionService).setPermissions(['iam.org_units.view', 'iam.org_units.update', 'iam.org_units.create']); fixture.detectChanges();
    expect(page.pending).toBe(true); expect(page.editorOpen).toBe(true); expect(page.canLeaveRecordPage()).toBe(false);
    write.error({ status: 409, detail: 'Current failure' }); fixture.detectChanges();
    expect(page.pending).toBe(false); expect(page.editor).toBe(editor); expect(editor.draft.name).toBe('Unsaved');
    expect(fixture.nativeElement.textContent).toContain('Current failure');
  });
});
