import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable } from 'rxjs';
import { expand, reduce } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';
import { KeysetPage } from '../../../core/models/common.models';
import { UplApiService, UplSourceItem } from '../upl-api';

export type UplPackageStatus = 'received' | 'verified' | 'rejected' | 'applied';

/** Параметры русского текста ошибки: подставляются в фигурные скобки ключа `upl.err.*`. */
export type UplPackageParams = Record<string, string | number>;

export interface UplPackageItem {
  id: string;
  sourceId: number;
  sourceCode: string;
  sourceName: string;
  formatVersion: number;
  periodFrom: string;
  periodTo: string;
  fileName: string;
  fileSizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  status: UplPackageStatus;
  rowsTotal: number | null;
  rowsAccepted: number | null;
  rowsRejected: number | null;
  errorsTotal: number | null;
  rejectCode: string | null;
  rejectParams: UplPackageParams | null;
  loadId: number | null;
  rawRows: number | null;
}

export interface UplPackageErrorItem {
  sheet: string | null;
  rowNo: number | null;
  columnName: string | null;
  value: string | null;
  code: string;
  params: UplPackageParams | null;
}

export interface UplPackageErrors {
  total: number;
  shown: number;
  items: UplPackageErrorItem[];
}

export interface UplPackageUpload {
  sourceId: number;
  periodFrom: string;
  periodTo: string;
  file: File;
}

const PACKAGES = '/upl/packages';
/** Источники для формы читаются порциями: список И3 отдаёт не больше 200 записей за раз. */
const SOURCES_PAGE_SIZE = 200;

@Injectable({ providedIn: 'root' })
export class UplPackagesApiService {
  private readonly api = inject(ApiService);
  private readonly upl = inject(UplApiService);

  list(limit = 50, cursor?: string | null): Observable<KeysetPage<UplPackageItem>> {
    return this.api.get<KeysetPage<UplPackageItem>>(PACKAGES, { limit, ...(cursor ? { cursor } : {}) }, { notifyError: false });
  }

  /** `multipart/form-data`: заголовок ставит браузер сам — руками его не задаём, иначе теряется граница частей. */
  upload(request: UplPackageUpload): Observable<UplPackageItem> {
    const form = new FormData();
    form.append('sourceId', String(request.sourceId));
    form.append('periodFrom', request.periodFrom);
    form.append('periodTo', request.periodTo);
    form.append('file', request.file, request.file.name);
    return this.api.post<UplPackageItem>(PACKAGES, form, { notifyError: false });
  }

  errors(id: string): Observable<UplPackageErrors> {
    return this.api.get<UplPackageErrors>(`${PACKAGES}/${encodeURIComponent(id)}/errors`, undefined, { notifyError: false });
  }

  /** Применяет проверенную загрузку: ответ — пакет «применён» или «отклонён системой» с причиной сверки. */
  apply(id: string): Observable<UplPackageItem> {
    return this.api.post<UplPackageItem>(`${PACKAGES}/${id}/apply`, null, { notifyError: false });
  }

  /** Все источники одним массивом: форма выбирает из полного списка, а список сервера постраничный. */
  allSources(): Observable<UplSourceItem[]> {
    return this.upl.listSources(SOURCES_PAGE_SIZE).pipe(
      expand(page => (page.hasMore === true ? this.upl.listSources(SOURCES_PAGE_SIZE, page.nextCursor) : EMPTY)),
      reduce((all, page) => [...all, ...page.items], [] as UplSourceItem[])
    );
  }
}
