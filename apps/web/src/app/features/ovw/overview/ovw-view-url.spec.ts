import { describe, expect, it } from 'vitest';
import { OvwColumn } from './ovw-api';
import { OvwView, OvwViewParams, parseOvwView, sanitizeOvwView, serializeOvwView, toOvwGroupsQuery, toOvwRowsQuery } from './ovw-view-url';

const FULL_VIEW: OvwView = {
  src: 12,
  sh: 2,
  filters: [
    { field: 'region', kind: 'c', text: 'TEST' },
    { field: 'amount', kind: 'r', from: '10', to: null },
  ],
  sort: { field: 'doc_date', dir: 'desc' },
  groupBy: 'region',
  group: { value: 'TEST-регион А' },
  page: 3,
};

const COLUMNS: OvwColumn[] = [
  { field: 'region', label: 'Region', type: 'text', summable: false },
  { field: 'amount', label: 'Amount', type: 'number', summable: true },
  { field: 'qty', label: 'Qty', type: 'integer', summable: true },
  { field: 'doc_date', label: 'Date', type: 'date', summable: false },
];

/** Router hands query params back as string | string[]; nulls are simply absent. */
function toParams(serialized: Record<string, string | string[] | null>): OvwViewParams {
  const params: OvwViewParams = {};
  for (const [key, value] of Object.entries(serialized)) {
    if (value !== null) {
      params[key] = value;
    }
  }
  return params;
}

function roundTrip(view: OvwView): OvwView {
  return parseOvwView(toParams(serializeOvwView(view)));
}

describe('parseOvwView / serializeOvwView', () => {
  it('round-trips a view with filters, sort, grouping, open group and page 3', () => {
    const serialized = serializeOvwView(FULL_VIEW);
    expect(serialized).toEqual({
      src: '12',
      sh: '2',
      f: ['region~c~TEST', 'amount~r~10~'],
      s: 'doc_date~desc',
      g: 'region',
      gv: 'TEST-регион А',
      p: '3',
    });
    expect(roundTrip(FULL_VIEW)).toEqual(FULL_VIEW);
  });

  it('writes nothing for an empty view and does not write page 1', () => {
    const empty: OvwView = { src: null, sh: null, filters: [], sort: null, groupBy: null, group: null, page: 1 };
    expect(serializeOvwView(empty)).toEqual({ src: null, sh: null, f: null, s: null, g: null, gv: null, p: null });
    expect(parseOvwView({})).toEqual(empty);
  });

  it('uses ~empty for the "(empty)" group', () => {
    const view: OvwView = { ...FULL_VIEW, group: { value: null } };
    expect(serializeOvwView(view)['gv']).toBe('~empty');
    expect(parseOvwView({ g: 'region', gv: '~empty' }).group).toEqual({ value: null });
    expect(roundTrip(view)).toEqual(view);
  });

  it('keeps a filter text with ~ and Cyrillic intact', () => {
    const view: OvwView = { ...FULL_VIEW, filters: [{ field: 'region', kind: 'c', text: 'TEST~регион~А' }] };
    expect(parseOvwView({ f: 'region~c~TEST~регион~А' }).filters).toEqual(view.filters);
    expect(roundTrip(view)).toEqual(view);
  });

  it('turns garbage into defaults and drops malformed filters and sort', () => {
    const view = parseOvwView({
      src: 'abc',
      sh: '-1',
      p: '0',
      f: ['region', 'region~x~y', 'amount~r~1', 'amount~r~~5'],
      s: 'doc_date~up',
    });
    expect(view.src).toBeNull();
    expect(view.sh).toBeNull();
    expect(view.page).toBe(1);
    expect(view.filters).toEqual([{ field: 'amount', kind: 'r', from: null, to: '5' }]);
    expect(view.sort).toBeNull();
  });
});

describe('sanitizeOvwView', () => {
  it('drops an unknown column, contains on a number and a non-numeric bound, keeps the rest', () => {
    const view: OvwView = {
      ...FULL_VIEW,
      filters: [
        { field: 'region', kind: 'c', text: 'TEST' },
        { field: 'missing', kind: 'c', text: 'TEST' },
        { field: 'qty', kind: 'c', text: '5' },
        { field: 'amount', kind: 'r', from: 'abc', to: null },
        { field: 'doc_date', kind: 'r', from: '2024-01-01', to: '2024-12-31' },
      ],
    };
    const result = sanitizeOvwView(view, COLUMNS);
    expect(result.dropped).toEqual([
      { reason: 'column', field: 'missing' },
      { reason: 'value', field: 'qty' },
      { reason: 'value', field: 'amount' },
    ]);
    expect(result.view).toEqual({
      ...view,
      filters: [
        { field: 'region', kind: 'c', text: 'TEST' },
        { field: 'doc_date', kind: 'r', from: '2024-01-01', to: '2024-12-31' },
      ],
    });
  });

  it('drops a range on text, an empty text, both bounds empty and a malformed date', () => {
    const view: OvwView = {
      ...FULL_VIEW,
      filters: [
        { field: 'region', kind: 'r', from: '1', to: '2' },
        { field: 'region', kind: 'c', text: '  ' },
        { field: 'amount', kind: 'r', from: null, to: null },
        { field: 'doc_date', kind: 'r', from: '31.01.2024', to: null },
      ],
    };
    const result = sanitizeOvwView(view, COLUMNS);
    expect(result.view.filters).toEqual([]);
    expect(result.dropped.map((d) => d.reason)).toEqual(['value', 'value', 'value', 'value']);
  });

  it('drops unknown sort and grouping columns together with the open group', () => {
    const view: OvwView = { ...FULL_VIEW, filters: [], sort: { field: 'gone', dir: 'asc' }, groupBy: 'lost' };
    const result = sanitizeOvwView(view, COLUMNS);
    expect(result.dropped).toEqual([
      { reason: 'column', field: 'gone' },
      { reason: 'column', field: 'lost' },
    ]);
    expect(result.view.sort).toBeNull();
    expect(result.view.groupBy).toBeNull();
    expect(result.view.group).toBeNull();
  });

  it('removes an open group without a grouping column', () => {
    const view: OvwView = { ...FULL_VIEW, groupBy: null, group: { value: 'TEST' } };
    const result = sanitizeOvwView(view, COLUMNS);
    expect(result.view.group).toBeNull();
    expect(result.dropped).toEqual([]);
  });

  it('drops a range with "from" after "to", comparing numbers as numbers and dates as dates', () => {
    const view: OvwView = {
      ...FULL_VIEW,
      filters: [
        { field: 'amount', kind: 'r', from: '9', to: '10' },
        { field: 'amount', kind: 'r', from: '10', to: '9' },
        { field: 'qty', kind: 'r', from: '5', to: '5' },
        { field: 'doc_date', kind: 'r', from: '2024-12-31', to: '2024-01-01' },
        { field: 'doc_date', kind: 'r', from: '2024-01-01', to: '2024-12-31' },
      ],
    };
    const result = sanitizeOvwView(view, COLUMNS);
    expect(result.dropped).toEqual([
      { reason: 'value', field: 'amount' },
      { reason: 'value', field: 'doc_date' },
    ]);
    expect(result.view.filters).toEqual([
      { field: 'amount', kind: 'r', from: '9', to: '10' },
      { field: 'qty', kind: 'r', from: '5', to: '5' },
      { field: 'doc_date', kind: 'r', from: '2024-01-01', to: '2024-12-31' },
    ]);
  });

  it('drops a date that is not in the calendar and keeps 29 February of a leap year', () => {
    const view: OvwView = {
      ...FULL_VIEW,
      filters: [
        { field: 'doc_date', kind: 'r', from: '2024-02-30', to: null },
        { field: 'doc_date', kind: 'r', from: null, to: '2023-02-29' },
        { field: 'doc_date', kind: 'r', from: '2024-13-01', to: null },
        { field: 'doc_date', kind: 'r', from: '2024-02-29', to: null },
      ],
    };
    const result = sanitizeOvwView(view, COLUMNS);
    expect(result.dropped.map((d) => d.reason)).toEqual(['value', 'value', 'value']);
    expect(result.view.filters).toEqual([{ field: 'doc_date', kind: 'r', from: '2024-02-29', to: null }]);
  });

  it('drops a number with an exponent or with more than 30 digits in a part, keeps 30 digits', () => {
    const digits30 = '1'.repeat(30);
    const view: OvwView = {
      ...FULL_VIEW,
      filters: [
        { field: 'amount', kind: 'r', from: '1e5', to: null },
        { field: 'amount', kind: 'r', from: '1'.repeat(31), to: null },
        { field: 'amount', kind: 'r', from: `0.${'1'.repeat(31)}`, to: null },
        { field: 'amount', kind: 'r', from: `-${digits30}.${digits30}`, to: null },
      ],
    };
    const result = sanitizeOvwView(view, COLUMNS);
    expect(result.dropped.map((d) => d.reason)).toEqual(['value', 'value', 'value']);
    expect(result.view.filters).toEqual([{ field: 'amount', kind: 'r', from: `-${digits30}.${digits30}`, to: null }]);
  });

  it('drops a text filter longer than 200 characters and keeps one of exactly 200', () => {
    const view: OvwView = {
      ...FULL_VIEW,
      filters: [
        { field: 'region', kind: 'c', text: 'T'.repeat(201) },
        { field: 'region', kind: 'c', text: '' },
        { field: 'region', kind: 'c', text: 'T'.repeat(200) },
      ],
    };
    const result = sanitizeOvwView(view, COLUMNS);
    expect(result.dropped).toEqual([
      { reason: 'value', field: 'region' },
      { reason: 'value', field: 'region' },
    ]);
    expect(result.view.filters).toEqual([{ field: 'region', kind: 'c', text: 'T'.repeat(200) }]);
  });

  it('keeps the first 20 filters and drops the rest with one line naming the first dropped', () => {
    const filters: OvwView['filters'] = Array.from({ length: 22 }, (_, index) => ({
      field: index < 20 ? 'region' : 'amount',
      kind: 'c' as const,
      text: `TEST-${index}`,
    }));
    filters[20] = { field: 'amount', kind: 'r', from: '1', to: null };
    filters[21] = { field: 'qty', kind: 'r', from: '2', to: null };
    const result = sanitizeOvwView({ ...FULL_VIEW, filters }, COLUMNS);
    expect(result.view.filters).toEqual(filters.slice(0, 20));
    expect(result.dropped).toEqual([{ reason: 'value', field: 'amount' }]);
  });

  it('drops an open group whose value does not fit a number or date grouping column, keeps the grouping', () => {
    const byNumber = sanitizeOvwView({ ...FULL_VIEW, filters: [], groupBy: 'amount', group: { value: 'abc' } }, COLUMNS);
    expect(byNumber.view.groupBy).toBe('amount');
    expect(byNumber.view.group).toBeNull();
    expect(byNumber.dropped).toEqual([{ reason: 'value', field: 'amount' }]);

    const byDate = sanitizeOvwView({ ...FULL_VIEW, filters: [], groupBy: 'doc_date', group: { value: '2024-02-30' } }, COLUMNS);
    expect(byDate.view.groupBy).toBe('doc_date');
    expect(byDate.view.group).toBeNull();
    expect(byDate.dropped).toEqual([{ reason: 'value', field: 'doc_date' }]);
  });

  it('keeps a fitting group value, the "(empty)" group and any text group value', () => {
    const keep = (groupBy: string, value: string | null) =>
      sanitizeOvwView({ ...FULL_VIEW, filters: [], groupBy, group: { value } }, COLUMNS);
    expect(keep('amount', '-1234.5').view.group).toEqual({ value: '-1234.5' });
    expect(keep('doc_date', '2024-02-29').view.group).toEqual({ value: '2024-02-29' });
    expect(keep('qty', null).view.group).toEqual({ value: null });
    expect(keep('region', 'T'.repeat(250)).view.group).toEqual({ value: 'T'.repeat(250) });
    expect(keep('amount', '-1234.5').dropped).toEqual([]);
  });
});

describe('toOvwRowsQuery / toOvwGroupsQuery', () => {
  it('adds the open group as the last eq filter and counts offset 400 for page 3', () => {
    expect(toOvwRowsQuery(FULL_VIEW, 2)).toEqual({
      sheet: 2,
      filters: [
        { field: 'region', op: 'contains', value: 'TEST' },
        { field: 'amount', op: 'between', from: '10', to: null },
        { field: 'region', op: 'eq', value: 'TEST-регион А' },
      ],
      sort: { field: 'doc_date', dir: 'desc' },
      offset: 400,
    });
  });

  it('sends null as the eq value for the "(empty)" group and no eq without an open group', () => {
    expect(toOvwRowsQuery({ ...FULL_VIEW, group: { value: null } }, 1).filters.at(-1)).toEqual({ field: 'region', op: 'eq', value: null });
    const noGroup = toOvwRowsQuery({ ...FULL_VIEW, group: null, page: 1 }, 1);
    expect(noGroup.filters.map((f) => f.op)).toEqual(['contains', 'between']);
    expect(noGroup.offset).toBe(0);
  });

  it('builds the groups query without the eq filter', () => {
    expect(toOvwGroupsQuery(FULL_VIEW, 2)).toEqual({
      sheet: 2,
      filters: [
        { field: 'region', op: 'contains', value: 'TEST' },
        { field: 'amount', op: 'between', from: '10', to: null },
      ],
      groupBy: 'region',
    });
  });

  it('refuses to build a groups query without a grouping column', () => {
    expect(() => toOvwGroupsQuery({ ...FULL_VIEW, groupBy: null }, 2)).toThrow();
  });
});
