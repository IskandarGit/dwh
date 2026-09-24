import { describe, expect, it } from 'vitest';
import { RptColumn, RptDefinition, RptSourceLayout } from './rpt-api';
import {
  RptFormState,
  rptDateColumns,
  rptEmptyForm,
  rptFormFromDefinition,
  rptFormToInput,
  rptKeyColumns,
  rptLevelOptions,
  rptMeasureColumns,
  rptOnRefChanged,
  rptOnSourceChanged,
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
    sourceId: 1,
    sourceSheet: 1,
    dateField: 'issued',
    measure: { kind: 'total', field: 'amount' },
    divisor: 1000,
    decimals: 2,
    ref: { sourceId: 2, sheet: 1, keys: [{ field: 'branch', refField: 'code' }] },
    level1: { origin: 'ref', field: 'group' },
    level2: { origin: 'source', field: 'region' },
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
      sourceId: 1,
      sourceSheet: 1,
      dateField: 'issued',
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
      sourceId: 1,
      sourceSheet: 1,
      dateField: 'issued',
      measure: { kind: 'total', field: 'amount' },
      divisor: 1000,
      decimals: 2,
      ref: { sourceId: 2, sheet: 1, keys: [{ field: 'branch', refField: 'code' }] },
      level1: { origin: 'ref', field: 'group' },
      level2: { origin: 'source', field: 'region' },
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
