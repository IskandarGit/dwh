import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, Subscription, forkJoin } from 'rxjs';
import { UiButtonComponent } from '../../shared/ui/ui-button.component';
import { UiBadgeComponent } from '../../shared/ui/ui-badge.component';
import { TranslatePipe, I18nService } from '../../core/services/i18n.service';

export interface AnalyticsSummary {
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  overdueTasks: number;
  completionRatePercent: number;
  createdLast7d: number;
  completedLast7d: number;
  activeProjectsCount: number;
  activeUsersCount: number;
}

export interface TrendDataPoint {
  date: string;
  createdCount: number;
  completedCount: number;
}

export interface ProjectDistribution {
  projectId: number;
  projectName: string;
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  progressPercent: number;
}

export interface UserWorkload {
  userId: number;
  userName: string;
  userLogin: string;
  assignedTasks: number;
  completedTasks: number;
}

export type WorkloadSortColumn = 'name' | 'login' | 'assigned' | 'completed' | 'efficiency';
export type SortDirection = 'asc' | 'desc';

export interface ChartPoint {
  x: number;
  yCreated: number;
  yCompleted: number;
  label: string;
  date: string;
  created: number;
  completed: number;
}

export interface YAxisTick {
  y: number;
  value: number;
}

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    FormsModule,
    UiBadgeComponent,
    UiButtonComponent
  ],
  template: `
    <div class="analytics-container">
      <!-- Header -->
      <div class="view-header">
        <div class="header-left">
          <h1 class="view-title">{{ 'analytics.analitika_i_dashbordy' | t }}</h1>
          <span class="count-badge">PostgreSQL 18 Analytics</span>
        </div>

        <div class="header-right">
          <!-- Time Range Selector -->
          <div class="status-tabs" role="group" [attr.aria-label]="'analytics.period_analitiki' | t">
            <button
              type="button"
              class="status-tab"
              [class.active]="selectedRange === '7d'"
              [attr.aria-pressed]="selectedRange === '7d'"
              (click)="setRange('7d')"
            >
              {{ 'analytics.7_dney' | t }}
            </button>
            <button
              type="button"
              class="status-tab"
              [class.active]="selectedRange === '30d'"
              [attr.aria-pressed]="selectedRange === '30d'"
              (click)="setRange('30d')"
            >
              {{ 'analytics.30_dney' | t }}
            </button>
            <button
              type="button"
              class="status-tab"
              [class.active]="selectedRange === '90d'"
              [attr.aria-pressed]="selectedRange === '90d'"
              (click)="setRange('90d')"
            >
              {{ 'analytics.90_dney' | t }}
            </button>
          </div>

          <ui-button
            variant="secondary"
            size="sm"
            icon="download"
            (onClick)="exportReport()"
            [title]="'analytics.eksport_spiska_zadach_v_excel' | t"
          >
            {{ 'analytics.eksport' | t }}
          </ui-button>

          <ui-button
            variant="secondary"
            size="sm"
            icon="refresh"
            [loading]="loading()"
            [title]="'common.refresh' | t"
            (onClick)="loadAll()"
          >
            {{ 'common.refresh' | t }}
          </ui-button>
        </div>
      </div>

      <!-- Error Alert -->
      <div *ngIf="error()" class="alert alert-error" role="alert">
        <span class="material-symbols-outlined">error</span>
        <span>{{ error() }}</span>
      </div>

      <!-- KPI Metrics Row -->
      <div class="tiles">
        <!-- 1. Всего задач -->
        <div class="tile">
          <div class="tile-header">
            <span class="tile-label">{{ 'analytics.vsego_zadach' | t }}</span>
            <span class="material-symbols-outlined tile-ico" style="color: var(--primary);">task_alt</span>
          </div>
          <div class="tile-value">{{ summary()?.totalTasks || 0 }}</div>
          <div class="tile-meta">
            <span class="text-success" style="font-weight: 600;">{{ 'analytics.active_count' | t:{count: summary()?.activeTasks || 0} }}</span>
            <span class="meta-dot">·</span>
            <span class="text-muted">{{ 'analytics.completed_count' | t:{count: summary()?.completedTasks || 0} }}</span>
          </div>
        </div>

        <!-- 2. Эффективность закрытия -->
        <div class="tile">
          <div class="tile-header">
            <span class="tile-label">{{ 'analytics.effektivnost_zakrytiya' | t }}</span>
            <span class="material-symbols-outlined tile-ico" style="color: var(--success);">trending_up</span>
          </div>
          <div class="tile-value">{{ summary()?.completionRatePercent || 0 }}%</div>
          <div class="tile-meta">
            <span class="text-success" style="font-weight: 600;">{{ 'analytics.completed_last_7d' | t:{count: summary()?.completedLast7d || 0} }}</span>
            <span class="meta-dot">·</span>
            <span class="text-muted">{{ 'analytics.created_count' | t:{count: summary()?.createdLast7d || 0} }}</span>
          </div>
        </div>

        <!-- 3. Просроченные задачи -->
        <div class="tile" [class.tile-alarm]="(summary()?.overdueTasks || 0) > 0">
          <div class="tile-header">
            <span class="tile-label">{{ 'analytics.prosrocheno_dedlaynov' | t }}</span>
            <span class="material-symbols-outlined tile-ico" [style.color]="(summary()?.overdueTasks || 0) > 0 ? 'var(--danger)' : 'var(--text-light)'">
              {{ (summary()?.overdueTasks || 0) > 0 ? 'warning' : 'verified' }}
            </span>
          </div>
          <div class="tile-value" [style.color]="(summary()?.overdueTasks || 0) > 0 ? 'var(--danger)' : 'var(--text-main)'">
            {{ summary()?.overdueTasks || 0 }}
          </div>
          <div class="tile-meta">
            <span *ngIf="(summary()?.overdueTasks || 0) > 0" class="text-danger" style="font-weight: 600;">{{ 'analytics.trebuyut_vnimaniya' | t }}</span>
            <span *ngIf="(summary()?.overdueTasks || 0) === 0" class="text-success" style="font-weight: 600;">{{ 'analytics.vse_zadachi_v_grafike' | t }}</span>
          </div>
        </div>

        <!-- 4. Активность проектов -->
        <div class="tile">
          <div class="tile-header">
            <span class="tile-label">{{ 'analytics.proekty_i_resursy' | t }}</span>
            <span class="material-symbols-outlined tile-ico" style="color: var(--warning);">folder_special</span>
          </div>
          <div class="tile-value">{{ summary()?.activeProjectsCount || 0 }}</div>
          <div class="tile-meta">
            <span class="text-muted">{{ 'analytics.active_users_count' | t:{count: summary()?.activeUsersCount || 0} }}</span>
          </div>
        </div>
      </div>

      <!-- Main Analytics Grid -->
      <div class="analytics-grid">
        <!-- Trend Chart Card -->
        <div class="analytics-card chart-card" [attr.aria-busy]="loading()">
          <div class="card-header-row">
            <div>
              <h2 class="card-title">{{ 'analytics.dinamika_potoka_zadach' | t }}</h2>
              <p class="card-subtitle">{{ 'analytics.created_vs_completed_range' | t:{range: displayedRange} }}</p>
            </div>
            <div class="chart-legend">
              <div class="legend-item">
                <span class="legend-dot" style="background-color: var(--primary);"></span>
                <span>{{ 'common.created_at' | t }}</span>
              </div>
              <div class="legend-item">
                <span class="legend-dot" style="background-color: var(--success);"></span>
                <span>{{ 'analytics.zaversheno' | t }}</span>
              </div>
            </div>
          </div>

          <p *ngIf="loading()" class="card-subtitle" role="status">{{ 'common.loading' | t }}</p>

          <!-- SVG Area / Line Chart -->
          <div class="svg-chart-container" *ngIf="trends().length > 0"
            role="region" tabindex="0" [attr.aria-label]="'analytics.dinamika_potoka_zadach' | t"
            (mouseleave)="clearHover()">
            <!-- Y Axis numeric tick values -->
            <div class="chart-y-axis" aria-hidden="true">
              <span *ngFor="let tick of yAxisTicks()" class="y-axis-tick font-mono" [style.top.px]="tick.y - 7">
                {{ tick.value }}
              </span>
            </div>

            <svg class="trend-svg" viewBox="0 0 700 240" preserveAspectRatio="none">
              <defs>
                <linearGradient id="createdGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.25"/>
                  <stop offset="100%" stop-color="var(--primary)" stop-opacity="0.0"/>
                </linearGradient>
                <linearGradient id="completedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--success)" stop-opacity="0.25"/>
                  <stop offset="100%" stop-color="var(--success)" stop-opacity="0.0"/>
                </linearGradient>
              </defs>

              <!-- Gridlines -->
              <g class="gridlines">
                <line x1="40" y1="40" x2="680" y2="40" stroke="var(--border-subtle)" stroke-dasharray="3,3"/>
                <line x1="40" y1="90" x2="680" y2="90" stroke="var(--border-subtle)" stroke-dasharray="3,3"/>
                <line x1="40" y1="140" x2="680" y2="140" stroke="var(--border-subtle)" stroke-dasharray="3,3"/>
                <line x1="40" y1="190" x2="680" y2="190" stroke="var(--border-subtle)"/>
              </g>

              <!-- Area Fills -->
              <path [attr.d]="createdAreaPath()" fill="url(#createdGrad)"/>
              <path [attr.d]="completedAreaPath()" fill="url(#completedGrad)"/>

              <!-- Line Strokes -->
              <path [attr.d]="createdLinePath()" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round"/>
              <path [attr.d]="completedLinePath()" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round"/>

              <!-- Hover guideline -->
              <line *ngIf="hoveredPoint() as hp"
                [attr.x1]="hp.x" y1="40"
                [attr.x2]="hp.x" y2="190"
                stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="4,4"
              />

              <!-- Data Dots -->
              <g *ngFor="let pt of chartPoints(); let i = index"
                class="chart-point-group"
                (mouseenter)="setHoveredPoint(pt, i)"
                (focus)="setHoveredPoint(pt, i)"
              >
                <!-- Hit area for easy hovering -->
                <rect [attr.x]="pt.x - 12" y="30" width="24" height="170" fill="transparent" class="hit-area" />

                <circle [attr.cx]="pt.x" [attr.cy]="pt.yCreated" [attr.r]="hoverIndex() === i ? 5.5 : 3.5" fill="var(--bg-surface)" stroke="var(--primary)" stroke-width="2">
                  <title>{{ pt.date }}: {{ 'analytics.sozdano' | t }}: {{ pt.created }}</title>
                </circle>
                <circle [attr.cx]="pt.x" [attr.cy]="pt.yCompleted" [attr.r]="hoverIndex() === i ? 5.5 : 3.5" fill="var(--bg-surface)" stroke="var(--success)" stroke-width="2">
                  <title>{{ pt.date }}: {{ 'analytics.zaversheno' | t }}: {{ pt.completed }}</title>
                </circle>
                <!-- X axis date labels for some points -->
                <text
                  *ngIf="shouldShowDateLabel(i, chartPoints().length)"
                  [attr.x]="pt.x"
                  y="215"
                  font-size="10"
                  text-anchor="middle"
                  fill="var(--text-muted)"
                  font-family="inherit"
                >
                  {{ pt.label }}
                </text>
              </g>
            </svg>

            <!-- Floating Tooltip Card -->
            <div *ngIf="hoveredPoint() as hp" class="chart-tooltip-floating" [style.left.px]="getTooltipLeft(hp.x)">
              <div class="tooltip-date font-mono">{{ hp.date }}</div>
              <div class="tooltip-values">
                <div class="tooltip-val">
                  <span class="tooltip-dot" style="background-color: var(--primary);"></span>
                  <span>{{ 'analytics.sozdano' | t }}: <strong>{{ hp.created }}</strong></span>
                </div>
                <div class="tooltip-val">
                  <span class="tooltip-dot" style="background-color: var(--success);"></span>
                  <span>{{ 'analytics.zaversheno' | t }}: <strong>{{ hp.completed }}</strong></span>
                </div>
              </div>
            </div>
          </div>

          <div *ngIf="trends().length === 0 && !loading() && !error()" class="empty-chart">
            <span class="material-symbols-outlined" style="font-size: 32px; color: var(--text-light);">show_chart</span>
            <p>{{ 'analytics.net_dannyh_za_vybrannyy_period' | t }}</p>
          </div>
        </div>

        <!-- Project Distribution Breakdown -->
        <div class="analytics-card">
          <div class="card-header-row">
            <div>
              <h2 class="card-title">{{ 'analytics.progress_po_proektam' | t }}</h2>
              <p class="card-subtitle">{{ 'analytics.statusy_i_procent_vypolneniya' | t }}</p>
            </div>
            <!-- Quick Project Filter -->
            <div class="project-search-box" *ngIf="projects().length > 3">
              <span class="material-symbols-outlined search-ico" aria-hidden="true">search</span>
              <input
                type="text"
                class="search-mini-input"
                [placeholder]="'analytics.poisk_proekta' | t"
                [attr.aria-label]="'analytics.poisk_proekta' | t"
                [ngModel]="searchProjectQuery()"
                (ngModelChange)="searchProjectQuery.set($event)"
              />
              <button
                *ngIf="searchProjectQuery()"
                type="button"
                class="clear-mini-btn"
                (click)="searchProjectQuery.set('')"
                [attr.aria-label]="'common.clear' | t"
              >
                <span class="material-symbols-outlined" style="font-size: 14px;">close</span>
              </button>
            </div>
          </div>

          <div class="project-list" *ngIf="filteredProjects().length > 0">
            <div *ngFor="let p of filteredProjects()" class="project-item clickable" (click)="navigateToProject(p.projectId)" [title]="'projects.open_project' | t">
              <div class="project-info-row">
                <div class="project-name-group">
                  <span class="material-symbols-outlined" style="font-size: 18px;" [style.color]="getProgressColor(p.progressPercent)">folder</span>
                  <span class="project-name">{{ p.projectName }}</span>
                </div>
                <div class="project-stats">
                  <span class="project-pct" [style.color]="getProgressColor(p.progressPercent)">{{ p.progressPercent }}%</span>
                  <span class="project-tasks-count font-mono">({{ p.completedTasks }}/{{ p.totalTasks }})</span>
                </div>
              </div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" [style.width.%]="p.progressPercent" [style.background-color]="getProgressColor(p.progressPercent)"></div>
              </div>
            </div>
          </div>

          <div *ngIf="filteredProjects().length === 0 && !loading() && !error()" class="empty-chart">
            <span class="material-symbols-outlined" style="font-size: 32px; color: var(--text-light);">folder_open</span>
            <p>{{ 'analytics.aktivnye_proekty_ne_naydeny' | t }}</p>
          </div>
        </div>
      </div>

      <!-- Bottom Grid: Team Workload Table -->
      <div class="table-card" style="margin-top: 20px;">
        <div class="card-header-row" style="padding: 14px 20px; border-bottom: 1px solid var(--border-color);">
          <div>
            <h2 class="card-title">{{ 'analytics.utilizaciya_i_zagruzka_komandy' | t }}</h2>
            <p class="card-subtitle">{{ 'analytics.raspredelenie_aktivnyh_i_vypolnennyh_zadach_po_i' | t }}</p>
          </div>

          <!-- Quick User Filter -->
          <div class="user-search-box" *ngIf="workload().length > 0">
            <span class="material-symbols-outlined search-ico" aria-hidden="true">search</span>
            <input
              type="text"
              class="search-mini-input"
              [placeholder]="'analytics.poisk_sotrudnika' | t"
              [attr.aria-label]="'analytics.poisk_sotrudnika' | t"
              [ngModel]="searchUserQuery()"
              (ngModelChange)="searchUserQuery.set($event)"
            />
            <button
              *ngIf="searchUserQuery()"
              type="button"
              class="clear-mini-btn"
              (click)="searchUserQuery.set('')"
              [attr.aria-label]="'common.clear' | t"
            >
              <span class="material-symbols-outlined" style="font-size: 14px;">close</span>
            </button>
          </div>
        </div>

        <div class="table-scroll" role="region" tabindex="0" [attr.aria-label]="'analytics.utilizaciya_i_zagruzka_komandy' | t">
          <table>
            <thead>
              <tr>
                <th style="width: 240px;" class="th-sort">
                  <button type="button" class="sort-button" (click)="changeWorkloadSort('name')" [attr.aria-pressed]="workloadSortColumn() === 'name'">
                    {{ 'analytics.sotrudnik' | t }}
                    <span class="material-symbols-outlined sort-ico" *ngIf="workloadSortColumn() === 'name'">
                      {{ workloadSortDir() === 'asc' ? 'north' : 'south' }}
                    </span>
                  </button>
                </th>
                <th class="th-sort">
                  <button type="button" class="sort-button" (click)="changeWorkloadSort('login')" [attr.aria-pressed]="workloadSortColumn() === 'login'">
                    {{ 'analytics.login' | t }}
                    <span class="material-symbols-outlined sort-ico" *ngIf="workloadSortColumn() === 'login'">
                      {{ workloadSortDir() === 'asc' ? 'north' : 'south' }}
                    </span>
                  </button>
                </th>
                <th class="th-sort">
                  <button type="button" class="sort-button" (click)="changeWorkloadSort('assigned')" [attr.aria-pressed]="workloadSortColumn() === 'assigned'">
                    {{ 'analytics.naznacheno_zadach' | t }}
                    <span class="material-symbols-outlined sort-ico" *ngIf="workloadSortColumn() === 'assigned'">
                      {{ workloadSortDir() === 'asc' ? 'north' : 'south' }}
                    </span>
                  </button>
                </th>
                <th class="th-sort">
                  <button type="button" class="sort-button" (click)="changeWorkloadSort('completed')" [attr.aria-pressed]="workloadSortColumn() === 'completed'">
                    {{ 'analytics.zaversheno' | t }}
                    <span class="material-symbols-outlined sort-ico" *ngIf="workloadSortColumn() === 'completed'">
                      {{ workloadSortDir() === 'asc' ? 'north' : 'south' }}
                    </span>
                  </button>
                </th>
                <th class="th-sort">
                  <button type="button" class="sort-button" (click)="changeWorkloadSort('efficiency')" [attr.aria-pressed]="workloadSortColumn() === 'efficiency'">
                    {{ 'analytics.effektivnost' | t }}
                    <span class="material-symbols-outlined sort-ico" *ngIf="workloadSortColumn() === 'efficiency'">
                      {{ workloadSortDir() === 'asc' ? 'north' : 'south' }}
                    </span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let u of filteredWorkload()">
                <td>
                  <div class="user-cell">
                    <div class="user-avatar-sm" [style.background-color]="getAvatarBgColor(u.userName)">
                      {{ getUserInitial(u.userName) }}
                    </div>
                    <span class="user-name-text">{{ u.userName }}</span>
                  </div>
                </td>
                <td>
                  <span class="mono badge badge-neutral">{{ u.userLogin }}</span>
                </td>
                <td style="font-weight: 600;">{{ u.assignedTasks }}</td>
                <td class="text-success" style="font-weight: 600;">{{ u.completedTasks }}</td>
                <td>
                  <div class="efficiency-cell">
                    <ui-badge [variant]="u.assignedTasks > 0 && (u.completedTasks / u.assignedTasks) >= 0.7 ? 'success' : 'neutral'">
                      {{ u.assignedTasks > 0 ? ((u.completedTasks / u.assignedTasks) * 100 | number:'1.0-0') : 0 }}%
                    </ui-badge>
                    <div class="eff-mini-bar-bg" *ngIf="u.assignedTasks > 0">
                      <div class="eff-mini-bar-fill"
                        [style.width.%]="getEfficiencyPercent(u)"
                        [style.background-color]="(u.completedTasks / u.assignedTasks) >= 0.7 ? 'var(--success)' : 'var(--primary)'">
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
              <tr *ngIf="filteredWorkload().length === 0 && !loading() && !error()">
                <td colspan="5" class="empty">
                  <span>{{ 'analytics.dannye_po_zagruzke_sotrudnikov_otsutstvuyut' | t }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .analytics-container {
      display: flex;
      flex-direction: column;
      min-width: 0;
      gap: 0;
    }

    .view-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      gap: 16px;
      flex-wrap: wrap;
    }

    .header-left {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      min-width: 0;
      max-width: 100%;
      gap: 10px;
    }

    .view-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-main);
      letter-spacing: -0.3px;
      overflow-wrap: anywhere;
    }

    .count-badge {
      font-size: 12px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 9999px;
      background-color: var(--bg-hover);
      color: var(--text-muted);
      border: 1px solid var(--border-color);
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .status-tabs {
      display: inline-flex;
      align-items: center;
      background-color: var(--bg-hover);
      border-radius: var(--radius-sm);
      padding: 2px;
      gap: 2px;
      border: 1px solid var(--border-color);
    }

    .status-tab {
      height: 28px;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      background: transparent;
      border: none;
      border-radius: var(--radius-xs);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.12s ease;
      user-select: none;
    }

    .status-tab:hover:not(.active) {
      color: var(--text-main);
    }

    .status-tab.active {
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-weight: 600;
      box-shadow: var(--shadow-sm);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 14px;
      height: 34px;
      border-radius: var(--radius-sm);
      border: 1px solid transparent;
      background-color: var(--primary);
      color: #ffffff;
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
      user-select: none;
    }

    .btn:hover:not(:disabled) {
      background-color: var(--primary-hover);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-secondary {
      background-color: var(--bg-surface);
      border-color: var(--border-color);
      color: var(--text-main);
    }

    .btn-secondary:hover:not(:disabled) {
      background-color: var(--bg-hover);
      border-color: var(--border-color);
    }

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
      .view-header {
        align-items: flex-start;
        flex-direction: column;
      }
      .header-right {
        width: 100%;
        flex-wrap: wrap;
      }
      .status-tabs {
        max-width: 100%;
        overflow-x: auto;
      }
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

    .spin {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      100% { transform: rotate(360deg); }
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

    .analytics-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
      gap: 20px;
    }

    @media (max-width: 1024px) {
      .analytics-grid {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .analytics-card {
      min-width: 0;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 18px 22px;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .card-header-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }

    .card-header-row > div {
      min-width: 0;
    }

    .card-title, .card-subtitle {
      overflow-wrap: anywhere;
    }

    .card-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-main);
    }

    .card-subtitle {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .chart-legend {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 14px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-main);
    }
    .legend-dot {
      width: 8px;
      height: 8px;
      flex-shrink: 0;
      border-radius: 50%;
    }

    .svg-chart-container {
      width: 100%;
      min-width: 0;
      overflow-x: auto;
      position: relative;
    }

    .chart-y-axis {
      position: absolute;
      left: 4px;
      top: 0;
      bottom: 0;
      width: 32px;
      pointer-events: none;
      z-index: 2;
    }

    .y-axis-tick {
      position: absolute;
      right: 0;
      font-size: 10px;
      line-height: 1;
      color: var(--text-muted);
      text-align: right;
    }

    .trend-svg {
      display: block;
      width: 100%;
      min-width: 700px;
      height: 240px;
    }

    .table-card {
      min-width: 0;
      max-width: 100%;
    }

    .svg-chart-container:focus-visible, .table-scroll:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }

    .empty-chart {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 50px 20px;
      gap: 8px;
      color: var(--text-muted);
      font-size: 13px;
    }

    /* Projects list */
    .project-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-height: 250px;
      overflow-y: auto;
    }

    .project-item {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .project-info-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
    }

    .project-name-group {
      display: flex;
      align-items: center;
      min-width: 0;
      flex: 1 1 140px;
      gap: 6px;
    }

    .project-name-group > .material-symbols-outlined {
      flex-shrink: 0;
    }

    .project-name {
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-main);
    }

    .project-stats {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .project-pct {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-main);
    }

    .project-tasks-count {
      font-size: 11px;
      color: var(--text-muted);
    }

    .progress-bar-bg {
      width: 100%;
      height: 6px;
      background-color: var(--bg-hover);
      border-radius: 9999px;
      overflow: hidden;
    }

    .progress-bar-fill {
      height: 100%;
      background-color: var(--primary);
      border-radius: 9999px;
      transition: width 0.3s ease;
    }

    .user-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .user-avatar-sm {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background-color: var(--primary-subtle);
      color: var(--primary-text);
      display: flex;
      align-items: center;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-main);
    }

    .project-stats {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .project-pct {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-main);
    }

    .project-tasks-count {
      font-size: 11px;
      color: var(--text-muted);
    }

    .progress-bar-bg {
      width: 100%;
      height: 6px;
      background-color: var(--bg-hover);
      border-radius: 9999px;
      overflow: hidden;
    }

    .progress-bar-fill {
      height: 100%;
      background-color: var(--primary);
      border-radius: 9999px;
      transition: width 0.3s ease;
    }

    .user-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .user-avatar-sm {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background-color: var(--primary-subtle);
      color: var(--primary-text);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
    }

    .user-name-text {
      font-weight: 600;
      color: var(--text-main);
    }

    /* Table sorting headers */
    .th-sort {
      padding: 0 !important;
    }
    .sort-button {
      width: 100%;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      letter-spacing: inherit;
      padding: 8px 12px;
      text-align: left;
      text-transform: inherit;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      user-select: none;
      transition: color 0.15s ease;
    }
    .sort-button:hover {
      color: var(--primary);
    }
    .sort-button:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
      border-radius: var(--radius-xs);
    }
    .sort-ico {
      font-size: 14px;
      vertical-align: middle;
    }

    /* Mini search inputs */
    .user-search-box, .project-search-box {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 2px 8px;
      height: 28px;
      transition: border-color 0.15s ease;
    }
    .user-search-box:focus-within, .project-search-box:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 0 1px var(--primary);
    }
    .search-ico {
      font-size: 16px;
      color: var(--text-muted);
    }
    .search-mini-input {
      border: none;
      outline: none;
      background: transparent;
      font-size: 12px;
      color: var(--text-main);
      width: 130px;
    }
    .clear-mini-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      padding: 0;
    }
    .clear-mini-btn:hover {
      color: var(--text-main);
    }

    /* Floating tooltip card for SVG chart */
    .chart-tooltip-floating {
      position: absolute;
      top: 10px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-md);
      padding: 6px 10px;
      font-size: 11px;
      pointer-events: none;
      z-index: 10;
      transition: left 0.08s ease-out;
    }
    .tooltip-date {
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .tooltip-values {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .tooltip-val {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-main);
    }
    .tooltip-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }

    /* Clickable project */
    .project-item.clickable {
      cursor: pointer;
      padding: 4px 6px;
      border-radius: var(--radius-sm);
      transition: background-color 0.15s ease;
    }
    .project-item.clickable:hover {
      background-color: var(--bg-hover);
    }

    /* Efficiency cell mini bar */
    .efficiency-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .eff-mini-bar-bg {
      width: 50px;
      height: 5px;
      border-radius: 9999px;
      background-color: var(--bg-hover);
      overflow: hidden;
    }
    .eff-mini-bar-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.2s ease;
    }

    .hit-area {
      cursor: pointer;
    }

    .chart-point-group:focus-visible circle {
      stroke-width: 3;
      stroke: var(--text-main);
    }
  `]
})
export class AnalyticsComponent implements OnInit, OnDestroy {
  private readonly uiI18n = inject(I18nService);
  private http = inject(HttpClient);
  private router = inject(Router);
  private activeRequest?: Subscription;
  private refreshRequired = true;

  summary = signal<AnalyticsSummary | null>(null);
  trends = signal<TrendDataPoint[]>([]);
  projects = signal<ProjectDistribution[]>([]);
  workload = signal<UserWorkload[]>([]);

  loading = signal(false);
  error = signal('');
  selectedRange = '7d';
  displayedRange = '7d';

  searchUserQuery = signal('');
  searchProjectQuery = signal('');
  workloadSortColumn = signal<WorkloadSortColumn>('assigned');
  workloadSortDir = signal<SortDirection>('desc');
  hoveredPoint = signal<ChartPoint | null>(null);
  hoverIndex = signal<number | null>(null);

  chartPoints = computed<ChartPoint[]>(() => {
    const list = this.trends();
    if (list.length === 0) return [];

    let maxVal = 1;
    for (const d of list) {
      if (d.createdCount > maxVal) maxVal = d.createdCount;
      if (d.completedCount > maxVal) maxVal = d.completedCount;
    }

    const width = 640;
    const startX = 40;
    const bottomY = 190;
    const topY = 40;
    const height = bottomY - topY;

    const step = list.length > 1 ? width / (list.length - 1) : width;

    return list.map((d, i) => {
      const x = startX + i * step;
      const yCreated = bottomY - (d.createdCount / maxVal) * height;
      const yCompleted = bottomY - (d.completedCount / maxVal) * height;
      const label = d.date.substring(5); // MM-DD
      return { x, yCreated, yCompleted, label, date: d.date, created: d.createdCount, completed: d.completedCount };
    });
  });

  yAxisTicks = computed<YAxisTick[]>(() => {
    const list = this.trends();
    if (list.length === 0) return [];
    let maxVal = 1;
    for (const d of list) {
      if (d.createdCount > maxVal) maxVal = d.createdCount;
      if (d.completedCount > maxVal) maxVal = d.completedCount;
    }
    return [
      { y: 40, value: maxVal },
      { y: 90, value: Math.round((maxVal * 2) / 3) },
      { y: 140, value: Math.round(maxVal / 3) },
      { y: 190, value: 0 }
    ];
  });

  filteredProjects = computed(() => {
    const query = this.searchProjectQuery().trim().toLowerCase();
    const list = this.projects();
    if (!query) return list;
    return list.filter(p => p.projectName.toLowerCase().includes(query));
  });

  filteredWorkload = computed(() => {
    const query = this.searchUserQuery().trim().toLowerCase();
    let list = this.workload();
    if (query) {
      list = list.filter(u =>
        u.userName.toLowerCase().includes(query) ||
        u.userLogin.toLowerCase().includes(query)
      );
    }
    const col = this.workloadSortColumn();
    const dir = this.workloadSortDir() === 'asc' ? 1 : -1;

    return [...list].sort((a, b) => {
      let diff = 0;
      switch (col) {
        case 'name':
          diff = a.userName.localeCompare(b.userName);
          break;
        case 'login':
          diff = a.userLogin.localeCompare(b.userLogin);
          break;
        case 'assigned':
          diff = a.assignedTasks - b.assignedTasks;
          break;
        case 'completed':
          diff = a.completedTasks - b.completedTasks;
          break;
        case 'efficiency': {
          const effA = a.assignedTasks > 0 ? a.completedTasks / a.assignedTasks : 0;
          const effB = b.assignedTasks > 0 ? b.completedTasks / b.assignedTasks : 0;
          diff = effA - effB;
          break;
        }
      }
      return diff !== 0 ? diff * dir : a.userName.localeCompare(b.userName);
    });
  });

  createdLinePath = computed(() => {
    const pts = this.chartPoints();
    if (pts.length === 0) return '';
    return pts.map((p, i) => (i === 0 ? `M ${p.x} ${p.yCreated}` : `L ${p.x} ${p.yCreated}`)).join(' ');
  });

  completedLinePath = computed(() => {
    const pts = this.chartPoints();
    if (pts.length === 0) return '';
    return pts.map((p, i) => (i === 0 ? `M ${p.x} ${p.yCompleted}` : `L ${p.x} ${p.yCompleted}`)).join(' ');
  });

  createdAreaPath = computed(() => {
    const pts = this.chartPoints();
    if (pts.length === 0) return '';
    const line = this.createdLinePath();
    const last = pts[pts.length - 1];
    const first = pts[0];
    return `${line} L ${last.x} 190 L ${first.x} 190 Z`;
  });

  completedAreaPath = computed(() => {
    const pts = this.chartPoints();
    if (pts.length === 0) return '';
    const line = this.completedLinePath();
    const last = pts[pts.length - 1];
    const first = pts[0];
    return `${line} L ${last.x} 190 L ${first.x} 190 Z`;
  });

  ngOnInit(): void {
    this.loadAll();
  }

  ngOnDestroy(): void {
    this.activeRequest?.unsubscribe();
  }

  setRange(range: string): void {
    this.selectedRange = range;
    if (this.refreshRequired) this.loadAll();
    else this.loadTrends();
  }

  setHoveredPoint(pt: ChartPoint, idx: number): void {
    this.hoveredPoint.set(pt);
    this.hoverIndex.set(idx);
  }

  clearHover(): void {
    this.hoveredPoint.set(null);
    this.hoverIndex.set(null);
  }

  getTooltipLeft(x: number): number {
    return Math.max(10, Math.min(x - 60, 560));
  }

  changeWorkloadSort(col: WorkloadSortColumn): void {
    if (this.workloadSortColumn() === col) {
      this.workloadSortDir.update(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.workloadSortColumn.set(col);
      this.workloadSortDir.set(col === 'name' || col === 'login' ? 'asc' : 'desc');
    }
  }

  getEfficiencyPercent(u: UserWorkload): number {
    if (u.assignedTasks <= 0) return 0;
    return Math.min(100, Math.round((u.completedTasks / u.assignedTasks) * 100));
  }

  getProgressColor(pct: number): string {
    if (pct >= 100) return 'var(--success)';
    if (pct >= 50) return 'var(--primary)';
    if (pct > 0) return '#f59e0b';
    return 'var(--text-muted)';
  }

  getAvatarBgColor(name: string): string {
    const colors = [
      '#4338ca', '#0369a1', '#047857', '#b45309',
      '#6d28d9', '#be185d', '#0f766e', '#c2410c'
    ];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  getUserInitial(name: string): string {
    return (name || '').trim().charAt(0).toUpperCase() || '?';
  }

  navigateToProject(projectId: number): void {
    this.router.navigate(['/tasks'], { queryParams: { project: projectId } });
  }

  exportReport(format: 'xlsx' | 'csv' = 'xlsx'): void {
    window.open(`/api/v1/reports/tasks/export?format=${format}`, '_blank');
  }

  shouldShowDateLabel(index: number, total: number): boolean {
    if (total <= 7) return true;
    if (total <= 14) return index % 2 === 0;
    return index % Math.ceil(total / 6) === 0 || index === total - 1;
  }

  loadAll(): void {
    const range = this.selectedRange;
    // A failed or superseded refresh must be retried as a whole snapshot.
    this.refreshRequired = true;
    this.loadRequest(forkJoin({
      summary: this.http.get<AnalyticsSummary>('/api/v1/analytics/summary'),
      trends: this.http.get<TrendDataPoint[]>(`/api/v1/analytics/trends?range=${range}`),
      projects: this.http.get<ProjectDistribution[]>('/api/v1/analytics/projects'),
      workload: this.http.get<UserWorkload[]>('/api/v1/analytics/workload')
    }), data => {
      this.summary.set(data.summary);
      this.trends.set(data.trends);
      this.projects.set(data.projects);
      this.workload.set(data.workload);
      this.displayedRange = range;
      this.refreshRequired = false;
    });
  }

  private loadTrends(): void {
    const range = this.selectedRange;
    this.loadRequest(this.http.get<TrendDataPoint[]>(`/api/v1/analytics/trends?range=${range}`), data => {
      this.trends.set(data);
      this.displayedRange = range;
    });
  }

  private loadRequest<T>(request: Observable<T>, apply: (data: T) => void): void {
    this.activeRequest?.unsubscribe();
    this.loading.set(true);
    this.error.set('');
    this.activeRequest = request.subscribe({
      next: data => apply(data),
      error: e => {
        this.error.set(e?.error?.detail || this.uiI18n.translate('analytics.ne_udalos_zagruzit_dannye_analitiki'));
        this.loading.set(false);
      },
      complete: () => this.loading.set(false)
    });
  }
}
