import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, Route, Router, RouterStateSnapshot, UrlSegment } from '@angular/router';
import { firstValueFrom, isObservable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app.routes';
import { PermissionService } from '../../core/services/permission.service';
import { ModuleService } from '../../core/services/module.service';
import { ToastService } from '../../core/services/toast.service';
import { I18nService } from '../../core/services/i18n.service';
import { uplFormatMatcher, uplSourceMatcher } from './upl-routes';

function segments(url: string): UrlSegment[] {
  return url.split('/').filter(Boolean).map(part => new UrlSegment(part, {}));
}

function uplRoutes(): Route[] {
  const shell = routes.find(route => route.path === '');
  return (shell?.children ?? []).filter(route =>
    route.path === 'upl/sources' || route.matcher === uplSourceMatcher || route.matcher === uplFormatMatcher);
}

describe('upl routes', () => {
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

  it('has three upl routes and each is guarded', () => {
    const found = uplRoutes();

    expect(found.length).toBe(3);
    for (const route of found) {
      expect(route.canActivate?.length).toBe(2);
    }
  });

  it('blocks every upl route without upl.sources.view', async () => {
    permissions.setPermissions([]);

    for (const route of uplRoutes()) {
      expect(await runGuard(route, 1)).toBe('redirect');
    }
  });

  it('opens every upl route with upl.sources.view only', async () => {
    permissions.setPermissions(['upl.sources.view']);

    for (const route of uplRoutes()) {
      expect(await runGuard(route, 1)).toBe(true);
    }
  });

  it('redirects every upl route to tasks when the upl module is disabled', async () => {
    activeModules = new Set(['notes']);

    for (const route of uplRoutes()) {
      expect(await runGuard(route, 0)).toBe('to-tasks');
    }
  });

  it('passes the module guard on every upl route when upl is active', async () => {
    for (const route of uplRoutes()) {
      expect(await runGuard(route, 0)).toBe(true);
    }
  });

  it('matches the card and the version urls and rejects a bad id', () => {
    const card = uplSourceMatcher(segments('upl/sources/7'), {} as never, {} as never);
    const version = uplFormatMatcher(segments('upl/sources/7/formats/2'), {} as never, {} as never);

    expect(card?.posParams?.['id'].path).toBe('7');
    expect(version?.posParams?.['id'].path).toBe('7');
    expect(version?.posParams?.['v'].path).toBe('2');
    expect(uplSourceMatcher(segments('upl/sources/abc'), {} as never, {} as never)).toBeNull();
    expect(uplFormatMatcher(segments('upl/sources/7/formats/0'), {} as never, {} as never)).toBeNull();
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
