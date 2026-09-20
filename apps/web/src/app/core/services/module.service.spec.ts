import { TestBed } from '@angular/core/testing';
import { of, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from './api.service';
import { ModuleService, InstalledModule } from './module.service';

describe('ModuleService', () => {
  function setup() {
    const api = {
      get: vi.fn(),
      post: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        ModuleService,
        { provide: ApiService, useValue: api }
      ]
    });

    const service = TestBed.inject(ModuleService);
    return { service, api };
  }

  it('initializes with system modules active and isLoaded false', () => {
    const { service } = setup();

    expect(service.isLoaded()).toBe(false);
    expect(service.isLoading()).toBe(false);
    expect(service.isModuleActive('tasks')).toBe(true);
    expect(service.isModuleActive('iam')).toBe(true);
    expect(service.isModuleActive('files')).toBe(true);
    expect(service.isModuleActive('audit')).toBe(true);
    expect(service.isModuleActive('search')).toBe(true);

    // Before loading completes, isModuleActive returns true to avoid layout flickering
    expect(service.isModuleActive('notes')).toBe(true);
  });

  it('loads active modules from backend and updates activeModuleCodes', async () => {
    const { service, api } = setup();

    const mockModules: InstalledModule[] = [
      {
        code: 'notes',
        name: 'Заметки',
        version: '1.0.0',
        route: '/notes',
        icon: 'description',
        isSystem: false,
        status: 'ACTIVE',
        isActive: true
      },
      {
        code: 'crm',
        name: 'CRM',
        version: '1.0.0',
        route: '/crm',
        icon: 'handshake',
        isSystem: false,
        status: 'ACTIVE',
        isActive: true
      }
    ];

    api.get.mockReturnValue(of(mockModules));

    const result = await firstValueFrom(service.loadActiveModules());

    expect(api.get).toHaveBeenCalledWith('/modules/active');
    expect(result).toHaveLength(2);
    expect(service.isLoaded()).toBe(true);
    expect(service.isLoading()).toBe(false);
    expect(service.isModuleActive('notes')).toBe(true);
    expect(service.isModuleActive('crm')).toBe(true);
    expect(service.isModuleActive('unknown_mod')).toBe(false);
  });

  it('filters active custom modules excluding notes and system modules', async () => {
    const { service, api } = setup();

    const mockModules: InstalledModule[] = [
      {
        code: 'notes',
        name: 'Заметки',
        version: '1.0.0',
        route: '/notes',
        icon: 'description',
        isSystem: false,
        status: 'ACTIVE',
        isActive: true
      },
      {
        code: 'crm',
        name: 'CRM',
        version: '1.0.0',
        route: '/crm',
        icon: 'handshake',
        isSystem: false,
        status: 'ACTIVE',
        isActive: true
      },
      {
        code: 'tasks',
        name: 'Задачи',
        version: '1.0.0',
        route: '/tasks',
        isSystem: true,
        status: 'ACTIVE',
        isActive: true
      }
    ];

    api.get.mockReturnValue(of(mockModules));
    await firstValueFrom(service.loadActiveModules());

    const customMods = service.getActiveCustomModules();
    expect(customMods).toHaveLength(1);
    expect(customMods[0].code).toBe('crm');
  });

  it('toggles module status and reactively updates activeModuleCodes', async () => {
    const { service, api } = setup();

    // Initial load: notes is ACTIVE
    api.get.mockReturnValue(of([
      { code: 'notes', name: 'Notes', version: '1.0', isSystem: false, status: 'ACTIVE', isActive: true }
    ]));
    await firstValueFrom(service.loadActiveModules());
    expect(service.isModuleActive('notes')).toBe(true);

    // Toggle notes to DISABLED
    api.post.mockReturnValue(of({
      code: 'notes',
      name: 'Notes',
      version: '1.0',
      isSystem: false,
      status: 'DISABLED',
      isActive: false
    }));

    await firstValueFrom(service.toggleModule('notes', false));

    expect(api.post).toHaveBeenCalledWith('/modules/notes/toggle', { enabled: false });
    expect(service.isModuleActive('notes')).toBe(false);

    // Toggle notes back to ACTIVE
    api.post.mockReturnValue(of({
      code: 'notes',
      name: 'Notes',
      version: '1.0',
      isSystem: false,
      status: 'ACTIVE',
      isActive: true
    }));

    await firstValueFrom(service.toggleModule('notes', true));

    expect(api.post).toHaveBeenCalledWith('/modules/notes/toggle', { enabled: true });
    expect(service.isModuleActive('notes')).toBe(true);
  });
});
