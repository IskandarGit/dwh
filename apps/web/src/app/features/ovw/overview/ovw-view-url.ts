import { OVW_PAGE_SIZE, OvwColumn, OvwColumnKind, OvwFilter, OvwGroupsQuery, OvwRowsQuery, ovwKind } from './ovw-api';
import { OVW_DATE_PATTERN, OVW_NUMBER_PATTERN } from './ovw-format';

export type OvwViewFilter =
  | { field: string; kind: 'c'; text: string }
  | { field: string; kind: 'r'; from: string | null; to: string | null };

export interface OvwView {
  src: number | null;
  sh: number | null;
  filters: OvwViewFilter[];
  sort: { field: string; dir: 'asc' | 'desc' } | null;
  groupBy: string | null;
  /** null: no group is open; value null: the "(empty)" group. */
  group: { value: string | null } | null;
  /** 1-based. */
  page: number;
}

export type OvwDropReason = 'column' | 'value' | 'page' | 'source';

export interface OvwDropped {
  reason: OvwDropReason;
  field: string | null;
}

export type OvwViewParams = Record<string, string | string[] | undefined>;

const SEP = '~';
const EMPTY_GROUP = '~empty';
const POSITIVE_INT = /^\d+$/;
const SORT_PATTERN = /^(.+)~(asc|desc)$/;

export function parseOvwView(params: OvwViewParams): OvwView {
  const gv = first(params['gv']);
  return {
    src: parseId(first(params['src'])),
    sh: parseId(first(params['sh'])),
    filters: all(params['f'])
      .map(parseFilter)
      .filter((filter): filter is OvwViewFilter => filter !== null),
    sort: parseSort(first(params['s'])),
    groupBy: nonEmpty(first(params['g'])),
    group: gv === undefined ? null : { value: gv === EMPTY_GROUP ? null : gv },
    page: parsePage(first(params['p'])),
  };
}

export function serializeOvwView(view: OvwView): Record<string, string | string[] | null> {
  return {
    src: view.src === null ? null : String(view.src),
    sh: view.sh === null ? null : String(view.sh),
    f: view.filters.length === 0 ? null : view.filters.map(serializeFilter),
    s: view.sort === null ? null : `${view.sort.field}${SEP}${view.sort.dir}`,
    g: view.groupBy,
    gv: view.group === null ? null : (view.group.value ?? EMPTY_GROUP),
    p: view.page > 1 ? String(view.page) : null,
  };
}

export function sanitizeOvwView(view: OvwView, columns: OvwColumn[]): { view: OvwView; dropped: OvwDropped[] } {
  const kinds = new Map<string, OvwColumnKind>(columns.map((column) => [column.field, ovwKind(column.type)]));
  const dropped: OvwDropped[] = [];

  const filters = view.filters.filter((filter) => {
    const kind = kinds.get(filter.field);
    if (kind === undefined) {
      dropped.push({ reason: 'column', field: filter.field });
      return false;
    }
    if (!isFilterValid(filter, kind)) {
      dropped.push({ reason: 'value', field: filter.field });
      return false;
    }
    return true;
  });

  let sort = view.sort;
  if (sort !== null && !kinds.has(sort.field)) {
    dropped.push({ reason: 'column', field: sort.field });
    sort = null;
  }

  let groupBy = view.groupBy;
  if (groupBy !== null && !kinds.has(groupBy)) {
    dropped.push({ reason: 'column', field: groupBy });
    groupBy = null;
  }
  const group = groupBy === null ? null : view.group;

  return { view: { ...view, filters, sort, groupBy, group }, dropped };
}

export function toOvwRowsQuery(view: OvwView, sheet: number): OvwRowsQuery {
  const filters = view.filters.map(toFilter);
  if (view.groupBy !== null && view.group !== null) {
    filters.push({ field: view.groupBy, op: 'eq', value: view.group.value });
  }
  return {
    sheet,
    filters,
    sort: view.sort === null ? null : { ...view.sort },
    offset: (view.page - 1) * OVW_PAGE_SIZE,
  };
}

export function toOvwGroupsQuery(view: OvwView, sheet: number): OvwGroupsQuery {
  if (view.groupBy === null) {
    throw new Error('toOvwGroupsQuery: view has no groupBy column');
  }
  return { sheet, filters: view.filters.map(toFilter), groupBy: view.groupBy };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function all(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

function parseId(value: string | undefined): number | null {
  return value !== undefined && POSITIVE_INT.test(value) ? Number(value) : null;
}

function parsePage(value: string | undefined): number {
  const page = value !== undefined && POSITIVE_INT.test(value) ? Number(value) : 0;
  return page >= 1 ? page : 1;
}

function parseSort(value: string | undefined): OvwView['sort'] {
  const match = value === undefined ? null : SORT_PATTERN.exec(value);
  return match ? { field: match[1], dir: match[2] as 'asc' | 'desc' } : null;
}

function parseFilter(value: string): OvwViewFilter | null {
  const fieldEnd = value.indexOf(SEP);
  if (fieldEnd <= 0) {
    return null;
  }
  const field = value.slice(0, fieldEnd);
  const kindEnd = value.indexOf(SEP, fieldEnd + 1);
  if (kindEnd < 0) {
    return null;
  }
  const kind = value.slice(fieldEnd + 1, kindEnd);
  const rest = value.slice(kindEnd + 1);
  if (kind === 'c') {
    return { field, kind: 'c', text: rest };
  }
  if (kind === 'r') {
    const bounds = rest.split(SEP);
    if (bounds.length !== 2) {
      return null;
    }
    return { field, kind: 'r', from: nonEmpty(bounds[0]), to: nonEmpty(bounds[1]) };
  }
  return null;
}

function serializeFilter(filter: OvwViewFilter): string {
  return filter.kind === 'c'
    ? `${filter.field}${SEP}c${SEP}${filter.text}`
    : `${filter.field}${SEP}r${SEP}${filter.from ?? ''}${SEP}${filter.to ?? ''}`;
}

function isFilterValid(filter: OvwViewFilter, kind: OvwColumnKind): boolean {
  if (filter.kind === 'c') {
    return kind === 'text' && filter.text.trim() !== '';
  }
  if (kind === 'text' || (filter.from === null && filter.to === null)) {
    return false;
  }
  const pattern = kind === 'number' ? OVW_NUMBER_PATTERN : OVW_DATE_PATTERN;
  return [filter.from, filter.to].every((bound) => bound === null || pattern.test(bound));
}

function toFilter(filter: OvwViewFilter): OvwFilter {
  return filter.kind === 'c'
    ? { field: filter.field, op: 'contains', value: filter.text }
    : { field: filter.field, op: 'between', from: filter.from, to: filter.to };
}
