import { describe, expect, it } from 'vitest';
import { descendants, orderedTree, parentCandidates } from './org-unit-tree';
import { OrgUnit } from './org-units.models';

function unit(id: number, parentId: number | null, orderNo = 0): OrgUnit {
  return { id, parentId, orderNo, code: `U${id}`, name: `Unit ${id}`, kind: 'company', state: 'A', createdAt: '', modifiedAt: '' };
}
describe('organization tree', () => {
  it('orders siblings by orderNo then id without mutating the response', () => {
    const data = [unit(4, 1, 2), unit(1, null), unit(3, 1), unit(2, 1)];
    expect(orderedTree(data).map(n => [n.unit.id, n.children.map(c => c.unit.id)])).toEqual([[1, [2, 3, 4]]]);
    expect(data.map(n => n.id)).toEqual([4, 1, 3, 2]);
  });
  it('keeps orphans and cycles readable exactly once without infinite recursion', () => {
    const flatten = (nodes: ReturnType<typeof orderedTree>): number[] => nodes.flatMap(n => [n.unit.id, ...flatten(n.children)]);
    expect(flatten(orderedTree([unit(1, 9), unit(2, 3), unit(3, 2)]))).toEqual([1, 2, 3]);
  });
  it('excludes self, descendants, invalid IDs and malformed ancestry from parents', () => {
    const data = [unit(1, null), unit(2, 1), unit(3, 2), unit(4, 1), unit(-2, 1), unit(5, 99), unit(6, 5)];
    expect([...descendants(data, 2)]).toEqual([3]);
    expect(parentCandidates(data, data[1]).map(n => n.id)).toEqual([1, 4]);
    expect(parentCandidates(data, data[0])).toEqual([]);
  });
});
