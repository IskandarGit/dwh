import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { AnalyticsSummary } from '../analytics.models';

@Component({
  selector: 'app-analytics-metrics-tiles',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe
  ],
  template: `
    <div class="tiles">
      <!-- 1. Всего задач -->
      <div class="tile">
        <div class="tile-header">
          <span class="tile-label">{{ 'analytics.vsego_zadach' | t }}</span>
          <span class="material-symbols-outlined tile-ico" style="color: var(--primary);">task_alt</span>
        </div>
        <div class="tile-value">{{ summary?.totalTasks || 0 }}</div>
        <div class="tile-meta">
          <span class="text-success" style="font-weight: 600;">{{ 'analytics.active_count' | t:{count: summary?.activeTasks || 0} }}</span>
          <span class="meta-dot">·</span>
          <span class="text-muted">{{ 'analytics.completed_count' | t:{count: summary?.completedTasks || 0} }}</span>
        </div>
      </div>

      <!-- 2. Эффективность закрытия -->
      <div class="tile">
        <div class="tile-header">
          <span class="tile-label">{{ 'analytics.effektivnost_zakrytiya' | t }}</span>
          <span class="material-symbols-outlined tile-ico" style="color: var(--success);">trending_up</span>
        </div>
        <div class="tile-value">{{ summary?.completionRatePercent || 0 }}%</div>
        <div class="tile-meta">
          <span class="text-success" style="font-weight: 600;">{{ 'analytics.completed_last_7d' | t:{count: summary?.completedLast7d || 0} }}</span>
          <span class="meta-dot">·</span>
          <span class="text-muted">{{ 'analytics.created_count' | t:{count: summary?.createdLast7d || 0} }}</span>
        </div>
      </div>

      <!-- 3. Просроченные задачи -->
      <div class="tile" [class.tile-alarm]="(summary?.overdueTasks || 0) > 0">
        <div class="tile-header">
          <span class="tile-label">{{ 'analytics.prosrocheno_dedlaynov' | t }}</span>
          <span class="material-symbols-outlined tile-ico" [style.color]="(summary?.overdueTasks || 0) > 0 ? 'var(--danger)' : 'var(--text-light)'">
            {{ (summary?.overdueTasks || 0) > 0 ? 'warning' : 'verified' }}
          </span>
        </div>
        <div class="tile-value" [style.color]="(summary?.overdueTasks || 0) > 0 ? 'var(--danger)' : 'var(--text-main)'">
          {{ summary?.overdueTasks || 0 }}
        </div>
        <div class="tile-meta">
          <span *ngIf="(summary?.overdueTasks || 0) > 0" class="text-danger" style="font-weight: 600;">{{ 'analytics.trebuyut_vnimaniya' | t }}</span>
          <span *ngIf="(summary?.overdueTasks || 0) === 0" class="text-success" style="font-weight: 600;">{{ 'analytics.vse_zadachi_v_grafike' | t }}</span>
        </div>
      </div>

      <!-- 4. Активность проектов -->
      <div class="tile">
        <div class="tile-header">
          <span class="tile-label">{{ 'analytics.proekty_i_resursy' | t }}</span>
          <span class="material-symbols-outlined tile-ico" style="color: var(--warning);">folder_special</span>
        </div>
        <div class="tile-value">{{ summary?.activeProjectsCount || 0 }}</div>
        <div class="tile-meta">
          <span class="text-muted">{{ 'analytics.active_users_count' | t:{count: summary?.activeUsersCount || 0} }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .tiles {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }

    @media (max-width: 1200px) {
      .tiles {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 640px) {
      .tiles {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .tile {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      box-shadow: var(--shadow-sm);
      transition: all 0.15s ease;
    }

    .tile:hover {
      box-shadow: var(--shadow-md);
    }

    .tile-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
    }

    .tile-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-main);
      line-height: 1.1;
    }

    .tile-alarm {
      border-color: rgba(220, 38, 38, 0.4);
      background: linear-gradient(to bottom right, var(--bg-surface), var(--danger-bg));
    }

    .tile-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .tile-ico {
      font-size: 20px;
    }
    .tile-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      overflow-wrap: anywhere;
      gap: 6px;
      font-size: 11px;
      margin-top: 4px;
    }
    .meta-dot {
      color: var(--text-light);
    }
    .text-success { color: var(--success); }
    .text-danger { color: var(--danger); }
    .text-muted { color: var(--text-muted); }
  `]
})
export class AnalyticsMetricsTilesComponent {
  @Input() summary: AnalyticsSummary | null = null;
}
