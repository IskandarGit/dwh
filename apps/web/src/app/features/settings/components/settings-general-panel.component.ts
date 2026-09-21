import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';

@Component({
  selector: 'app-settings-general-panel',
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
          <span class="material-symbols-outlined card-icon" aria-hidden="true">corporate_fare</span>
          <div>
            <h3 class="card-title">{{ 'settings.konfiguraciya_kompanii' | t }}</h3>
            <p class="card-desc">{{ 'settings.globalnye_parametry_dlya_vseh_sotrudnikov_organi' | t }}</p>
          </div>
        </div>
        <span class="badge badge-neutral" *ngIf="!canUpdateSystemSettings">{{ 'settings.readonly_badge' | t }}</span>
      </div>

      <div class="form-grid">
        <div class="form-group full-width">
          <label class="form-label" for="settings-company-name">{{ 'settings.company_name' | t }}</label>
          <input
            id="settings-company-name"
            name="settingsCompanyName"
            type="text"
            class="form-input"
            [disabled]="!canUpdateSystemSettings || isSaving"
            [(ngModel)]="systemSettings['system.company_name']"
            placeholder="SmartupCMS"
          />
        </div>

        <div class="form-group">
          <label class="form-label" for="settings-default-language">{{ 'settings.default_language' | t }}</label>
          <select id="settings-default-language" name="settingsDefaultLanguage" class="form-select" [disabled]="!canUpdateSystemSettings || isSaving" [(ngModel)]="systemSettings['system.default_language']">
            <option *ngFor="let lang of languages" [value]="lang.code">
              {{ lang.name }} ({{ lang.code.toUpperCase() }})
            </option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="settings-default-timezone">{{ 'settings.default_timezone' | t }}</label>
          <select id="settings-default-timezone" name="settingsDefaultTimezone" class="form-select" [disabled]="!canUpdateSystemSettings || isSaving" [(ngModel)]="systemSettings['system.default_timezone']">
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
            <option *ngIf="isCustomTimezone(systemSettings['system.default_timezone'])" [value]="systemSettings['system.default_timezone']">
              {{ systemSettings['system.default_timezone'] }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="settings-date-format">{{ 'settings.date_format' | t }}</label>
          <select id="settings-date-format" name="settingsDateFormat" class="form-select" [disabled]="!canUpdateSystemSettings || isSaving" [(ngModel)]="systemSettings['system.date_format']">
            <option value="dd.MM.yyyy HH:mm">29.08.2026 14:30 (dd.MM.yyyy HH:mm)</option>
            <option value="yyyy-MM-dd HH:mm">2026-08-29 14:30 (yyyy-MM-dd HH:mm)</option>
            <option value="MM/dd/yyyy hh:mm a">08/29/2026 02:30 PM (MM/dd/yyyy)</option>
            <option value="dd.MM.yyyy">29.08.2026 (dd.MM.yyyy)</option>
            <option value="dd/MM/yyyy HH:mm">29/08/2026 14:30 (dd/MM/yyyy HH:mm)</option>
            <option *ngIf="isCustomDateFormat(systemSettings['system.date_format'])" [value]="systemSettings['system.date_format']">
              {{ systemSettings['system.date_format'] }}
            </option>
          </select>
        </div>
      </div>

      <div class="card-footer-actions" *ngIf="canUpdateSystemSettings">
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
    .card-footer-actions {
      display: flex;
      justify-content: flex-end;
      padding-top: 12px;
      border-top: 1px solid var(--border-subtle);
    }
    .badge-neutral {
      background-color: var(--bg-active);
      color: var(--text-muted);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 600;
      border-radius: var(--radius-xs);
    }
  `]
})
export class SettingsGeneralPanelComponent {
  @Input() systemSettings: Record<string, string> = {};
  @Input() canUpdateSystemSettings = false;
  @Input() isSaving = false;
  @Input() languages: Array<{ code: string; name: string }> = [];
  @Output() save = new EventEmitter<void>();

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
}
