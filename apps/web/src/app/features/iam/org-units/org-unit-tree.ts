import { OrgUnit } from './org-units.models';
import { safeNumericRecordId } from '../../../core/services/search-target';
export interface OrgUnitNode { unit: OrgUnit; children: OrgUnitNode[]; }
export const orgUnitKindKeys: Readonly<Record<string, string>> = Object.assign(Object.create(null), {
  company: 'iam.org_units.kind_company', region: 'iam.org_units.kind_region',
  branch: 'iam.org_units.kind_branch', department: 'iam.org_units.kind_department'
});
const order = (a: OrgUnit, b: OrgUnit) => a.orderNo - b.orderNo || a.id - b.id;

/** Orphans and malformed cycles stay readable; a visited set cuts cycles. */
export function orderedTree(units: readonly OrgUnit[]): OrgUnitNode[] {
  const sorted = [...units].sort(order);
  const ids = new Set(units.map(unit => unit.id));
  const visited = new Set<OrgUnit>();
  const children = new Map<number, OrgUnit[]>();
  for (const unit of sorted) {
    if (unit.parentId !== null) children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit]);
  }
  const visit = (unit: OrgUnit): OrgUnitNode[] => {
    if (visited.has(unit)) return [];
    visited.add(unit);
    return [{ unit, children: (children.get(unit.id) ?? []).flatMap(visit) }];
  };
  const roots = sorted.filter(unit => unit.parentId === null || !ids.has(unit.parentId)).flatMap(visit);
  return [...roots, ...sorted.flatMap(visit)];
}
export function descendants(units: readonly OrgUnit[], id: number): Set<number> {
  const result = new Set<number>();
  const queue = [id];
  for (let index = 0; index < queue.length; index++) {
    for (const unit of units) {
      if (unit.parentId === queue[index] && unit.id !== id && !result.has(unit.id)) {
        result.add(unit.id); queue.push(unit.id);
      }
    }
  }
  return result;
}
export function parentCandidates(units: readonly OrgUnit[], original: OrgUnit): OrgUnit[] {
  if (original.parentId === null) return [];
  const excluded = descendants(units, original.id);
  excluded.add(original.id);
  const byId = new Map(units.map(unit => [unit.id, unit]));
  const validAncestry = (unit: OrgUnit): boolean => {
    const visited = new Set<number>();
    let current: OrgUnit | undefined = unit;
    while (current) {
      if (!safeNumericRecordId(current.id) || visited.has(current.id)) return false;
      visited.add(current.id);
      if (current.parentId === null) return true;
      current = byId.get(current.parentId);
    }
    return false;
  };
  return units.filter(unit => !excluded.has(unit.id) && validAncestry(unit)).sort(order);
}
