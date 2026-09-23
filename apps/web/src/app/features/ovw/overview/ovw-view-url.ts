import { OVW_PAGE_SIZE, OvwColumn, OvwColumnKind, OvwFilter, OvwGroupsQuery, OvwRowsQuery, ovwKind } from './ovw-api';
import { OVW_DATE_PATTERN, OVW_EQ_NUMBER_PATTERN, OVW_FILTER_NUMBER_PATTERN } from './ovw-format';

/** Limits of the server (contract, section 6): a link beyond them is cut on the screen, not sent. */
const MAX_URL_FILTERS = 20;
const MAX_CONTAINS_LENGTH = 200;

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

export type OvwDropReason = 'column' | 'value' | 'page' | 'source' | 'sheet';

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

  const valid = view.filters.filter((filter) => {
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
  const filters = valid.slice(0, MAX_URL_FILTERS);
  if (valid.length > MAX_URL_FILTERS) {
    dropped.push({ reason: 'value', field: valid[MAX_URL_FILTERS].field });
  }

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
  let group = groupBy === null ? null : view.group;
  if (groupBy !== null && group !== null && !isGroupValueValid(group.value, kinds.get(groupBy) ?? 'text')) {
    dropped.push({ reason: 'value', field: groupBy });
    group = null;
  }

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
    return kind === 'text' && filter.text.trim() !== '' && filter.text.length <= MAX_CONTAINS_LENGTH;
  }
  if (kind === 'text' || (filter.from === null && filter.to === null)) {
    return false;
  }
  const isBoundValid = (bound: string | null) => bound === null || isValueOfKind(bound, kind, OVW_FILTER_NUMBER_PATTERN);
  if (![filter.from, filter.to].every(isBoundValid)) {
    return false;
  }
  return filter.from === null || filter.to === null || !isAfter(filter.from, filter.to, kind);
}

/** The "(empty)" group (null) fits any column; a text column takes any value; a number may be as long as `eq` takes. */
function isGroupValueValid(value: string | null, kind: OvwColumnKind): boolean {
  return value === null || isValueOfKind(value, kind, OVW_EQ_NUMBER_PATTERN);
}

function isValueOfKind(value: string, kind: OvwColumnKind, numberPattern: RegExp): boolean {
  if (kind === 'number') {
    return numberPattern.test(value);
  }
  if (kind === 'date') {
    return isCalendarDate(value);
  }
  return true;
}

/** 2024-02-30 has the right shape but no such day in the calendar. */
function isCalendarDate(value: string): boolean {
  if (!OVW_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Both bounds are already valid for the kind; ISO dates of one length compare as text. */
function isAfter(from: string, to: string, kind: OvwColumnKind): boolean {
  return kind === 'number' ? Number(from) > Number(to) : from > to;
}

function toFilter(filter: OvwViewFilter): OvwFilter {
  return filter.kind === 'c'
    ? { field: filter.field, op: 'contains', value: filter.text }
    : { field: filter.field, op: 'between', from: filter.from, to: filter.to };
}
