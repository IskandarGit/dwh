import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { User, UserSession, ApiToken, UserChannel } from './profile.models';
import { ProfileComponent } from './profile.component';

describe('ProfileComponent UI contracts', () => {
  async function createFixture(options?: {
    sessions?: UserSession[];
    tokens?: ApiToken[];
    channels?: UserChannel[];
    mockApi?: any;
  }) {
    const user: User = {
      id: 1,
      name: 'Иван Иванов',
      login: 'ivan',
      email: 'ivan@example.test',
      state: 'A',
      language: 'ru',
      timezone: 'Asia/Tashkent',
      attributes: {},
      is2faEnabled: false,
      forcePasswordChange: false,
      createdAt: '2026-08-30T00:00:00Z',
      modifiedAt: '2026-08-30T00:00:00Z'
    };

    const apiMock = options?.mockApi || {
      get: vi.fn((url: string) => {
        if (url.includes('/sessions')) return of(options?.sessions || []);
        if (url.includes('/tokens')) return of(options?.tokens || []);
        if (url.includes('/channels')) return of(options?.channels || []);
        return of([]);
      }),
      post: vi.fn((url: string) => {
        if (url.includes('/channels/confirm')) return of(undefined);
        if (url.includes('/channels')) return of({ verifyToken: 'mock_verify_token_123' });
        return of({ record: { id: 1, name: 'test' }, rawSecretToken: 'dwh_secret_xyz' });
      }),
      delete: vi.fn(() => of({}))
    };

    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        { provide: ApiService, useValue: apiMock },
        { provide: AuthService, useValue: { currentUser: signal(user), onPasswordChanged: vi.fn() } },
        { provide: PermissionService, useValue: { hasPermission: vi.fn(() => true), permissions: signal(new Set(['*.*'])) } },
        { provide: ToastService, useValue: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(ProfileComponent);
    fixture.detectChanges();
    return { fixture, apiMock };
  }

  it('connects password fields to inline validation and password visibility', async () => {
    const { fixture } = await createFixture();
    fixture.componentInstance.submitChangePassword(new Event('submit'));
    fixture.detectChanges();

    const current = fixture.nativeElement.querySelector('#profile-current-password') as HTMLInputElement;
    expect(fixture.nativeElement.querySelector(`label[for="${current.id}"]`)).not.toBeNull();
    expect(current.required).toBe(true);
    expect(current.getAttribute('aria-invalid')).toBe('true');
    expect(current.getAttribute('aria-describedby')).toBe('profile-current-password-error');
    expect(fixture.nativeElement.querySelector('button[aria-label="Показать новый пароль"]')).not.toBeNull();
  });

  it('names channel, session and token table regions', async () => {
    const { fixture } = await createFixture();
    const regions = fixture.nativeElement.querySelectorAll('.table-wrapper[role="region"]');

    expect(regions.length).toBe(3);
    expect(regions[0].tabIndex).toBe(0);
    expect(regions[0].querySelector('table')?.getAttribute('aria-label')).toBe('Каналы связи');
    expect(regions[1].tabIndex).toBe(0);
    expect(regions[1].querySelector('table')?.getAttribute('aria-label')).toBe('Активные сессии');
    expect(regions[2].tabIndex).toBe(0);
    expect(regions[2].querySelector('table')?.getAttribute('aria-label')).toBe('API-токены');
  });

  it('validates token name inline before creation', async () => {
    const { fixture } = await createFixture();
    fixture.componentInstance.openCreateTokenModal();
    fixture.componentInstance.createTokenSubmit();
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('#profile-token-name') as HTMLInputElement;
    expect(fixture.nativeElement.querySelector(`label[for="${name.id}"]`)).not.toBeNull();
    expect(name.required).toBe(true);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBe('profile-token-name-error');
  });

  it('toggles password visibility for current and confirm password fields', async () => {
    const { fixture } = await createFixture();
    const comp = fixture.componentInstance;

    expect(comp.showOldPassword()).toBe(false);
    expect(comp.showConfirmPassword()).toBe(false);

    const oldToggle = fixture.nativeElement.querySelector('button[aria-label="Показать текущий пароль"]');
    expect(oldToggle).not.toBeNull();
    oldToggle.click();
    expect(comp.showOldPassword()).toBe(true);

    const confirmToggle = fixture.nativeElement.querySelector('button[aria-label="Показать подтверждение пароля"]');
    expect(confirmToggle).not.toBeNull();
    confirmToggle.click();
    expect(comp.showConfirmPassword()).toBe(true);
  });

  it('computes live password strength and matching feedback', async () => {
    const { fixture } = await createFixture();
    const comp = fixture.componentInstance;

    comp.passwordForm.newPassword = 'short';
    expect(comp.passwordStrength().score).toBeLessThan(2);
    expect(comp.hasMinLength()).toBe(false);

    comp.passwordForm.newPassword = 'CorrectP@ssword123';
    expect(comp.passwordStrength().score).toBe(4);
    expect(comp.hasMinLength()).toBe(true);
    expect(comp.hasLettersAndNumbers()).toBe(true);
    expect(comp.hasMixedCase()).toBe(true);

    comp.passwordForm.confirmPassword = 'DifferentPassword123';
    expect(comp.passwordsMatch()).toBe(false);

    comp.passwordForm.confirmPassword = 'CorrectP@ssword123';
    expect(comp.passwordsMatch()).toBe(true);
  });

  it('renders current session badge and differentiates current session actions', async () => {
    const sessions: UserSession[] = [
      {
        id: 101,
        userId: 1,
        ip: '192.168.1.50',
        userAgent: 'Chrome on Windows',
        deviceInfo: 'Desktop Windows',
        createdAt: '2026-09-01T10:00:00Z',
        lastSeenAt: '2026-09-01T12:00:00Z',
        current: true
      },
      {
        id: 102,
        userId: 1,
        ip: '10.0.0.5',
        userAgent: 'Safari on iPhone',
        deviceInfo: 'iPhone 15',
        createdAt: '2026-09-01T08:00:00Z',
        lastSeenAt: '2026-09-01T09:00:00Z',
        current: false
      }
    ];

    const { fixture } = await createFixture({ sessions });
    fixture.detectChanges();

    const currentBadge = fixture.nativeElement.querySelector('.session-ip-cell ui-badge');
    expect(currentBadge).not.toBeNull();
    expect(currentBadge.textContent).toContain('Текущая сессия');

    // The other session has a danger "Завершить" button
    const buttons = fixture.nativeElement.querySelectorAll('.data-table button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('submits token expiration choice and reveals secret with copy feedback', async () => {
    const { fixture, apiMock } = await createFixture();
    const comp = fixture.componentInstance;

    comp.openCreateTokenModal();
    comp.newTokenName = 'Deploy Bot';
    comp.selectedTokenExpiration = '30';
    comp.createTokenSubmit();

    expect(apiMock.post).toHaveBeenCalledWith(
      '/iam/profile/tokens',
      expect.objectContaining({
        name: 'Deploy Bot',
        expiresAt: expect.any(String)
      })
    );

    expect(comp.isTokenSecretModalOpen()).toBe(true);
    expect(comp.createdTokenSecret).toBe('dwh_secret_xyz');
  });

  it('requests and confirms session termination', async () => {
    const sessions: UserSession[] = [
      {
        id: 101,
        userId: 1,
        ip: '127.0.0.1',
        userAgent: 'Firefox',
        deviceInfo: 'PC',
        createdAt: '2026-09-01T00:00:00Z',
        lastSeenAt: '2026-09-01T00:00:00Z',
        current: false
      }
    ];

    const { fixture, apiMock } = await createFixture({ sessions });
    const comp = fixture.componentInstance;

    comp.requestTerminateSession(sessions[0]);
    expect(comp.sessionToTerminate).toEqual(sessions[0]);

    comp.confirmTerminateSession();
    expect(apiMock.delete).toHaveBeenCalledWith('/iam/profile/sessions/101');
    expect(comp.sessionToTerminate).toBeNull();
  });

  it('renders communication channels and status badges', async () => {
    const channels: UserChannel[] = [
      {
        id: 1,
        userId: 1,
        channel: 'email',
        address: 'user@example.com',
        isVerified: true,
        createdAt: '2026-09-01T10:00:00Z'
      },
      {
        id: 2,
        userId: 1,
        channel: 'telegram',
        address: '@user_tg',
        isVerified: false,
        createdAt: '2026-09-01T11:00:00Z'
      }
    ];

    const { fixture } = await createFixture({ channels });
    const cardEl = fixture.nativeElement.querySelector('app-profile-channels-card');
    expect(cardEl).not.toBeNull();

    const rows = cardEl.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);

    const verifiedBadge = rows[0].querySelector('ui-badge');
    expect(verifiedBadge?.textContent).toContain('Подтверждён');

    const pendingBadge = rows[1].querySelector('ui-badge');
    expect(pendingBadge?.textContent).toContain('Ожидает подтверждения');
  });

  it('initiates channel binding and opens verification modal', async () => {
    const { fixture, apiMock } = await createFixture();
    const comp = fixture.componentInstance;

    comp.onBindChannel({ channel: 'email', address: 'alex@example.test' });

    expect(apiMock.post).toHaveBeenCalledWith('/iam/profile/channels', {
      channel: 'email',
      address: 'alex@example.test'
    });

    expect(comp.channelsCard?.isConfirmModalOpen).toBe(true);
    expect(comp.channelsCard?.activeVerifyToken).toBe('mock_verify_token_123');
    expect(comp.channelsCard?.activeVerifyAddress).toBe('alex@example.test');
  });

  it('confirms channel with OTP code and closes modal', async () => {
    const { fixture, apiMock } = await createFixture();
    const comp = fixture.componentInstance;

    comp.channelsCard?.openConfirmModal('mock_verify_token_123', 'alex@example.test');
    expect(comp.channelsCard?.isConfirmModalOpen).toBe(true);

    comp.onConfirmChannel({ verifyToken: 'mock_verify_token_123', code: '123456' });

    expect(apiMock.post).toHaveBeenCalledWith('/iam/profile/channels/confirm', {
      verifyToken: 'mock_verify_token_123',
      code: '123456'
    });
    expect(comp.channelsCard?.isConfirmModalOpen).toBe(false);
  });

  it('requests and executes channel unbinding', async () => {
    const channels: UserChannel[] = [
      {
        id: 2,
        userId: 1,
        channel: 'telegram',
        address: '@user_tg',
        isVerified: true,
        createdAt: '2026-09-01T11:00:00Z'
      }
    ];
    const { fixture, apiMock } = await createFixture({ channels });
    const comp = fixture.componentInstance;

    comp.onUnbindChannel('telegram');

    expect(apiMock.delete).toHaveBeenCalledWith('/iam/profile/channels/telegram');
  });
});

