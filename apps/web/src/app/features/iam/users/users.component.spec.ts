import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { User } from '../../../core/models/auth.models';
import { I18nService } from '../../../core/services/i18n.service';
import { signal } from '@angular/core';
import { UsersComponent } from './users.component';
import { translateTest } from '../../../../testing/i18n-test.stub';
import { UserOrgUnitsPanelComponent } from '../org-units/public-api';

describe('UsersComponent UI contracts', () => {
  async function createFixture() {
    await TestBed.configureTestingModule({
      imports: [UsersComponent],
      providers: [
        {
          provide: ApiService,
          useValue: {
            get: vi.fn((path: string) => of(path === '/iam/users'
              ? { items: [], nextCursor: null, hasMore: false }
              : [])),
            post: vi.fn(() => of({})),
            patch: vi.fn(() => of({})),
            put: vi.fn(() => of({})),
            delete: vi.fn(() => of({}))
          }
        },
        {
          provide: I18nService,
          useValue: {
            languages: signal([
              { code: 'ru', name: 'Русский', active: true },
              { code: 'de', name: 'Deutsch', active: true },
              { code: 'tr', name: 'Türkçe', active: true }
            ]),
            translate: translateTest
          }
        },
        { provide: ToastService, useValue: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }
      ]
    }).compileComponents();
    TestBed.inject(PermissionService).setPermissions(['*.*']);
    const fixture = TestBed.createComponent(UsersComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('labels filters and exposes explicit table interactions', async () => {
    const fixture = await createFixture();
    const user: User = {
      id: 7,
      name: 'Анна Иванова',
      login: 'anna',
      email: 'anna@example.test',
      state: 'A',
      language: 'ru',
      timezone: 'Asia/Tashkent',
      attributes: {},
      is2faEnabled: false,
      forcePasswordChange: false,
      createdAt: '2026-08-30T00:00:00Z',
      modifiedAt: '2026-08-30T00:00:00Z'
    };
    fixture.componentInstance.users.set([user]);
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector('#user-search') as HTMLInputElement;
    const region = fixture.nativeElement.querySelector('.table-container[role="region"]') as HTMLElement;
    const identity = fixture.nativeElement.querySelector('.user-identity') as HTMLElement;

    expect(fixture.nativeElement.querySelector(`label[for="${search.id}"]`)).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="group"][aria-label="Фильтр пользователей по статусу"]')).not.toBeNull();
    expect(region.tabIndex).toBe(0);
    expect(region.querySelector('table')?.getAttribute('aria-label')).toBe('Список пользователей');
    expect(identity.tagName).toBe('BUTTON');
    expect(fixture.nativeElement.querySelector('button[aria-label="Редактировать пользователя Анна Иванова"]')).not.toBeNull();
  });

  it('connects required create-user fields to inline validation', async () => {
    const fixture = await createFixture();
    fixture.componentInstance.openCreateModal();
    (fixture.componentInstance as any).isCreateSubmitted = true;
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('#user-create-name') as HTMLInputElement;
    const password = fixture.nativeElement.querySelector('#user-create-password') as HTMLInputElement;

    expect(fixture.nativeElement.querySelector(`label[for="${name.id}"]`)).not.toBeNull();
    expect(name.required).toBe(true);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBe('user-create-name-error');
    expect(password.required).toBe(true);
    expect(fixture.nativeElement.querySelector('button[aria-label="Показать пароль"]')).not.toBeNull();
    const language = fixture.nativeElement.querySelector('#user-create-language') as HTMLSelectElement;
    expect(Array.from(language.options).map(option => option.value)).toEqual(['ru', 'de', 'tr']);
  });

  it('keeps a dirty organization draft mounted until Escape or record selection is decided', async () => {
    const fixture = await createFixture();
    const api = TestBed.inject(ApiService) as unknown as { get: ReturnType<typeof vi.fn> };
    const first = user(7, 'Анна');
    const second = user(8, 'Борис');
    api.get.mockImplementation((path: string) => of(orgResponse(path, first)));

    fixture.componentInstance.openViewModal(first);
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.directive(UserOrgUnitsPanelComponent)).componentInstance as UserOrgUnitsPanelComponent;
    (fixture.nativeElement.querySelector('[data-check="2"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(panel.hasUnsavedWork()).toBe(true);
    expect(fixture.nativeElement.querySelector('.expand[aria-expanded="true"]')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.viewingUser?.id).toBe(first.id);
    expect(fixture.componentInstance.isViewModalOpen()).toBe(true);
    expect(panel.discard.open()).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('[role="dialog"]')).toHaveLength(2);

    panel.discard.cancel();
    fixture.componentInstance.openViewModal(second);
    fixture.detectChanges();
    expect(fixture.componentInstance.viewingUser?.id).toBe(first.id);
    expect(panel.discard.open()).toBe(true);

    panel.discard.confirm();
    fixture.detectChanges();
    expect(fixture.componentInstance.viewingUser?.id).toBe(second.id);
    expect(fixture.debugElement.query(By.directive(UserOrgUnitsPanelComponent)).componentInstance.userId).toBe(second.id);
  });

  it('rejects record replacement while assignment save is pending and ignores a leave decision after destruction', async () => {
    const fixture = await createFixture();
    const api = TestBed.inject(ApiService) as unknown as {
      get: ReturnType<typeof vi.fn>;
      put: ReturnType<typeof vi.fn>;
    };
    const write = new Subject<void>();
    const first = user(7, 'Анна');
    const second = user(8, 'Борис');
    api.get.mockImplementation((path: string) => of(orgResponse(path, first)));
    api.put.mockReturnValue(write.asObservable());

    fixture.componentInstance.openViewModal(first);
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.directive(UserOrgUnitsPanelComponent)).componentInstance as UserOrgUnitsPanelComponent;
    (fixture.nativeElement.querySelector('[data-check="2"]') as HTMLInputElement).click();
    panel.save();
    fixture.componentInstance.openViewModal(second);
    fixture.detectChanges();
    expect(panel.pending).toBe(true);
    expect(fixture.componentInstance.viewingUser?.id).toBe(first.id);
    expect(panel.discard.open()).toBe(false);

    write.error({ status: 409, detail: 'retry' });
    fixture.componentInstance.openViewModal(second);
    expect(panel.discard.open()).toBe(true);
    fixture.destroy();
    panel.discard.confirm();
    expect(fixture.componentInstance.viewingUser?.id).toBe(first.id);
  });

  it.each(['success', 'error'] as const)(
    'retains the real assignment panel through view revocation and ignores the old %s result',
    async outcome => {
      const fixture = await createFixture();
      const api = TestBed.inject(ApiService) as unknown as {
        get: ReturnType<typeof vi.fn>;
        put: ReturnType<typeof vi.fn>;
      };
      const permissions = TestBed.inject(PermissionService);
      const toast = TestBed.inject(ToastService) as unknown as { success: ReturnType<typeof vi.fn> };
      const write = new Subject<void>();
      const first = user(7, 'Анна');
      const second = user(8, 'Борис');
      api.get.mockImplementation((path: string) => of(orgResponse(path, first)));
      api.put.mockReturnValue(write.asObservable());

      fixture.componentInstance.openViewModal(first);
      fixture.detectChanges();
      const panel = fixture.debugElement.query(By.directive(UserOrgUnitsPanelComponent)).componentInstance as UserOrgUnitsPanelComponent;
      (fixture.nativeElement.querySelector('[data-check="2"]') as HTMLInputElement).click();
      fixture.componentInstance.openViewModal(second);
      expect(panel.discard.open()).toBe(true);
      panel.discard.cancel();
      panel.save();
      const readsBeforeRevocation = api.get.mock.calls.filter(([path]) => String(path).startsWith('/iam/org-units')).length;

      permissions.setPermissions(['iam.users.view', 'iam.users.update', 'iam.org_units.assign']);
      fixture.detectChanges();

      const retained = fixture.debugElement.query(By.directive(UserOrgUnitsPanelComponent));
      expect(retained?.componentInstance).toBe(panel);
      expect(panel.pending).toBe(true);
      expect(write.observed).toBe(true);
      expect(fixture.componentInstance.orgPanelBusy()).toBe(true);
      expect(panel.discard.open()).toBe(false);
      expect(fixture.nativeElement.querySelector('app-user-org-units-panel input[data-check]')).toBeNull();
      expect(fixture.nativeElement.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(fixture.nativeElement.textContent).not.toContain('Компания');
      expect(fixture.componentInstance.canLeaveRecordPage()).toBe(false);

      fixture.componentInstance.closeRecordView();
      fixture.componentInstance.openViewModal(second);
      fixture.componentInstance.openEditFromView();
      expect(fixture.componentInstance.isViewModalOpen()).toBe(true);
      expect(fixture.componentInstance.isEditModalOpen()).toBe(false);
      expect(fixture.componentInstance.viewingUser?.id).toBe(first.id);

      permissions.setPermissions(['*.*']);
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.directive(UserOrgUnitsPanelComponent)).componentInstance).toBe(panel);
      expect(api.get.mock.calls.filter(([path]) => String(path).startsWith('/iam/org-units'))).toHaveLength(readsBeforeRevocation);
      panel.save();
      expect(api.put).toHaveBeenCalledTimes(1);

      if (outcome === 'success') {
        write.next();
        write.complete();
      } else {
        write.error({ status: 409, detail: 'Late revoked assignment failure' });
      }
      fixture.detectChanges();

      expect(panel.pending).toBe(false);
      expect(fixture.componentInstance.orgPanelBusy()).toBe(false);
      expect(panel.units).toEqual([]);
      expect(panel.selectedOrgUnitIds()).toEqual([]);
      expect(panel.saveError).toBeNull();
      expect(toast.success).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).not.toContain('Late revoked assignment failure');

      panel.reloadAll();
      fixture.detectChanges();
      expect(api.get.mock.calls.filter(([path]) => String(path).startsWith('/iam/org-units'))).toHaveLength(readsBeforeRevocation + 3);
      expect(panel.units.map(unit => unit.id)).toEqual([1, 2]);
    }
  );

  it('mounts the organization panel for a safe deep-linked user record', async () => {
    const fixture = await createFixture();
    const api = TestBed.inject(ApiService) as unknown as { get: ReturnType<typeof vi.fn> };
    const first = user(7, 'Анна');
    api.get.mockImplementation((path: string) => of(orgResponse(path, first)));

    fixture.componentInstance.loadRecordView('7');
    fixture.detectChanges();

    const panel = fixture.debugElement.query(By.directive(UserOrgUnitsPanelComponent)).componentInstance as UserOrgUnitsPanelComponent;
    expect(fixture.componentInstance.routeRecordId()).toBe('7');
    expect(panel.userId).toBe(7);
  });

  it('guards a same-ID deep-link reload before clearing its dirty panel', async () => {
    const fixture = await createFixture();
    const api = TestBed.inject(ApiService) as unknown as { get: ReturnType<typeof vi.fn> };
    const first = user(7, 'Анна');
    api.get.mockImplementation((path: string) => of(orgResponse(path, first)));
    fixture.componentInstance.loadRecordView('7');
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.directive(UserOrgUnitsPanelComponent)).componentInstance as UserOrgUnitsPanelComponent;
    (fixture.nativeElement.querySelector('[data-check="2"]') as HTMLInputElement).click();
    const readsBeforeReload = api.get.mock.calls.filter(([path]) => path === '/iam/users/7').length;

    fixture.componentInstance.openViewModal(first);

    expect(fixture.componentInstance.viewingUser?.id).toBe(first.id);
    expect(panel.discard.open()).toBe(true);
    expect(api.get.mock.calls.filter(([path]) => path === '/iam/users/7')).toHaveLength(readsBeforeReload);
    panel.discard.cancel();
    expect(panel.hasUnsavedWork()).toBe(true);
  });

  it('guards a direct deep-link reload requested while the mounted organization panel is dirty', async () => {
    const fixture = await createFixture();
    const api = TestBed.inject(ApiService) as unknown as { get: ReturnType<typeof vi.fn> };
    const first = user(7, 'Анна');
    api.get.mockImplementation((path: string) => of(orgResponse(path, first)));
    fixture.componentInstance.loadRecordView('7');
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.directive(UserOrgUnitsPanelComponent)).componentInstance as UserOrgUnitsPanelComponent;
    (fixture.nativeElement.querySelector('[data-check="2"]') as HTMLInputElement).click();
    const readsBeforeReload = api.get.mock.calls.filter(([path]) => path === '/iam/users/7').length;

    fixture.componentInstance.closeEditModal();

    expect(panel.discard.open()).toBe(true);
    expect(panel.hasUnsavedWork()).toBe(true);
    expect(fixture.componentInstance.viewingUser?.id).toBe(first.id);
    expect(api.get.mock.calls.filter(([path]) => path === '/iam/users/7')).toHaveLength(readsBeforeReload);
  });

  it.each(['dirty', 'pending'] as const)(
    'does not let a delayed profile save replace a newer %s organization panel after edit cancellation',
    async panelState => {
      const fixture = await createFixture();
      const api = TestBed.inject(ApiService) as unknown as {
        get: ReturnType<typeof vi.fn>;
        patch: ReturnType<typeof vi.fn>;
        put: ReturnType<typeof vi.fn>;
      };
      const profileSave = new Subject<void>();
      const assignmentSave = new Subject<void>();
      const first = user(7, 'Анна');
      api.get.mockImplementation((path: string) => of(orgResponse(path, first)));
      api.patch.mockReturnValue(profileSave.asObservable());
      api.put.mockReturnValue(assignmentSave.asObservable());
      fixture.componentInstance.loadRecordView('7');
      fixture.detectChanges();

      fixture.componentInstance.openEditFromView();
      fixture.componentInstance.submitEditUser();
      fixture.componentInstance.closeEditModal();
      fixture.detectChanges();
      const newerPanel = fixture.debugElement.query(By.directive(UserOrgUnitsPanelComponent)).componentInstance as UserOrgUnitsPanelComponent;
      (fixture.nativeElement.querySelector('[data-check="2"]') as HTMLInputElement).click();
      if (panelState === 'pending') newerPanel.save();
      const readsBeforeProfileSettlement = api.get.mock.calls.filter(([path]) => path === '/iam/users/7').length;

      profileSave.next();
      profileSave.complete();
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.directive(UserOrgUnitsPanelComponent)).componentInstance).toBe(newerPanel);
      expect(fixture.componentInstance.viewingUser?.id).toBe(first.id);
      expect(api.get.mock.calls.filter(([path]) => path === '/iam/users/7')).toHaveLength(readsBeforeProfileSettlement);
      expect(newerPanel.pending).toBe(panelState === 'pending');
      expect(newerPanel.hasUnsavedWork()).toBe(true);
    }
  );

  it('keeps the shared submitting state owned by the newest edit save', async () => {
    const fixture = await createFixture();
    const api = TestBed.inject(ApiService) as unknown as {
      get: ReturnType<typeof vi.fn>;
      patch: ReturnType<typeof vi.fn>;
    };
    const firstSave = new Subject<void>();
    const newerSave = new Subject<void>();
    const first = user(7, 'Анна');
    api.get.mockImplementation((path: string) => of(orgResponse(path, first)));
    api.patch.mockReturnValueOnce(firstSave.asObservable()).mockReturnValueOnce(newerSave.asObservable());
    fixture.componentInstance.loadRecordView('7');
    fixture.detectChanges();

    fixture.componentInstance.openEditFromView();
    fixture.componentInstance.submitEditUser();
    fixture.componentInstance.closeEditModal();
    fixture.detectChanges();
    fixture.componentInstance.openEditFromView();
    fixture.componentInstance.submitEditUser();

    firstSave.next();

    expect(fixture.componentInstance.isSubmitting()).toBe(true);
    expect(fixture.componentInstance.isEditModalOpen()).toBe(true);
    expect(fixture.componentInstance.editingUser?.id).toBe(first.id);

    newerSave.next();
    expect(fixture.componentInstance.isSubmitting()).toBe(false);
    expect(fixture.componentInstance.isEditModalOpen()).toBe(false);
  });

  it('evaluates password strength and requirements checklist dynamically', async () => {
    const fixture = await createFixture();
    fixture.componentInstance.openCreateModal();
    fixture.componentInstance.createForm.login = 'john';

    fixture.componentInstance.createForm.password = 'short';
    expect(fixture.componentInstance.hasMinLength()).toBe(false);
    expect(fixture.componentInstance.passwordStrength().score).toBe(1);

    fixture.componentInstance.createForm.password = 'johnStrong123!';
    expect(fixture.componentInstance.doesNotContainLogin()).toBe(false);

    fixture.componentInstance.createForm.password = 'SafePass123!#';
    expect(fixture.componentInstance.hasMinLength()).toBe(true);
    expect(fixture.componentInstance.hasUpperAndLower()).toBe(true);
    expect(fixture.componentInstance.hasDigitsOrSymbols()).toBe(true);
    expect(fixture.componentInstance.doesNotContainLogin()).toBe(true);
    expect(fixture.componentInstance.passwordStrength().score).toBe(4);
  });

  it('switches to security tab and loads security summary for viewing user', async () => {
    const fixture = await createFixture();
    const api = TestBed.inject(ApiService) as unknown as {
      get: ReturnType<typeof vi.fn>;
    };
    const targetUser = user(15, 'Дмитрий');
    const mockSecurity = {
      userId: 15,
      login: 'dmitriy',
      is2faEnabled: true,
      forcePasswordChange: false,
      authVersion: 2,
      activeSessionsCount: 1,
      activeSessions: [
        { id: 101, userId: 15, ip: '127.0.0.1', userAgent: 'Chrome', deviceInfo: 'Desktop', createdAt: '2026-09-09T00:00:00Z', lastSeenAt: '2026-09-09T00:00:00Z' }
      ],
      recentLoginAttempts: [
        { id: 201, login: 'dmitriy', ip: '127.0.0.1', isSuccess: true, attemptAt: '2026-09-09T00:00:00Z' }
      ]
    };

    api.get.mockImplementation((path: string) => {
      if (path === '/iam/users/15/security') return of(mockSecurity);
      return of(orgResponse(path, targetUser));
    });

    fixture.componentInstance.openViewModal(targetUser);
    fixture.detectChanges();
    expect(fixture.componentInstance.activeViewTab()).toBe('info');

    fixture.componentInstance.switchViewTab('security', targetUser.id);
    fixture.detectChanges();

    expect(fixture.componentInstance.activeViewTab()).toBe('security');
    expect(fixture.componentInstance.userSecurity()?.userId).toBe(15);
    expect(fixture.componentInstance.userSecurity()?.activeSessionsCount).toBe(1);
    expect(fixture.componentInstance.userSecurity()?.recentLoginAttempts.length).toBe(1);
  });

  it('loadMore appends users using nextCursor and updates hasMore flag', async () => {
    const fixture = await createFixture();
    const api = TestBed.inject(ApiService) as unknown as {
      get: ReturnType<typeof vi.fn>;
    };

    const user1 = user(1, 'Пользователь 1');
    const user2 = user(2, 'Пользователь 2');

    api.get.mockReturnValueOnce(of({ items: [user1], nextCursor: 'cursor_abc', hasMore: true }));
    fixture.componentInstance.loadUsers(true);

    expect(fixture.componentInstance.users().length).toBe(1);
    expect(fixture.componentInstance.hasMore()).toBe(true);
    expect(fixture.componentInstance.nextCursor).toBe('cursor_abc');

    api.get.mockReturnValueOnce(of({ items: [user2], nextCursor: null, hasMore: false }));
    fixture.componentInstance.loadMore();

    expect(api.get).toHaveBeenCalledWith('/iam/users', expect.objectContaining({ cursor: 'cursor_abc', limit: 50 }));
    expect(fixture.componentInstance.users().length).toBe(2);
    expect(fixture.componentInstance.hasMore()).toBe(false);
  });

  it('generateSecurePassword generates a 14-char password meeting all complexity rules', async () => {
    const fixture = await createFixture();
    fixture.componentInstance.createForm.login = 'testuser';

    const generated = fixture.componentInstance.generateSecurePassword();

    expect(generated.length).toBe(14);
    expect(fixture.componentInstance.createForm.password).toBe(generated);
    expect(fixture.componentInstance.hasMinLength()).toBe(true);
    expect(fixture.componentInstance.hasUpperAndLower()).toBe(true);
    expect(fixture.componentInstance.hasDigitsOrSymbols()).toBe(true);
    expect(fixture.componentInstance.doesNotContainLogin()).toBe(true);
    expect(fixture.componentInstance.passwordStrength().score).toBe(4);
  });

  it('copies generated password to clipboard and shows toast', async () => {
    const fixture = await createFixture();
    const toast = TestBed.inject(ToastService);
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy
      }
    });

    fixture.componentInstance.createForm.password = 'ComplexPass123!';
    await fixture.componentInstance.copyGeneratedPassword();

    expect(writeTextSpy).toHaveBeenCalledWith('ComplexPass123!');
    expect(toast.success).toHaveBeenCalled();
  });

  it('active filter pills render and allow clearing individual filters', async () => {
    const fixture = await createFixture();
    fixture.componentInstance.roles.set([{ id: 10, pcode: 'manager', name: 'Менеджер' } as any]);

    fixture.componentInstance.selectedRoleId = 10;
    fixture.componentInstance.selected2fa = true;
    fixture.componentInstance.selectedState = 'A';
    fixture.detectChanges();

    expect(fixture.componentInstance.hasAnyActiveFilters()).toBe(true);

    const pills = fixture.nativeElement.querySelectorAll('.filter-pill');
    expect(pills.length).toBe(3);

    fixture.componentInstance.clear2faFilter();
    expect(fixture.componentInstance.selected2fa).toBeNull();

    fixture.componentInstance.clearStateFilter();
    expect(fixture.componentInstance.selectedState).toBe('');

    fixture.componentInstance.resetAllFilters();
    expect(fixture.componentInstance.selectedRoleId).toBeNull();
    expect(fixture.componentInstance.hasAnyActiveFilters()).toBe(false);
  });

  it('security confirmation modal triggers action on confirm without window.confirm', async () => {
    const fixture = await createFixture();
    const api = TestBed.inject(ApiService) as unknown as {
      delete: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
    };
    const confirmSpy = vi.spyOn(window, 'confirm');
    api.delete.mockReturnValue(of({}));

    fixture.componentInstance.terminateUserSessions(42);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(fixture.componentInstance.isSecConfirmModalOpen()).toBe(true);
    expect(fixture.componentInstance.secConfirmConfig).not.toBeNull();
    expect(fixture.componentInstance.secConfirmConfig?.confirmBtnVariant).toBe('danger');

    fixture.componentInstance.confirmSecurityAction();
    expect(api.delete).toHaveBeenCalledWith('/iam/users/42/sessions');

    confirmSpy.mockRestore();
  });

  function user(id: number, name: string): User {
    return {
      id, name, login: name.toLowerCase(), email: `${name.toLowerCase()}@example.test`, state: 'A',
      language: 'ru', timezone: 'Asia/Tashkent', attributes: {}, roleIds: [], is2faEnabled: false,
      forcePasswordChange: false, createdAt: '2026-08-30T00:00:00Z', modifiedAt: '2026-08-30T00:00:00Z'
    };
  }

  function orgResponse(path: string, selected: User): unknown {
    if (path === `/iam/users/${selected.id}`) return selected;
    if (path === '/iam/org-units') return [
      { id: 1, parentId: null, code: 'ROOT', name: 'Компания', kind: 'company', state: 'A', orderNo: 0, createdAt: '', modifiedAt: '' },
      { id: 2, parentId: 1, code: 'OPS', name: 'Операции', kind: 'department', state: 'A', orderNo: 0, createdAt: '', modifiedAt: '' }
    ];
    const assignments = path.match(/^\/iam\/org-units\/users\/(\d+)$/);
    if (assignments) return { userId: Number(assignments[1]), orgUnitIds: [], legacyOrgUnitId: null };
    if (/^\/iam\/org-units\/users\/\d+\/scope$/.test(path)) return { rule: 'ALL', visibleOrgUnitIds: [] };
    return [];
  }
});
