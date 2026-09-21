import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, I18nService } from '../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';

@Component({
  selector: 'app-settings-storage-panel',
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
          <span class="material-symbols-outlined card-icon" aria-hidden="true">folder_shared</span>
          <div>
            <h3 class="card-title">{{ 'settings.parametry_hranilischa_i_kvoty' | t }}</h3>
            <p class="card-desc">{{ 'settings.limity_diskovogo_prostranstva_dlya_novyh_sotrudn' | t }}</p>
          </div>
        </div>
        <span class="badge badge-neutral" *ngIf="!canUpdateSystemSettings">{{ 'settings.readonly_badge' | t }}</span>
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label class="form-label" for="settings-user-quota">
            {{ 'settings.default_user_quota' | t }}
            <span class="unit-badge" *ngIf="formatQuotaMb(systemSettings['storage.default_user_quota_mb']) as quotaBadge">
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
            [disabled]="!canUpdateSystemSettings || isSaving"
            aria-describedby="settings-user-quota-hint"
            [(ngModel)]="systemSettings['storage.default_user_quota_mb']"
          />
          <span id="settings-user-quota-hint" class="hint-text">{{ 'settings.1024_mb_1_gb_na_kazhdogo_sotrudnika' | t }}</span>
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
export class SettingsStoragePanelComponent {
  private readonly i18n = inject(I18nService);

  @Input() systemSettings: Record<string, string> = {};
  @Input() canUpdateSystemSettings = false;
  @Input() isSaving = false;
  @Output() save = new EventEmitter<void>();

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
}
