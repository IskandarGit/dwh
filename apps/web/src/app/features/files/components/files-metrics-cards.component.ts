import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StorageStats } from '../files.models';
import { TranslatePipe } from '../../../core/services/i18n.service';

@Component({
  selector: 'app-files-metrics-cards',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe
  ],
  template: `
    <div class="storage-metrics-grid" *ngIf="stats as s">
      <!-- Company Quota Card -->
      <div class="metric-card company-card">
        <div class="metric-header">
          <div class="metric-title-group">
            <span class="material-symbols-outlined card-icon" aria-hidden="true">corporate_fare</span>
            <span class="card-title">{{ 'files.diskovoe_prostranstvo_kompanii' | t }}</span>
          </div>
          <span class="percent-badge" [class.danger]="getCompanyPercent(s) >= 90" [class.warning]="getCompanyPercent(s) >= 75 && getCompanyPercent(s) < 90">
            {{ getCompanyPercent(s) }}%
          </span>
        </div>

        <div class="metric-body">
          <div class="metric-values">
            <span class="used-val">{{ formatBytes(s.companyUsedBytes) }}</span>
            <span class="sep-val">{{ 'files.iz' | t }}</span>
            <span class="quota-val">{{ formatBytes(s.companyQuotaBytes) }}</span>
          </div>

          <div
            class="progress-bar-track"
            role="progressbar"
            [attr.aria-label]="'files.ispolzovanie_hranilischa_kompanii' | t"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-valuenow]="getCompanyPercent(s)"
          >
            <div
              class="progress-bar-fill"
              [style.width.%]="getCompanyPercent(s)"
              [class.danger-fill]="getCompanyPercent(s) >= 90"
              [class.warning-fill]="getCompanyPercent(s) >= 75 && getCompanyPercent(s) < 90"
            ></div>
          </div>

          <div class="metric-footer">
            <span>{{ 'files.available_space' | t:{size: formatBytes(s.companyAvailableBytes)} }}</span>
            <span>{{ 'files.total_files_count' | t:{count: s.totalFilesCount} }}</span>
          </div>
        </div>
      </div>

      <!-- User Personal Quota Card -->
      <div class="metric-card user-card">
        <div class="metric-header">
          <div class="metric-title-group">
            <span class="material-symbols-outlined card-icon" aria-hidden="true">person</span>
            <span class="card-title">{{ 'files.moya_personalnaya_kvota' | t }}</span>
          </div>
          <span class="percent-badge user-badge" [class.danger]="getUserPercent(s) >= 90" [class.warning]="getUserPercent(s) >= 75 && getUserPercent(s) < 90">
            {{ getUserPercent(s) }}%
          </span>
        </div>

        <div class="metric-body">
          <div class="metric-values">
            <span class="used-val">{{ formatBytes(s.userUsedBytes) }}</span>
            <span class="sep-val">{{ 'files.iz' | t }}</span>
            <span class="quota-val">{{ formatBytes(s.userQuotaBytes) }}</span>
          </div>

          <div
            class="progress-bar-track"
            role="progressbar"
            [attr.aria-label]="'files.ispolzovanie_personalnoy_kvoty' | t"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-valuenow]="getUserPercent(s)"
          >
            <div
              class="progress-bar-fill user-fill"
              [style.width.%]="getUserPercent(s)"
              [class.danger-fill]="getUserPercent(s) >= 90"
              [class.warning-fill]="getUserPercent(s) >= 75 && getUserPercent(s) < 90"
            ></div>
          </div>

          <div class="metric-footer">
            <span>{{ 'files.available_space' | t:{size: formatBytes(s.userAvailableBytes)} }}</span>
            <span>{{ 'files.my_files_count' | t:{count: s.userFilesCount} }}</span>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .storage-metrics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    @media (max-width: 768px) {
      .storage-metrics-grid {
        grid-template-columns: 1fr;
      }
    }

    .metric-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .metric-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .metric-title-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .card-icon {
      font-size: 20px;
      color: var(--primary-text);
    }

    .card-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-main);
    }

    .percent-badge {
      font-size: 12px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 6px;
      background: var(--primary-subtle);
      color: var(--primary-text);
    }

    .percent-badge.warning { background: var(--warning-bg); color: var(--warning); }
    .percent-badge.danger { background: var(--danger-bg); color: var(--danger); }

    .user-badge {
      background: var(--info-bg);
      color: var(--info);
    }

    .metric-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .metric-values {
      display: flex;
      align-items: baseline;
      gap: 6px;
      font-size: 13px;
    }

    .used-val {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-main);
    }

    .sep-val {
      color: var(--text-muted);
      font-size: 12px;
    }

    .quota-val {
      color: var(--text-muted);
      font-weight: 500;
    }

    .progress-bar-track {
      height: 6px;
      background: var(--bg-hover);
      border-radius: 3px;
      overflow: hidden;
      position: relative;
    }

    .progress-bar-fill {
      height: 100%;
      background: var(--primary);
      border-radius: 3px;
      transition: width 0.3s ease;
    }

    .progress-bar-fill.user-fill {
      background: var(--info);
    }

    .progress-bar-fill.warning-fill {
      background: var(--warning);
    }

    .progress-bar-fill.danger-fill {
      background: var(--danger);
    }

    .metric-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: var(--text-muted);
    }
  `]
})
export class FilesMetricsCardsComponent {
  @Input() stats: StorageStats | null = null;

  getCompanyPercent(s: StorageStats): number {
    if (!s.companyQuotaBytes || s.companyQuotaBytes === 0) return 0;
    return Math.min(100, Math.round((s.companyUsedBytes / s.companyQuotaBytes) * 100));
  }

  getUserPercent(s: StorageStats): number {
    if (!s.userQuotaBytes || s.userQuotaBytes === 0) return 0;
    return Math.min(100, Math.round((s.userUsedBytes / s.userQuotaBytes) * 100));
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
