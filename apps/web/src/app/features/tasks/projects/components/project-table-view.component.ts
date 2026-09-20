import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { UiPaginationComponent } from '../../../../shared/ui/ui-pagination.component';
import { Project, ProjectTaskStats } from '../../../../core/models/task.models';

@Component({
  selector: 'app-project-table-view',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    UiPaginationComponent
  ],
  template: `
    <div class="table-card">
      <div class="table-wrapper" role="region" [attr.aria-label]="'projects.tablica_proektov' | t" tabindex="0">
        <table class="data-table" [attr.aria-label]="'projects.spisok_proektov' | t">
          <thead>
            <tr>
              <th style="width: 60px;">ID</th>
              <th>{{ 'projects.proekt' | t }}</th>
              <th style="width: 110px;">{{ 'common.status' | t }}</th>
              <th *ngIf="canViewTasks" style="width: 220px;">{{ 'projects.closed_tasks' | t }}</th>
              <th style="width: 120px;">{{ 'iam.sozdan' | t }}</th>
              <th class="text-right" style="width: 140px;">{{ 'common.actions' | t }}</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let p of paginatedProjects" class="project-row">
              <td class="tabular-nums font-mono text-muted">#{{ p.id }}</td>
              <td>
                <div class="project-title-cell">
                  <span class="material-symbols-outlined folder-icon" aria-hidden="true">folder</span>
                  <div class="project-info-group">
                    <button *ngIf="canViewTasks; else plainProjectName" type="button" class="project-name" (click)="viewTasks.emit(p)">
                      {{ p.name }}
                    </button>
                    <ng-template #plainProjectName><span class="project-name-text">{{ p.name }}</span></ng-template>
                    <span *ngIf="p.description" class="project-desc-line">{{ p.description }}</span>
                  </div>
                </div>
              </td>
              <td>
                <span class="status-pill" [class.active]="p.state === 'A'">
                  <span class="status-dot" [class.active]="p.state === 'A'"></span>
                  {{ (p.state === 'A' ? 'projects.state_active' : 'projects.state_archived') | t }}
                </span>
              </td>
              <td *ngIf="canViewTasks">
                <div *ngIf="hasProjectStats(p.id); else unknownTableStats" class="progress-cell">
                  <div class="progress-labels">
                    <span class="progress-count tabular-nums">
                      {{ 'projects.closed_ratio' | t:{done: getProjectDoneCount(p.id), total: getProjectTotalCount(p.id)} }}
                    </span>
                    <span class="progress-percent tabular-nums">
                      {{ getProjectPercent(p.id) }}%
                    </span>
                  </div>
                  <div
                    class="progress-bar-bg"
                    role="progressbar"
                    [attr.aria-label]="'projects.closed_progress_named' | t:{name: p.name}"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    [attr.aria-valuenow]="getProjectPercent(p.id)"
                  >
                    <div
                      class="progress-bar-fill"
                      [style.width.%]="getProjectPercent(p.id)"
                      [class.complete]="getProjectPercent(p.id) === 100 && getProjectTotalCount(p.id) > 0"
                    ></div>
                  </div>
                </div>
                <ng-template #unknownTableStats><span class="stats-unknown">{{ 'projects.stats_unknown' | t }}</span></ng-template>
              </td>
              <td>
                <span class="tabular-nums text-muted text-xs">
                  {{ p.createdAt | date:'dd.MM.yyyy' }}
                </span>
              </td>
              <td class="text-right">
                <div class="row-action-btns">
                  <button
                    *ngIf="canViewTasks"
                    type="button"
                    class="action-link-btn"
                    [attr.aria-label]="'projects.open_tasks_named' | t:{name: p.name}"
                    [title]="'projects.pereyti_k_zadacham_proekta' | t"
                    (click)="viewTasks.emit(p)"
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">task_alt</span>
                    {{ 'nav.tasks' | t }}
                  </button>
                  <button
                    *ngIf="canUpdateProject"
                    type="button"
                    class="icon-ghost-btn"
                    [attr.aria-label]="'projects.edit_named' | t:{name: p.name}"
                    [title]="'projects.redaktirovat_proekt' | t"
                    (click)="editProject.emit(p)"
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">edit</span>
                  </button>
                </div>
              </td>
            </tr>

            <tr *ngIf="totalCount === 0">
              <td [attr.colspan]="canViewTasks ? 6 : 5" class="empty-state-cell">
                <span class="material-symbols-outlined empty-icon" aria-hidden="true">folder_off</span>
                <p>{{ 'projects.proekty_ne_naydeny' | t }}</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <ui-pagination
        [totalItems]="totalCount"
        [currentPage]="currentPage"
        [pageSize]="pageSize"
        (pageChange)="pageChange.emit($event)"
        (pageSizeChange)="pageSizeChange.emit($event)"
      ></ui-pagination>
    </div>
  `,
  styles: [`
    .table-card {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      overflow: hidden;
    }
    .table-wrapper { overflow-x: auto; }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .data-table th {
      text-align: left;
      padding: 8px 12px;
      background-color: var(--bg-hover);
      border-bottom: 1px solid var(--border-color);
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .data-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-main);
    }
    .project-row { transition: background 0.1s ease; }
    .project-row:hover { background-color: var(--bg-hover); }
    .project-row:last-child td { border-bottom: none; }

    .project-title-cell {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .folder-icon { font-size: 20px; color: var(--warning); flex-shrink: 0; }
    .project-info-group { display: flex; flex-direction: column; gap: 2px; }
    .project-name {
      border: 0;
      background: transparent;
      cursor: pointer;
      font: inherit;
      min-height: 28px;
      padding: 0 2px;
      text-align: left;
      display: inline-flex;
      align-items: center;
      font-weight: 600;
      color: var(--text-main);
    }
    .project-name:hover { text-decoration: underline; }
    .project-name-text { font-weight: 600; color: var(--text-main); }
    .project-desc-line {
      font-size: 11px;
      color: var(--text-muted);
      max-width: 400px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-pill {
      font-size: 11px;
      font-weight: 500;
      padding: 2px 7px;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background-color: var(--bg-hover);
      color: var(--text-muted);
    }
    .status-pill.active { background-color: rgba(16,185,129,0.1); color: var(--success); }
    .status-dot { width: 5px; height: 5px; border-radius: 50%; background-color: var(--text-muted); }
    .status-dot.active { background-color: var(--success); }

    /* Progress Cell */
    .progress-cell { display: flex; flex-direction: column; gap: 4px; }
    .progress-labels { display: flex; justify-content: space-between; font-size: 11px; }
    .progress-count { color: var(--text-muted); font-size: 10px; }
    .progress-percent { font-weight: 600; color: var(--text-main); font-size: 10px; }
    .progress-bar-bg {
      height: 5px;
      background-color: var(--bg-hover);
      border-radius: 3px;
      overflow: hidden;
      border: 1px solid var(--border-color);
    }
    .progress-bar-fill {
      height: 100%;
      background-color: var(--primary);
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    .progress-bar-fill.complete { background-color: var(--success); }
    .stats-unknown { color: var(--text-muted); font-size: 11px; }

    .row-action-btns { display: inline-flex; align-items: center; gap: 6px; }
    .action-link-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      min-height: 28px;
      border-radius: var(--radius-xs);
      border: 1px solid var(--border-color);
      background-color: var(--bg-hover);
      color: var(--text-main);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
    }
    .action-link-btn:hover { border-color: var(--primary); color: var(--primary); }
    .action-link-btn .material-symbols-outlined { font-size: 14px; }

    .icon-ghost-btn {
      min-width: 28px;
      min-height: 28px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .icon-ghost-btn:hover { color: var(--text-main); background-color: var(--bg-hover); }
    .icon-ghost-btn .material-symbols-outlined { font-size: 16px; }

    .empty-state-cell {
      padding: 40px;
      text-align: center;
      color: var(--text-muted);
    }
    .empty-icon { font-size: 36px; color: var(--text-light); margin-bottom: 6px; }

    .tabular-nums { font-variant-numeric: tabular-nums; }
    .font-mono { font-family: monospace; }
    .text-right { text-align: right; }
    .text-muted { color: var(--text-muted); }
    .text-xs { font-size: 11px; }
  `]
})
export class ProjectTableViewComponent {
  @Input() paginatedProjects: Project[] = [];
  @Input() totalCount = 0;
  @Input() currentPage = 1;
  @Input() pageSize = 10;
  @Input() canViewTasks = false;
  @Input() canUpdateProject = false;
  @Input() projectStats: Record<number, ProjectTaskStats> = {};
  @Input() statsLoading = false;
  @Input() statsLoadError = false;
  @Input() statsLoaded = false;

  @Output() viewTasks = new EventEmitter<Project>();
  @Output() editProject = new EventEmitter<Project>();
  @Output() pageChange = new EventEmitter<number>();
  @Output() pageSizeChange = new EventEmitter<number>();

  hasProjectStats(projectId: number): boolean {
    return this.canViewTasks
      && this.statsLoaded
      && !this.statsLoading
      && !this.statsLoadError
      && this.projectStats[projectId] !== undefined;
  }

  getProjectTotalCount(projectId: number): number {
    return this.projectStats[projectId]?.totalTasks ?? 0;
  }

  getProjectDoneCount(projectId: number): number {
    return this.projectStats[projectId]?.doneTasks ?? 0;
  }

  getProjectPercent(projectId: number): number {
    const stats = this.projectStats[projectId];
    if (!stats) return 0;
    const total = stats.totalTasks;
    if (total === 0) return 0;
    return Math.round((stats.doneTasks / total) * 100);
  }
}
