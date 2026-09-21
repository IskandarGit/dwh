import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { I18nService } from '../../../../core/services/i18n.service';
import { UserEffectivePermissionsPanelComponent } from './user-effective-permissions-panel.component';

describe('UserEffectivePermissionsPanelComponent', () => {
  const mockEffectivePermissions = {
    items: [
      { form: 'iam.users', action: 'view', source: 'role' },
      { form: 'iam.users', action: 'create', source: 'personal' },
      { form: 'tasks', action: 'view', source: 'role' }
    ]
  };

  const mockPersonalGrants = {
    grants: [
      { form: 'iam.users', action: 'create' }
    ]
  };

  const mockFormCatalog = [
    { formCode: 'iam.users', module: 'md', formName: 'Пользователи', action: 'view', actionName: 'Просмотр' },
    { formCode: 'iam.users', module: 'md', formName: 'Пользователи', action: 'create', actionName: 'Создание' },
    { formCode: 'iam.users', module: 'md', formName: 'Пользователи', action: 'update', actionName: 'Редактирование' },
    { formCode: 'tasks', module: 'ms.task', formName: 'Задачи', action: 'view', actionName: 'Просмотр' }
  ];

  async function createFixture(options: {
    getHandler?: (path: string) => any;
    putHandler?: (path: string, body: any) => any;
    canAssign?: boolean;
    userId?: number;
  } = {}) {
    const api = {
      get: vi.fn((path: string) => {
        if (options.getHandler) return options.getHandler(path);
        if (path === '/iam/users/10/effective-permissions') return of(mockEffectivePermissions);
        if (path === '/iam/users/10/permissions') return of(mockPersonalGrants);
        if (path === '/iam/roles/forms') return of(mockFormCatalog);
        return of([]);
      }),
      put: vi.fn((path: string, body: any) => {
        if (options.putHandler) return options.putHandler(path, body);
        return of({});
      })
    };

    const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
    const i18n = { translate: vi.fn((key: string) => key) };

    await TestBed.configureTestingModule({
      imports: [UserEffectivePermissionsPanelComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: I18nService, useValue: i18n }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(UserEffectivePermissionsPanelComponent);
    fixture.componentInstance.userId = options.userId ?? 10;
    fixture.componentInstance.canAssign = options.canAssign ?? true;
    fixture.componentInstance.userRoleNames = ['Администратор'];
    fixture.detectChanges();

    return { fixture, api, toast, i18n };
  }

  it('loads and renders effective permissions, personal grants and summary statistics', async () => {
    const { fixture, api } = await createFixture();
    const component = fixture.componentInstance;

    expect(api.get).toHaveBeenCalledWith('/iam/users/10/effective-permissions');
    expect(api.get).toHaveBeenCalledWith('/iam/users/10/permissions');
    expect(api.get).toHaveBeenCalledWith('/iam/roles/forms');

    expect(component.effectiveItems().length).toBe(3);
    expect(component.personalGrants().length).toBe(1);
    expect(component.roleCount()).toBe(2);
    expect(component.personalCount()).toBe(1);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Администратор');
    expect(host.querySelector('.stat-val.primary')?.textContent?.trim()).toBe('3');
    expect(host.querySelector('.stat-val.role')?.textContent?.trim()).toBe('2');
    expect(host.querySelector('.stat-val.personal')?.textContent?.trim()).toBe('1');
  });

  it('filters effective permissions by search query and source filter', async () => {
    const { fixture } = await createFixture();
    const component = fixture.componentInstance;

    // Default: all 3 items
    expect(component.filteredItems().length).toBe(3);

    // Search for 'tasks'
    component.searchQuery.set('tasks');
    expect(component.filteredItems().length).toBe(1);
    expect(component.filteredItems()[0].form).toBe('tasks');

    // Reset search, filter by source = 'personal'
    component.searchQuery.set('');
    component.sourceFilter.set('personal');
    expect(component.filteredItems().length).toBe(1);
    expect(component.filteredItems()[0].action).toBe('create');

    // Filter by source = 'role'
    component.sourceFilter.set('role');
    expect(component.filteredItems().length).toBe(2);
  });

  it('adds and removes personal grant drafts and updates unsaved changes state', async () => {
    const { fixture } = await createFixture({ canAssign: true });
    const component = fixture.componentInstance;

    expect(component.hasUnsavedChanges()).toBe(false);

    // Select form and action to add
    component.onFormSelect('iam.users');
    expect(component.availableActionsForSelectedForm().length).toBe(3);

    component.selectedAction.set('update');
    component.addPersonalGrant();

    expect(component.personalGrants()).toContainEqual({ form: 'iam.users', action: 'update' });
    expect(component.hasUnsavedChanges()).toBe(true);
    expect(component.personalCount()).toBe(2);

    // Remove personal grant
    component.removePersonalGrant('iam.users', 'update');
    expect(component.personalGrants()).not.toContainEqual({ form: 'iam.users', action: 'update' });
  });

  it('saves personal grants via PUT /iam/users/{userId}/permissions and displays success toast', async () => {
    const { fixture, api, toast } = await createFixture({ canAssign: true });
    const component = fixture.componentInstance;

    component.onFormSelect('iam.users');
    component.selectedAction.set('update');
    component.addPersonalGrant();

    component.savePersonalGrants();

    expect(api.put).toHaveBeenCalledWith('/iam/users/10/permissions', {
      grants: [
        { form: 'iam.users', action: 'create' },
        { form: 'iam.users', action: 'update' }
      ]
    });
    expect(toast.success).toHaveBeenCalled();
    expect(component.hasUnsavedChanges()).toBe(false);
  });

  it('handles load error gracefully with retry capability', async () => {
    let shouldFail = true;
    const { fixture, api } = await createFixture({
      getHandler: (path: string) => {
        if (path.includes('effective-permissions')) {
          return shouldFail ? throwError(() => new Error('Server error')) : of(mockEffectivePermissions);
        }
        return of([]);
      }
    });
    const component = fixture.componentInstance;

    expect(component.loadError()).toBe(true);

    // Retry load
    shouldFail = false;
    component.loadAll();

    expect(component.loadError()).toBe(false);
    expect(component.effectiveItems().length).toBe(3);
  });
});

