import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { Project, TaskStatus } from '../../../core/models/task.models';

export type TaskPreset = 'all' | 'my' | 'reported' | 'overdue';

@Component({
  selector: 'app-task-filter-bar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe
  ],
  template: `
    <div class="toolbar">
      <div class="toolbar-left-row">
        <!-- Smart View Presets -->
        <div class="preset-filter-group" role="group" [attr.aria-label]="'tasks.filtr_po_statusu' | t">
          <button
            type="button"
            class="preset-btn"
            [class.active]="activePreset === 'all'"
            [attr.aria-pressed]="activePreset === 'all'"
            (click)="onPresetClick('all')"
          >
            <span class="material-symbols-outlined preset-icon" aria-hidden="true">dashboard</span>
            <span>{{ 'tasks.filter_preset_all' | t }}</span>
          </button>
          <button
            type="button"
            class="preset-btn"
            [class.active]="activePreset === 'my'"
            [attr.aria-pressed]="activePreset === 'my'"
            (click)="onPresetClick('my')"
          >
            <span class="material-symbols-outlined preset-icon" aria-hidden="true">person</span>
            <span>{{ 'tasks.filter_preset_my' | t }}</span>
          </button>
          <button
            type="button"
            class="preset-btn"
            [class.active]="activePreset === 'reported'"
            [attr.aria-pressed]="activePreset === 'reported'"
            (click)="onPresetClick('reported')"
          >
            <span class="material-symbols-outlined preset-icon" aria-hidden="true">assignment_ind</span>
            <span>{{ 'tasks.filter_preset_reported' | t }}</span>
          </button>
          <button
            type="button"
            class="preset-btn preset-overdue"
            [class.active]="activePreset === 'overdue'"
            [attr.aria-pressed]="activePreset === 'overdue'"
            (click)="onPresetClick('overdue')"
          >
            <span class="material-symbols-outlined preset-icon" aria-hidden="true">error</span>
            <span>{{ 'tasks.filter_preset_overdue' | t }}</span>
          </button>
        </div>

        <div class="search-field">
          <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
          <label class="sr-only" for="task-search">{{ 'tasks.poisk_zadach' | t }}</label>
          <input
            id="task-search"
            name="taskSearch"
            type="text"
            class="search-input"
            [placeholder]="'projects.poisk_po_nazvaniyu_ili_opisaniyu' | t"
            [ngModel]="searchQuery"
            (ngModelChange)="searchQueryChange.emit($event)"
            (keydown.enter)="searchApply.emit(); $event.preventDefault()"
          />
          <button
            *ngIf="searchQuery"
            type="button"
            class="clear-btn"
            [attr.aria-label]="'tasks.ochistit_poisk_zadach' | t"
            (click)="searchClear.emit()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      </div>

      <div class="toolbar-controls">
        <!-- Status Filter Tabs -->
        <div class="status-tabs" role="group" [attr.aria-label]="'tasks.filtr_po_statusu' | t">
          <button
            type="button"
            class="status-tab"
            [class.active]="statusFilterMode === 'active'"
            [attr.aria-pressed]="statusFilterMode === 'active'"
            (click)="statusFilterModeChange.emit('active')"
            [title]="'tasks.tolko_aktivnye_zadachi_bez_vypolnennyh_i_otmenen' | t"
          >
            <span class="status-tab-dot active-dot" aria-hidden="true"></span>
            {{ 'iam.aktivnye' | t }}
          </button>
          <button
            type="button"
            class="status-tab"
            [class.active]="statusFilterMode === 'all'"
            [attr.aria-pressed]="statusFilterMode === 'all'"
            (click)="statusFilterModeChange.emit('all')"
            [title]="'tasks.vse_zadachi_vklyuchaya_zavershennye' | t"
          >
            {{ 'common.all' | t }}
          </button>
          <button
            *ngFor="let s of statuses"
            type="button"
            class="status-tab"
            [class.active]="statusFilterMode === s.id"
            [attr.aria-pressed]="statusFilterMode === s.id"
            (click)="statusFilterModeChange.emit(s.id)"
          >
            <span class="status-tab-dot" [style.background-color]="s.color || 'var(--primary)'" aria-hidden="true"></span>
            {{ s.name }}
          </button>
        </div>

        <!-- Project Filter -->
        <label class="sr-only" for="task-project-filter">{{ 'tasks.filtr_po_proektu' | t }}</label>
        <select
          id="task-project-filter"
          name="taskProjectFilter"
          class="clean-select"
          [ngModel]="selectedProjectId"
          (ngModelChange)="selectedProjectIdChange.emit($event)"
        >
          <option [ngValue]="null">{{ 'tasks.vse_proekty' | t }}</option>
          <option *ngFor="let p of projects" [ngValue]="p.id">{{ p.name }}</option>
        </select>

        <!-- Priority Filter -->
        <label class="sr-only" for="task-priority-filter">{{ 'tasks.filtr_po_prioritetu' | t }}</label>
        <select
          id="task-priority-filter"
          name="taskPriorityFilter"
          class="clean-select"
          [ngModel]="selectedPriority"
          (ngModelChange)="selectedPriorityChange.emit($event)"
        >
          <option value="">{{ 'tasks.vse_prioritety' | t }}</option>
          <option value="critical">{{ 'tasks.kriticheskiy' | t }}</option>
          <option value="high">{{ 'task.priority.high' | t }}</option>
          <option value="medium">{{ 'tasks.sredniy' | t }}</option>
          <option value="low">{{ 'task.priority.low' | t }}</option>
        </select>

        <button
          *ngIf="hasActiveFilters"
          type="button"
          class="reset-filters-btn"
          [attr.aria-label]="'tasks.sbrosit_vse_filtry' | t"
          (click)="resetFilters.emit()"
          [title]="'tasks.sbrosit_vse_filtry' | t"
        >
          <span class="material-symbols-outlined" aria-hidden="true">filter_alt_off</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 8px 12px;
    }
    .toolbar-left-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .preset-filter-group {
      display: flex;
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 2px;
      gap: 2px;
    }
    .preset-btn {
      border: none;
      background: transparent;
      min-height: 28px;
      padding: 3px 9px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      border-radius: var(--radius-xs);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.1s ease;
      white-space: nowrap;
    }
    .preset-btn:hover { color: var(--text-main); }
    .preset-btn.active {
      background-color: var(--bg-surface);
      color: var(--text-main);
      box-shadow: var(--shadow-sm);
      font-weight: 600;
    }
    .preset-btn .preset-icon { font-size: 15px; color: var(--text-muted); }
    .preset-btn.active .preset-icon { color: var(--primary); }
    .preset-btn.preset-overdue.active { color: var(--danger); }
    .preset-btn.preset-overdue.active .preset-icon { color: var(--danger); }
    .search-field {
      display: flex;
      align-items: center;
      gap: 6px;
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 4px 8px;
      width: 260px;
      max-width: 100%;
    }
    .search-icon { font-size: 16px; color: var(--text-muted); }
    .search-input {
      border: none;
      background: transparent;
      outline: none;
      font-size: 12px;
      color: var(--text-main);
      width: 100%;
    }
    .clear-btn {
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      padding: 0;
    }
    .clear-btn .material-symbols-outlined { font-size: 14px; }

    .toolbar-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .status-tabs {
      display: flex;
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 2px;
      gap: 2px;
    }
    .status-tab {
      border: none;
      background: transparent;
      min-height: 28px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      border-radius: var(--radius-xs);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.1s ease;
      white-space: nowrap;
    }
    .status-tab:hover { color: var(--text-main); }
    .status-tab.active {
      background-color: var(--bg-surface);
      color: var(--text-main);
      box-shadow: var(--shadow-sm);
    }
    .status-tab-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .status-tab-dot.active-dot {
      background-color: #10b981;
    }

    .clean-select {
      height: 30px;
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-size: 12px;
      outline: none;
      white-space: nowrap;
    }
    .clean-select:focus { border-color: var(--primary); }

    .reset-filters-btn {
      border: 1px solid var(--border-color);
      background-color: var(--bg-hover);
      color: var(--text-muted);
      border-radius: var(--radius-sm);
      height: 30px;
      width: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .reset-filters-btn:hover { color: var(--text-main); border-color: var(--text-muted); }
    .reset-filters-btn .material-symbols-outlined { font-size: 16px; }
  `]
})
export class TaskFilterBarComponent {
  @Input() activePreset: TaskPreset = 'all';
  @Input() searchQuery = '';
  @Input() statusFilterMode: 'active' | 'all' | number = 'active';
  @Input() statuses: TaskStatus[] = [];
  @Input() selectedProjectId: number | null = null;
  @Input() projects: Project[] = [];
  @Input() selectedPriority = '';
  @Input() hasActiveFilters = false;

  @Output() activePresetChange = new EventEmitter<TaskPreset>();
  @Output() searchQueryChange = new EventEmitter<string>();
  @Output() searchApply = new EventEmitter<void>();
  @Output() searchClear = new EventEmitter<void>();
  @Output() statusFilterModeChange = new EventEmitter<'active' | 'all' | number>();
  @Output() selectedProjectIdChange = new EventEmitter<number | null>();
  @Output() selectedPriorityChange = new EventEmitter<string>();
  @Output() resetFilters = new EventEmitter<void>();

  onPresetClick(preset: TaskPreset) {
    this.activePresetChange.emit(preset);
  }
}
