import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { KeysetPage } from '../../core/models/common.models';

export type UplPeriodicity = 'month' | 'quarter' | 'year' | 'adhoc';
export type UplStrictness = 'error' | 'warning';
export type UplVersionStatus = 'draft' | 'published' | 'superseded';
export type UplDataType = 'text' | 'integer' | 'number' | 'date' | 'object_key' | 'ref_code';
export type UplFileKind = 'xlsx' | 'csv';
export type UplEncoding = 'utf-8' | 'windows-1251';
export type UplMatchBy = 'header' | 'position';

export const UPL_PERIODICITIES = ['month', 'quarter', 'year', 'adhoc'] as const;
export const UPL_STRICTNESSES = ['error', 'warning'] as const;
export const UPL_DATA_TYPES = ['text', 'integer', 'number', 'date', 'object_key', 'ref_code'] as const;
export const UPL_FILE_KINDS = ['xlsx', 'csv'] as const;
export const UPL_ENCODINGS = ['utf-8', 'windows-1251'] as const;
export const UPL_MATCH_BY = ['header', 'position'] as const;

export interface UplSourceItem {
  id: number;
  code: string;
  name: string;
  periodicity: UplPeriodicity;
  lastPublishedVersion: number | null;
  hasDraft: boolean;
}

export interface UplSourceRequest {
  code: string;
  name: string;
  ownerOrg: string;
  ownerContact: string | null;
  periodicity: UplPeriodicity;
  slaDays: number;
  sourceType: 'file';
  reconciliationStrictness: UplStrictness | null;
  lockVersion: number | null;
}

export interface UplSource {
  id: number;
  code: string;
  name: string;
  ownerOrg: string;
  ownerContact: string | null;
  periodicity: UplPeriodicity;
  slaDays: number;
  sourceType: 'file';
  reconciliationStrictness: UplStrictness | null;
  lockVersion: number;
  lastPublishedVersion: number | null;
  hasDraft: boolean;
  createdAt: string;
  modifiedAt: string;
}

export interface UplVersionItem {
  version: number;
  status: UplVersionStatus;
  validFrom: string | null;
  validTo: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
}

export interface UplColumn {
  id: number | null;
  ordinal: number | null;
  filePosition: number | null;
  nameInFile: string;
  targetField: string;
  dataType: UplDataType;
  required: boolean;
  sourceUnit: string | null;
  baseUnit: string | null;
  keyMask: string | null;
  keyPadLength: number | null;
  keyPadMax: number | null;
  refBookCode: string | null;
}

export interface UplSheet {
  id: number | null;
  ordinal: number | null;
  sheetName: string | null;
  headerRow: number;
  totalRowMarker: string | null;
  columns: UplColumn[];
}

export interface UplFormatDraftRequest {
  lockVersion: number;
  fileKind: UplFileKind | null;
  encoding: UplEncoding | null;
  delimiter: string | null;
  matchColumnsBy: UplMatchBy | null;
  sheets: UplSheet[];
}

export interface UplFormatVersion {
  sourceId: number;
  version: number;
  status: UplVersionStatus;
  validFrom: string | null;
  validTo: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  lockVersion: number;
  fileKind: UplFileKind | null;
  encoding: UplEncoding | null;
  delimiter: string | null;
  matchColumnsBy: UplMatchBy | null;
  sheets: UplSheet[];
}

export interface UplUnit {
  code: string;
  name: string;
  baseUnitCode: string;
}

const SOURCES = '/upl/sources';

@Injectable({ providedIn: 'root' })
export class UplApiService {
  private readonly api = inject(ApiService);

  listSources(limit = 50, cursor?: string | null): Observable<KeysetPage<UplSourceItem>> {
    return this.api.get<KeysetPage<UplSourceItem>>(SOURCES, { limit, ...(cursor ? { cursor } : {}) });
  }

  getSource(id: string): Observable<UplSource> {
    return this.api.get<UplSource>(`${SOURCES}/${id}`);
  }

  createSource(body: UplSourceRequest): Observable<UplSource> {
    return this.api.post<UplSource>(SOURCES, body, { notifyError: false });
  }

  updateSource(id: string, body: UplSourceRequest): Observable<UplSource> {
    return this.api.put<UplSource>(`${SOURCES}/${id}`, body, { notifyError: false });
  }

  listVersions(id: string): Observable<UplVersionItem[]> {
    return this.api.get<UplVersionItem[]>(`${SOURCES}/${id}/format-versions`);
  }

  createDraft(id: string, copyFrom?: number): Observable<UplFormatVersion> {
    return this.api.post<UplFormatVersion>(`${SOURCES}/${id}/format-versions`, copyFrom ? { copyFrom } : {}, { notifyError: false });
  }

  getVersion(id: string, v: string): Observable<UplFormatVersion> {
    return this.api.get<UplFormatVersion>(`${SOURCES}/${id}/format-versions/${v}`);
  }

  saveDraft(id: string, v: string, body: UplFormatDraftRequest): Observable<UplFormatVersion> {
    return this.api.put<UplFormatVersion>(`${SOURCES}/${id}/format-versions/${v}`, body, { notifyError: false });
  }

  publish(id: string, v: string, validFrom: string): Observable<void> {
    return this.api.post<void>(`${SOURCES}/${id}/format-versions/${v}/publish`, { validFrom }, { notifyError: false });
  }

  listUnits(): Observable<UplUnit[]> {
    return this.api.get<UplUnit[]>('/upl/units');
  }
}
