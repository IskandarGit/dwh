import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, I18nService } from '../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';

@Component({
  selector: 'app-settings-security-panel',
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
          <span class="material-symbols-outlined card-icon" aria-hidden="true">lock</span>
          <div>
            <h3 class="card-title">{{ 'settings.politiki_bezopasnosti_i_avtorizacii' | t }}</h3>
            <p class="card-desc">{{ 'settings.trebovaniya_k_parolyam_2fa_i_veb_sessiyam' | t }}</p>
          </div>
        </div>
        <span class="badge badge-neutral" *ngIf="!canUpdateSystemSettings">{{ 'settings.readonly_badge' | t }}</span>
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
            [disabled]="!canUpdateSystemSettings || isSaving"
            aria-describedby="settings-password-length-hint"
            [(ngModel)]="systemSettings['security.min_password_length']"
          />
          <span id="settings-password-length-hint" class="hint-text">{{ 'settings.rekomenduetsya_ne_menee_10_simvolov' | t }}</span>
        </div>

        <div class="form-group">
          <label class="form-label" for="settings-session-lifetime">
            {{ 'settings.session_lifetime' | t }}
            <span class="unit-badge" *ngIf="formatSessionHours(systemSettings['security.session_lifetime_hours']) as sessionBadge">
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
            [disabled]="!canUpdateSystemSettings || isSaving"
            aria-describedby="settings-session-lifetime-hint"
            [(ngModel)]="systemSettings['security.session_lifetime_hours']"
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
                [disabled]="!canUpdateSystemSettings || isSaving"
                [checked]="systemSettings['security.require_2fa'] === 'true'"
                (change)="toggleRequire2fa.emit($event)"
              />
              <span class="toggle-slider" aria-hidden="true"></span>
            </label>
          </div>
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
    .form-input {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 9px 12px;
      color: var(--text-main);
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .form-input:focus {
      border-color: var(--primary);
    }
    .hint-text {
      font-size: 11px;
      color: var(--text-light);
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
  `]
})
export class SettingsSecurityPanelComponent {
  private readonly i18n = inject(I18nService);

  @Input() systemSettings: Record<string, string> = {};
  @Input() canUpdateSystemSettings = false;
  @Input() isSaving = false;
  @Output() save = new EventEmitter<void>();
  @Output() toggleRequire2fa = new EventEmitter<any>();

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
}
