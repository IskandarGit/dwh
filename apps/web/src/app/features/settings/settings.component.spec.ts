import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../core/services/api.service';
import { I18nService } from '../../core/services/i18n.service';
import { PermissionService } from '../../core/services/permission.service';
import { SearchManagementService } from '../../core/services/search-management.service';
import { ToastService } from '../../core/services/toast.service';
import { ThemeService } from '../../core/services/theme.service';
import { SettingsComponent } from './settings.component';
import { translateTest } from '../../../testing/i18n-test.stub';

describe('SettingsComponent UI contracts', () => {
  async function createFixture(
    api: object = {
      get: vi.fn(() => of({})),
      patch: vi.fn(() => of({}))
    },
    hasPermission: (form: string, action: string) => boolean = () => true,
    searchManagement: object = {
      status: vi.fn(() => of({})),
      settings: vi.fn(() => of({})),
      jobs: vi.fn(() => of({ items: [], hasMore: false }))
    },
    themeService?: object,
    toast?: object,
    i18nMock?: object
  ) {
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: PermissionService, useValue: { hasPermission } },
        { provide: SearchManagementService, useValue: searchManagement },
        { provide: ToastService, useValue: toast ?? { success: vi.fn(), error: vi.fn(), info: vi.fn() } },
        {
          provide: ThemeService,
          useValue: themeService ?? {
            themePreference: signal('light'),
            currentTheme: signal('light'),
            setTheme: vi.fn(),
            toggleTheme: vi.fn()
          }
        },
        {
          provide: I18nService,
          useValue: i18nMock ?? {
            currentLang: signal('ru'),
            languages: signal([
              { code: 'ru', name: 'Русский', builtin: true, active: true },
              { code: 'de', name: 'Deutsch', builtin: true, active: true },
              { code: 'tr', name: 'Türkçe', builtin: true, active: true }
            ]),
            translate: translateTest,
            setLanguage: vi.fn(() => of(undefined)),
            registerLanguage: vi.fn(() => of({})),
            refreshLanguages: vi.fn(() => of([])),
            exportDictionary: vi.fn(() => '{}')
          }
        }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders settings that arrive after the initial change-detection pass', async () => {
    const systemSettings = new Subject<Record<string, string>>();
    const userSettings = new Subject<Record<string, string>>();
    const api = {
      get: vi.fn((path: string) => path === '/settings/system' ? systemSettings : userSettings),
      patch: vi.fn(() => of({}))
    };
    const fixture = await createFixture(api);
    fixture.autoDetectChanges();

    systemSettings.next({
      'system.company_name': 'Persisted Company',
      'system.default_language': 'en',
      'system.default_timezone': 'UTC',
      'system.date_format': 'yyyy-MM-dd HH:mm'
    });
    userSettings.next({ 'user.theme': 'light' });
    await fixture.whenStable();

    const companyName = fixture.nativeElement.querySelector('#settings-company-name') as HTMLInputElement;
    expect(companyName.value).toBe('Persisted Company');
  });

  it('connects settings tabs and general fields', async () => {
    const fixture = await createFixture();

    expect(fixture.nativeElement.querySelector('[role="tablist"][aria-label="Разделы настроек"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#settings-general-tab[aria-selected="true"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#settings-general-panel[role="tabpanel"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('label[for="settings-company-name"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('label[for="settings-default-language"]')).not.toBeNull();
    const language = fixture.nativeElement.querySelector('#settings-default-language') as HTMLSelectElement;
    expect(Array.from(language.options).map(option => option.value)).toEqual(['ru', 'de', 'tr']);
  });

  it('shows the search tab from search permission and destroys its child on a structural tab switch', async () => {
    let statusUnsubscribed = 0;
    const searchManagement = {
      status: vi.fn(() => new Observable(() => () => statusUnsubscribed++)),
      jobs: vi.fn(() => of({ items: [], hasMore: false })),
      settings: vi.fn(() => of({}))
    };
    const fixture = await createFixture(undefined, (form, action) =>
      form === 'platform.search' && action === 'view', searchManagement);

    const searchTab = fixture.nativeElement.querySelector('#settings-search-tab') as HTMLButtonElement;
    expect(searchTab).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#settings-general-tab')).toBeNull();
    searchTab.click();
    fixture.detectChanges();
    expect(searchManagement.status).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('#settings-search-panel app-search-settings')).not.toBeNull();

    (fixture.nativeElement.querySelector('#settings-preferences-tab') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#settings-search-panel')).toBeNull();
    expect(statusUnsubscribed).toBe(1);
  });

  it('centers only the latest locally focused settings tab and cancels pending work on teardown', async () => {
    vi.useFakeTimers();
    try {
      const fixture = await createFixture();
      const storage = fixture.nativeElement.querySelector('#settings-storage-tab') as HTMLButtonElement;
      const languages = fixture.nativeElement.querySelector('#settings-languages-tab') as HTMLButtonElement;
      const search = fixture.nativeElement.querySelector('#settings-search-tab') as HTMLButtonElement;
      const storageScroll = vi.fn();
      const languagesScroll = vi.fn();
      const searchScroll = vi.fn();
      storage.scrollIntoView = storageScroll;
      languages.scrollIntoView = languagesScroll;
      search.scrollIntoView = searchScroll;

      storage.focus();
      languages.focus();
      vi.runOnlyPendingTimers();

      expect(storageScroll).not.toHaveBeenCalled();
      expect(languagesScroll).toHaveBeenCalledOnce();
      expect(languagesScroll).toHaveBeenCalledWith({ behavior: 'instant', block: 'nearest', inline: 'center' });

      search.focus();
      fixture.destroy();
      vi.runOnlyPendingTimers();
      expect(searchScroll).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('names security values and switches', async () => {
    const fixture = await createFixture();
    fixture.componentInstance.activeTab = 'security';
    fixture.detectChanges();

    const passwordLength = fixture.nativeElement.querySelector('#settings-password-length') as HTMLInputElement;
    expect(fixture.nativeElement.querySelector(`label[for="${passwordLength.id}"]`)).not.toBeNull();
    expect(passwordLength.min).toBe('8');
    expect(passwordLength.getAttribute('aria-describedby')).toBe('settings-password-length-hint');
    expect(fixture.nativeElement.querySelector('#settings-require-2fa[aria-labelledby="settings-require-2fa-label"]')).not.toBeNull();
  });

  it('keeps operational status out of settings and exposes no custom-module controls', async () => {
    const fixture = await createFixture();
    const api = TestBed.inject(ApiService) as unknown as { get: ReturnType<typeof vi.fn> };

    expect(api.get).not.toHaveBeenCalledWith('/system/info');
    expect(api.get).not.toHaveBeenCalledWith('/system/license-info');
    expect(api.get).not.toHaveBeenCalledWith('/modules');
    expect(fixture.nativeElement.querySelector('#settings-modules-tab')).toBeNull();

    expect(fixture.nativeElement.querySelector('#settings-system-tab')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Control Plane');
    expect(fixture.nativeElement.textContent).not.toContain('Лиценз');
  });

  it('migrates legacy browser translations atomically and removes them only after success', async () => {
    localStorage.setItem('dwh_custom_languages', JSON.stringify({
      de: { name: 'Deutsch', dict: { 'common.save': 'Alt speichern', unknown: 'ignore' } }
    }));
    const api = {
      get: vi.fn((path: string) => {
        if (path === '/i18n/admin/languages/ru/translations') {
          return of({ language: { revision: 4 }, entries: [
            { key: 'common.save' }, { key: 'common.cancel' }
          ] });
        }
        if (path === '/i18n/admin/languages/de/translations') {
          return of({ language: { revision: 7 }, entries: [
            { key: 'common.save', overrideValue: null },
            { key: 'common.cancel', overrideValue: 'Abbrechen' }
          ] });
        }
        return of({});
      }),
      patch: vi.fn(() => of({})),
      put: vi.fn(() => of({}))
    };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = await createFixture(api);

    fixture.componentInstance.migrateLegacyLanguages();

    expect(api.put).toHaveBeenCalledWith('/i18n/admin/languages/de/translations', {
      expectedRevision: 7,
      translations: {
        'common.save': 'Alt speichern',
        'common.cancel': 'Abbrechen'
      }
    });
    expect(localStorage.getItem('dwh_custom_languages')).toBeNull();
    confirm.mockRestore();
  });
  it('disables system inputs, displays readonly badge, and hides save button for view-only users', async () => {
    const hasPermission = (form: string, action: string) => {
      if (form === 'platform.settings' || form === 'settings') {
        return action === 'view';
      }
      return false;
    };
    const fixture = await createFixture(undefined, hasPermission);
    fixture.detectChanges();

    const readonlyBadges = fixture.nativeElement.querySelectorAll('.badge.badge-neutral');
    expect(Array.from(readonlyBadges).some((b: any) => b.textContent?.includes('Только чтение'))).toBe(true);

    const companyInput = fixture.nativeElement.querySelector('#settings-company-name') as HTMLInputElement;
    expect(companyInput.disabled).toBe(true);

    const generalSaveBtn = fixture.nativeElement.querySelector('#settings-general-panel .card-footer-actions ui-button');
    expect(generalSaveBtn).toBeNull();
  });

  it('synchronizes theme changes with ThemeService immediately and on user settings save', async () => {
    const themeServiceMock = {
      themePreference: signal('light'),
      currentTheme: signal('light'),
      setTheme: vi.fn(),
      toggleTheme: vi.fn()
    };
    const fixture = await createFixture(undefined, () => true, undefined, themeServiceMock);

    // Immediate change via UI helper
    fixture.componentInstance.onThemeChange('dark');
    expect(themeServiceMock.setTheme).toHaveBeenCalledWith('dark');
    expect(fixture.componentInstance.userSettings()['user.theme']).toBe('dark');

    // On saveUserSettings
    fixture.componentInstance.userSettings.set({ 'user.theme': 'system' });
    fixture.componentInstance.saveUserSettings();
    expect(themeServiceMock.setTheme).toHaveBeenCalledWith('system');
  });

  it('validates password length, session lifetime, and quota bounds before sending patch', async () => {
    const api = {
      get: vi.fn(() => of({})),
      patch: vi.fn(() => of({}))
    };
    const toast = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    };
    const fixture = await createFixture(api, () => true, undefined, undefined, toast);

    // Min password too short (< 8)
    fixture.componentInstance.systemSettings.set({ 'security.min_password_length': '5' });
    fixture.componentInstance.saveSystemSettings();
    expect(toast.error).toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();

    // Session lifetime invalid (> 8760)
    toast.error.mockClear();
    fixture.componentInstance.systemSettings.set({ 'security.session_lifetime_hours': '10000' });
    fixture.componentInstance.saveSystemSettings();
    expect(toast.error).toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();

    // User quota invalid (< 100)
    toast.error.mockClear();
    fixture.componentInstance.systemSettings.set({ 'storage.default_user_quota_mb': '50' });
    fixture.componentInstance.saveSystemSettings();
    expect(toast.error).toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('validates language code format and prevents registering invalid codes', async () => {
    const toast = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    };
    const i18nMock = {
      currentLang: signal('ru'),
      languages: signal([{ code: 'ru', name: 'Русский', builtin: true, active: true }]),
      translate: translateTest,
      setLanguage: vi.fn(() => of(undefined)),
      registerLanguage: vi.fn(() => of({})),
      refreshLanguages: vi.fn(() => of([])),
      exportDictionary: vi.fn(() => '{}')
    };
    const fixture = await createFixture(undefined, () => true, undefined, undefined, toast, i18nMock);

    fixture.componentInstance.newLangCode = 'invalid_123_toolongformat';
    fixture.componentInstance.newLangName = 'Test';
    fixture.componentInstance.saveNewLanguage();

    expect(toast.error).toHaveBeenCalled();
    expect(i18nMock.registerLanguage).not.toHaveBeenCalled();
  });

  it('opens add language modal with isOpen=true and closes it cleanly', async () => {
    const fixture = await createFixture();
    fixture.componentInstance.activeTab = 'languages';
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('ui-modal')).toBeNull();
    fixture.componentInstance.openAddLangModal();
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('ui-modal');
    expect(modal).not.toBeNull();
    expect(fixture.componentInstance.isAddLangModalOpen()).toBe(true);
    expect(modal.querySelector('.modal-dialog')).not.toBeNull();
  });

  it('rejects empty strings and non-numeric inputs for numeric settings', async () => {
    const api = { get: vi.fn(() => of({})), patch: vi.fn(() => of({})) };
    const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    const fixture = await createFixture(api, () => true, undefined, undefined, toast);

    fixture.componentInstance.systemSettings.set({ 'security.min_password_length': '   ' });
    fixture.componentInstance.saveSystemSettings();
    expect(toast.error).toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();

    toast.error.mockClear();
    fixture.componentInstance.systemSettings.set({
      'security.min_password_length': '10',
      'security.session_lifetime_hours': 'letters'
    });
    fixture.componentInstance.saveSystemSettings();
    expect(toast.error).toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();

    toast.error.mockClear();
    fixture.componentInstance.systemSettings.set({
      'security.min_password_length': '10',
      'security.session_lifetime_hours': '720',
      'storage.default_user_quota_mb': 'not-a-number'
    });
    fixture.componentInstance.saveSystemSettings();
    expect(toast.error).toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('provides human-readable units for session hours and quota MB', async () => {
    const fixture = await createFixture();
    expect(fixture.componentInstance.formatSessionHours('720')).toBe('720 ч. (30 дн.)');
    expect(fixture.componentInstance.formatSessionHours('24')).toBe('24 ч. (1 дн.)');
    expect(fixture.componentInstance.formatSessionHours('12')).toBe('12 ч.');
    expect(fixture.componentInstance.formatQuotaMb('1024')).toBe('1024 МБ (~1 ГБ)');
    expect(fixture.componentInstance.formatQuotaMb('5120')).toBe('5120 МБ (~5 ГБ)');
    expect(fixture.componentInstance.formatQuotaMb('500')).toBe('500 МБ');
  });
});
