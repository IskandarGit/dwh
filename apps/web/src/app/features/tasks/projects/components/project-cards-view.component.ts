import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { UiPaginationComponent } from '../../../../shared/ui/ui-pagination.component';
import { Project, ProjectTaskStats } from '../../../../core/models/task.models';

@Component({
  selector: 'app-project-cards-view',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    UiPaginationComponent
  ],
  template: `
    <div class="cards-view-wrapper">
      <div class="projects-grid">
        <div
          *ngFor="let p of paginatedProjects"
          class="project-card"
        >
          <div class="card-top">
            <div class="project-icon-box">
              <span class="material-symbols-outlined" aria-hidden="true">folder</span>
            </div>
            <div class="card-top-right">
              <span class="status-pill" [class.active]="p.state === 'A'">
                <span class="status-dot" [class.active]="p.state === 'A'"></span>
                {{ (p.state === 'A' ? 'projects.state_active' : 'projects.state_archived') | t }}
              </span>
              <button
                *ngIf="canUpdateProject"
                type="button"
                class="edit-btn"
                [attr.aria-label]="'projects.edit_named' | t:{name: p.name}"
                [title]="'projects.redaktirovat_proekt' | t"
                (click)="editProject.emit(p)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">edit</span>
              </button>
            </div>
          </div>

          <div class="card-content">
            <h3 class="project-title">
              <button *ngIf="canViewTasks; else plainCardProjectName" type="button" class="project-title-btn" (click)="viewTasks.emit(p)">
                {{ p.name }}
              </button>
              <ng-template #plainCardProjectName><span class="project-name-text">{{ p.name }}</span></ng-template>
            </h3>
            <p class="project-desc">{{ p.description || ('projects.description_missing' | t) }}</p>
          </div>

          <div *ngIf="canViewTasks && hasProjectStats(p.id)" class="card-progress">
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

          <div class="card-foot">
            <span class="foot-date tabular-nums">{{ 'projects.created_at' | t:{date: (p.createdAt | date:'dd.MM.yyyy') || ''} }}</span>
            <button *ngIf="canViewTasks && hasProjectStats(p.id)" type="button" class="view-tasks-link" (click)="viewTasks.emit(p)">
              {{ 'projects.tasks_count_arrow' | t:{count: getProjectTotalCount(p.id)} }}
            </button>
            <span *ngIf="canViewTasks && !hasProjectStats(p.id)" class="stats-unknown">{{ 'projects.stats_unknown' | t }}</span>
          </div>
        </div>

        <div *ngIf="totalCount === 0" class="empty-projects-cell">
          <span class="material-symbols-outlined empty-icon" aria-hidden="true">folder_off</span>
          <p>{{ 'projects.proekty_ne_naydeny' | t }}</p>
        </div>
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
    .cards-view-wrapper { width: 100%; }
    .projects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }

    .project-card {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: all 0.12s ease;
    }
    .project-card:hover {
      border-color: var(--primary);
      transform: translateY(-1px);
      box-shadow: var(--shadow-sm);
    }

    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .project-icon-box {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-sm);
      background-color: rgba(245, 158, 11, 0.12);
      color: var(--warning);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .project-icon-box .material-symbols-outlined { font-size: 18px; }
    .card-top-right { display: flex; align-items: center; gap: 6px; }

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

    .edit-btn {
      min-width: 28px;
      min-height: 28px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      padding: 3px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .edit-btn:hover { color: var(--text-main); background-color: var(--bg-hover); }
    .edit-btn .material-symbols-outlined { font-size: 15px; }

    .card-content { display: flex; flex-direction: column; gap: 4px; }
    .project-title { font-size: 14px; font-weight: 600; margin: 0; color: var(--text-main); }
    .project-desc {
      font-size: 12px;
      color: var(--text-muted);
      margin: 0;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .card-progress { display: flex; flex-direction: column; gap: 4px; padding-top: 4px; }
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

    .card-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 8px;
      border-top: 1px solid var(--border-color);
      font-size: 11px;
    }
    .foot-date { color: var(--text-muted); }
    .project-title-btn,
    .view-tasks-link {
      border: 0;
      background: transparent;
      cursor: pointer;
      font: inherit;
      min-height: 28px;
      padding: 0 2px;
      text-align: left;
      display: inline-flex;
      align-items: center;
    }
    .project-title-btn { color: inherit; font-weight: inherit; }
    .project-name-text { font-weight: 600; color: var(--text-main); }
    .view-tasks-link { color: var(--primary); font-weight: 500; }
    .project-title-btn:hover,
    .view-tasks-link:hover { text-decoration: underline; }
    .stats-unknown { color: var(--text-muted); font-size: 11px; }

    .empty-projects-cell {
      grid-column: 1 / -1;
      padding: 40px;
      text-align: center;
      color: var(--text-muted);
    }
    .empty-icon { font-size: 36px; color: var(--text-light); margin-bottom: 6px; }

    .tabular-nums { font-variant-numeric: tabular-nums; }
  `]
})
export class ProjectCardsViewComponent {
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
