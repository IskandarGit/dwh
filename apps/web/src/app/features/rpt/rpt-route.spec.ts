import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, Route, Router, RouterStateSnapshot } from '@angular/router';
import { firstValueFrom, isObservable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app.routes';
import { recordNavigationGuard } from '../../core/guards/record-navigation.guard';
import { PermissionService } from '../../core/services/permission.service';
import { ModuleService } from '../../core/services/module.service';
import { ToastService } from '../../core/services/toast.service';
import { I18nService } from '../../core/services/i18n.service';
import { RptListPage } from './list/rpt-list.page';
import { RptViewPage } from './view/rpt-view.page';
import { RptEditPage } from './edit/rpt-edit.page';

const LIST_PATH = 'rpt/reports';
const NEW_PATH = 'rpt/reports/new';
const VIEW_PATH = 'rpt/reports/:id';
const EDIT_PATH = 'rpt/reports/:id/edit';

function shellChildren(): Route[] {
  const shell = routes.find(route => route.path === '');
  return shell?.children ?? [];
}

function reportRoute(path: string): Route {
  const route = shellChildren().find(candidate => candidate.path === path);
  expect(route).toBeDefined();
  return route!;
}

describe('rpt reports routes', () => {
  let permissions: PermissionService;
  let activeModules: Set<string>;

  beforeEach(() => {
    activeModules = new Set(['rpt']);
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

  it('declares all four report routes with a module guard, a permission guard and a lazy page', () => {
    for (const path of [LIST_PATH, NEW_PATH, VIEW_PATH, EDIT_PATH]) {
      const route = reportRoute(path);
      expect(route.pathMatch).toBe('full');
      expect(route.canActivate?.length).toBe(2);
      expect(route.loadComponent).toBeTypeOf('function');
    }
  });

  it('declares the new-report route before the report-by-id route', () => {
    const paths = shellChildren().map(route => route.path);

    expect(paths.indexOf(NEW_PATH)).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf(NEW_PATH)).toBeLessThan(paths.indexOf(VIEW_PATH));
  });

  it('guards unsaved changes on the new and edit routes only', () => {
    expect(reportRoute(NEW_PATH).canDeactivate).toEqual([recordNavigationGuard]);
    expect(reportRoute(EDIT_PATH).canDeactivate).toEqual([recordNavigationGuard]);
    expect(reportRoute(LIST_PATH).canDeactivate).toBeUndefined();
    expect(reportRoute(VIEW_PATH).canDeactivate).toBeUndefined();
  });

  it('loads the list, view and edit pages', async () => {
    expect(await loadedPage(reportRoute(LIST_PATH))).toBe(RptListPage);
    expect(await loadedPage(reportRoute(NEW_PATH))).toBe(RptEditPage);
    expect(await loadedPage(reportRoute(VIEW_PATH))).toBe(RptViewPage);
    expect(await loadedPage(reportRoute(EDIT_PATH))).toBe(RptEditPage);
  });

  it('blocks every report route without permissions', async () => {
    permissions.setPermissions([]);

    for (const path of [LIST_PATH, NEW_PATH, VIEW_PATH, EDIT_PATH]) {
      expect(await runGuard(reportRoute(path), 1)).toBe('redirect');
    }
  });

  it('opens the list and view routes with rpt.reports.view', async () => {
    permissions.setPermissions(['rpt.reports.view']);

    expect(await runGuard(reportRoute(LIST_PATH), 1)).toBe(true);
    expect(await runGuard(reportRoute(VIEW_PATH), 1)).toBe(true);
  });

  it('blocks the new and edit routes when only rpt.reports.view is granted', async () => {
    permissions.setPermissions(['rpt.reports.view']);

    expect(await runGuard(reportRoute(NEW_PATH), 1)).toBe('redirect');
    expect(await runGuard(reportRoute(EDIT_PATH), 1)).toBe('redirect');
  });

  it('opens the new and edit routes with rpt.reports.edit', async () => {
    permissions.setPermissions(['rpt.reports.view', 'rpt.reports.edit']);

    expect(await runGuard(reportRoute(NEW_PATH), 1)).toBe(true);
    expect(await runGuard(reportRoute(EDIT_PATH), 1)).toBe(true);
  });

  it('blocks the report routes when only ovw.data.view is granted', async () => {
    permissions.setPermissions(['ovw.data.view']);

    expect(await runGuard(reportRoute(LIST_PATH), 1)).toBe('redirect');
    expect(await runGuard(reportRoute(VIEW_PATH), 1)).toBe('redirect');
  });

  it('passes the module guard when rpt is active', async () => {
    for (const path of [LIST_PATH, NEW_PATH, VIEW_PATH, EDIT_PATH]) {
      expect(await runGuard(reportRoute(path), 0)).toBe(true);
    }
  });

  it('redirects every report route to tasks when the rpt module is disabled', async () => {
    activeModules = new Set(['ovw']);

    for (const path of [LIST_PATH, NEW_PATH, VIEW_PATH, EDIT_PATH]) {
      expect(await runGuard(reportRoute(path), 0)).toBe('to-tasks');
    }
  });

  async function loadedPage(route: Route): Promise<unknown> {
    return await route.loadComponent!();
  }

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
