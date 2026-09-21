import { describe, expect, it } from 'vitest';
import { PACKAGED_RUSSIAN } from '../../../core/i18n/packaged-russian';
import { UplPackageItem, UplPackageStatus } from './packages-api';
import {
  UPL_PACKAGE_STATUS_KEY,
  UPL_PACKAGE_STATUS_VARIANT,
  formatUplDate,
  formatUplDateTime,
  formatUplPeriod,
  uplPackageRowsText
} from './packages-labels';

const STATUSES: UplPackageStatus[] = ['received', 'verified', 'rejected', 'applied'];

function item(status: UplPackageStatus, rows: [number, number, number] | null): UplPackageItem {
  return {
    id: 'p-1',
    sourceId: 1,
    sourceCode: 'cement.output',
    sourceName: 'TEST source',
    formatVersion: 2,
    periodFrom: '2026-01-01',
    periodTo: '2026-01-31',
    fileName: 'report.xlsx',
    fileSizeBytes: 1024,
    uploadedBy: 'TEST user',
    uploadedAt: '2026-01-31T08:05:00Z',
    status,
    rowsTotal: rows ? rows[0] : null,
    rowsAccepted: rows ? rows[1] : null,
    rowsRejected: rows ? rows[2] : null,
    errorsTotal: rows ? rows[2] : null,
    rejectCode: null,
    rejectParams: null,
    loadId: null,
    rawRows: null
  };
}

describe('upl package labels', () => {
  it('shows a date of the contract as a Russian date', () => {
    expect(formatUplDate('2026-01-31')).toBe('31.01.2026');
  });

  it('keeps a string that is not a date of the contract', () => {
    expect(formatUplDate('31.01.2026')).toBe('31.01.2026');
    expect(formatUplDate('')).toBe('');
  });

  it('shows a period as two dates with a dash', () => {
    expect(formatUplPeriod('2026-01-01', '2026-01-31')).toBe('01.01.2026–31.01.2026');
  });

  it('shows an instant in the time zone of the browser', () => {
    const moment = new Date('2026-01-31T08:05:00Z');
    const pad = (value: number) => String(value).padStart(2, '0');
    const expected =
      `${pad(moment.getDate())}.${pad(moment.getMonth() + 1)}.${moment.getFullYear()}` +
      ` ${pad(moment.getHours())}:${pad(moment.getMinutes())}`;
    expect(formatUplDateTime('2026-01-31T08:05:00Z')).toBe(expected);
  });

  it('keeps an instant that cannot be read', () => {
    expect(formatUplDateTime('not-a-date')).toBe('not-a-date');
  });

  it('shows three counters of a verified and of an applied package', () => {
    expect(uplPackageRowsText(item('verified', [120, 117, 3]))).toBe('120 / 117 / 3');
    expect(uplPackageRowsText(item('applied', [120, 117, 3]))).toBe('120 / 117 / 3');
  });

  it('shows a dash while the package has no counters', () => {
    expect(uplPackageRowsText(item('received', null))).toBe('—');
    expect(uplPackageRowsText(item('rejected', null))).toBe('—');
    expect(uplPackageRowsText(item('verified', null))).toBe('—');
  });

  it('has a Russian text and a badge variant for every status', () => {
    for (const status of STATUSES) {
      expect(PACKAGED_RUSSIAN[UPL_PACKAGE_STATUS_KEY[status]]).toBeTruthy();
      expect(UPL_PACKAGE_STATUS_VARIANT[status]).toBeTruthy();
    }
    expect(new Set(Object.values(UPL_PACKAGE_STATUS_VARIANT)).size).toBe(4);
  });
});
