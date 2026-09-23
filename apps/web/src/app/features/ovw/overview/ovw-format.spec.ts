import { describe, expect, it } from 'vitest';
import { formatOvwValue, parseOvwDateInput, parseOvwNumberInput } from './ovw-format';

describe('formatOvwValue', () => {
  it('shows an empty cell for null', () => {
    expect(formatOvwValue('number', null)).toEqual({ text: '', raw: false });
  });

  it('formats a canonical date as dd.mm.yyyy', () => {
    expect(formatOvwValue('date', '2024-01-31')).toEqual({ text: '31.01.2024', raw: false });
  });

  it('groups the integer part by three with nbsp and keeps the fraction as is', () => {
    expect(formatOvwValue('number', '1234567.50')).toEqual({ text: '1 234 567,50', raw: false });
  });

  it('keeps a short negative number unchanged', () => {
    expect(formatOvwValue('number', '-7')).toEqual({ text: '-7', raw: false });
    expect(formatOvwValue('number', '-1234')).toEqual({ text: '-1 234', raw: false });
  });

  it('marks a value that does not fit the column type as raw', () => {
    expect(formatOvwValue('number', 'abc')).toEqual({ text: 'abc', raw: true });
    expect(formatOvwValue('date', '31/01/2024')).toEqual({ text: '31/01/2024', raw: true });
  });

  it('shows text as is and never marks it raw', () => {
    expect(formatOvwValue('text', 'TEST 2024-01-31')).toEqual({ text: 'TEST 2024-01-31', raw: false });
  });

  it('shows a number of 41 digits as a number, not as raw', () => {
    const longNumber = `0.${'0'.repeat(39)}1`;
    expect(formatOvwValue('number', longNumber)).toEqual({ text: `0,${'0'.repeat(39)}1`, raw: false });
  });
});

describe('parseOvwNumberInput', () => {
  it('accepts spaces, nbsp and a decimal comma', () => {
    expect(parseOvwNumberInput('1 234,5')).toBe('1234.5');
    expect(parseOvwNumberInput('1 234')).toBe('1234');
    expect(parseOvwNumberInput('-7')).toBe('-7');
  });

  it('rejects anything that is not a number', () => {
    expect(parseOvwNumberInput('12a')).toBeNull();
    expect(parseOvwNumberInput('')).toBeNull();
    expect(parseOvwNumberInput('1,2,3')).toBeNull();
  });

  it('rejects more than 30 digits in a part and accepts exactly 30, as the server does', () => {
    const digits30 = '1'.repeat(30);
    expect(parseOvwNumberInput('1'.repeat(31))).toBeNull();
    expect(parseOvwNumberInput(`0,${'1'.repeat(31)}`)).toBeNull();
    expect(parseOvwNumberInput(digits30)).toBe(digits30);
    expect(parseOvwNumberInput(`-${digits30},${digits30}`)).toBe(`-${digits30}.${digits30}`);
  });
});

describe('parseOvwDateInput', () => {
  it('turns dd.mm.yyyy into yyyy-mm-dd', () => {
    expect(parseOvwDateInput('31.01.2024')).toBe('2024-01-31');
    expect(parseOvwDateInput('29.02.2024')).toBe('2024-02-29');
  });

  it('rejects a date that does not exist', () => {
    expect(parseOvwDateInput('31.02.2024')).toBeNull();
    expect(parseOvwDateInput('29.02.2023')).toBeNull();
  });

  it('rejects the canonical form and other formats', () => {
    expect(parseOvwDateInput('2024-01-31')).toBeNull();
    expect(parseOvwDateInput('1.1.2024')).toBeNull();
  });
});
