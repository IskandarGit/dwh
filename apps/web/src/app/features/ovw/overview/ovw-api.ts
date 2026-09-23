import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

/** Rows per page: the server always returns exactly this many (contract 2.3). */
export const OVW_PAGE_SIZE = 200;

export type OvwColumnType = 'text' | 'integer' | 'number' | 'date' | 'object_key' | 'ref_code';

/** How the screen treats a column: filter editor, value format, sort semantics. */
export type OvwColumnKind = 'text' | 'number' | 'date';

export interface OvwSource {
  id: number;
  code: string;
  name: string;
}

export interface OvwSheet {
  ordinal: number;
  name: string;
}

export interface OvwColumn {
  field: string;
  label: string;
  type: OvwColumnType;
  summable: boolean;
}

export interface OvwPackage {
  fileName: string;
  periodFrom: string;
  periodTo: string;
}

export interface OvwLayout {
  sourceId: number;
  sheets: OvwSheet[];
  sheet: number | null;
  formatVersion: number | null;
  columns: OvwColumn[];
  packages: OvwPackage[];
  rowsTotal: number;
}

export interface OvwFilter {
  field: string;
  op: 'contains' | 'between' | 'eq';
  value?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface OvwSort {
  field: string;
  dir: 'asc' | 'desc';
}

export interface OvwRowsQuery {
  sheet: number;
  filters: OvwFilter[];
  sort: OvwSort | null;
  offset: number;
}

export interface OvwRow {
  file: string;
  sheet: string;
  excelRow: number;
  values: Record<string, string | null>;
}

export interface OvwRowsPage {
  total: number;
  offset: number;
  limit: number;
  items: OvwRow[];
}

export interface OvwGroupsQuery {
  sheet: number;
  filters: OvwFilter[];
  groupBy: string;
}

export interface OvwGroup {
  value: string | null;
  count: number;
  sums: Record<string, string>;
}

export interface OvwGroupsResult {
  groupsTotal: number;
  groupsShown: number;
  groups: OvwGroup[];
  total: { count: number; sums: Record<string, string> };
}

export function ovwKind(type: OvwColumnType): OvwColumnKind {
  switch (type) {
    case 'integer':
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}

const OVW = '/ovw';

@Injectable({ providedIn: 'root' })
export class OvwApiService {
  private readonly api = inject(ApiService);

  sources(): Observable<OvwSource[]> {
    return this.api.get<OvwSource[]>(`${OVW}/sources`, {}, { notifyError: false });
  }

  layout(sourceId: number, sheet: number | null): Observable<OvwLayout> {
    return this.api.get<OvwLayout>(`${OVW}/sources/${sourceId}/layout`, sheet == null ? {} : { sheet }, { notifyError: false });
  }

  rows(sourceId: number, query: OvwRowsQuery): Observable<OvwRowsPage> {
    return this.api.post<OvwRowsPage>(`${OVW}/sources/${sourceId}/rows`, query, { notifyError: false });
  }

  groups(sourceId: number, query: OvwGroupsQuery): Observable<OvwGroupsResult> {
    return this.api.post<OvwGroupsResult>(`${OVW}/sources/${sourceId}/groups`, query, { notifyError: false });
  }
}
