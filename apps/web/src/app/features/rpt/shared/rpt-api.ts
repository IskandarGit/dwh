import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

/** Rows per page of the cell panel: the server always returns exactly this many (contract 2.1, CellRows.limit). */
export const RPT_PAGE_SIZE = 200;
/** Allowed divisors of a report ("show in units / thousands / millions"). */
export const RPT_DIVISORS = [1, 1000, 1000000] as const;
/** Allowed digits after the decimal separator. */
export const RPT_DECIMALS = [0, 1, 2, 3] as const;

export type RptDivisor = (typeof RPT_DIVISORS)[number];
export type RptDecimals = (typeof RPT_DECIMALS)[number];
export type RptOrigin = 'source' | 'ref';
export type RptMeasureKind = 'total' | 'count';
export type RptColumnType = 'text' | 'integer' | 'number' | 'date' | 'object_key' | 'ref_code';

export interface RptReportItem {
  id: number;
  name: string;
  sourceName: string;
  modifiedAt: string;
}

export interface RptMeasure {
  kind: RptMeasureKind;
  field: string | null;
}

export interface RptKeyPair {
  field: string | null;
  refField: string | null;
}

export interface RptRefPart {
  sourceId: number | null;
  sheet: number | null;
  keys: RptKeyPair[];
}

export interface RptLevelPart {
  origin: RptOrigin;
  field: string;
}

/** Body of POST/PUT: the screen may send an incomplete description, the server answers 422 with errors by field. */
export interface RptDefinitionInput {
  name: string;
  sourceId: number | null;
  sourceSheet: number | null;
  dateField: string | null;
  measure: RptMeasure;
  divisor: RptDivisor;
  decimals: RptDecimals;
  ref: RptRefPart | null;
  level1: RptLevelPart | null;
  level2: RptLevelPart | null;
  lockVersion?: number;
}

export interface RptDefinition extends RptDefinitionInput {
  id: number;
  lockVersion: number;
  modifiedAt: string;
  modifiedBy: string;
  /** Column labels by the current form: key `source:<field>` or `ref:<field>`; a missing key means the column is gone. */
  labels: Record<string, string>;
}

export interface RptSourceItem {
  id: number;
  code: string;
  name: string;
}

export interface RptSheet {
  ordinal: number;
  name: string;
}

export interface RptColumn {
  field: string;
  label: string;
  type: RptColumnType;
}

export interface RptSourceLayout {
  sourceId: number;
  sheets: RptSheet[];
  sheet: number | null;
  columns: RptColumn[];
}

export interface RptLine {
  /** Month i+1; null — no rows in the cell, "0" — rows exist and sum to zero. */
  cells: (string | null)[];
  total: string | null;
  count: number;
}

export interface RptLine2 extends RptLine {
  key: string | null;
  name: string | null;
}

export interface RptLine1 extends RptLine2 {
  lines: RptLine2[];
}

export interface RptLabels {
  level1: string;
  level2: string | null;
  measure: string | null;
}

export interface RptUndated {
  count: number;
  value: string;
}

export interface RptReportView {
  reportId: number;
  name: string;
  year: number | null;
  years: number[];
  divisor: RptDivisor;
  decimals: RptDecimals;
  labels: RptLabels;
  grand: RptLine;
  lines: RptLine1[];
  undated: RptUndated | null;
  refDuplicateKeys: number;
}

export type RptPeriod = { kind: 'month'; month: number } | { kind: 'year' } | { kind: 'undated' };

export interface RptCellQuery {
  year: number | null;
  period: RptPeriod;
  /** [] — grand total; [k1] — level 1 line; [k1, k2] — level 2 line; keys as the server sent them. */
  path: (string | null)[];
  offset: number;
}

export interface RptCellItem {
  file: string;
  sheet: string;
  excelRow: number;
  date: string | null;
  measure: string | null;
  level1: string | null;
  level2: string | null;
}

export interface RptCellRows {
  total: number;
  offset: number;
  limit: number;
  /** Measure over all rows of the cell, before the divisor. */
  value: string;
  items: RptCellItem[];
}

const RPT = '/rpt';

@Injectable({ providedIn: 'root' })
export class RptApiService {
  private readonly api = inject(ApiService);

  reports(): Observable<RptReportItem[]> {
    return this.api.get<RptReportItem[]>(`${RPT}/reports`, {}, { notifyError: false });
  }

  report(id: number): Observable<RptDefinition> {
    return this.api.get<RptDefinition>(`${RPT}/reports/${id}`, {}, { notifyError: false });
  }

  create(input: RptDefinitionInput): Observable<RptDefinition> {
    return this.api.post<RptDefinition>(`${RPT}/reports`, input, { notifyError: false });
  }

  update(id: number, input: RptDefinitionInput): Observable<RptDefinition> {
    return this.api.put<RptDefinition>(`${RPT}/reports/${id}`, input, { notifyError: false });
  }

  sources(): Observable<RptSourceItem[]> {
    return this.api.get<RptSourceItem[]>(`${RPT}/sources`, {}, { notifyError: false });
  }

  layout(sourceId: number, sheet: number | null): Observable<RptSourceLayout> {
    return this.api.get<RptSourceLayout>(
      `${RPT}/sources/${sourceId}/layout`,
      sheet == null ? {} : { sheet },
      { notifyError: false },
    );
  }

  view(id: number, year: number | null): Observable<RptReportView> {
    return this.api.get<RptReportView>(`${RPT}/reports/${id}/view`, year == null ? {} : { year }, { notifyError: false });
  }

  cells(id: number, query: RptCellQuery): Observable<RptCellRows> {
    return this.api.post<RptCellRows>(`${RPT}/reports/${id}/cells`, query, { notifyError: false });
  }
}
