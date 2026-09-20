import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { ProjectDistribution } from '../analytics.models';

@Component({
  selector: 'app-analytics-projects-card',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe
  ],
  template: `
    <div class="analytics-card">
      <div class="card-header-row">
        <div>
          <h2 class="card-title">{{ 'analytics.progress_po_proektam' | t }}</h2>
          <p class="card-subtitle">{{ 'analytics.statusy_i_procent_vypolneniya' | t }}</p>
        </div>
        <!-- Quick Project Filter -->
        <div class="project-search-box" *ngIf="projects.length > 3">
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
        <div *ngFor="let p of filteredProjects()" class="project-item clickable" (click)="projectClick.emit(p.projectId)" [title]="'projects.open_project' | t">
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

      <div *ngIf="filteredProjects().length === 0 && !loading && !error" class="empty-chart">
        <span class="material-symbols-outlined" style="font-size: 32px; color: var(--text-light);">folder_open</span>
        <p>{{ 'analytics.aktivnye_proekty_ne_naydeny' | t }}</p>
      </div>
    </div>
  `,
  styles: [`
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

    .card-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-main);
      overflow-wrap: anywhere;
    }

    .card-subtitle {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
      overflow-wrap: anywhere;
    }

    .project-search-box {
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
    .project-search-box:focus-within {
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

    .project-item.clickable {
      cursor: pointer;
      padding: 4px 6px;
      border-radius: var(--radius-sm);
      transition: background-color 0.15s ease;
    }
    .project-item.clickable:hover {
      background-color: var(--bg-hover);
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

    .font-mono {
      font-family: monospace;
    }
  `]
})
export class AnalyticsProjectsCardComponent {
  private _projects = signal<ProjectDistribution[]>([]);

  @Input() set projects(value: ProjectDistribution[]) {
    this._projects.set(value || []);
  }
  get projects(): ProjectDistribution[] {
    return this._projects();
  }

  @Input() loading = false;
  @Input() error = '';
  @Output() projectClick = new EventEmitter<number>();

  searchProjectQuery = signal('');

  filteredProjects = computed(() => {
    const query = this.searchProjectQuery().trim().toLowerCase();
    const list = this._projects();
    if (!query) return list;
    return list.filter(p => p.projectName.toLowerCase().includes(query));
  });

  getProgressColor(pct: number): string {
    if (pct >= 100) return 'var(--success)';
    if (pct >= 50) return 'var(--primary)';
    if (pct > 0) return '#f59e0b';
    return 'var(--text-muted)';
  }
}
