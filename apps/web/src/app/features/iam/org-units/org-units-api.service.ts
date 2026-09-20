import { inject, Injectable } from '@angular/core';
import { map, Observable, throwError } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { I18nService } from '../../../core/services/i18n.service';
import { safeNumericRecordId } from '../../../core/services/search-target';
import { OrgUnit, OrgUnitCreate, OrgUnitPatch, UserAssignments, UserScope, RoleRuleSnapshot, ScopeRule } from './org-units.models';
@Injectable({ providedIn: 'root' })
export class OrgUnitsApiService {
  private readonly api = inject(ApiService);
  private readonly i18n = inject(I18nService);
  private readonly base = '/iam/org-units';
  private readonly inline = { notifyError: false };

  list(): Observable<OrgUnit[]> {
    return this.api.get<OrgUnit[]>(this.base, undefined, this.inline).pipe(map(units => units.map(normalizeUnit)));
  }
  get(id: number): Observable<OrgUnit> {
    return safeNumericRecordId(id) ? this.api.get<OrgUnit>(`${this.base}/${id}`, undefined, this.inline).pipe(map(normalizeUnit)) : this.invalidId();
  }
  create(body: OrgUnitCreate): Observable<OrgUnit> {
    return body.parentId === null || safeNumericRecordId(body.parentId)
      ? this.api.post<OrgUnit>(this.base, body, this.inline).pipe(map(normalizeUnit)) : this.invalidId();
  }
  update(id: number, patch: OrgUnitPatch): Observable<void> {
    return safeNumericRecordId(id) && (patch.parentId === undefined || patch.parentId === null || safeNumericRecordId(patch.parentId))
      ? this.api.patch<void>(`${this.base}/${id}`, patch, this.inline) : this.invalidId();
  }
  remove(id: number): Observable<void> {
    return safeNumericRecordId(id) ? this.api.delete<void>(`${this.base}/${id}`, this.inline) : this.invalidId();
  }
  assignments(userId: number): Observable<UserAssignments> {
    return safeNumericRecordId(userId) ? this.api.get<UserAssignments>(`${this.base}/users/${userId}`, undefined, this.inline)
      .pipe(map(value => ({ ...value, legacyOrgUnitId: value.legacyOrgUnitId ?? null }))) : this.invalidId();
  }
  saveAssignments(userId: number, orgUnitIds: number[]): Observable<void> {
    return safeNumericRecordId(userId) && orgUnitIds.every(safeNumericRecordId)
      ? this.api.put<void>(`${this.base}/users/${userId}`, { orgUnitIds }, this.inline) : this.invalidId();
  }
  scope(userId: number): Observable<UserScope> {
    return safeNumericRecordId(userId) ? this.api.get<UserScope>(`${this.base}/users/${userId}/scope`, undefined, this.inline) : this.invalidId();
  }
  roleRule(roleId: number): Observable<RoleRuleSnapshot> {
    return safeNumericRecordId(roleId) ? this.api.get<RoleRuleSnapshot>(`${this.base}/roles/${roleId}/rule`, undefined, this.inline) : this.invalidId();
  }
  saveRoleRule(roleId: number, rule: ScopeRule): Observable<void> {
    return safeNumericRecordId(roleId) ? this.api.put<void>(`${this.base}/roles/${roleId}/rule`, { rule }, this.inline) : this.invalidId();
  }
  private invalidId(): Observable<never> {
    return throwError(() => ({ status: 400, code: 'ORG_UNIT_UNSAFE_ID', title: this.i18n.translate('iam.org_units.unavailable'), detail: this.i18n.translate('iam.org_units.readonly_id') }));
  }
}

function normalizeUnit(unit: OrgUnit): OrgUnit { return { ...unit, parentId: unit.parentId ?? null }; }
