import { Component, HostListener, OnDestroy, OnInit, signal, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, concatMap, finalize, from, switchMap, toArray } from 'rxjs';
import { TranslationDictionary, TranslationEditor } from '../../core/models/i18n.models';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { I18nService, TranslatePipe } from '../../core/services/i18n.service';
import { PermissionService } from '../../core/services/permission.service';
import { ThemeService } from '../../core/services/theme.service';
import { UiButtonComponent } from '../../shared/ui/ui-button.component';
import { SearchSettingsComponent } from './search/search-settings.component';
import { NavigationSettingsComponent } from './navigation/navigation-settings.component';
import { SettingsTab, LegacyLanguage, filterKnownTranslations, readLegacyLanguages } from './settings.models';
import { SettingsGeneralPanelComponent } from './components/settings-general-panel.component';
import { SettingsSecurityPanelComponent } from './components/settings-security-panel.component';
import { SettingsStoragePanelComponent } from './components/settings-storage-panel.component';
import { SettingsPreferencesPanelComponent } from './components/settings-preferences-panel.component';
import { SettingsLanguagesPanelComponent } from './components/settings-languages-panel.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    UiButtonComponent,
    SearchSettingsComponent,
    NavigationSettingsComponent,
    SettingsGeneralPanelComponent,
    SettingsSecurityPanelComponent,
    SettingsStoragePanelComponent,
    SettingsPreferencesPanelComponent,
    SettingsLanguagesPanelComponent
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css'
})
export class SettingsComponent implements OnInit, OnDestroy {
  private readonly uiI18n = inject(I18nService);
  private readonly themeService = inject(ThemeService);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private pendingTabFocusScroll: ReturnType<typeof setTimeout> | null = null;
  activeTab: SettingsTab = 'general';

  readonly isLoading = signal<boolean>(false);
  readonly loadError = signal<string | null>(null);
  readonly systemSettings = signal<Record<string, string>>({});
  readonly userSettings = signal<Record<string, string>>({});
  readonly isSaving = signal<boolean>(false);

  // Languages Management
  readonly isAddLangModalOpen = signal<boolean>(false);
  readonly isAddingLang = signal<boolean>(false);
  readonly editingLanguageCode = signal<string | null>(null);
  readonly legacyLanguageCount = signal(0);
  readonly isMigratingLegacyLanguages = signal(false);
  newLangCode = '';
  newLangName = '';
  newLangJson = '';

  constructor(
    private api: ApiService,
    private toast: ToastService,
    public i18n: I18nService,
    private permService: PermissionService
  ) {}

  ngOnInit() {
    if (this.route) {
      this.route.queryParams.subscribe(params => {
        const tabParam = params['tab'];
        if (tabParam && this.isTabAvailable(tabParam)) {
          this.activeTab = tabParam as any;
        } else if (!this.canManageSystemSettings()) {
          this.activeTab = 'preferences';
        }
      });
    } else if (!this.canManageSystemSettings()) {
      this.activeTab = 'preferences';
    }
    this.legacyLanguageCount.set(Object.keys(readLegacyLanguages()).length);
    this.loadAllSettings();
  }

  ngOnDestroy(): void {
    if (this.pendingTabFocusScroll !== null) clearTimeout(this.pendingTabFocusScroll);
    this.pendingTabFocusScroll = null;
  }

  onSettingsTabFocusIn(event: FocusEvent): void {
    const tabList = event.currentTarget;
    const target = event.target;
    if (!(tabList instanceof HTMLElement) || !(target instanceof HTMLElement)
      || !target.matches('.status-tab[role="tab"]') || !tabList.contains(target)) return;
    if (this.pendingTabFocusScroll !== null) clearTimeout(this.pendingTabFocusScroll);
    this.pendingTabFocusScroll = setTimeout(() => {
      this.pendingTabFocusScroll = null;
      if (!tabList.isConnected || !target.isConnected || !tabList.contains(target)
        || document.activeElement !== target) return;
      target.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
    }, 0);
  }

  canManageSystemSettings(): boolean {
    return this.permService.hasPermission('platform.settings', 'view') ||
           this.permService.hasPermission('platform.settings', 'update') ||
           this.permService.hasPermission('settings', 'view') ||
           this.permService.hasPermission('settings', 'update');
  }

  canUpdateSystemSettings(): boolean {
    return this.permService.hasPermission('platform.settings', 'update') ||
           this.permService.hasPermission('settings', 'update');
  }

  canViewSearchSettings(): boolean {
    return this.permService.hasPermission('platform.search', 'view');
  }

  canViewNavigationSettings(): boolean {
    return this.permService.hasPermission('platform.navigation', 'view');
  }

  userThemePreference(): string {
    return this.userSettings()['user.theme'] || this.themeService.themePreference();
  }

  onThemeChange(newTheme: string): void {
    this.userSettings.update(settings => ({ ...settings, 'user.theme': newTheme }));
    if (newTheme === 'light' || newTheme === 'dark' || newTheme === 'system') {
      this.themeService.setTheme(newTheme);
    }
  }

  loadAllSettings() {
    this.isLoading.set(true);
    this.loadError.set(null);
    let sysLoaded = !this.canManageSystemSettings();
    let userLoaded = false;
    const checkDone = () => {
      if (sysLoaded && userLoaded) {
        this.isLoading.set(false);
      }
    };

    if (this.canManageSystemSettings()) {
      this.api.get<Record<string, string>>('/settings/system').subscribe({
        next: res => {
          this.systemSettings.set({ ...res });
          sysLoaded = true;
          checkDone();
        },
        error: () => {
          this.loadError.set(this.uiI18n.translate('settings.oshibka_zagruzki_nastroek'));
          sysLoaded = true;
          checkDone();
        }
      });
    }

    this.api.get<Record<string, string>>('/settings/user').subscribe({
      next: res => {
        this.userSettings.set({ ...res });
        const theme = res['user.theme'];
        if (theme === 'light' || theme === 'dark' || theme === 'system') {
          this.themeService.setTheme(theme);
        }
        userLoaded = true;
        checkDone();
      },
      error: () => {
        this.loadError.set(this.uiI18n.translate('settings.oshibka_zagruzki_nastroek'));
        userLoaded = true;
        checkDone();
      }
    });
  }

  saveSystemSettings() {
    if (!this.canUpdateSystemSettings()) return;

    const minPassStr = this.systemSettings()['security.min_password_length'];
    if (minPassStr !== undefined) {
      const trimmed = String(minPassStr).trim();
      const minPass = trimmed === '' ? NaN : Number(trimmed);
      if (!Number.isFinite(minPass) || minPass < 8 || minPass > 64) {
        this.toast.error(this.uiI18n.translate('settings.validation.min_password'));
        return;
      }
    }

    const sessionStr = this.systemSettings()['security.session_lifetime_hours'];
    if (sessionStr !== undefined) {
      const trimmed = String(sessionStr).trim();
      const sessionLifetime = trimmed === '' ? NaN : Number(trimmed);
      if (!Number.isFinite(sessionLifetime) || sessionLifetime < 1 || sessionLifetime > 8760) {
        this.toast.error(this.uiI18n.translate('settings.validation.session_lifetime'));
        return;
      }
    }

    const quotaStr = this.systemSettings()['storage.default_user_quota_mb'];
    if (quotaStr !== undefined) {
      const trimmed = String(quotaStr).trim();
      const quota = trimmed === '' ? NaN : Number(trimmed);
      if (!Number.isFinite(quota) || quota < 100 || quota > 102400) {
        this.toast.error(this.uiI18n.translate('settings.validation.quota'));
        return;
      }
    }

    this.isSaving.set(true);
    this.api.patch('/settings/system', this.systemSettings()).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.toast.success(this.i18n.translate('common.saved'));
      },
      error: () => this.isSaving.set(false)
    });
  }

  saveUserSettings() {
    this.isSaving.set(true);
    this.api.patch('/settings/user', this.userSettings()).subscribe({
      next: () => {
        this.isSaving.set(false);
        const theme = this.userSettings()['user.theme'];
        if (theme === 'light' || theme === 'dark' || theme === 'system') {
          this.themeService.setTheme(theme);
        }
        this.toast.success(this.i18n.translate('common.saved'));
      },
      error: () => this.isSaving.set(false)
    });
  }

  changePersonalLang(lang: string) {
    this.i18n.setLanguage(lang).subscribe({
      next: () => this.userSettings.update(settings => ({ ...settings, 'user.language': lang }))
    });
  }

  toggleRequire2fa(event: any) {
    this.systemSettings.update(settings => ({
      ...settings,
      'security.require_2fa': event.target.checked ? 'true' : 'false'
    }));
  }

  toggleSound(event: any) {
    this.userSettings.update(settings => ({
      ...settings,
      'user.notifications_sound': event.target.checked ? 'true' : 'false'
    }));
  }

  // Language management methods
  openAddLangModal() {
    this.newLangCode = '';
    this.newLangName = '';
    this.newLangJson = '';
    this.isAddLangModalOpen.set(true);
  }

  openLanguageEditor(code: string) {
    this.editingLanguageCode.set(code);
  }

  onLanguageSaved() {
    this.i18n.refreshLanguages().subscribe();
  }

  migrateLegacyLanguages(): void {
    const legacyLanguages = readLegacyLanguages();
    const entries = Object.entries(legacyLanguages);
    if (entries.length === 0 || !this.canUpdateSystemSettings()) return;
    if (!window.confirm(
      this.uiI18n.translate('settings.confirm_legacy_migration', { count: entries.length })
    )) return;

    this.isMigratingLegacyLanguages.set(true);
    this.api.get<TranslationEditor>('/i18n/admin/languages/ru/translations').pipe(
      switchMap(russianEditor => {
        const knownKeys = new Set(russianEditor.entries.map(entry => entry.key));
        return from(entries).pipe(
          concatMap(([code, legacy]) => this.migrateLegacyLanguage(code, legacy, knownKeys)),
          toArray()
        );
      }),
      switchMap(() => this.i18n.refreshLanguages()),
      finalize(() => this.isMigratingLegacyLanguages.set(false))
    ).subscribe({
      next: () => {
        localStorage.removeItem('dwh_custom_languages');
        this.legacyLanguageCount.set(0);
        this.toast.success(this.uiI18n.translate('settings.lokalnye_yazykovye_pakety_pereneseny_v_servernoe'));
      },
      error: () => this.toast.error(
        this.uiI18n.translate('settings.ne_udalos_perenesti_yazykovye_pakety_lokalnaya_k')
      )
    });
  }

  isTabAvailable(tab: string): boolean {
    switch (tab) {
      case 'general':
      case 'security':
      case 'storage':
      case 'languages':
        return this.canManageSystemSettings();
      case 'preferences':
        return true;
      case 'search':
        return this.canViewSearchSettings();
      case 'navigation':
        return this.canViewNavigationSettings();
      default:
        return false;
    }
  }

  setTab(tab: SettingsTab): void {
    if (!this.isTabAvailable(tab)) return;
    this.activeTab = tab;
    if (this.router && this.route) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { tab },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }

  onTabKeydown(event: KeyboardEvent, currentTab: string): void {
    const tabs: SettingsTab[] = [
      'general', 'security', 'storage', 'preferences', 'languages', 'search', 'navigation'
    ];
    const availableTabs = tabs.filter(t => this.isTabAvailable(t));
    const currentIndex = availableTabs.indexOf(currentTab as any);
    if (currentIndex === -1) return;

    let targetIndex = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      targetIndex = (currentIndex + 1) % availableTabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      targetIndex = (currentIndex - 1 + availableTabs.length) % availableTabs.length;
    } else if (event.key === 'Home') {
      event.preventDefault();
      targetIndex = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      targetIndex = availableTabs.length - 1;
    }

    if (targetIndex >= 0) {
      const targetTab = availableTabs[targetIndex];
      this.setTab(targetTab);
      const tabElement = document.getElementById(`settings-${targetTab}-tab`);
      if (tabElement) tabElement.focus();
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleGlobalKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      if (['general', 'security', 'storage'].includes(this.activeTab)) {
        if (this.canUpdateSystemSettings() && !this.isSaving()) {
          this.saveSystemSettings();
        }
      } else if (this.activeTab === 'preferences') {
        if (!this.isSaving()) {
          this.saveUserSettings();
        }
      }
    }
  }

  formatSessionHours(hours: string | number | undefined): string {
    if (hours === undefined || hours === '') return '';
    const num = Number(hours);
    if (!Number.isFinite(num) || num <= 0) return '';
    const days = Math.floor(num / 24);
    const remHours = num % 24;
    const h = this.i18n.translate('settings.unit_hours_short') || 'h';
    const d = this.i18n.translate('settings.unit_days_short') || 'd';
    if (days === 0) return `${num} ${h}`;
    if (remHours === 0) return `${num} ${h} (${days} ${d})`;
    return `${num} ${h} (${days} ${d} ${remHours} ${h})`;
  }

  formatQuotaMb(mb: string | number | undefined): string {
    if (mb === undefined || mb === '') return '';
    const num = Number(mb);
    if (!Number.isFinite(num) || num <= 0) return '';
    const mbUnit = this.i18n.translate('settings.unit_mb') || 'MB';
    const gbUnit = this.i18n.translate('settings.unit_gb') || 'GB';
    if (num >= 1024) {
      const gb = (num / 1024).toFixed(1).replace(/\.0$/, '');
      return `${num} ${mbUnit} (~${gb} ${gbUnit})`;
    }
    return `${num} ${mbUnit}`;
  }

  saveNewLanguage() {
    const rawCode = this.newLangCode.trim().toLowerCase();
    const rawName = this.newLangName.trim();
    if (!rawCode || !rawName) return;

    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(rawCode)) {
      this.toast.error(this.uiI18n.translate('settings.validation.lang_code'));
      return;
    }

    let dict: Record<string, string> = {};
    if (this.newLangJson) {
      try {
        dict = JSON.parse(this.newLangJson);
      } catch (e) {
        this.toast.error(this.uiI18n.translate('settings.nevernyy_format_json_slovarya'));
        return;
      }
    }

    this.isAddingLang.set(true);
    this.i18n.registerLanguage(rawCode, rawName, dict).pipe(
      finalize(() => this.isAddingLang.set(false))
    ).subscribe({
      next: () => {
        this.isAddLangModalOpen.set(false);
        this.toast.success(this.uiI18n.translate('settings.language_added', { name: rawName }));
      },
      error: () => {
        this.toast.error(this.uiI18n.translate('common.error'));
      }
    });
  }

  switchLanguage(lang: string) {
    this.i18n.setLanguage(lang).subscribe();
  }

  exportLangJson(langCode: string) {
    this.api.get<Record<string, string>>(`/i18n/${langCode}`).subscribe(dictionary => {
      const blob = new Blob([JSON.stringify(dictionary, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smartupcms-translations-${langCode}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.toast.info(this.uiI18n.translate('settings.dictionary_exported', {
        code: langCode.toUpperCase()
      }));
    });
  }

  private migrateLegacyLanguage(
    code: string,
    legacy: LegacyLanguage,
    knownKeys: Set<string>
  ): Observable<unknown> {
    const translations = filterKnownTranslations(legacy.dict, knownKeys);
    const existing = this.i18n.languages().some(language => language.code === code);
    if (!existing) {
      return this.i18n.registerLanguage(code, legacy.name, translations);
    }

    return this.api.get<TranslationEditor>(`/i18n/admin/languages/${code}/translations`).pipe(
      switchMap(editor => {
        const merged: TranslationDictionary = {};
        for (const entry of editor.entries) {
          if (entry.overrideValue) merged[entry.key] = entry.overrideValue;
        }
        Object.assign(merged, translations);
        return this.api.put(`/i18n/admin/languages/${code}/translations`, {
          expectedRevision: editor.language.revision,
          translations: merged
        });
      })
    );
  }

}
