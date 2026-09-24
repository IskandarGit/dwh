import { describe, expect, it } from 'vitest';
import { RptColumn, RptDefinition, RptMeasureInput, RptSourceLayout } from './rpt-api';
import {
  RptFormState,
  rptDateColumns,
  rptEmptyForm,
  rptEmptyMeasure,
  rptFillMonthsInOrder,
  rptFormFromDefinition,
  rptFormToInput,
  rptKeyColumns,
  rptLevelOptions,
  rptMeasureColumns,
  rptMonthColumns,
  rptOnRefChanged,
  rptOnSourceChanged,
  rptSyncSecondLevels,
} from './rpt-definition-form';

function layout(sourceId: number, columns: RptColumn[]): RptSourceLayout {
  return { sourceId, sheets: [{ ordinal: 1, name: 'TEST sheet' }], sheet: 1, columns };
}

const source = layout(1, [
  { field: 'issued', label: 'TEST issued', type: 'date' },
  { field: 'amount', label: 'TEST amount', type: 'number' },
  { field: 'pieces', label: 'TEST pieces', type: 'integer' },
  { field: 'branch', label: 'TEST branch', type: 'ref_code' },
  { field: 'client', label: 'TEST client', type: 'object_key' },
  { field: 'region', label: 'TEST region', type: 'text' },
]);

const reference = layout(2, [
  { field: 'code', label: 'TEST code', type: 'ref_code' },
  { field: 'opened', label: 'TEST opened', type: 'date' },
  { field: 'group', label: 'TEST group', type: 'text' },
]);

function definition(overrides: Partial<RptDefinition> = {}): RptDefinition {
  return {
    id: 7,
    lockVersion: 3,
    modifiedAt: '2026-09-23T10:00:00Z',
    modifiedBy: 'TEST',
    name: 'TEST report',
    measureName: null,
    sourceId: 1,
    sourceSheet: 1,
    dateField: 'issued',
    monthFields: null,
    measure: { kind: 'total', field: 'amount' },
    divisor: 1000,
    decimals: 2,
    ref: { sourceId: 2, sheet: 1, keys: [{ field: 'branch', refField: 'code' }] },
    level1: { origin: 'ref', field: 'group' },
    level2: { origin: 'source', field: 'region' },
    second: null,
    labels: {
      'source:issued': 'TEST issued',
      'source:amount': 'TEST amount',
      'source:branch': 'TEST branch',
      'source:region': 'TEST region',
      'ref:code': 'TEST code',
      'ref:group': 'TEST group',
    },
    ...overrides,
  };
}

function filledForm(): RptFormState {
  return rptFormFromDefinition(definition()).state;
}

function months(...fields: (string | null)[]): (string | null)[] {
  return Array.from({ length: 12 }, (_, index) => fields[index] ?? null);
}

const monthSource = layout(3, [
  { field: 'branch', label: 'TEST branch', type: 'ref_code' },
  { field: 'm01', label: 'TEST m01', type: 'number' },
  { field: 'note', label: 'TEST note', type: 'text' },
  { field: 'm02', label: 'TEST m02', type: 'integer' },
  { field: 'm03', label: 'TEST m03', type: 'number' },
  { field: 'paid', label: 'TEST paid', type: 'date' },
  { field: 'm04', label: 'TEST m04', type: 'number' },
]);

/** Second measure by month columns, with its own reference and two levels. */
function secondMeasure(overrides: Partial<RptMeasureInput> = {}): RptMeasureInput {
  return {
    name: 'TEST plan',
    sourceId: 3,
    sourceSheet: 1,
    dateField: null,
    monthFields: months('m01', 'm02'),
    measure: null,
    divisor: 1,
    decimals: 0,
    ref: { sourceId: 2, sheet: 1, keys: [{ field: 'branch', refField: 'code' }] },
    level1: { origin: 'ref', field: 'group' },
    level2: { origin: 'source', field: 'branch' },
    ...overrides,
  };
}

const secondLabels = {
  'second.source:m01': 'TEST m01',
  'second.source:m02': 'TEST m02',
  'second.source:branch': 'TEST branch',
  'second.ref:code': 'TEST code',
  'second.ref:group': 'TEST group',
};

function twoMeasureDefinition(): RptDefinition {
  return definition({ measureName: 'TEST fact', second: secondMeasure(), labels: { ...definition().labels, ...secondLabels } });
}

function twoMeasureForm(): RptFormState {
  return rptFormFromDefinition(twoMeasureDefinition()).state;
}

describe('rptEmptyForm', () => {
  it('starts with a sum in units, no reference and one empty key pair', () => {
    const form = rptEmptyForm();
    expect(form.name).toBe('');
    expect(form.sourceId).toBeNull();
    expect(form.measureKind).toBe('total');
    expect(form.divisor).toBe(1);
    expect(form.useRef).toBe(false);
    expect(form.keys).toEqual([{ field: null, refField: null }]);
    expect(form.level1).toBeNull();
    expect(form.level2).toBeNull();
  });
});

describe('rptFormFromDefinition', () => {
  it('reads every field of a current description without stale fields', () => {
    const { state, staleFields } = rptFormFromDefinition(definition());
    expect(staleFields).toEqual([]);
    expect(state).toEqual({
      name: 'TEST report',
      measureName: '',
      sourceId: 1,
      sourceSheet: 1,
      periodKind: 'date',
      dateField: 'issued',
      monthFields: months(),
      measureKind: 'total',
      measureField: 'amount',
      divisor: 1000,
      decimals: 2,
      useRef: true,
      refSourceId: 2,
      refSheet: 1,
      keys: [{ field: 'branch', refField: 'code' }],
      level1: { origin: 'ref', field: 'group' },
      level2: { origin: 'source', field: 'region' },
      useSecond: false,
      second: rptEmptyMeasure(),
    });
  });

  it('empties the fields whose column is gone from the current form and lists them', () => {
    const labels = { 'source:amount': 'TEST amount', 'source:branch': 'TEST branch', 'ref:code': 'TEST code' };
    const { state, staleFields } = rptFormFromDefinition(definition({ labels }));
    expect(state.dateField).toBeNull();
    expect(state.measureField).toBe('amount');
    expect(state.level1).toBeNull();
    expect(state.level2).toBeNull();
    expect(staleFields).toEqual(['dateField', 'level1.field', 'level2.field']);
  });

  it('checks a key pair on both sides: source column by source label, reference column by reference label', () => {
    const labels = { 'source:issued': 'x', 'source:amount': 'x', 'ref:branch': 'x', 'source:code': 'x', 'ref:group': 'x', 'source:region': 'x' };
    const { state, staleFields } = rptFormFromDefinition(definition({ labels }));
    expect(state.keys).toEqual([{ field: null, refField: null }]);
    expect(staleFields).toEqual(['ref.keys[0].field', 'ref.keys[0].refField']);
  });

  it('reads a count without a reference and without a second level', () => {
    const { state, staleFields } = rptFormFromDefinition(
      definition({ measure: { kind: 'count', field: null }, ref: null, level1: { origin: 'source', field: 'region' }, level2: null }),
    );
    expect(staleFields).toEqual([]);
    expect(state.measureKind).toBe('count');
    expect(state.measureField).toBeNull();
    expect(state.useRef).toBe(false);
    expect(state.keys).toEqual([{ field: null, refField: null }]);
    expect(state.level2).toBeNull();
  });
});

describe('rptFormToInput', () => {
  it('builds the request body and adds the lock version for an update', () => {
    const input = rptFormToInput(filledForm(), 3);
    expect(input).toEqual({
      name: 'TEST report',
      measureName: null,
      sourceId: 1,
      sourceSheet: 1,
      dateField: 'issued',
      monthFields: null,
      measure: { kind: 'total', field: 'amount' },
      divisor: 1000,
      decimals: 2,
      ref: { sourceId: 2, sheet: 1, keys: [{ field: 'branch', refField: 'code' }] },
      level1: { origin: 'ref', field: 'group' },
      level2: { origin: 'source', field: 'region' },
      second: null,
      lockVersion: 3,
    });
  });

  it('sends no lock version for a new report', () => {
    expect('lockVersion' in rptFormToInput(filledForm())).toBe(false);
  });

  it('sends no reference when the reference is switched off', () => {
    expect(rptFormToInput({ ...filledForm(), useRef: false }).ref).toBeNull();
  });

  it('sends no measure column for a count', () => {
    expect(rptFormToInput({ ...filledForm(), measureKind: 'count' }).measure).toEqual({ kind: 'count', field: null });
  });
});

describe('column lists', () => {
  it('offers only dates for months', () => {
    expect(rptDateColumns(source).map((column) => column.field)).toEqual(['issued']);
  });

  it('offers only numbers and integers for the sum', () => {
    expect(rptMeasureColumns(source).map((column) => column.field)).toEqual(['amount', 'pieces']);
  });

  it('offers every column but dates for a key pair', () => {
    expect(rptKeyColumns(source).map((column) => column.field)).toEqual(['amount', 'pieces', 'branch', 'client', 'region']);
  });
});

describe('rptLevelOptions', () => {
  it('offers source columns without dates and without the measure column', () => {
    expect(rptLevelOptions(source, null, 'amount')).toEqual([
      { origin: 'source', field: 'pieces', label: 'TEST pieces' },
      { origin: 'source', field: 'branch', label: 'TEST branch' },
      { origin: 'source', field: 'client', label: 'TEST client' },
      { origin: 'source', field: 'region', label: 'TEST region' },
    ]);
  });

  it('keeps every number column when the measure is a count', () => {
    expect(rptLevelOptions(source, null, null).map((option) => option.field)).toEqual(['amount', 'pieces', 'branch', 'client', 'region']);
  });

  it('adds reference columns without dates after the source columns', () => {
    const options = rptLevelOptions(source, reference, 'amount');
    expect(options.slice(-2)).toEqual([
      { origin: 'ref', field: 'code', label: 'TEST code' },
      { origin: 'ref', field: 'group', label: 'TEST group' },
    ]);
    expect(options).toHaveLength(6);
  });
});

describe('rptOnSourceChanged', () => {
  it('clears the source sheet, date, measure, source keys and source levels and names them', () => {
    const { state, cleared } = rptOnSourceChanged(filledForm());
    expect(state.sourceSheet).toBeNull();
    expect(state.dateField).toBeNull();
    expect(state.measureField).toBeNull();
    expect(state.keys).toEqual([{ field: null, refField: 'code' }]);
    expect(state.level1).toEqual({ origin: 'ref', field: 'group' });
    expect(state.level2).toBeNull();
    expect(cleared).toEqual(['sourceSheet', 'dateField', 'measure.field', 'ref.keys[0].field', 'level2.field']);
  });

  it('keeps the name, the reference and the display settings', () => {
    const { state } = rptOnSourceChanged(filledForm());
    expect(state.name).toBe('TEST report');
    expect(state.refSourceId).toBe(2);
    expect(state.refSheet).toBe(1);
    expect(state.divisor).toBe(1000);
    expect(state.decimals).toBe(2);
  });

  it('names nothing when there was nothing to clear', () => {
    expect(rptOnSourceChanged(rptEmptyForm()).cleared).toEqual([]);
  });
});

describe('rptOnRefChanged', () => {
  it('clears the reference sheet, reference keys and reference levels and names them', () => {
    const { state, cleared } = rptOnRefChanged(filledForm());
    expect(state.refSheet).toBeNull();
    expect(state.keys).toEqual([{ field: 'branch', refField: null }]);
    expect(state.level1).toBeNull();
    expect(state.level2).toEqual({ origin: 'source', field: 'region' });
    expect(state.dateField).toBe('issued');
    expect(cleared).toEqual(['ref.sheet', 'ref.keys[0].refField', 'level1.field']);
  });
});

describe('rptEmptyForm with two measures', () => {
  it('starts by date with 12 empty month columns, no measure name and no second measure', () => {
    const form = rptEmptyForm();
    expect(form.measureName).toBe('');
    expect(form.periodKind).toBe('date');
    expect(form.monthFields).toEqual(months());
    expect(form.useSecond).toBe(false);
    expect(form.second).toEqual(rptEmptyMeasure());
    expect(form.second.name).toBe('');
    expect(form.second.periodKind).toBe('date');
    expect(form.second.monthFields).toEqual(months());
  });
});

describe('rptFormFromDefinition with two measures', () => {
  it('reads an old description with all new fields empty as before: by date, no name, no second measure', () => {
    const { state, staleFields } = rptFormFromDefinition(definition());
    expect(staleFields).toEqual([]);
    expect(state.measureName).toBe('');
    expect(state.periodKind).toBe('date');
    expect(state.monthFields).toEqual(months());
    expect(state.useSecond).toBe(false);
    expect(state.second).toEqual(rptEmptyMeasure());
  });

  it('reads a description that has no new fields at all as an old one', () => {
    const old: Partial<RptDefinition> = definition();
    delete old.measureName;
    delete old.monthFields;
    delete old.second;
    const { state, staleFields } = rptFormFromDefinition(old as RptDefinition);
    expect(staleFields).toEqual([]);
    expect(state).toEqual(filledForm());
  });

  it('reads the first measure by month columns: no date, no measure column', () => {
    const labels = { ...definition().labels, 'source:pieces': 'TEST pieces' };
    const { state, staleFields } = rptFormFromDefinition(
      definition({ dateField: null, monthFields: months('amount', 'pieces'), measure: null, labels }),
    );
    expect(staleFields).toEqual([]);
    expect(state.periodKind).toBe('months');
    expect(state.dateField).toBeNull();
    expect(state.monthFields).toEqual(months('amount', 'pieces'));
    expect(state.measureKind).toBe('total');
    expect(state.measureField).toBeNull();
  });

  it('reads the measure name and the second measure with its own reference and levels', () => {
    const { state, staleFields } = rptFormFromDefinition(twoMeasureDefinition());
    expect(staleFields).toEqual([]);
    expect(state.measureName).toBe('TEST fact');
    expect(state.useSecond).toBe(true);
    expect(state.second).toEqual({
      name: 'TEST plan',
      sourceId: 3,
      sourceSheet: 1,
      periodKind: 'months',
      dateField: null,
      monthFields: months('m01', 'm02'),
      measureKind: 'total',
      measureField: null,
      divisor: 1,
      decimals: 0,
      useRef: true,
      refSourceId: 2,
      refSheet: 1,
      keys: [{ field: 'branch', refField: 'code' }],
      level1: { origin: 'ref', field: 'group' },
      level2: { origin: 'source', field: 'branch' },
    });
  });

  it('checks the second measure by its own labels and names its stale fields with the second. prefix', () => {
    const labels: Record<string, string> = { ...definition().labels, 'second.source:m01': 'x', 'second.ref:code': 'x' };
    const { state, staleFields } = rptFormFromDefinition(definition({ second: secondMeasure(), labels }));
    expect(state.second.monthFields).toEqual(months('m01'));
    expect(state.second.keys).toEqual([{ field: null, refField: 'code' }]);
    expect(state.second.level1).toBeNull();
    expect(state.second.level2).toBeNull();
    expect(staleFields).toEqual(['second.monthFields[1]', 'second.ref.keys[0].field', 'second.level1.field', 'second.level2.field']);
  });

  it('does not take first measure labels for the second measure', () => {
    const labels: Record<string, string> = { ...definition().labels, 'source:m01': 'x', 'source:m02': 'x' };
    const second = secondMeasure({ ref: null, level1: { origin: 'source', field: 'branch' }, level2: null });
    const { staleFields } = rptFormFromDefinition(definition({ second, labels }));
    expect(staleFields).toEqual(['second.monthFields[0]', 'second.monthFields[1]', 'second.level1.field']);
  });
});

describe('rptFormToInput with two measures', () => {
  it('sends months by month columns without a date and without a measure, always 12 months', () => {
    const input = rptFormToInput({ ...filledForm(), periodKind: 'months', monthFields: months('amount', null, 'pieces') });
    expect(input.dateField).toBeNull();
    expect(input.measure).toBeNull();
    expect(input.monthFields).toEqual(months('amount', null, 'pieces'));
    expect(input.monthFields).toHaveLength(12);
  });

  it('sends months by date without month columns even if some were chosen before', () => {
    const input = rptFormToInput({ ...filledForm(), periodKind: 'date', monthFields: months('amount') });
    expect(input.monthFields).toBeNull();
    expect(input.dateField).toBe('issued');
    expect(input.measure).toEqual({ kind: 'total', field: 'amount' });
  });

  it('sends an empty measure name as null and a filled one as typed', () => {
    expect(rptFormToInput({ ...filledForm(), measureName: '' }).measureName).toBeNull();
    expect(rptFormToInput({ ...filledForm(), measureName: '   ' }).measureName).toBeNull();
    expect(rptFormToInput({ ...filledForm(), measureName: 'TEST fact' }).measureName).toBe('TEST fact');
  });

  it('sends no second measure when it is switched off, even if it was filled', () => {
    expect(rptFormToInput({ ...twoMeasureForm(), useSecond: false }).second).toBeNull();
  });

  it('sends the second measure with its name, month columns and its own reference and levels', () => {
    const input = rptFormToInput(twoMeasureForm(), 3);
    expect(input.measureName).toBe('TEST fact');
    expect(input.second).toEqual(secondMeasure());
    expect(input.lockVersion).toBe(3);
  });

  it('sends the second measure by date with its measure and without month columns', () => {
    const form = twoMeasureForm();
    const second = { ...form.second, periodKind: 'date' as const, dateField: 'paid', measureKind: 'count' as const };
    const input = rptFormToInput({ ...form, second });
    expect(input.second?.dateField).toBe('paid');
    expect(input.second?.monthFields).toBeNull();
    expect(input.second?.measure).toEqual({ kind: 'count', field: null });
  });

  it('reads back what it sends', () => {
    const def = twoMeasureDefinition();
    const input = rptFormToInput(rptFormFromDefinition(def).state, def.lockVersion);
    expect(rptFormFromDefinition({ ...def, ...input, lockVersion: def.lockVersion }).state).toEqual(twoMeasureForm());
  });
});

describe('month columns', () => {
  const many = layout(
    4,
    Array.from({ length: 14 }, (_, index): RptColumn => ({ field: `c${index}`, label: `TEST ${index}`, type: 'number' })),
  );

  it('offers numbers and integers in the order of the form', () => {
    expect(rptMonthColumns(monthSource).map((column) => column.field)).toEqual(['m01', 'm02', 'm03', 'm04']);
  });

  it('fills in order from a column in the middle, skipping columns that are not numbers', () => {
    expect(rptFillMonthsInOrder(monthSource.columns, 'm02')).toEqual(months('m02', 'm03', 'm04'));
  });

  it('leaves the months empty once the columns run out', () => {
    const filled = rptFillMonthsInOrder(many.columns, 'c5');
    expect(filled).toEqual(months('c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12', 'c13'));
    expect(filled).toHaveLength(12);
  });

  it('takes no more than 12 columns', () => {
    expect(rptFillMonthsInOrder(many.columns, 'c0')).toEqual(
      months('c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11'),
    );
  });

  it('guesses nothing when the chosen column is not a number column or not chosen', () => {
    expect(rptFillMonthsInOrder(monthSource.columns, 'note')).toEqual(months());
    expect(rptFillMonthsInOrder(monthSource.columns, 'missing')).toEqual(months());
    expect(rptFillMonthsInOrder(monthSource.columns, null)).toEqual(months());
  });
});

describe('levels of the second measure', () => {
  it('drops the second level of the second measure when the first measure has none', () => {
    const { state, cleared } = rptSyncSecondLevels({ ...twoMeasureForm(), level2: null });
    expect(state.second.level2).toBeNull();
    expect(state.second.level1).toEqual({ origin: 'ref', field: 'group' });
    expect(cleared).toEqual(['second.level2.field']);
  });

  it('keeps the second level of the second measure while the first measure has one', () => {
    const form = twoMeasureForm();
    const { state, cleared } = rptSyncSecondLevels(form);
    expect(state).toBe(form);
    expect(cleared).toEqual([]);
  });

  it('drops the second level of the second measure when a source change of the first measure clears its second level', () => {
    const { state, cleared } = rptOnSourceChanged(twoMeasureForm());
    expect(state.level2).toBeNull();
    expect(state.second.level2).toBeNull();
    expect(cleared.slice(-2)).toEqual(['level2.field', 'second.level2.field']);
  });
});

describe('rptOnSourceChanged with two measures', () => {
  it('clears the month columns of the first measure and names them', () => {
    const form: RptFormState = { ...filledForm(), periodKind: 'months', dateField: null, monthFields: months('amount', null, 'pieces') };
    const { state, cleared } = rptOnSourceChanged(form);
    expect(state.monthFields).toEqual(months());
    expect(state.periodKind).toBe('months');
    expect(cleared).toContain('monthFields[0]');
    expect(cleared).toContain('monthFields[2]');
    expect(cleared).not.toContain('monthFields[1]');
  });

  it('clears the second measure only, naming its fields with the second. prefix', () => {
    const form = twoMeasureForm();
    const { state, cleared } = rptOnSourceChanged(form, 2);
    expect(state.second.sourceSheet).toBeNull();
    expect(state.second.monthFields).toEqual(months());
    expect(state.second.keys).toEqual([{ field: null, refField: 'code' }]);
    expect(state.second.level1).toEqual({ origin: 'ref', field: 'group' });
    expect(state.second.level2).toBeNull();
    expect(state.second.name).toBe('TEST plan');
    expect(cleared).toEqual([
      'second.sourceSheet',
      'second.monthFields[0]',
      'second.monthFields[1]',
      'second.ref.keys[0].field',
      'second.level2.field',
    ]);
    expect({ ...state, second: form.second }).toEqual(form);
  });
});

describe('rptOnRefChanged with two measures', () => {
  it('clears the reference of the second measure only, naming its fields with the second. prefix', () => {
    const form = twoMeasureForm();
    const { state, cleared } = rptOnRefChanged(form, 2);
    expect(state.second.refSheet).toBeNull();
    expect(state.second.keys).toEqual([{ field: 'branch', refField: null }]);
    expect(state.second.level1).toBeNull();
    expect(state.second.level2).toEqual({ origin: 'source', field: 'branch' });
    expect(cleared).toEqual(['second.ref.sheet', 'second.ref.keys[0].refField', 'second.level1.field']);
    expect({ ...state, second: form.second }).toEqual(form);
  });
});
