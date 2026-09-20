import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../../core/services/i18n.service';

@Component({
  selector: 'app-modules-stats',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon-wrapper primary">
          <span class="material-symbols-outlined">extension</span>
        </div>
        <div class="stat-content">
          <span class="stat-value">{{ totalCount() }}</span>
          <span class="stat-label">{{ 'modules.stat.total' | t }}</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon-wrapper success">
          <span class="material-symbols-outlined">check_circle</span>
        </div>
        <div class="stat-content">
          <span class="stat-value">{{ activeCount() }}</span>
          <span class="stat-label">{{ 'modules.stat.active' | t }}</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon-wrapper info">
          <span class="material-symbols-outlined">verified_user</span>
        </div>
        <div class="stat-content">
          <span class="stat-value">{{ systemCount() }}</span>
          <span class="stat-label">{{ 'modules.stat.system' | t }}</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon-wrapper neutral">
          <span class="material-symbols-outlined">widgets</span>
        </div>
        <div class="stat-content">
          <span class="stat-value">{{ customCount() }}</span>
          <span class="stat-label">{{ 'modules.stat.custom' | t }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
    }
    .stat-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
    }
    .stat-icon-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: var(--radius-md);
      flex-shrink: 0;
    }
    .stat-icon-wrapper.primary {
      background: var(--primary-subtle);
      color: var(--primary);
    }
    .stat-icon-wrapper.success {
      background: rgba(16, 185, 129, 0.1);
      color: var(--success);
    }
    .stat-icon-wrapper.info {
      background: rgba(59, 130, 246, 0.1);
      color: #3b82f6;
    }
    .stat-icon-wrapper.neutral {
      background: var(--bg-hover);
      color: var(--text-muted);
    }
    .stat-icon-wrapper .material-symbols-outlined {
      font-size: 22px;
    }
    .stat-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .stat-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--text-main);
      line-height: 1.2;
    }
    .stat-label {
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 500;
    }
    @media (max-width: 900px) {
      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    @media (max-width: 480px) {
      .stats-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class ModulesStatsComponent {
  readonly totalCount = input.required<number>();
  readonly activeCount = input.required<number>();
  readonly systemCount = input.required<number>();
  readonly customCount = input.required<number>();
}
