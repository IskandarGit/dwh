import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { PermissionService } from './core/services/permission.service';
import { recordNavigationGuard } from './core/guards/record-navigation.guard';
import { userRecordMatcher } from './core/services/search-target';
import { routes } from './app.routes';

describe('application route permissions', () => {
  let permissions: PermissionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PermissionService,
        { provide: Router, useValue: { createUrlTree: () => 'settings-redirect' } }
      ]
    });
    permissions = TestBed.inject(PermissionService);
  });

  it('prevents navigation to audit without audit.log view permission', () => {
    permissions.setPermissions([]);

    expect(runAuditGuard()).toBe('settings-redirect');
  });

  it('allows navigation to audit with audit.log view permission', () => {
    permissions.setPermissions(['audit.log.view']);

    expect(runAuditGuard()).toBe(true);
  });

  it('exposes the organization page only for view permission and protects every IAM record host', () => {
    permissions.setPermissions([]);
    expect(runOrgUnitsGuard()).toBe('settings-redirect');

    permissions.setPermissions(['iam.org_units.assign']);
    expect(runOrgUnitsGuard()).toBe('settings-redirect');

    permissions.setPermissions(['iam.org_units.view']);
    expect(runOrgUnitsGuard()).toBe(true);

    const shell = routes.find(route => route.path === '');
    const users = shell?.children?.find(route => route.matcher === userRecordMatcher);
    const rolesRoute = shell?.children?.find(route => route.path === 'iam/roles');
    const orgUnits = shell?.children?.find(route => route.path === 'iam/org-units');
    expect(users?.canDeactivate).toContain(recordNavigationGuard);
    expect(rolesRoute?.canDeactivate).toContain(recordNavigationGuard);
    expect(orgUnits?.canDeactivate).toContain(recordNavigationGuard);
  });

  function runAuditGuard(): unknown {
    const shell = routes.find(route => route.path === '');
    const audit = shell?.children?.find(route => route.path === 'audit');
    const guard = audit?.canActivate?.[0] as CanActivateFn | undefined;
    expect(guard).toBeTypeOf('function');
    return TestBed.runInInjectionContext(() => guard!(
      {} as ActivatedRouteSnapshot,
      {} as RouterStateSnapshot
    ));
  }

  function runOrgUnitsGuard(): unknown {
    const shell = routes.find(route => route.path === '');
    const orgUnits = shell?.children?.find(route => route.path === 'iam/org-units');
    const guard = orgUnits?.canActivate?.[0] as CanActivateFn | undefined;
    expect(guard).toBeTypeOf('function');
    return TestBed.runInInjectionContext(() => guard!(
      {} as ActivatedRouteSnapshot,
      {} as RouterStateSnapshot
    ));
  }
});
