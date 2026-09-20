import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { Task, Project, TaskStatus, TaskType } from '../../../core/models/task.models';

@Component({
  selector: 'app-task-table-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    UiButtonComponent
  ],
  template: `
    <div class="table-card">
      <div class="table-wrapper" *ngIf="tasks.length > 0" role="region" [attr.aria-label]="'tasks.tablica_zadach' | t" tabindex="0">
        <table class="data-table" [attr.aria-label]="'tasks.spisok_zadach' | t">
          <thead>
            <tr>
              <th style="width: 60px;">ID</th>
              <th style="width: 120px;">{{ 'settings.tip' | t }}</th>
              <th>{{ 'tasks.zadacha' | t }}</th>
              <th>{{ 'projects.proekt' | t }}</th>
              <th>{{ 'common.priority' | t }}</th>
              <th>{{ 'common.status' | t }}</th>
              <th>{{ 'tasks.srok' | t }}</th>
              <th class="text-right" style="width: 110px;">{{ 'common.actions' | t }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              *ngFor="let t of paginatedTasks"
              class="task-row"
              [class.row-overdue]="isOverdue(t.endTime, t.statusId)"
              (click)="onTaskContainerClick($event, t)"
            >
              <td class="tabular-nums font-mono" [class.text-danger]="isOverdue(t.endTime, t.statusId)" [class.text-muted]="!isOverdue(t.endTime, t.statusId)">
                #{{ t.id }}
              </td>
              <td>
                <span class="task-type-badge" [style.color]="getTypeColor(t)" [style.background-color]="getTypeBg(t)">
                  <span class="material-symbols-outlined type-icon" aria-hidden="true">{{ getTypeIcon(t) }}</span>
                  {{ getTypeLabel(t) }}
                </span>
              </td>
              <td>
                <div class="task-title-cell">
                  <button
                    type="button"
                    class="task-title task-title-open"
                    [class.title-overdue]="isOverdue(t.endTime, t.statusId)"
                    [attr.aria-label]="'tasks.open_task_named' | t:{id: t.id, title: t.title}"
                    (click)="openTaskDetails.emit(t)"
                  >
                    {{ t.title }}
                  </button>
                  <span *ngIf="isOverdue(t.endTime, t.statusId)" class="overdue-tag">
                    {{ 'tasks.prosrocheno' | t }}
                  </span>
                  <span *ngIf="t.parentTaskId" class="parent-chip font-mono" [title]="'task.parent' | t">
                    {{ 'tasks.subtask_number' | t:{id: t.parentTaskId} }}
                  </span>
                </div>
              </td>
              <td>
                <span class="project-tag" *ngIf="getProjectName(t.projectId) as pName">
                  <span class="material-symbols-outlined folder-ico">folder</span>
                  {{ pName }}
                </span>
                <span class="text-muted" *ngIf="!t.projectId">—</span>
              </td>
              <td>
                <div class="inline-priority-wrapper" (click)="$event.stopPropagation()">
                  <select
                    class="inline-priority-select"
                    [attr.data-priority]="t.priority"
                    [ngModel]="t.priority"
                    (ngModelChange)="updatePriority.emit({ taskId: t.id, priority: $event })"
                    [disabled]="!canUpdateTask"
                    [attr.aria-label]="'common.priority' | t"
                    [title]="'common.priority' | t"
                  >
                    <option value="low">{{ 'task.priority.low' | t }}</option>
                    <option value="medium">{{ 'tasks.sredniy' | t }}</option>
                    <option value="high">{{ 'task.priority.high' | t }}</option>
                    <option value="critical">{{ 'tasks.kriticheskiy' | t }}</option>
                  </select>
                </div>
              </td>
              <td>
                <!-- Quick Status Changer Dropdown -->
                <div class="inline-status-wrapper table-status">
                  <span class="status-dot" [style.background-color]="getStatusColor(t.statusId)" aria-hidden="true"></span>
                  <select
                    class="inline-status-select"
                    [ngModel]="t.statusId"
                    (ngModelChange)="updateStatus.emit({ taskId: t.id, statusId: $event })"
                    [disabled]="!canUpdateTask"
                    [attr.aria-label]="'tasks.task_status_aria' | t:{id: t.id}"
                    [title]="'tasks.nazhmite_dlya_smeny_statusa' | t"
                  >
                    <option *ngFor="let s of statuses" [ngValue]="s.id">{{ s.name }}</option>
                  </select>
                </div>
              </td>
              <td>
                <ng-container *ngIf="getDeadlineInfo(t.endTime, t.statusId) as dl">
                  <span
                    *ngIf="dl.state !== 'none'"
                    class="deadline-pill"
                    [class.overdue]="dl.state === 'overdue'"
                    [class.deadline-today]="dl.state === 'today'"
                    [class.deadline-tomorrow]="dl.state === 'tomorrow'"
                    [title]="'tasks.deadline_value' | t:{date: (t.endTime | date:'dd.MM.yyyy HH:mm') || ''}"
                  >
                    <span class="material-symbols-outlined ico" aria-hidden="true">
                      {{ dl.state === 'overdue' ? 'warning' : (dl.state === 'today' ? 'alarm' : 'event') }}
                    </span>
                    {{ dl.label }}
                  </span>
                  <span *ngIf="dl.state === 'none'" class="text-muted">—</span>
                </ng-container>
              </td>
              <td class="text-right actions-cell">
                <div class="row-action-btns">
                  <button
                    *ngIf="canUpdateTask"
                    type="button"
                    class="icon-ghost-btn"
                    [attr.aria-label]="'tasks.edit_task_number' | t:{id: t.id}"
                    [title]="'tasks.redaktirovat_zadachu' | t"
                    (click)="openEditModal.emit(t)"
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">edit</span>
                  </button>
                  <button
                    type="button"
                    class="icon-ghost-btn"
                    [attr.aria-label]="'tasks.view_task_number' | t:{id: t.id}"
                    [title]="'tasks.prosmotret_detali' | t"
                    (click)="openTaskDetails.emit(t)"
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">visibility</span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div *ngIf="tasks.length === 0 && !isLoading && !listLoadError" class="empty-state-cell">
        <span class="material-symbols-outlined icon" aria-hidden="true">task</span>
        <p>{{ 'tasks.zadachi_ne_naydeny' | t }}</p>
        <ui-button *ngIf="hasActiveFilters" variant="secondary" size="sm" (onClick)="resetFilters.emit()">
          {{ 'tasks.sbrosit_vse_filtry' | t }}
        </ui-button>
        <ui-button *ngIf="!hasActiveFilters && canCreateTask" variant="primary" size="sm" icon="add" (onClick)="createTask.emit()">
          {{ 'task.new' | t }}
        </ui-button>
      </div>
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
    .task-row {
      cursor: pointer;
      transition: background 0.1s ease;
    }
    .task-row:hover { background-color: var(--bg-hover); }
    .task-row:last-child td { border-bottom: none; }

    /* Overdue Highlighting in Table */
    .task-row.row-overdue {
      background-color: rgba(239, 68, 68, 0.04);
      border-left: 3px solid var(--danger);
    }
    .task-row.row-overdue:hover {
      background-color: rgba(239, 68, 68, 0.08);
    }
    .overdue-tag {
      font-size: 9px;
      font-weight: 600;
      color: var(--danger);
      background-color: var(--danger-bg);
      padding: 1px 5px;
      border-radius: 3px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .task-type-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      font-weight: 500;
      padding: 1px 6px;
      border-radius: 4px;
    }
    .task-type-badge .type-icon { font-size: 13px; }

    .task-title-cell {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .task-title { font-weight: 500; }
    .task-title-open {
      border: 0;
      padding: 0;
      background: transparent;
      color: var(--text-main);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .task-title-open:hover { color: var(--primary); text-decoration: underline; }
    .parent-chip {
      font-size: 10px;
      background-color: var(--bg-hover);
      color: var(--text-muted);
      padding: 1px 5px;
      border-radius: 4px;
      border: 1px solid var(--border-color);
    }

    .project-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .folder-ico { font-size: 14px; color: var(--warning); }

    /* Inline Priority Select */
    .inline-priority-wrapper { display: inline-flex; align-items: center; }
    .inline-priority-select {
      border: 1px solid transparent;
      border-radius: 10px;
      padding: 2px 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      background-color: var(--bg-hover);
      color: var(--text-muted);
      outline: none;
      transition: all 0.12s ease;
      font-family: inherit;
    }
    .inline-priority-select:hover:not(:disabled) { border-color: var(--border-color); }
    .inline-priority-select[data-priority="low"] {
      background-color: rgba(16, 185, 129, 0.12);
      color: #10b981;
    }
    .inline-priority-select[data-priority="medium"],
    .inline-priority-select[data-priority="normal"] {
      background-color: rgba(59, 130, 246, 0.12);
      color: #3b82f6;
    }
    .inline-priority-select[data-priority="high"] {
      background-color: rgba(245, 158, 11, 0.15);
      color: #d97706;
    }
    .inline-priority-select[data-priority="critical"],
    .inline-priority-select[data-priority="urgent"] {
      background-color: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }
    .inline-priority-select:disabled { cursor: default; }

    /* Inline Status Select */
    .inline-status-wrapper { display: inline-flex; align-items: center; gap: 5px; }
    .inline-status-select {
      height: 26px;
      padding: 1px 6px;
      font-size: 11px;
      font-weight: 500;
      border-radius: 10px;
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-main);
      cursor: pointer;
      outline: none;
    }
    .inline-status-select:focus { border-color: var(--primary); }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }

    .deadline-pill {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      color: var(--text-muted);
      background-color: var(--bg-hover);
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid var(--border-color);
      white-space: nowrap;
    }
    .deadline-pill .ico { font-size: 13px; }
    .deadline-pill.overdue {
      color: var(--danger);
      background-color: var(--danger-bg);
      border-color: rgba(239,68,68,0.3);
      font-weight: 600;
    }
    .deadline-pill.deadline-today {
      background-color: rgba(245, 158, 11, 0.15);
      border-color: rgba(245, 158, 11, 0.35);
      color: #d97706;
      font-weight: 600;
    }
    .deadline-pill.deadline-tomorrow {
      background-color: rgba(59, 130, 246, 0.12);
      border-color: rgba(59, 130, 246, 0.3);
      color: #2563eb;
    }

    .row-action-btns { display: inline-flex; gap: 4px; }
    .icon-ghost-btn {
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .icon-ghost-btn:hover { color: var(--text-main); background-color: var(--bg-hover); }
    .icon-ghost-btn .material-symbols-outlined { font-size: 17px; }

    .empty-state-cell {
      padding: 40px;
      text-align: center;
      color: var(--text-muted);
    }
    .empty-state-cell .icon { font-size: 36px; color: var(--text-light); margin-bottom: 6px; }
    .font-mono { font-family: ui-monospace, monospace; }
    .tabular-nums { font-variant-numeric: tabular-nums; }
    .text-danger { color: var(--danger); }
    .text-muted { color: var(--text-muted); }
    .text-right { text-align: right; }
  `]
})
export class TaskTableViewComponent {
  @Input() tasks: Task[] = [];
  @Input() paginatedTasks: Task[] = [];
  @Input() statuses: TaskStatus[] = [];
  @Input() projects: Project[] = [];
  @Input() taskTypes: TaskType[] = [];
  @Input() canCreateTask = false;
  @Input() canUpdateTask = false;
  @Input() hasActiveFilters = false;
  @Input() isLoading = false;
  @Input() listLoadError = false;

  @Input() isOverdue!: (endTime: string | null | undefined, statusId: number) => boolean;
  @Input() getTypeColor!: (task: Task) => string;
  @Input() getTypeBg!: (task: Task) => string;
  @Input() getTypeIcon!: (task: Task) => string;
  @Input() getTypeLabel!: (task: Task) => string;
  @Input() getProjectName!: (projectId: number | null | undefined) => string | null;
  @Input() getStatusColor!: (statusId: number | null | undefined) => string;
  @Input() getDeadlineInfo!: (endTime: string | null | undefined, statusId: number) => { state: string; label: string };

  @Output() openTaskDetails = new EventEmitter<Task>();
  @Output() openEditModal = new EventEmitter<Task>();
  @Output() updatePriority = new EventEmitter<{ taskId: number; priority: string }>();
  @Output() updateStatus = new EventEmitter<{ taskId: number; statusId: number }>();
  @Output() resetFilters = new EventEmitter<void>();
  @Output() createTask = new EventEmitter<void>();

  onTaskContainerClick(event: MouseEvent, task: Task) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, select, input, textarea, a, [role="button"], [role="option"]')) return;
    this.openTaskDetails.emit(task);
  }
}
