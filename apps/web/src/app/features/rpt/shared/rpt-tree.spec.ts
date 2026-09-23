import { describe, expect, it } from 'vitest';
import { RptLine, RptLine1, RptLine2, RptReportView } from './rpt-api';
import { rptAllGroupIds, rptGroupId, rptVisibleRows } from './rpt-tree';

function cells(value: string | null): (string | null)[] {
  return Array.from({ length: 12 }, () => value);
}

function line(total: string, count: number): RptLine {
  return { cells: cells(total), total, count };
}

function child(key: string | null, name: string | null, total: string): RptLine2 {
  return { ...line(total, 1), key, name };
}

function group(key: string | null, name: string | null, total: string, children: RptLine2[]): RptLine1 {
  return { ...line(total, children.length || 1), key, name, lines: children };
}

function view(lines: RptLine1[]): RptReportView {
  return {
    reportId: 1,
    name: 'TEST',
    year: 2024,
    years: [2024],
    divisor: 1,
    decimals: 0,
    labels: { level1: 'TEST level 1', level2: 'TEST level 2', measure: 'TEST sum' },
    grand: line('100', 10),
    lines,
    undated: null,
    refDuplicateKeys: 0,
  };
}

const twoLevels = view([
  group('north', 'North', '60', [child('a', 'A', '40'), child(null, null, '20')]),
  group('south', 'South', '30', [child('b', 'B', '30')]),
  group(null, null, '10', [child('c', 'C', '10')]),
]);

describe('rptGroupId', () => {
  it('uses the key as the id and a separate id for the group without a name', () => {
    expect(rptGroupId('north')).toBe('north');
    expect(rptGroupId(null)).toBe('\u0000');
    expect(rptGroupId(null)).not.toBe(rptGroupId(''));
  });
});

describe('rptVisibleRows', () => {
  it('puts the grand total first with an empty path', () => {
    const [grand] = rptVisibleRows(twoLevels, new Set());
    expect(grand.kind).toBe('grand');
    expect(grand.path).toEqual([]);
    expect(grand.total).toBe('100');
    expect(grand.count).toBe(10);
  });

  it('lists every level 1 line followed by its level 2 lines in the server order', () => {
    const rows = rptVisibleRows(twoLevels, new Set());
    expect(rows.map((row) => [row.kind, row.name])).toEqual([
      ['grand', null],
      ['l1', 'North'],
      ['l2', 'A'],
      ['l2', null],
      ['l1', 'South'],
      ['l2', 'B'],
      ['l1', null],
      ['l2', 'C'],
    ]);
  });

  it('builds the cell query path of both levels, keeping null keys', () => {
    const rows = rptVisibleRows(twoLevels, new Set());
    expect(rows[1].path).toEqual(['north']);
    expect(rows[2].path).toEqual(['north', 'a']);
    expect(rows[3].path).toEqual(['north', null]);
    expect(rows[6].path).toEqual([null]);
    expect(rows[7].path).toEqual([null, 'c']);
  });

  it('hides the children of a collapsed group and marks it collapsed', () => {
    const rows = rptVisibleRows(twoLevels, new Set(['north']));
    expect(rows.map((row) => row.name)).toEqual([null, 'North', 'South', 'B', null, 'C']);
    expect(rows[1].collapsed).toBe(true);
    expect(rows[1].hasChildren).toBe(true);
    expect(rows[1].total).toBe('60');
    expect(rows[2].collapsed).toBe(false);
  });

  it('collapses the group without a name by its own id', () => {
    const rows = rptVisibleRows(twoLevels, new Set([rptGroupId(null)]));
    expect(rows.map((row) => row.name)).toEqual([null, 'North', 'A', null, 'South', 'B', null]);
    expect(rows[rows.length - 1].collapsed).toBe(true);
  });

  it('gives every row a distinct id', () => {
    const rows = rptVisibleRows(twoLevels, new Set());
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it('shows one level without children and never marks such a line collapsed', () => {
    const oneLevel = view([group('north', 'North', '60', []), group(null, null, '40', [])]);
    const rows = rptVisibleRows(oneLevel, new Set(['north']));
    expect(rows.map((row) => row.kind)).toEqual(['grand', 'l1', 'l1']);
    expect(rows[1].hasChildren).toBe(false);
    expect(rows[1].collapsed).toBe(false);
  });
});

describe('rptAllGroupIds', () => {
  it('returns the ids of every group with children, including the group without a name', () => {
    expect(rptAllGroupIds(twoLevels)).toEqual(['north', 'south', '\u0000']);
  });

  it('collapses everything to level 1 lines when all ids are collapsed', () => {
    const rows = rptVisibleRows(twoLevels, new Set(rptAllGroupIds(twoLevels)));
    expect(rows.map((row) => row.kind)).toEqual(['grand', 'l1', 'l1', 'l1']);
  });

  it('skips groups without children', () => {
    expect(rptAllGroupIds(view([group('north', 'North', '60', [])]))).toEqual([]);
  });
});
