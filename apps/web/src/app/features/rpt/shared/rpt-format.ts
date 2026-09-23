import { formatOvwValue } from '../../ovw/overview/ovw-format';
import { RptDivisor } from './rpt-api';

/** Canonical number as the server sends it: dot as decimal separator, no grouping, no exponent. */
const RPT_NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;
const NBSP = ' ';

/**
 * Server number → text of the report cell: rounded to `decimals` half away from zero (as Excel does),
 * integer part grouped by three with a no-break space, comma as decimal separator, exactly `decimals` digits.
 * Rounding works on the digits (BigInt), never on a floating point number. Anything that is not a number is shown as it came.
 */
export const formatRptNumber = (value: string | null, decimals: number): string => {
  if (value === null) {
    return '';
  }
  if (!RPT_NUMBER_PATTERN.test(value)) {
    return value;
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart, fractionPart = ''] = unsigned.split('.');
  const rounded = roundDigits(integerPart, fractionPart, decimals);
  const digits = rounded.toString().padStart(decimals + 1, '0');
  const integerDigits = digits.slice(0, digits.length - decimals);
  const fractionDigits = digits.slice(digits.length - decimals);
  const sign = negative && rounded !== BigInt(0) ? '-' : '';
  const grouped = groupThousands(integerDigits);
  return decimals > 0 ? `${sign}${grouped},${fractionDigits}` : `${sign}${grouped}`;
};

/** Server number → text without rounding (as many digits as came): the panel shows values before the divisor. */
export function formatRptRaw(value: string | null): string {
  return formatOvwValue('number', value).text;
}

/** Dictionary key of the short unit name for a divisor. */
export function rptUnitKey(divisor: RptDivisor): string {
  return `rpt.unit_short.${divisor}`;
}

/** Magnitude scaled by 10^decimals, rounded half up on the first dropped digit. */
function roundDigits(integerPart: string, fractionPart: string, decimals: number): bigint {
  const kept = fractionPart.slice(0, decimals).padEnd(decimals, '0');
  const firstDropped = fractionPart.charAt(decimals);
  const scaled = BigInt(`${integerPart}${kept}`);
  return firstDropped >= '5' ? scaled + BigInt(1) : scaled;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}
