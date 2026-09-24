import {
  RptColumn,
  RptDecimals,
  RptDefinition,
  RptDefinitionInput,
  RptDivisor,
  RptLevelPart,
  RptMeasure,
  RptMeasureInput,
  RptMeasureKind,
  RptMonthFields,
  RptOrigin,
  RptRefPart,
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

/** Months by a date column or by twelve month columns. */
export type RptPeriodKind = 'date' | 'months';

/** Which measure of the form a change belongs to. */
export type RptMeasureNo = 1 | 2;

/** Number of month columns of a measure by month columns. */
export const RPT_MONTHS = 12;

/** Flat state of one measure of the form; `name` is the measure caption. */
export interface RptMeasureFormState {
  name: string;
  sourceId: number | null;
  sourceSheet: number | null;
  periodKind: RptPeriodKind;
  dateField: string | null;
  /** Always 12 elements, January first. */
  monthFields: RptMonthFields;
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

/** Flat state of the report description form (sketch, section 4): report name, the first measure in place, the second measure. */
export interface RptFormState extends Omit<RptMeasureFormState, 'name'> {
  name: string;
  measureName: string;
  useSecond: boolean;
  second: RptMeasureFormState;
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

/** Field names follow the server errors (contract 2.2, 10.3), so one map serves both server errors and "choose again". */
export const RPT_FIELD = {
  measureName: 'measureName',
  secondName: 'second.name',
  sourceSheet: 'sourceSheet',
  dateField: 'dateField',
  monthField: (index: number) => `monthFields[${index}]`,
  measureField: 'measure.field',
  refSheet: 'ref.sheet',
  level1: 'level1.field',
  level2: 'level2.field',
  keyField: (index: number) => `ref.keys[${index}].field`,
  keyRefField: (index: number) => `ref.keys[${index}].refField`,
  /** Prefix of every field of the second measure, in server errors and in "choose again". */
  secondPrefix: 'second.',
} as const;

const SOURCE_LABEL = 'source:';
const REF_LABEL = 'ref:';

/** Label key prefix and field name prefix of one measure. */
interface RptMeasurePrefix {
  label: string;
  field: string;
}

const FIRST: RptMeasurePrefix = { label: '', field: '' };
const SECOND: RptMeasurePrefix = { label: RPT_FIELD.secondPrefix, field: RPT_FIELD.secondPrefix };

type RptMeasureFields = Omit<RptMeasureFormState, 'name'>;

/** Description of one measure as the server stores it (the first measure lives at the top level of the description). */
interface RptMeasureSource {
  sourceId: number | null;
  sourceSheet: number | null;
  dateField: string | null;
  monthFields?: RptMonthFields | null;
  measure: RptMeasure | null;
  divisor: RptDivisor;
  decimals: RptDecimals;
  ref: RptRefPart | null;
  level1: RptLevelPart | null;
  level2: RptLevelPart | null;
}

export function rptEmptyForm(): RptFormState {
  return { name: '', measureName: '', ...emptyMeasureFields(), useSecond: false, second: rptEmptyMeasure() };
}

/** Second measure before anything is chosen: months by date, a sum in units, no reference. */
export function rptEmptyMeasure(): RptMeasureFormState {
  return { name: '', ...emptyMeasureFields() };
}

/** Saved description → form; a column missing from `labels` is left empty and reported in `staleFields`. */
export function rptFormFromDefinition(def: RptDefinition): RptFormLoad {
  const staleFields: string[] = [];
  const first = measureFromDefinition(def, def.labels, FIRST, staleFields);
  const second = def.second ?? null;
  const state: RptFormState = {
    name: def.name,
    measureName: def.measureName ?? '',
    ...first,
    useSecond: second !== null,
    second:
      second === null
        ? rptEmptyMeasure()
        : { name: second.name, ...measureFromDefinition(second, def.labels, SECOND, staleFields) },
  };
  return { state, staleFields };
}

/** Form → request body; the server checks completeness and answers 422 by field. */
export function rptFormToInput(state: RptFormState, lockVersion?: number): RptDefinitionInput {
  const input: RptDefinitionInput = {
    name: state.name,
    measureName: state.measureName.trim() === '' ? null : state.measureName,
    ...measureToInput(state),
    second: state.useSecond ? { name: state.second.name, ...measureToInput(state.second) } : null,
  };
  return lockVersion === undefined ? input : { ...input, lockVersion };
}

/** Columns for "months by": only dates. */
export function rptDateColumns(layout: RptSourceLayout): RptColumn[] {
  return layout.columns.filter((column) => column.type === 'date');
}

/** Columns for "sum of column": integers and numbers. */
export function rptMeasureColumns(layout: RptSourceLayout): RptColumn[] {
  return layout.columns.filter(isNumberColumn);
}

/** Columns for a month of "months by month columns": integers and numbers in the order of the form. */
export function rptMonthColumns(layout: RptSourceLayout): RptColumn[] {
  return rptMeasureColumns(layout);
}

/**
 * "Fill in order": January is the chosen column, every next month the next number column in the order of the form;
 * when the columns run out the rest stays empty. A column that is not among the number columns gives 12 empty months
 * (nothing is guessed by column names).
 */
export function rptFillMonthsInOrder(columns: RptColumn[], januaryField: string | null): RptMonthFields {
  const numbers = columns.filter(isNumberColumn).map((column) => column.field);
  const start = januaryField === null ? -1 : numbers.indexOf(januaryField);
  if (start < 0) {
    return emptyMonths();
  }
  return fitMonths(numbers.slice(start, start + RPT_MONTHS));
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

/**
 * Source of a measure changed: its sheet, date, month columns, measure column, source side of the keys and source levels
 * are cleared. Fields of the second measure are named with the `second.` prefix.
 */
export function rptOnSourceChanged(state: RptFormState, measure: RptMeasureNo = 1): RptFormChange {
  return changeMeasure(state, measure, clearSource);
}

/** Reference of a measure changed: its sheet, reference side of the keys and reference levels are cleared. */
export function rptOnRefChanged(state: RptFormState, measure: RptMeasureNo = 1): RptFormChange {
  return changeMeasure(state, measure, clearRef);
}

/** The second measure has as many levels as the first one: the first measure has no second level — the second measure neither. */
export function rptSyncSecondLevels(state: RptFormState): RptFormChange {
  if (state.level2 !== null || state.second.level2 === null) {
    return { state, cleared: [] };
  }
  return {
    state: { ...state, second: { ...state.second, level2: null } },
    cleared: [`${RPT_FIELD.secondPrefix}${RPT_FIELD.level2}`],
  };
}

function changeMeasure(
  state: RptFormState,
  measure: RptMeasureNo,
  clear: (fields: RptMeasureFields, prefix: string, cleared: string[]) => RptMeasureFields,
): RptFormChange {
  const cleared: string[] = [];
  if (measure === 2) {
    const second: RptMeasureFormState = { ...state.second, ...clear(state.second, SECOND.field, cleared) };
    return { state: { ...state, second }, cleared };
  }
  const next: RptFormState = { ...state, ...clear(state, FIRST.field, cleared) };
  const synced = rptSyncSecondLevels(next);
  return { state: synced.state, cleared: [...cleared, ...synced.cleared] };
}

function clearSource(fields: RptMeasureFields, prefix: string, cleared: string[]): RptMeasureFields {
  const clear = clearer(prefix, cleared);
  return {
    ...fields,
    sourceSheet: clear(fields.sourceSheet, RPT_FIELD.sourceSheet),
    dateField: clear(fields.dateField, RPT_FIELD.dateField),
    monthFields: fields.monthFields.map((field, index) => clear(field, RPT_FIELD.monthField(index))),
    measureField: clear(fields.measureField, RPT_FIELD.measureField),
    keys: fields.keys.map((key, index) => ({ ...key, field: clear(key.field, RPT_FIELD.keyField(index)) })),
    level1: clearLevel(fields.level1, 'source', `${prefix}${RPT_FIELD.level1}`, cleared),
    level2: clearLevel(fields.level2, 'source', `${prefix}${RPT_FIELD.level2}`, cleared),
  };
}

function clearRef(fields: RptMeasureFields, prefix: string, cleared: string[]): RptMeasureFields {
  const clear = clearer(prefix, cleared);
  return {
    ...fields,
    refSheet: clear(fields.refSheet, RPT_FIELD.refSheet),
    keys: fields.keys.map((key, index) => ({ ...key, refField: clear(key.refField, RPT_FIELD.keyRefField(index)) })),
    level1: clearLevel(fields.level1, 'ref', `${prefix}${RPT_FIELD.level1}`, cleared),
    level2: clearLevel(fields.level2, 'ref', `${prefix}${RPT_FIELD.level2}`, cleared),
  };
}

/** Empties a value and names its field (with the measure prefix) when there was something to empty. */
function clearer(prefix: string, cleared: string[]): <T>(value: T | null, name: string) => null {
  return <T>(value: T | null, name: string): null => {
    if (value !== null) {
      cleared.push(`${prefix}${name}`);
    }
    return null;
  };
}

function clearLevel(level: RptFormLevel | null, origin: RptOrigin, name: string, cleared: string[]): RptFormLevel | null {
  if (level === null || level.origin !== origin) {
    return level;
  }
  cleared.push(name);
  return null;
}

function measureFromDefinition(
  part: RptMeasureSource,
  labels: Record<string, string>,
  prefix: RptMeasurePrefix,
  staleFields: string[],
): RptMeasureFields {
  const known = (labelPrefix: string, field: string | null, name: string): string | null => {
    if (field === null) {
      return null;
    }
    if (labels[`${prefix.label}${labelPrefix}${field}`] === undefined) {
      staleFields.push(`${prefix.field}${name}`);
      return null;
    }
    return field;
  };
  const level = (levelPart: RptLevelPart | null, name: string): RptFormLevel | null => {
    if (levelPart === null) {
      return null;
    }
    const field = known(levelPart.origin === 'source' ? SOURCE_LABEL : REF_LABEL, levelPart.field, name);
    return field === null ? null : { origin: levelPart.origin, field };
  };
  const monthFields = part.monthFields ?? null;
  const measure = part.measure;
  return {
    sourceId: part.sourceId,
    sourceSheet: part.sourceSheet,
    periodKind: monthFields === null ? 'date' : 'months',
    dateField: known(SOURCE_LABEL, part.dateField, RPT_FIELD.dateField),
    monthFields:
      monthFields === null
        ? emptyMonths()
        : fitMonths(monthFields).map((field, index) => known(SOURCE_LABEL, field, RPT_FIELD.monthField(index))),
    measureKind: measure?.kind ?? 'total',
    measureField: measure === null || measure.kind === 'count' ? null : known(SOURCE_LABEL, measure.field, RPT_FIELD.measureField),
    divisor: part.divisor,
    decimals: part.decimals,
    useRef: part.ref !== null,
    refSourceId: part.ref?.sourceId ?? null,
    refSheet: part.ref?.sheet ?? null,
    keys:
      part.ref === null || part.ref.keys.length === 0
        ? [emptyKey()]
        : part.ref.keys.map((key, index) => ({
            field: known(SOURCE_LABEL, key.field, RPT_FIELD.keyField(index)),
            refField: known(REF_LABEL, key.refField, RPT_FIELD.keyRefField(index)),
          })),
    level1: level(part.level1, RPT_FIELD.level1),
    level2: level(part.level2, RPT_FIELD.level2),
  };
}

/** One measure of the form → its part of the request body: a measure by month columns has no date and no measure column. */
function measureToInput(fields: RptMeasureFields): Omit<RptMeasureInput, 'name'> {
  const byMonths = fields.periodKind === 'months';
  return {
    sourceId: fields.sourceId,
    sourceSheet: fields.sourceSheet,
    dateField: byMonths ? null : fields.dateField,
    monthFields: byMonths ? fitMonths(fields.monthFields) : null,
    measure: byMonths ? null : { kind: fields.measureKind, field: fields.measureKind === 'count' ? null : fields.measureField },
    divisor: fields.divisor,
    decimals: fields.decimals,
    ref: fields.useRef
      ? {
          sourceId: fields.refSourceId,
          sheet: fields.refSheet,
          keys: fields.keys.map((key) => ({ field: key.field, refField: key.refField })),
        }
      : null,
    level1: fields.level1 === null ? null : { ...fields.level1 },
    level2: fields.level2 === null ? null : { ...fields.level2 },
  };
}

function emptyMeasureFields(): RptMeasureFields {
  return {
    sourceId: null,
    sourceSheet: null,
    periodKind: 'date',
    dateField: null,
    monthFields: emptyMonths(),
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

function emptyMonths(): RptMonthFields {
  return Array.from({ length: RPT_MONTHS }, () => null);
}

/** Exactly 12 months: extra ones are dropped, missing ones are empty. */
function fitMonths(months: RptMonthFields): RptMonthFields {
  return Array.from({ length: RPT_MONTHS }, (_, index) => months[index] ?? null);
}

function isNumberColumn(column: RptColumn): boolean {
  return column.type === 'integer' || column.type === 'number';
}

function levelOption(origin: RptOrigin, column: RptColumn): RptLevelOption {
  return { origin, field: column.field, label: column.label };
}

function emptyKey(): RptFormKey {
  return { field: null, refField: null };
}
