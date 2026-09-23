import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, Route, Router, RouterStateSnapshot } from '@angular/router';
import { firstValueFrom, isObservable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app.routes';
import { PermissionService } from '../../core/services/permission.service';
import { ModuleService } from '../../core/services/module.service';
import { ToastService } from '../../core/services/toast.service';
import { I18nService } from '../../core/services/i18n.service';

function dataOverviewRoute(): Route | undefined {
  const shell = routes.find(route => route.path === '');
  return (shell?.children ?? []).find(route => route.path === 'ovw/data');
}

describe('ovw data overview route', () => {
  let permissions: PermissionService;
  let activeModules: Set<string>;

  beforeEach(() => {
    activeModules = new Set(['ovw']);
    TestBed.configureTestingModule({
      providers: [
        PermissionService,
        { provide: Router, useValue: { createUrlTree: (commands: unknown[]) => (commands[0] === '/tasks' ? 'to-tasks' : 'redirect') } },
        {
          provide: ModuleService,
          useValue: {
            isLoaded: () => true,
            isModuleActive: (code: string) => activeModules.has(code),
            loadActiveModules: () => of([])
          }
        },
        { provide: ToastService, useValue: { warning: vi.fn() } },
        { provide: I18nService, useValue: { translate: (key: string) => key } }
      ]
    });
    permissions = TestBed.inject(PermissionService);
  });

  it('declares the data overview route with two guards', () => {
    const route = dataOverviewRoute();

    expect(route).toBeDefined();
    expect(route?.pathMatch).toBe('full');
    expect(route?.canActivate?.length).toBe(2);
    expect(route?.loadComponent).toBeTypeOf('function');
  });

  it('blocks the data overview route without permissions', async () => {
    permissions.setPermissions([]);

    expect(await runGuard(dataOverviewRoute()!, 1)).toBe('redirect');
  });

  it('blocks the data overview route when only upl.packages.view is granted', async () => {
    permissions.setPermissions(['upl.packages.view']);

    expect(await runGuard(dataOverviewRoute()!, 1)).toBe('redirect');
  });

  it('opens the data overview route with ovw.data.view', async () => {
    permissions.setPermissions(['ovw.data.view']);

    expect(await runGuard(dataOverviewRoute()!, 1)).toBe(true);
  });

  it('passes the module guard when ovw is active', async () => {
    expect(await runGuard(dataOverviewRoute()!, 0)).toBe(true);
  });

  it('redirects the data overview route to tasks when the ovw module is disabled', async () => {
    activeModules = new Set(['upl']);

    expect(await runGuard(dataOverviewRoute()!, 0)).toBe('to-tasks');
  });

  async function runGuard(route: Route, index: number): Promise<unknown> {
    const guard = route.canActivate?.[index] as CanActivateFn | undefined;
    expect(guard).toBeTypeOf('function');
    const result = TestBed.runInInjectionContext(() => guard!(
      {} as ActivatedRouteSnapshot,
      {} as RouterStateSnapshot
    ));
    return isObservable(result) ? await firstValueFrom(result) : result;
  }
});
