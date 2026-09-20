import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';

@Component({
  selector: 'app-settings-preferences-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    UiButtonComponent
  ],
  template: `
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
          <select
            id="settings-interface-language"
            name="settingsInterfaceLanguage"
            class="form-select"
            [disabled]="isSaving"
            [ngModel]="currentLang"
            (ngModelChange)="changeLanguage.emit($event)"
          >
            <option *ngFor="let lang of languages" [value]="lang.code">
              {{ lang.name }} ({{ lang.code.toUpperCase() }})
            </option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="settings-theme">{{ 'settings.theme' | t }}</label>
          <select
            id="settings-theme"
            name="settingsTheme"
            class="form-select"
            [disabled]="isSaving"
            [ngModel]="userThemePreference"
            (ngModelChange)="themeChange.emit($event)"
          >
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
                [disabled]="isSaving"
                [checked]="userSettings['user.notifications_sound'] !== 'false'"
                (change)="toggleSound.emit($event)"
              />
              <span class="toggle-slider" aria-hidden="true"></span>
            </label>
          </div>
        </div>
      </div>

      <div class="card-footer-actions">
        <ui-button [loading]="isSaving" (onClick)="save.emit()">
          {{ 'common.save' | t }}
        </ui-button>
      </div>
    </div>
  `,
  styles: [`
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
    .form-select {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 9px 12px;
      color: var(--text-main);
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .form-select:focus {
      border-color: var(--primary);
    }
    .form-select option {
      background: var(--bg-surface);
      color: var(--text-main);
    }
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
    .switch-toggle input:focus-visible + .toggle-slider {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }
    .card-footer-actions {
      display: flex;
      justify-content: flex-end;
      padding-top: 12px;
      border-top: 1px solid var(--border-subtle);
    }
  `]
})
export class SettingsPreferencesPanelComponent {
  @Input() userSettings: Record<string, string> = {};
  @Input() isSaving = false;
  @Input() currentLang = '';
  @Input() languages: Array<{ code: string; name: string }> = [];
  @Input() userThemePreference = '';

  @Output() save = new EventEmitter<void>();
  @Output() changeLanguage = new EventEmitter<string>();
  @Output() themeChange = new EventEmitter<string>();
  @Output() toggleSound = new EventEmitter<any>();
}
