import { OvwColumnKind } from './ovw-api';

/** Canonical number as the server sends it: dot as decimal separator, no grouping, no exponent. */
export const OVW_NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;
/** Server limit of digits before and after the dot in a filter bound (contract, section 6). */
export const OVW_MAX_NUMBER_DIGITS = 30;
/** Server limit of digits before and after the dot in a group value (`eq` on a number column). */
export const OVW_MAX_EQ_NUMBER_DIGITS = 1000;
/** Number a filter bound may hold: the server rejects longer ones. */
export const OVW_FILTER_NUMBER_PATTERN = new RegExp(
  `^-?\\d{1,${OVW_MAX_NUMBER_DIGITS}}(\\.\\d{1,${OVW_MAX_NUMBER_DIGITS}})?$`,
);
/** Number a group value may hold: a long value from the file (e.g. "1E-40") still opens its group. */
export const OVW_EQ_NUMBER_PATTERN = new RegExp(
  `^-?\\d{1,${OVW_MAX_EQ_NUMBER_DIGITS}}(\\.\\d{1,${OVW_MAX_EQ_NUMBER_DIGITS}})?$`,
);
/** Canonical date as the server sends it. */
export const OVW_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const INPUT_DATE_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const NBSP = ' ';

export interface OvwFormattedValue {
  text: string;
  /** True when the value did not fit the column type and is shown as it was in the file. */
  raw: boolean;
}

export function formatOvwValue(kind: OvwColumnKind, value: string | null): OvwFormattedValue {
  if (value === null) {
    return { text: '', raw: false };
  }
  if (kind === 'date' && OVW_DATE_PATTERN.test(value)) {
    return { text: formatDate(value), raw: false };
  }
  if (kind === 'number' && OVW_NUMBER_PATTERN.test(value)) {
    return { text: formatNumber(value), raw: false };
  }
  return { text: value, raw: kind !== 'text' };
}

/** User input of a number bound → canonical number, or null when the input is not a number. */
export function parseOvwNumberInput(input: string): string | null {
  const normalized = input.replace(/[  ]/g, '').replace(',', '.');
  return OVW_FILTER_NUMBER_PATTERN.test(normalized) ? normalized : null;
}

/** User input `dd.mm.yyyy` of an existing date → `yyyy-mm-dd`, otherwise null. */
export function parseOvwDateInput(input: string): string | null {
  const match = INPUT_DATE_PATTERN.exec(input.trim());
  if (!match) {
    return null;
  }
  const [, day, month, year] = match;
  return isExistingDate(Number(year), Number(month), Number(day)) ? `${year}-${month}-${day}` : null;
}

function isExistingDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function formatDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function formatNumber(value: string): string {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart, fractionPart] = unsigned.split('.');
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const sign = negative ? '-' : '';
  return fractionPart === undefined ? `${sign}${grouped}` : `${sign}${grouped},${fractionPart}`;
}
