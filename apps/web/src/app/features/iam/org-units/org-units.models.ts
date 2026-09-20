export type ScopeRule = 'ALL' | 'SUBTREE' | 'UNITS' | 'SELF';
export interface OrgUnit {
  id: number; parentId: number | null; code: string; name: string;
  kind: string; state: 'A' | 'P'; orderNo: number;
  createdAt: string; modifiedAt: string;
}
export interface UserAssignments { userId: number; orgUnitIds: number[]; legacyOrgUnitId: number | null; }
export interface RoleRuleSnapshot { roleId: number; rule: ScopeRule; }
export interface UserScope { rule: ScopeRule; visibleOrgUnitIds: number[]; }
export interface OrgUnitCreate { parentId: number | null; code: string; name: string; kind: string; orderNo: number; }
export type OrgUnitPatch = Partial<Pick<OrgUnit, 'parentId' | 'name' | 'kind' | 'state' | 'orderNo'>>;
