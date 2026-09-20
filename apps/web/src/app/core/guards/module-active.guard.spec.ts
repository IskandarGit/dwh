import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { of, firstValueFrom, isObservable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { moduleActiveGuard } from './module-active.guard';
import { ModuleService } from '../services/module.service';
import { ToastService } from '../services/toast.service';
import { I18nService } from '../services/i18n.service';

describe('moduleActiveGuard', () => {
  const dummyRoute = {} as ActivatedRouteSnapshot;
  const dummyState = {} as RouterStateSnapshot;

  function setup(overrides: {
    isLoaded?: boolean;
    isModuleActive?: (code: string) => boolean;
    loadActiveModules?: () => any;
  } = {}) {
    const moduleService = {
      isLoaded: vi.fn(() => overrides.isLoaded ?? true),
      isModuleActive: vi.fn(overrides.isModuleActive ?? ((code: string) => code === 'notes')),
      loadActiveModules: vi.fn(overrides.loadActiveModules ?? (() => of([])))
    };
    const toastService = {
      warning: vi.fn(),
      success: vi.fn(),
      error: vi.fn()
    };
    const i18nService = {
      translate: vi.fn((key: string) => `translated:${key}`)
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ModuleService, useValue: moduleService },
        { provide: ToastService, useValue: toastService },
        { provide: I18nService, useValue: i18nService }
      ]
    });

    const router = TestBed.inject(Router);
    return { moduleService, toastService, i18nService, router };
  }

  it('allows navigation when module is loaded and active', async () => {
    const { moduleService, toastService } = setup({ isLoaded: true, isModuleActive: () => true });

    const guard = moduleActiveGuard('notes');
    const result = TestBed.runInInjectionContext(() => guard(dummyRoute, dummyState));

    const value = isObservable(result) ? await firstValueFrom(result) : result;
    expect(value).toBe(true);
    expect(toastService.warning).not.toHaveBeenCalled();
  });

  it('redirects to /tasks and shows toast warning when module is loaded but disabled', async () => {
    const { moduleService, toastService, router } = setup({ isLoaded: true, isModuleActive: () => false });

    const guard = moduleActiveGuard('notes');
    const result = TestBed.runInInjectionContext(() => guard(dummyRoute, dummyState));

    const value = isObservable(result) ? await firstValueFrom(result) : result;
    expect(value instanceof UrlTree).toBe(true);
    expect((value as UrlTree).toString()).toBe('/tasks');
    expect(toastService.warning).toHaveBeenCalled();
  });

  it('loads active modules before checking if service is not yet loaded', async () => {
    let active = false;
    const { moduleService, toastService } = setup({
      isLoaded: false,
      isModuleActive: () => active,
      loadActiveModules: () => {
        active = true;
        return of([{ code: 'notes', status: 'ACTIVE', isActive: true }]);
      }
    });

    const guard = moduleActiveGuard('notes');
    const result = TestBed.runInInjectionContext(() => guard(dummyRoute, dummyState));

    expect(moduleService.loadActiveModules).toHaveBeenCalled();
    const value = isObservable(result) ? await firstValueFrom(result) : result;
    expect(value).toBe(true);
    expect(toastService.warning).not.toHaveBeenCalled();
  });
});
