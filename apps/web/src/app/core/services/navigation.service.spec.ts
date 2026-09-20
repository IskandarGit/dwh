import { TestBed } from '@angular/core/testing';
import { of, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from './api.service';
import { NavigationService } from './navigation.service';
import { CustomNavigationItem, CreateNavigationItemPayload, UpdateNavigationItemPayload } from '../models/navigation.models';

describe('NavigationService', () => {
  const sampleItem: CustomNavigationItem = {
    id: 1,
    code: 'superset-sales',
    title: 'Отчет по продажам (Superset)',
    sectionId: 'custom-reports',
    icon: 'bar-chart',
    targetType: 'EMBEDDED_IFRAME',
    url: 'https://superset.example.com/superset/dashboard/sales/',
    openInIframe: true,
    sortOrder: 10,
    state: 'A',
    createdAt: '2026-09-09T10:00:00Z',
    modifiedAt: '2026-09-09T10:00:00Z'
  };

  function setup() {
    const api = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        NavigationService,
        { provide: ApiService, useValue: api }
      ]
    });

    const service = TestBed.inject(NavigationService);
    return { service, api };
  }

  it('initializes with empty activeItems and isLoading false', () => {
    const { service } = setup();
    expect(service.activeItems()).toEqual([]);
    expect(service.isLoading()).toBe(false);
  });

  it('loads active items from backend and updates signal', async () => {
    const { service, api } = setup();
    api.get.mockReturnValue(of([sampleItem]));

    const result = await firstValueFrom(service.loadActiveItems());

    expect(api.get).toHaveBeenCalledWith('/navigation/items/active');
    expect(result).toEqual([sampleItem]);
    expect(service.activeItems()).toEqual([sampleItem]);
    expect(service.isLoading()).toBe(false);
  });

  it('loads all items for administration view', async () => {
    const { service, api } = setup();
    api.get.mockReturnValue(of([sampleItem]));

    const result = await firstValueFrom(service.loadAllItems());

    expect(api.get).toHaveBeenCalledWith('/navigation/items');
    expect(result).toEqual([sampleItem]);
  });

  it('fetches item by code', async () => {
    const { service, api } = setup();
    api.get.mockReturnValue(of(sampleItem));

    const result = await firstValueFrom(service.getItemByCode('superset-sales'));

    expect(api.get).toHaveBeenCalledWith('/navigation/items/by-code/superset-sales');
    expect(result).toEqual(sampleItem);
  });

  it('creates an item and refreshes active items', async () => {
    const { service, api } = setup();
    const payload: CreateNavigationItemPayload = {
      code: 'new-report',
      title: 'Новый отчет',
      targetType: 'EMBEDDED_IFRAME',
      url: 'https://bi.example.com',
      openInIframe: true
    };
    api.post.mockReturnValue(of({ ...sampleItem, ...payload, id: 2 }));
    api.get.mockReturnValue(of([{ ...sampleItem, ...payload, id: 2 }]));

    const created = await firstValueFrom(service.createItem(payload));

    expect(api.post).toHaveBeenCalledWith('/navigation/items', payload);
    expect(created.code).toBe('new-report');
  });

  it('updates an item', async () => {
    const { service, api } = setup();
    const payload: UpdateNavigationItemPayload = {
      title: 'Обновленное название'
    };
    api.put.mockReturnValue(of({ ...sampleItem, title: 'Обновленное название' }));
    api.get.mockReturnValue(of([]));

    const updated = await firstValueFrom(service.updateItem(1, payload));

    expect(api.put).toHaveBeenCalledWith('/navigation/items/1', payload);
    expect(updated.title).toBe('Обновленное название');
  });

  it('toggles item active state', async () => {
    const { service, api } = setup();
    api.post.mockReturnValue(of({ ...sampleItem, state: 'P' }));
    api.get.mockReturnValue(of([]));

    const toggled = await firstValueFrom(service.toggleItem(1));

    expect(api.post).toHaveBeenCalledWith('/navigation/items/1/toggle', {});
    expect(toggled.state).toBe('P');
  });

  it('deletes an item', async () => {
    const { service, api } = setup();
    api.delete.mockReturnValue(of(undefined));
    api.get.mockReturnValue(of([]));

    await firstValueFrom(service.deleteItem(1));

    expect(api.delete).toHaveBeenCalledWith('/navigation/items/1');
  });
});
