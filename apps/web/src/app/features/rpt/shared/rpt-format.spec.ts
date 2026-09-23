import { describe, expect, it } from 'vitest';
import { formatRptNumber, formatRptRaw, rptUnitKey } from './rpt-format';

const NBSP = ' ';

describe('formatRptNumber', () => {
  it('shows an empty cell for null', () => {
    expect(formatRptNumber(null, 2)).toBe('');
  });

  it('rounds half away from zero like Excel', () => {
    expect(formatRptNumber('2.345', 2)).toBe('2,35');
    expect(formatRptNumber('2.344', 2)).toBe('2,34');
    expect(formatRptNumber('0.5', 0)).toBe('1');
  });

  it('rounds a negative half away from zero', () => {
    expect(formatRptNumber('-2.345', 2)).toBe('-2,35');
    expect(formatRptNumber('-0.5', 0)).toBe('-1');
  });

  it('shows zero with exactly the report digits', () => {
    expect(formatRptNumber('0', 2)).toBe('0,00');
    expect(formatRptNumber('0', 0)).toBe('0');
  });

  it('drops the minus when a negative value rounds to zero', () => {
    expect(formatRptNumber('-0.001', 2)).toBe('0,00');
    expect(formatRptNumber('-0.4', 0)).toBe('0');
  });

  it('groups a million by three with a no-break space', () => {
    expect(formatRptNumber('1000000', 0)).toBe(`1${NBSP}000${NBSP}000`);
    expect(formatRptNumber('-1234567.891', 1)).toBe(`-1${NBSP}234${NBSP}567,9`);
  });

  it('pads the fraction to the report digits', () => {
    expect(formatRptNumber('12.5', 3)).toBe('12,500');
    expect(formatRptNumber('7', 1)).toBe('7,0');
  });

  it('carries the rounding into the integer part and the grouping', () => {
    expect(formatRptNumber('999999.995', 2)).toBe(`1${NBSP}000${NBSP}000,00`);
  });

  it('keeps precision beyond floating point', () => {
    expect(formatRptNumber('12345678901234567890.125', 2)).toBe(
      `12${NBSP}345${NBSP}678${NBSP}901${NBSP}234${NBSP}567${NBSP}890,13`,
    );
  });

  it('shows a value that is not a number as it came', () => {
    expect(formatRptNumber('1e5', 2)).toBe('1e5');
    expect(formatRptNumber('TEST', 0)).toBe('TEST');
  });
});

describe('formatRptRaw', () => {
  it('groups digits and keeps every fraction digit that came', () => {
    expect(formatRptRaw('26435.3102')).toBe(`26${NBSP}435,3102`);
    expect(formatRptRaw('-1000')).toBe(`-1${NBSP}000`);
  });

  it('shows an empty text for null', () => {
    expect(formatRptRaw(null)).toBe('');
  });
});

describe('rptUnitKey', () => {
  it('builds the dictionary key of every divisor', () => {
    expect(rptUnitKey(1)).toBe('rpt.unit_short.1');
    expect(rptUnitKey(1000)).toBe('rpt.unit_short.1000');
    expect(rptUnitKey(1000000)).toBe('rpt.unit_short.1000000');
  });
});
