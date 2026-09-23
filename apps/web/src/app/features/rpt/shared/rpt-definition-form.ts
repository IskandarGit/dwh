import {
  RptColumn,
  RptDecimals,
  RptDefinition,
  RptDefinitionInput,
  RptDivisor,
  RptMeasureKind,
  RptOrigin,
  RptSourceLayout,
} from './rpt-api';

export interface RptFormKey {
  field: string | null;
  refField: string | null;
}

export interface RptFormLevel {
  origin: RptOrigin;
  field: string;
}

/** Flat state of the report description form (sketch, section 4). */
export interface RptFormState {
  name: string;
  sourceId: number | null;
  sourceSheet: number | null;
  dateField: string | null;
  measureKind: RptMeasureKind;
  measureField: string | null;
  divisor: RptDivisor;
  decimals: RptDecimals;
  useRef: boolean;
  refSourceId: number | null;
  refSheet: number | null;
  keys: RptFormKey[];
  level1: RptFormLevel | null;
  level2: RptFormLevel | null;
}

/** Option of the level list: a column of the source or of the reference file. */
export interface RptLevelOption {
  origin: RptOrigin;
  field: string;
  label: string;
}

/** Form state after a change, with the names of fields that lost their value (shown with "choose again"). */
export interface RptFormChange {
  state: RptFormState;
  cleared: string[];
}

/** Form state read from a saved description, with the names of fields whose column is gone from the current form. */
export interface RptFormLoad {
  state: RptFormState;
  staleFields: string[];
}

/** Field names follow the server errors (contract 2.2), so one map serves both server errors and "choose again". */
export const RPT_FIELD = {
  sourceSheet: 'sourceSheet',
  dateField: 'dateField',
  measureField: 'measure.field',
  refSheet: 'ref.sheet',
  level1: 'level1.field',
  level2: 'level2.field',
  keyField: (index: number) => `ref.keys[${index}].field`,
  keyRefField: (index: number) => `ref.keys[${index}].refField`,
} as const;

const SOURCE_LABEL = 'source:';
const REF_LABEL = 'ref:';

export function rptEmptyForm(): RptFormState {
  return {
    name: '',
    sourceId: null,
    sourceSheet: null,
    dateField: null,
    measureKind: 'total',
    measureField: null,
    divisor: 1,
    decimals: 0,
    useRef: false,
    refSourceId: null,
    refSheet: null,
    keys: [emptyKey()],
    level1: null,
    level2: null,
  };
}

/** Saved description → form; a column missing from `labels` is left empty and reported in `staleFields`. */
export function rptFormFromDefinition(def: RptDefinition): RptFormLoad {
  const staleFields: string[] = [];
  const known = (prefix: string, field: string | null, name: string): string | null => {
    if (field === null) {
      return null;
    }
    if (def.labels[`${prefix}${field}`] === undefined) {
      staleFields.push(name);
      return null;
    }
    return field;
  };
  const level = (part: RptDefinition['level1'], name: string): RptFormLevel | null => {
    if (part === null) {
      return null;
    }
    const field = known(part.origin === 'source' ? SOURCE_LABEL : REF_LABEL, part.field, name);
    return field === null ? null : { origin: part.origin, field };
  };
  const state: RptFormState = {
    name: def.name,
    sourceId: def.sourceId,
    sourceSheet: def.sourceSheet,
    dateField: known(SOURCE_LABEL, def.dateField, RPT_FIELD.dateField),
    measureKind: def.measure.kind,
    measureField: def.measure.kind === 'count' ? null : known(SOURCE_LABEL, def.measure.field, RPT_FIELD.measureField),
    divisor: def.divisor,
    decimals: def.decimals,
    useRef: def.ref !== null,
    refSourceId: def.ref?.sourceId ?? null,
    refSheet: def.ref?.sheet ?? null,
    keys:
      def.ref === null || def.ref.keys.length === 0
        ? [emptyKey()]
        : def.ref.keys.map((key, index) => ({
            field: known(SOURCE_LABEL, key.field, RPT_FIELD.keyField(index)),
            refField: known(REF_LABEL, key.refField, RPT_FIELD.keyRefField(index)),
          })),
    level1: level(def.level1, RPT_FIELD.level1),
    level2: level(def.level2, RPT_FIELD.level2),
  };
  return { state, staleFields };
}

/** Form → request body; the server checks completeness and answers 422 by field. */
export function rptFormToInput(state: RptFormState, lockVersion?: number): RptDefinitionInput {
  const input: RptDefinitionInput = {
    name: state.name,
    sourceId: state.sourceId,
    sourceSheet: state.sourceSheet,
    dateField: state.dateField,
    measure: { kind: state.measureKind, field: state.measureKind === 'count' ? null : state.measureField },
    divisor: state.divisor,
    decimals: state.decimals,
    ref: state.useRef
      ? {
          sourceId: state.refSourceId,
          sheet: state.refSheet,
          keys: state.keys.map((key) => ({ field: key.field, refField: key.refField })),
        }
      : null,
    level1: state.level1 === null ? null : { ...state.level1 },
    level2: state.level2 === null ? null : { ...state.level2 },
  };
  return lockVersion === undefined ? input : { ...input, lockVersion };
}

/** Columns for "months by": only dates. */
export function rptDateColumns(layout: RptSourceLayout): RptColumn[] {
  return layout.columns.filter((column) => column.type === 'date');
}

/** Columns for "sum of column": integers and numbers. */
export function rptMeasureColumns(layout: RptSourceLayout): RptColumn[] {
  return layout.columns.filter((column) => column.type === 'integer' || column.type === 'number');
}

/** Columns of a key pair: anything but dates. */
export function rptKeyColumns(layout: RptSourceLayout): RptColumn[] {
  return layout.columns.filter((column) => column.type !== 'date');
}

/** Level list: source columns (no dates, no measure column), then reference columns (no dates) when a reference is chosen. */
export function rptLevelOptions(
  sourceLayout: RptSourceLayout,
  refLayout: RptSourceLayout | null,
  measureField: string | null,
): RptLevelOption[] {
  const fromSource = sourceLayout.columns
    .filter((column) => column.type !== 'date' && column.field !== measureField)
    .map((column) => levelOption('source', column));
  const fromRef = refLayout === null ? [] : rptKeyColumns(refLayout).map((column) => levelOption('ref', column));
  return [...fromSource, ...fromRef];
}

/** Source changed: its sheet, date, measure column, source side of the keys and source levels are cleared. */
export function rptOnSourceChanged(state: RptFormState): RptFormChange {
  const cleared: string[] = [];
  const clear = <T>(value: T | null, name: string): null => {
    if (value !== null) {
      cleared.push(name);
    }
    return null;
  };
  const next: RptFormState = {
    ...state,
    sourceSheet: clear(state.sourceSheet, RPT_FIELD.sourceSheet),
    dateField: clear(state.dateField, RPT_FIELD.dateField),
    measureField: clear(state.measureField, RPT_FIELD.measureField),
    keys: state.keys.map((key, index) => ({ ...key, field: clear(key.field, RPT_FIELD.keyField(index)) })),
    level1: clearLevel(state.level1, 'source', RPT_FIELD.level1, cleared),
    level2: clearLevel(state.level2, 'source', RPT_FIELD.level2, cleared),
  };
  return { state: next, cleared };
}

/** Reference changed: its sheet, reference side of the keys and reference levels are cleared. */
export function rptOnRefChanged(state: RptFormState): RptFormChange {
  const cleared: string[] = [];
  const clear = <T>(value: T | null, name: string): null => {
    if (value !== null) {
      cleared.push(name);
    }
    return null;
  };
  const next: RptFormState = {
    ...state,
    refSheet: clear(state.refSheet, RPT_FIELD.refSheet),
    keys: state.keys.map((key, index) => ({ ...key, refField: clear(key.refField, RPT_FIELD.keyRefField(index)) })),
    level1: clearLevel(state.level1, 'ref', RPT_FIELD.level1, cleared),
    level2: clearLevel(state.level2, 'ref', RPT_FIELD.level2, cleared),
  };
  return { state: next, cleared };
}

function clearLevel(level: RptFormLevel | null, origin: RptOrigin, name: string, cleared: string[]): RptFormLevel | null {
  if (level === null || level.origin !== origin) {
    return level;
  }
  cleared.push(name);
  return null;
}

function levelOption(origin: RptOrigin, column: RptColumn): RptLevelOption {
  return { origin, field: column.field, label: column.label };
}

function emptyKey(): RptFormKey {
  return { field: null, refField: null };
}
