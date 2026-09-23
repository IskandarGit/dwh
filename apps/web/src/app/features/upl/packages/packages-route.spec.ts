import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, Route, Router, RouterStateSnapshot } from '@angular/router';
import { firstValueFrom, isObservable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../../app.routes';
import { PermissionService } from '../../../core/services/permission.service';
import { ModuleService } from '../../../core/services/module.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/services/i18n.service';

function packagesRoute(): Route | undefined {
  const shell = routes.find(route => route.path === '');
  return (shell?.children ?? []).find(route => route.path === 'upl/packages');
}

describe('upl packages route', () => {
  let permissions: PermissionService;
  let activeModules: Set<string>;

  beforeEach(() => {
    activeModules = new Set(['upl']);
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

  it('declares the packages route with two guards', () => {
    const route = packagesRoute();

    expect(route).toBeDefined();
    expect(route?.pathMatch).toBe('full');
    expect(route?.canActivate?.length).toBe(2);
    expect(route?.loadComponent).toBeTypeOf('function');
  });

  it('blocks the packages route without permissions', async () => {
    permissions.setPermissions([]);

    expect(await runGuard(packagesRoute()!, 1)).toBe('redirect');
  });

  it('blocks the packages route when only upl.sources.view is granted', async () => {
    permissions.setPermissions(['upl.sources.view']);

    expect(await runGuard(packagesRoute()!, 1)).toBe('redirect');
  });

  it('opens the packages route with upl.packages.view', async () => {
    permissions.setPermissions(['upl.packages.view']);

    expect(await runGuard(packagesRoute()!, 1)).toBe(true);
  });

  it('passes the module guard when upl is active', async () => {
    expect(await runGuard(packagesRoute()!, 0)).toBe(true);
  });

  it('redirects the packages route to tasks when the upl module is disabled', async () => {
    activeModules = new Set(['notes']);

    expect(await runGuard(packagesRoute()!, 0)).toBe('to-tasks');
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
