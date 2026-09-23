import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { KeysetPage } from '../../../core/models/common.models';
import { ApiService } from '../../../core/services/api.service';
import { UplApiService, UplSourceItem } from '../upl-api';
import { UplPackageErrors, UplPackageItem, UplPackagesApiService } from './packages-api';

function sourcePage(items: UplSourceItem[], hasMore: boolean, nextCursor: string | null): KeysetPage<UplSourceItem> {
  return { items, nextCursor, hasMore, totalReturned: items.length };
}

function source(id: number): UplSourceItem {
  return { id, code: `code.${id}`, name: `TEST ${id}`, periodicity: 'month', lastPublishedVersion: 1, hasDraft: false };
}

interface Setup {
  sourcePages?: Array<KeysetPage<UplSourceItem>>;
}

function create(setup: Setup = {}) {
  const pages = setup.sourcePages ?? [sourcePage([source(1)], false, null)];
  let call = 0;
  const api = {
    get: vi.fn(() => of({} as unknown)),
    post: vi.fn(() => of({} as unknown))
  };
  const upl = {
    listSources: vi.fn(() => of(pages[Math.min(call++, pages.length - 1)]))
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: UplApiService, useValue: upl }
    ]
  });
  return { service: TestBed.inject(UplPackagesApiService), api, upl };
}

function xlsx(name = 'report.xlsx'): File {
  return new File(['TEST'], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

describe('UplPackagesApiService', () => {
  it('asks for the first page without a cursor', () => {
    const { service, api } = create();
    service.list().subscribe();
    expect(api.get).toHaveBeenCalledWith('/upl/packages', { limit: 50 }, { notifyError: false });
  });

  it('passes the cursor and the limit of the next page', () => {
    const { service, api } = create();
    service.list(25, 'cursor-1').subscribe();
    expect(api.get).toHaveBeenCalledWith('/upl/packages', { limit: 25, cursor: 'cursor-1' }, { notifyError: false });
  });

  it('sends the upload as a form with four parts and without a content type header', () => {
    const { service, api } = create();
    const file = xlsx();
    service.upload({ sourceId: 7, periodFrom: '2026-01-01', periodTo: '2026-01-31', file }).subscribe();
    const [path, body, options] = api.post.mock.calls[0] as unknown as [string, FormData, { notifyError: boolean }];
    expect(path).toBe('/upl/packages');
    expect(options).toEqual({ notifyError: false });
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('sourceId')).toBe('7');
    expect(body.get('periodFrom')).toBe('2026-01-01');
    expect(body.get('periodTo')).toBe('2026-01-31');
    expect((body.get('file') as File).name).toBe('report.xlsx');
    expect([...body.keys()]).toHaveLength(4);
  });

  it('reads the errors of one package by its identifier', () => {
    const { service, api } = create();
    service.errors('1a2b/3c').subscribe();
    expect(api.get).toHaveBeenCalledWith('/upl/packages/1a2b%2F3c/errors', undefined, { notifyError: false });
  });

  it('applies one package with a POST and returns what the server sends', () => {
    const { service, api } = create();
    const item = { id: 'p-1', status: 'applied' } as UplPackageItem;
    api.post.mockReturnValue(of(item) as Observable<unknown>);
    let seen: UplPackageItem | undefined;
    service.apply('p-1').subscribe(value => (seen = value));
    expect(api.post).toHaveBeenCalledWith('/upl/packages/p-1/apply', null, { notifyError: false });
    expect(seen).toBe(item);
  });

  it('joins every page of sources and stops when the server has no more', () => {
    const { service, upl } = create({
      sourcePages: [sourcePage([source(1), source(2)], true, 'c-2'), sourcePage([source(3)], false, null)]
    });
    let result: UplSourceItem[] = [];
    service.allSources().subscribe(items => (result = items));
    expect(result.map(item => item.id)).toEqual([1, 2, 3]);
    expect(upl.listSources).toHaveBeenCalledTimes(2);
    expect(upl.listSources).toHaveBeenNthCalledWith(1, 200);
    expect(upl.listSources).toHaveBeenNthCalledWith(2, 200, 'c-2');
  });

  it('returns what the server sends for a package and for its errors', () => {
    const { service, api } = create();
    const item = { id: 'p-1', status: 'received' } as UplPackageItem;
    const errors = { total: 0, shown: 0, items: [] } as UplPackageErrors;
    api.get.mockReturnValue(of(errors) as Observable<unknown>);
    api.post.mockReturnValue(of(item) as Observable<unknown>);
    const seen: unknown[] = [];
    service.upload({ sourceId: 1, periodFrom: '2026-01-01', periodTo: '2026-01-31', file: xlsx() })
      .subscribe(value => seen.push(value));
    service.errors('p-1').subscribe(value => seen.push(value));
    expect(seen).toEqual([item, errors]);
  });
});
