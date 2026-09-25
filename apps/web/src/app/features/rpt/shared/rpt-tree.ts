import { RptLine, RptLine1, RptMeasureValues, RptRatio, RptReportView } from './rpt-api';

export type RptRowKind = 'grand' | 'l1' | 'l2';

/** One visible line of the report table, in the order the server sent it. */
export interface RptRow {
  kind: RptRowKind;
  id: string;
  key: string | null;
  name: string | null;
  /** Path for the cell query: [] — grand total, [k1] — level 1, [k1, k2] — level 2. */
  path: (string | null)[];
  cells: (string | null)[];
  total: string | null;
  count: number;
  /** Second measure of the line; null — a report with one measure. */
  m2: RptMeasureValues | null;
  /** Second measure to first measure as the server sent it; null — a report with one measure. */
  ratio: RptRatio | null;
  hasChildren: boolean;
  collapsed: boolean;
}

const NULL_GROUP_ID = '\u0000';
/** Control characters never occur in a normalized group key, so row ids of different kinds cannot collide. */
const GRAND_ID = '\u0001';
const CHILD_SEPARATOR = '\u0001';

/** Id of a level 1 group in the set of collapsed groups; the "no name" group (key null) gets its own id. */
export function rptGroupId(key: string | null): string {
  return key ?? NULL_GROUP_ID;
}

/** Rows to draw: grand total first, then every level 1 line followed by its level 2 lines unless it is collapsed. */
export function rptVisibleRows(view: RptReportView, collapsed: ReadonlySet<string>): RptRow[] {
  const rows: RptRow[] = [grandRow(view.grand)];
  for (const line of view.lines) {
    const groupId = rptGroupId(line.key);
    const isCollapsed = line.lines.length > 0 && collapsed.has(groupId);
    rows.push(levelOneRow(line, groupId, isCollapsed));
    if (!isCollapsed) {
      for (const child of line.lines) {
        const childId = `${groupId}${CHILD_SEPARATOR}${rptGroupId(child.key)}`;
        rows.push(lineRow('l2', childId, child.key, child.name, [line.key, child.key], child));
      }
    }
  }
  return rows;
}

/** Ids of all level 1 groups that have children — for "collapse all". */
export function rptAllGroupIds(view: RptReportView): string[] {
  return view.lines.filter((line) => line.lines.length > 0).map((line) => rptGroupId(line.key));
}

function grandRow(grand: RptLine): RptRow {
  return lineRow('grand', GRAND_ID, null, null, [], grand);
}

function levelOneRow(line: RptLine1, groupId: string, isCollapsed: boolean): RptRow {
  return {
    ...lineRow('l1', groupId, line.key, line.name, [line.key], line),
    hasChildren: line.lines.length > 0,
    collapsed: isCollapsed,
  };
}

function lineRow(
  kind: RptRowKind,
  id: string,
  key: string | null,
  name: string | null,
  path: (string | null)[],
  line: RptLine,
): RptRow {
  return {
    kind,
    id,
    key,
    name,
    path,
    cells: line.cells,
    total: line.total,
    count: line.count,
    m2: line.m2,
    ratio: line.ratio,
    hasChildren: false,
    collapsed: false,
  };
}
