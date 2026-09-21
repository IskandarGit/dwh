import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../../core/services/i18n.service';

@Component({
  selector: 'app-navigation-settings-stats',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe
  ],
  template: `
    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-value">{{ totalCount }}</span>
        <span class="stat-label">{{ 'nav.settings.stat_total' | t }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-value stat-active">{{ activeCount }}</span>
        <span class="stat-label">{{ 'nav.settings.stat_active' | t }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-value stat-embedded">{{ embeddedCount }}</span>
        <span class="stat-label">{{ 'nav.settings.stat_embedded' | t }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-value stat-external">{{ externalCount }}</span>
        <span class="stat-label">{{ 'nav.settings.stat_external' | t }}</span>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
    }

    .stat-card {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      box-shadow: var(--shadow-sm);
    }

    .stat-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-main);
      line-height: 1.2;
    }

    .stat-value.stat-active { color: #059669; }
    .stat-value.stat-embedded { color: #2563eb; }
    .stat-value.stat-external { color: #7c3aed; }

    .stat-label {
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 500;
    }
  `]
})
export class NavigationSettingsStatsComponent {
  @Input() totalCount = 0;
  @Input() activeCount = 0;
  @Input() embeddedCount = 0;
  @Input() externalCount = 0;
}
