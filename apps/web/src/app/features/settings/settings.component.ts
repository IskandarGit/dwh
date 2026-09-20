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
import { ThemeService, ThemePreference } from '../../core/services/theme.service';
import { UiButtonComponent } from '../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../shared/ui/ui-modal.component';
import { LanguageEditorComponent } from './language-editor.component';
import { SearchSettingsComponent } from './search/search-settings.component';
import { NavigationSettingsComponent } from './navigation/navigation-settings.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    UiButtonComponent,
    UiModalComponent,
    LanguageEditorComponent,
    SearchSettingsComponent,
    NavigationSettingsComponent
  ],
  template: `
    <div class="settings-page">
      <!-- Page Header -->
      <div class="view-header">
        <div class="header-left">
          <h1 class="view-title">{{ 'settings.title' | t }}</h1>
          <p class="view-subtitle">{{ 'settings.sistemnye_nastroyki' | t }}</p>
        </div>
        <div class="header-right">
          <ui-button
            variant="secondary"
            icon="refresh"
            [loading]="isLoading()"
            [ariaLabel]="'common.refresh' | t"
            (onClick)="loadAllSettings()"
          >
            {{ 'common.refresh' | t }}
          </ui-button>
        </div>
      </div>

      <!-- Error Banner -->
      <div *ngIf="loadError()" class="load-error-banner" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        <span class="load-error-text">{{ loadError() }}</span>
        <button type="button" class="btn btn-secondary btn-sm" (click)="loadAllSettings()">
          {{ 'common.retry' | t }}
        </button>
      </div>

      <!-- Tabs Navigation -->
      <div class="toolbar">
        <div class="status-tabs" role="tablist" [attr.aria-label]="'settings.razdely_nastroek' | t" (focusin)="onSettingsTabFocusIn($event)">
          <button
            *ngIf="canManageSystemSettings()"
            id="settings-general-tab"
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="activeTab === 'general'"
            [attr.aria-selected]="activeTab === 'general'"
            aria-controls="settings-general-panel"
            (click)="setTab('general')"
            (keydown)="onTabKeydown($event, 'general')"
          >
            <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">tune</span>
            <span>{{ 'settings.tab.general' | t }}</span>
          </button>

          <button
            *ngIf="canManageSystemSettings()"
            id="settings-security-tab"
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="activeTab === 'security'"
            [attr.aria-selected]="activeTab === 'security'"
            aria-controls="settings-security-panel"
            (click)="setTab('security')"
            (keydown)="onTabKeydown($event, 'security')"
          >
            <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">security</span>
            <span>{{ 'settings.tab.security' | t }}</span>
          </button>

          <button
            *ngIf="canManageSystemSettings()"
            id="settings-storage-tab"
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="activeTab === 'storage'"
            [attr.aria-selected]="activeTab === 'storage'"
            aria-controls="settings-storage-panel"
            (click)="setTab('storage')"
            (keydown)="onTabKeydown($event, 'storage')"
          >
            <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">cloud</span>
            <span>{{ 'settings.tab.storage' | t }}</span>
          </button>

          <button
            id="settings-preferences-tab"
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="activeTab === 'preferences'"
            [attr.aria-selected]="activeTab === 'preferences'"
            aria-controls="settings-preferences-panel"
            (click)="setTab('preferences')"
            (keydown)="onTabKeydown($event, 'preferences')"
          >
            <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">person</span>
            <span>{{ 'settings.tab.preferences' | t }}</span>
          </button>

          <button
            *ngIf="canManageSystemSettings()"
            id="settings-languages-tab"
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="activeTab === 'languages'"
            [attr.aria-selected]="activeTab === 'languages'"
            aria-controls="settings-languages-panel"
            (click)="setTab('languages')"
            (keydown)="onTabKeydown($event, 'languages')"
          >
            <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">language</span>
            <span>{{ 'settings.yazyki_i_lokalizaciya' | t }}</span>
          </button>

          <button
            *ngIf="canViewSearchSettings()"
            id="settings-search-tab"
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="activeTab === 'search'"
            [attr.aria-selected]="activeTab === 'search'"
            aria-controls="settings-search-panel"
            (click)="setTab('search')"
            (keydown)="onTabKeydown($event, 'search')"
          >
            <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">manage_search</span>
            <span>{{ 'settings.search.tab' | t }}</span>
          </button>

          <button
            *ngIf="canViewNavigationSettings()"
            id="settings-navigation-tab"
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="activeTab === 'navigation'"
            [attr.aria-selected]="activeTab === 'navigation'"
            aria-controls="settings-navigation-panel"
            (click)="setTab('navigation')"
            (keydown)="onTabKeydown($event, 'navigation')"
          >
            <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">menu_open</span>
            <span>{{ 'settings.navigation.tab' | t }}</span>
          </button>

        </div>
      </div>

      <div id="settings-search-panel" class="tab-content" role="tabpanel" aria-labelledby="settings-search-tab" *ngIf="activeTab === 'search' && canViewSearchSettings()">
        <app-search-settings />
      </div>

      <div id="settings-navigation-panel" class="tab-content" role="tabpanel" aria-labelledby="settings-navigation-tab" *ngIf="activeTab === 'navigation' && canViewNavigationSettings()">
        <app-navigation-settings />
      </div>

      <!-- =================================================================== -->
      <!-- TAB 1: GENERAL SYSTEM SETTINGS -->
      <!-- =================================================================== -->
      <div id="settings-general-panel" class="tab-content" role="tabpanel" aria-labelledby="settings-general-tab" *ngIf="activeTab === 'general' && canManageSystemSettings()">
        <div class="settings-card">
          <div class="card-header-bar">
            <div class="card-title-group">
              <span class="material-symbols-outlined card-icon" aria-hidden="true">corporate_fare</span>
              <div>
                <h3 class="card-title">{{ 'settings.konfiguraciya_kompanii' | t }}</h3>
                <p class="card-desc">{{ 'settings.globalnye_parametry_dlya_vseh_sotrudnikov_organi' | t }}</p>
              </div>
            </div>
            <span class="badge badge-neutral" *ngIf="!canUpdateSystemSettings()">{{ 'settings.readonly_badge' | t }}</span>
          </div>

          <div class="form-grid">
            <div class="form-group full-width">
              <label class="form-label" for="settings-company-name">{{ 'settings.company_name' | t }}</label>
              <input
                id="settings-company-name"
                name="settingsCompanyName"
                type="text"
                class="form-input"
                [disabled]="!canUpdateSystemSettings() || isSaving()"
                [(ngModel)]="systemSettings()['system.company_name']"
                placeholder="SmartupCMS"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-default-language">{{ 'settings.default_language' | t }}</label>
              <select id="settings-default-language" name="settingsDefaultLanguage" class="form-select" [disabled]="!canUpdateSystemSettings() || isSaving()" [(ngModel)]="systemSettings()['system.default_language']">
                <option *ngFor="let lang of i18n.languages()" [value]="lang.code">
                  {{ lang.name }} ({{ lang.code.toUpperCase() }})
                </option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-default-timezone">{{ 'settings.default_timezone' | t }}</label>
              <select id="settings-default-timezone" name="settingsDefaultTimezone" class="form-select" [disabled]="!canUpdateSystemSettings() || isSaving()" [(ngModel)]="systemSettings()['system.default_timezone']">
                <option value="Asia/Tashkent">Asia/Tashkent (UTC+5)</option>
                <option value="Asia/Samarkand">Asia/Samarkand (UTC+5)</option>
                <option value="Asia/Almaty">Asia/Almaty (UTC+5)</option>
                <option value="Asia/Bishkek">Asia/Bishkek (UTC+6)</option>
                <option value="Asia/Dushanbe">Asia/Dushanbe (UTC+5)</option>
                <option value="Asia/Ashgabat">Asia/Ashgabat (UTC+5)</option>
                <option value="Asia/Baku">Asia/Baku (UTC+4)</option>
                <option value="Europe/Moscow">Europe/Moscow (UTC+3)</option>
                <option value="Europe/Istanbul">Europe/Istanbul (UTC+3)</option>
                <option value="Europe/Berlin">Europe/Berlin (UTC+1)</option>
                <option value="Europe/London">Europe/London (UTC+0)</option>
                <option value="UTC">UTC (GMT+0)</option>
                <option *ngIf="isCustomTimezone(systemSettings()['system.default_timezone'])" [value]="systemSettings()['system.default_timezone']">
                  {{ systemSettings()['system.default_timezone'] }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-date-format">{{ 'settings.date_format' | t }}</label>
              <select id="settings-date-format" name="settingsDateFormat" class="form-select" [disabled]="!canUpdateSystemSettings() || isSaving()" [(ngModel)]="systemSettings()['system.date_format']">
                <option value="dd.MM.yyyy HH:mm">29.08.2026 14:30 (dd.MM.yyyy HH:mm)</option>
                <option value="yyyy-MM-dd HH:mm">2026-08-29 14:30 (yyyy-MM-dd HH:mm)</option>
                <option value="MM/dd/yyyy hh:mm a">08/29/2026 02:30 PM (MM/dd/yyyy)</option>
                <option value="dd.MM.yyyy">29.08.2026 (dd.MM.yyyy)</option>
                <option value="dd/MM/yyyy HH:mm">29/08/2026 14:30 (dd/MM/yyyy HH:mm)</option>
                <option *ngIf="isCustomDateFormat(systemSettings()['system.date_format'])" [value]="systemSettings()['system.date_format']">
                  {{ systemSettings()['system.date_format'] }}
                </option>
              </select>
            </div>
          </div>

          <div class="card-footer-actions" *ngIf="canUpdateSystemSettings()">
            <ui-button [loading]="isSaving()" (onClick)="saveSystemSettings()">
              {{ 'common.save' | t }}
            </ui-button>
          </div>
        </div>
      </div>

      <!-- =================================================================== -->
      <!-- TAB 2: SECURITY POLICIES -->
      <!-- =================================================================== -->
      <div id="settings-security-panel" class="tab-content" role="tabpanel" aria-labelledby="settings-security-tab" *ngIf="activeTab === 'security' && canManageSystemSettings()">
        <div class="settings-card">
          <div class="card-header-bar">
            <div class="card-title-group">
              <span class="material-symbols-outlined card-icon" aria-hidden="true">lock</span>
              <div>
                <h3 class="card-title">{{ 'settings.politiki_bezopasnosti_i_avtorizacii' | t }}</h3>
                <p class="card-desc">{{ 'settings.trebovaniya_k_parolyam_2fa_i_veb_sessiyam' | t }}</p>
              </div>
            </div>
            <span class="badge badge-neutral" *ngIf="!canUpdateSystemSettings()">{{ 'settings.readonly_badge' | t }}</span>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="settings-password-length">{{ 'settings.min_password_len' | t }}</label>
              <input
                id="settings-password-length"
                name="settingsPasswordLength"
                type="number"
                min="8"
                max="64"
                class="form-input"
                [disabled]="!canUpdateSystemSettings() || isSaving()"
                aria-describedby="settings-password-length-hint"
                [(ngModel)]="systemSettings()['security.min_password_length']"
              />
              <span id="settings-password-length-hint" class="hint-text">{{ 'settings.rekomenduetsya_ne_menee_10_simvolov' | t }}</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-session-lifetime">
                {{ 'settings.session_lifetime' | t }}
                <span class="unit-badge" *ngIf="formatSessionHours(systemSettings()['security.session_lifetime_hours']) as sessionBadge">
                  {{ sessionBadge }}
                </span>
              </label>
              <input
                id="settings-session-lifetime"
                name="settingsSessionLifetime"
                type="number"
                min="1"
                max="8760"
                class="form-input"
                [disabled]="!canUpdateSystemSettings() || isSaving()"
                aria-describedby="settings-session-lifetime-hint"
                [(ngModel)]="systemSettings()['security.session_lifetime_hours']"
              />
              <span id="settings-session-lifetime-hint" class="hint-text">{{ 'settings.po_umolchaniyu_720_chasov_30_dney' | t }}</span>
            </div>

            <div class="form-group full-width">
              <div class="toggle-row">
                <div class="toggle-info">
                  <span id="settings-require-2fa-label" class="toggle-title">{{ 'settings.require_2fa' | t }}</span>
                  <span class="toggle-desc">{{ 'settings.prinuditelno_trebovat_dvuhfaktornuyu_autentifika' | t }}</span>
                </div>
                <label class="switch-toggle">
                  <input
                    id="settings-require-2fa"
                    name="settingsRequire2fa"
                    type="checkbox"
                    aria-labelledby="settings-require-2fa-label"
                    [disabled]="!canUpdateSystemSettings() || isSaving()"
                    [checked]="systemSettings()['security.require_2fa'] === 'true'"
                    (change)="toggleRequire2fa($event)"
                  />
                  <span class="toggle-slider" aria-hidden="true"></span>
                </label>
              </div>
            </div>
          </div>

          <div class="card-footer-actions" *ngIf="canUpdateSystemSettings()">
            <ui-button [loading]="isSaving()" (onClick)="saveSystemSettings()">
              {{ 'common.save' | t }}
            </ui-button>
          </div>
        </div>
      </div>

      <!-- =================================================================== -->
      <!-- TAB 3: STORAGE QUOTAS -->
      <!-- =================================================================== -->
      <div id="settings-storage-panel" class="tab-content" role="tabpanel" aria-labelledby="settings-storage-tab" *ngIf="activeTab === 'storage' && canManageSystemSettings()">
        <div class="settings-card">
          <div class="card-header-bar">
            <div class="card-title-group">
              <span class="material-symbols-outlined card-icon" aria-hidden="true">folder_shared</span>
              <div>
                <h3 class="card-title">{{ 'settings.parametry_hranilischa_i_kvoty' | t }}</h3>
                <p class="card-desc">{{ 'settings.limity_diskovogo_prostranstva_dlya_novyh_sotrudn' | t }}</p>
              </div>
            </div>
            <span class="badge badge-neutral" *ngIf="!canUpdateSystemSettings()">{{ 'settings.readonly_badge' | t }}</span>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="settings-user-quota">
                {{ 'settings.default_user_quota' | t }}
                <span class="unit-badge" *ngIf="formatQuotaMb(systemSettings()['storage.default_user_quota_mb']) as quotaBadge">
                  {{ quotaBadge }}
                </span>
              </label>
              <input
                id="settings-user-quota"
                name="settingsUserQuota"
                type="number"
                min="100"
                max="102400"
                class="form-input"
                [disabled]="!canUpdateSystemSettings() || isSaving()"
                aria-describedby="settings-user-quota-hint"
                [(ngModel)]="systemSettings()['storage.default_user_quota_mb']"
              />
              <span id="settings-user-quota-hint" class="hint-text">{{ 'settings.1024_mb_1_gb_na_kazhdogo_sotrudnika' | t }}</span>
            </div>
          </div>

          <div class="card-footer-actions" *ngIf="canUpdateSystemSettings()">
            <ui-button [loading]="isSaving()" (onClick)="saveSystemSettings()">
              {{ 'common.save' | t }}
            </ui-button>
          </div>
        </div>
      </div>

      <!-- =================================================================== -->
      <!-- TAB 4: USER PREFERENCES -->
      <!-- =================================================================== -->
      <div id="settings-preferences-panel" class="tab-content" role="tabpanel" aria-labelledby="settings-preferences-tab" *ngIf="activeTab === 'preferences'">
        <div class="settings-card">
          <div class="card-header-bar">
            <div class="card-title-group">
              <span class="material-symbols-outlined card-icon" aria-hidden="true">palette</span>
              <div>
                <h3 class="card-title">{{ 'settings.personalnye_predpochteniya' | t }}</h3>
                <p class="card-desc">{{ 'settings.nastroyki_vneshnego_vida_i_yazyka_dlya_vashey_uc' | t }}</p>
              </div>
            </div>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="settings-interface-language">{{ 'settings.yazyk_interfeysa' | t }}</label>
              <select id="settings-interface-language" name="settingsInterfaceLanguage" class="form-select" [disabled]="isSaving()" [ngModel]="i18n.currentLang()" (ngModelChange)="changePersonalLang($event)">
                <option *ngFor="let lang of i18n.languages()" [value]="lang.code">
                  {{ lang.name }} ({{ lang.code.toUpperCase() }})
                </option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-theme">{{ 'settings.theme' | t }}</label>
              <select id="settings-theme" name="settingsTheme" class="form-select" [disabled]="isSaving()" [ngModel]="userThemePreference()" (ngModelChange)="onThemeChange($event)">
                <option value="dark">{{ 'settings.temnaya_dark_premium' | t }}</option>
                <option value="light">{{ 'settings.svetlaya_light_clean' | t }}</option>
                <option value="system">{{ 'settings.sistemnaya_tema' | t }}</option>
              </select>
            </div>

            <div class="form-group full-width">
              <div class="toggle-row">
                <div class="toggle-info">
                  <span id="settings-notification-sound-label" class="toggle-title">{{ 'settings.notifications_sound' | t }}</span>
                  <span class="toggle-desc">{{ 'settings.vosproizvodit_zvukovoy_signal_pri_poluchenii_nov' | t }}</span>
                </div>
                <label class="switch-toggle">
                  <input
                    id="settings-notification-sound"
                    name="settingsNotificationSound"
                    type="checkbox"
                    aria-labelledby="settings-notification-sound-label"
                    [disabled]="isSaving()"
                    [checked]="userSettings()['user.notifications_sound'] !== 'false'"
                    (change)="toggleSound($event)"
                  />
                  <span class="toggle-slider" aria-hidden="true"></span>
                </label>
              </div>
            </div>
          </div>

          <div class="card-footer-actions">
            <ui-button [loading]="isSaving()" (onClick)="saveUserSettings()">
              {{ 'common.save' | t }}
            </ui-button>
          </div>
        </div>
      </div>

      <!-- =================================================================== -->
      <!-- TAB 6: LANGUAGES & TRANSLATIONS -->
      <!-- =================================================================== -->
      <div id="settings-languages-panel" class="tab-content" role="tabpanel" aria-labelledby="settings-languages-tab" *ngIf="activeTab === 'languages' && canManageSystemSettings()">
        <app-language-editor
          *ngIf="editingLanguageCode() as code"
          [languageCode]="code"
          (closed)="editingLanguageCode.set(null)"
          (saved)="onLanguageSaved()"
        />

        <div class="settings-card" *ngIf="!editingLanguageCode()">
          <div class="legacy-import" *ngIf="legacyLanguageCount() > 0" role="status">
            <div>
              <strong>{{ 'settings.legacy_packages_found' | t:{count: legacyLanguageCount()} }}</strong>
              <span>{{ 'settings.perenesite_ih_v_obschee_servernoe_hranilische_ch' | t }}</span>
            </div>
            <button
              id="migrate-legacy-languages"
              type="button"
              class="btn btn-secondary"
              *ngIf="canUpdateSystemSettings()"
              [disabled]="isMigratingLegacyLanguages()"
              (click)="migrateLegacyLanguages()"
            >
              {{ (isMigratingLegacyLanguages() ? 'settings.migrating' : 'settings.migrate') | t }}
            </button>
          </div>
          <div class="card-header-bar">
            <div class="card-title-group">
              <span class="material-symbols-outlined card-icon" aria-hidden="true">translate</span>
              <div>
                <h3 class="card-title">{{ 'settings.upravlenie_yazykovymi_paketami_i_lokalizaciey' | t }}</h3>
                <p class="card-desc">{{ 'settings.dinamicheskoe_dobavlenie_novyh_yazykov_i_import_' | t }}</p>
              </div>
            </div>
            <button type="button" class="btn btn-primary" *ngIf="canUpdateSystemSettings()" (click)="openAddLangModal()">
              <span class="material-symbols-outlined" aria-hidden="true">add</span>
              <span>{{ 'settings.dobavit_yazyk' | t }}</span>
            </button>
          </div>

          <div class="table-card">
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{{ 'settings.kod' | t }}</th>
                    <th>{{ 'settings.nazvanie_yazyka' | t }}</th>
                    <th>{{ 'settings.tip' | t }}</th>
                    <th>{{ 'settings.gotovnost' | t }}</th>
                    <th>{{ 'common.status' | t }}</th>
                    <th style="text-align: right;">{{ 'common.actions' | t }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let lang of i18n.languages()">
                    <td><span class="badge badge-neutral mono">{{ lang.code.toUpperCase() }}</span></td>
                    <td class="font-medium">{{ lang.name }}</td>
                    <td>
                      <span class="badge" [class.badge-active]="lang.builtin" [class.badge-info]="!lang.builtin">
                        {{ (lang.builtin ? 'settings.builtin' : 'settings.custom') | t }}
                      </span>
                    </td>
                    <td>
                      <div class="language-coverage" [attr.aria-label]="'settings.coverage_percent' | t:{coverage: lang.coverage}">
                        <span class="coverage-track"><span [style.width.%]="lang.coverage"></span></span>
                        <span>{{ lang.translated }}/{{ lang.total }} · {{ lang.coverage }}%</span>
                      </div>
                    </td>
                    <td>
                      <span class="badge badge-active" *ngIf="i18n.currentLang() === lang.code">{{ 'settings.tekuschiy_aktivnyy' | t }}</span>
                      <span class="badge badge-neutral" *ngIf="i18n.currentLang() !== lang.code">{{ 'settings.dostupen' | t }}</span>
                    </td>
                    <td style="text-align: right;">
                      <div class="table-actions-right">
                        <button type="button" class="btn btn-secondary btn-sm" [attr.data-testid]="'edit-language-' + lang.code" (click)="openLanguageEditor(lang.code)">
                          <span class="material-symbols-outlined" aria-hidden="true">edit</span>
                          <span>{{ 'common.edit' | t }}</span>
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm" (click)="exportLangJson(lang.code)" [title]="'settings.eksportirovat_json' | t">
                          <span class="material-symbols-outlined" aria-hidden="true">download</span>
                          <span>JSON</span>
                        </button>
                        <button type="button" class="btn btn-primary btn-sm" [attr.data-testid]="'switch-language-' + lang.code" *ngIf="i18n.currentLang() !== lang.code" (click)="switchLanguage(lang.code)">
                          <span>{{ 'settings.pereklyuchitsya' | t }}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Modal: Add New Custom Language -->
    <ui-modal
      *ngIf="isAddLangModalOpen()"
      [isOpen]="isAddLangModalOpen()"
      [title]="'settings.dobavlenie_novogo_yazyka' | t"
      [ariaLabel]="'settings.dobavlenie_novogo_yazyka' | t"
      (close)="isAddLangModalOpen.set(false)"
    >
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label" for="new-lang-code">{{ 'settings.kod_yazyka_iso_639_1' | t }}</label>
          <input id="new-lang-code" type="text" class="form-input" [(ngModel)]="newLangCode" placeholder="kk, ky, tg, de, tr" maxlength="10">
        </div>
        <div class="form-group">
          <label class="form-label" for="new-lang-name">{{ 'settings.nazvanie_yazyka' | t }}</label>
          <input id="new-lang-name" type="text" class="form-input" [(ngModel)]="newLangName" [placeholder]="'settings.aza_sha_deutsch_etc' | t">
        </div>
        <div class="form-group full-width">
          <label class="form-label" for="new-lang-json">{{ 'settings.json_slovar_perevodov_opcionalno' | t }}</label>
          <textarea id="new-lang-json" class="form-input mono" rows="6" [(ngModel)]="newLangJson" [placeholder]="'settings.translation_json_example' | t"></textarea>
        </div>
      </div>
      <div modal-footer class="modal-footer-btns">
        <ui-button variant="secondary" (onClick)="isAddLangModalOpen.set(false)" [disabled]="isAddingLang()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="primary" [loading]="isAddingLang()" (onClick)="saveNewLanguage()" [disabled]="!newLangCode.trim() || !newLangName.trim()">{{ 'settings.sohranit_yazyk' | t }}</ui-button>
      </div>
    </ui-modal>

  `,
  styles: [`
    .settings-page {
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding: 0;
      width: 100%;
      min-width: 0;
      max-width: 1280px;
      margin: 0 auto;
    }

    .toolbar {
      width: 100%;
      min-width: 0;
      max-width: 100%;
      flex-wrap: nowrap;
      overflow-x: auto;
      overscroll-behavior-x: contain;
    }

    .status-tabs {
      min-width: max-content;
      flex: 0 0 max-content;
      margin-inline: 8px;
    }

    .view-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .header-left {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .view-title {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-main);
      margin: 0;
    }

    .view-subtitle {
      font-size: 13px;
      color: var(--text-light);
    }

    .icon-refresh-btn {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      background: var(--bg-surface);
      color: var(--text-light);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .icon-refresh-btn:hover {
      background: var(--bg-hover);
      color: var(--text-main);
    }

    /* Tabs */
    .tabs-nav-bar {
      display: flex;
      border-bottom: 1px solid var(--border-color);
    }

    .tab-buttons {
      display: flex;
      gap: 4px;
    }

    .nav-tab-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border: none;
      background: transparent;
      color: var(--text-light);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.15s ease;
    }

    .nav-tab-btn .material-symbols-outlined {
      font-size: 18px;
    }

    .nav-tab-btn.active {
      color: var(--primary-text);
      border-bottom-color: var(--primary);
    }

    /* Settings Card */
    .settings-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .card-header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 16px;
    }

    .card-title-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .card-icon {
      font-size: 28px;
      color: var(--primary-text);
    }

    .card-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-main);
      margin: 0;
    }

    .card-desc {
      font-size: 13px;
      color: var(--text-light);
      margin: 2px 0 0 0;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 18px;
    }

    @media (max-width: 768px) {
      .form-grid {
        grid-template-columns: 1fr;
      }
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-group.full-width {
      grid-column: span 2;
    }

    @media (max-width: 768px) {
      .form-group.full-width {
        grid-column: span 1;
      }
    }

    .form-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-main);
    }

    .form-input, .form-select {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 9px 12px;
      color: var(--text-main);
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s ease;
    }

    .form-input:focus, .form-select:focus {
      border-color: var(--primary);
    }

    .form-select option {
      background: var(--bg-surface);
      color: var(--text-main);
    }

    .hint-text {
      font-size: 11px;
      color: var(--text-light);
    }

    /* Toggle Switch */
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      background: var(--bg-hover);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
    }

    .toggle-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .toggle-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-main);
    }

    .toggle-desc {
      font-size: 12px;
      color: var(--text-light);
    }

    .switch-toggle {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 24px;
    }

    .switch-toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--bg-active);
      transition: .2s;
      border-radius: 24px;
    }

    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background-color: var(--text-inverse);
      transition: .2s;
      border-radius: 50%;
    }

    input:checked + .toggle-slider {
      background-color: var(--primary);
    }

    input:checked + .toggle-slider:before {
      transform: translateX(20px);
    }

    .card-footer-actions {
      display: flex;
      justify-content: flex-end;
      padding-top: 12px;
      border-top: 1px solid var(--border-subtle);
    }

    .language-coverage {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 112px;
      color: var(--text-light);
      font-size: 11px;
    }

    .coverage-track {
      display: block;
      width: 100%;
      height: 5px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--bg-active);
    }

    .coverage-track > span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--primary);
    }
    .legacy-import {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin: 16px 20px 0;
      padding: 12px 14px;
      border: 1px solid var(--warning);
      border-radius: 9px;
      color: var(--text-main);
      background: var(--warning-bg);
    }
    .legacy-import > div { display: grid; gap: 3px; }
    .legacy-import span { color: var(--text-muted); font-size: 12px; }
    .switch-toggle input:focus-visible + .toggle-slider {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }

    .load-error-banner {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 8px;
      background: var(--danger-bg);
      color: var(--danger);
      border: 1px solid var(--danger);
    }

    .table-actions-right {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      white-space: nowrap;
    }

    .badge-active {
      background-color: var(--success-bg);
      color: var(--success);
    }

    .unit-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      margin-left: 6px;
      font-size: 11px;
      font-weight: 600;
      color: var(--primary-text);
      background: var(--primary-subtle);
      border-radius: var(--radius-sm);
    }
    .load-error-text {
      flex: 1;
      font-size: 14px;
    }

    @media (max-width: 680px) {
      .legacy-import { align-items: stretch; flex-direction: column; }
    }

  `]
})
export class SettingsComponent implements OnInit, OnDestroy {
  private readonly uiI18n = inject(I18nService);
  private readonly themeService = inject(ThemeService);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private pendingTabFocusScroll: ReturnType<typeof setTimeout> | null = null;
  activeTab: 'general' | 'security' | 'storage' | 'preferences' | 'languages' | 'search' | 'navigation' = 'general';

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
    this.legacyLanguageCount.set(Object.keys(this.readLegacyLanguages()).length);
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
    const legacyLanguages = this.readLegacyLanguages();
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

  setTab(tab: 'general' | 'security' | 'storage' | 'preferences' | 'languages' | 'search' | 'navigation'): void {
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
    const tabs: Array<'general' | 'security' | 'storage' | 'preferences' | 'languages' | 'search' | 'navigation'> = [
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

  isCustomTimezone(tz: string | undefined): boolean {
    if (!tz) return false;
    const known = [
      'Asia/Tashkent', 'Asia/Samarkand', 'Asia/Almaty', 'Asia/Bishkek',
      'Asia/Dushanbe', 'Asia/Ashgabat', 'Asia/Baku', 'Europe/Moscow',
      'Europe/Istanbul', 'Europe/Berlin', 'Europe/London', 'UTC'
    ];
    return !known.includes(tz);
  }

  isCustomDateFormat(df: string | undefined): boolean {
    if (!df) return false;
    const known = [
      'dd.MM.yyyy HH:mm', 'yyyy-MM-dd HH:mm', 'MM/dd/yyyy hh:mm a',
      'dd.MM.yyyy', 'dd/MM/yyyy HH:mm'
    ];
    return !known.includes(df);
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
    const translations = this.filterKnownTranslations(legacy.dict, knownKeys);
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

  private filterKnownTranslations(
    dictionary: TranslationDictionary,
    knownKeys: Set<string>
  ): TranslationDictionary {
    return Object.fromEntries(Object.entries(dictionary).filter(([key, value]) =>
      knownKeys.has(key) && typeof value === 'string' && value.trim().length > 0 && value.length <= 4000
    ));
  }

  private readLegacyLanguages(): Record<string, LegacyLanguage> {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem('dwh_custom_languages') ?? '{}');
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
      const result: Record<string, LegacyLanguage> = {};
      for (const [rawCode, rawEntry] of Object.entries(parsed)) {
        const code = rawCode.trim().toLowerCase();
        if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code)
            || !rawEntry || Array.isArray(rawEntry) || typeof rawEntry !== 'object') continue;
        const entry = rawEntry as { name?: unknown; dict?: unknown };
        if (typeof entry.name !== 'string' || !entry.name.trim()
            || !entry.dict || Array.isArray(entry.dict) || typeof entry.dict !== 'object') continue;
        const dict = Object.fromEntries(Object.entries(entry.dict).filter((pair): pair is [string, string] =>
          typeof pair[1] === 'string'
        ));
        result[code] = { name: entry.name.trim(), dict };
      }
      return result;
    } catch {
      return {};
    }
  }

}

interface LegacyLanguage {
  name: string;
  dict: TranslationDictionary;
}
