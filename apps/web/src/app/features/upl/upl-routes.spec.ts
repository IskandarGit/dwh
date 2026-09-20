import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, Route, Router, RouterStateSnapshot, UrlSegment } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app.routes';
import { PermissionService } from '../../core/services/permission.service';
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

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PermissionService,
        { provide: Router, useValue: { createUrlTree: () => 'redirect' } }
      ]
    });
    permissions = TestBed.inject(PermissionService);
  });

  it('has three upl routes and each is guarded', () => {
    const found = uplRoutes();

    expect(found.length).toBe(3);
    for (const route of found) {
      expect(route.canActivate?.length).toBe(1);
    }
  });

  it('blocks every upl route without upl.sources.view', () => {
    permissions.setPermissions([]);

    for (const route of uplRoutes()) {
      expect(runGuard(route)).toBe('redirect');
    }
  });

  it('opens every upl route with upl.sources.view only', () => {
    permissions.setPermissions(['upl.sources.view']);

    for (const route of uplRoutes()) {
      expect(runGuard(route)).toBe(true);
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

  function runGuard(route: Route): unknown {
    const guard = route.canActivate?.[0] as CanActivateFn | undefined;
    expect(guard).toBeTypeOf('function');
    return TestBed.runInInjectionContext(() => guard!(
      {} as ActivatedRouteSnapshot,
      {} as RouterStateSnapshot
    ));
  }
});
