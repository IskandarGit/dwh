import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { OrgUnitsApiService } from './org-units-api.service';

describe('OrgUnitsApiService contracts', () => {
  function setup() {
    const api = { get: vi.fn(() => of({})), post: vi.fn(() => of({})), patch: vi.fn(() => of(undefined)), put: vi.fn(() => of(undefined)), delete: vi.fn(() => of(undefined)) };
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    return { api, service: TestBed.inject(OrgUnitsApiService) };
  }
  it('reads exact resources and never writes on construction or reads', () => {
    const { api, service } = setup();
    api.get.mockReturnValue(of([]));
    service.list().subscribe(); service.get(7).subscribe(); service.assignments(42).subscribe(); service.scope(42).subscribe(); service.roleRule(8).subscribe();
    expect(api.get.mock.calls).toEqual([
      ['/iam/org-units', undefined, { notifyError: false }], ['/iam/org-units/7', undefined, { notifyError: false }],
      ['/iam/org-units/users/42', undefined, { notifyError: false }], ['/iam/org-units/users/42/scope', undefined, { notifyError: false }],
      ['/iam/org-units/roles/8/rule', undefined, { notifyError: false }]
    ]);
    for (const write of [api.post, api.patch, api.put, api.delete]) expect(write).not.toHaveBeenCalled();
  });
  it('sends exact mutation payloads including explicit empty assignments and sparse patch', () => {
    const { api, service } = setup();
    const body = { parentId: null, code: 'ROOT', name: 'Root', kind: 'company', orderNo: 0 };
    service.create(body).subscribe(); service.update(7, { name: 'New' }).subscribe(); service.remove(7).subscribe();
    service.saveAssignments(42, []).subscribe(); service.saveRoleRule(8, 'UNITS').subscribe();
    expect(api.post).toHaveBeenCalledWith('/iam/org-units', body, { notifyError: false });
    expect(api.patch).toHaveBeenCalledWith('/iam/org-units/7', { name: 'New' }, { notifyError: false });
    expect(api.delete).toHaveBeenCalledWith('/iam/org-units/7', { notifyError: false });
    expect(api.put.mock.calls).toEqual([['/iam/org-units/users/42', { orgUnitIds: [] }, { notifyError: false }], ['/iam/org-units/roles/8/rule', { rule: 'UNITS' }, { notifyError: false }]]);
  });
  it.each([undefined, null])('normalizes root parent %s for list, detail and create', parentId => {
    const { api, service } = setup();
    const wire = { id: 1, ...(parentId === null ? { parentId } : {}) };
    api.get.mockReturnValueOnce(of([wire])).mockReturnValueOnce(of(wire)); api.post.mockReturnValue(of(wire));
    let list: any; let detail: any; let created: any;
    service.list().subscribe(v => list = v); service.get(1).subscribe(v => detail = v);
    service.create({ parentId: null, code: 'R', name: 'Root', kind: 'company', orderNo: 0 }).subscribe(v => created = v);
    expect(list?.[0]?.parentId).toBeNull(); expect(detail?.parentId).toBeNull(); expect(created?.parentId).toBeNull();
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe editable identifier %s before HTTP', id => {
    const { api, service } = setup();
    const failures: unknown[] = [];
    for (const request of [service.update(id, { name: 'X' }), service.remove(id), service.saveAssignments(42, [id]), service.saveRoleRule(id, 'SELF'), service.create({ parentId: id, code: 'X', name: 'X', kind: 'company', orderNo: 0 }), service.update(1, { parentId: id })]) {
      (request as Observable<unknown>).subscribe({ error: e => failures.push(e) });
    }
    expect(failures).toHaveLength(6);
    for (const write of [api.post, api.patch, api.put, api.delete]) expect(write).not.toHaveBeenCalled();
  });
});
