import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DragDropModule, CdkDragDrop } from '@angular/cdk/drag-drop';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { Task, Project, TaskStatus, TaskType } from '../../../core/models/task.models';

@Component({
  selector: 'app-task-kanban-view',
  standalone: true,
  imports: [
    CommonModule,
    DragDropModule,
    TranslatePipe,
    UiButtonComponent
  ],
  template: `
    <div class="kanban-board" cdkDropListGroup role="region" [attr.aria-label]="'tasks.kanban_doska_zadach' | t">
      <div class="kanban-empty-recovery" *ngIf="tasks.length === 0 && !isLoading && !listLoadError">
        <span>{{ 'tasks.zadachi_ne_naydeny' | t }}</span>
        <ui-button *ngIf="hasActiveFilters" variant="secondary" size="sm" (onClick)="resetFilters.emit()">
          {{ 'tasks.sbrosit_vse_filtry' | t }}
        </ui-button>
        <ui-button *ngIf="!hasActiveFilters && canCreateTask" variant="primary" size="sm" icon="add" (onClick)="createTask.emit()">
          {{ 'task.new' | t }}
        </ui-button>
      </div>

      <div
        *ngFor="let status of statuses"
        class="kanban-column"
        [style.border-top-color]="status.color || 'var(--primary)'"
        (dragover)="onHtml5DragOver($event)"
        (dragleave)="onHtml5DragLeave($event)"
        (drop)="onHtml5Drop($event, status.id)"
      >
        <!-- Column Header -->
        <div class="column-header">
          <div class="column-title-group">
            <span class="status-dot" [style.background-color]="status.color || 'var(--primary)'"></span>
            <h3 class="column-title">{{ status.name }}</h3>
          </div>
          <span class="column-badge">{{ getTasksByStatus(status.id).length }}</span>
        </div>

        <!-- Drop List Zone for CDK Drag & Drop -->
        <div
          cdkDropList
          [cdkDropListDisabled]="!canUpdateTask"
          [cdkDropListData]="getTasksByStatus(status.id)"
          [id]="'col-' + status.id"
          class="column-tasks-dropzone"
          (cdkDropListDropped)="onTaskDrop($event, status.id)"
        >
          <div
            *ngFor="let task of getTasksByStatus(status.id)"
            cdkDrag
            [cdkDragDisabled]="!canUpdateTask"
            [cdkDragData]="task"
            [attr.draggable]="canUpdateTask ? 'true' : null"
            (dragstart)="onHtml5DragStart($event, task)"
            (dragend)="onHtml5DragEnd()"
            class="kanban-card"
            [class.can-drag]="canUpdateTask"
            [class.card-overdue]="isOverdue(task.endTime, task.statusId)"
            (click)="onTaskContainerClick($event, task)"
          >
            <!-- Card Top -->
            <div class="card-top-row">
              <div class="card-type-group">
                <span *ngIf="canUpdateTask" class="material-symbols-outlined drag-grip-icon" cdkDragHandle [title]="'tasks.peretaschit_kartochku' | t">
                  drag_indicator
                </span>
                <span class="task-type-badge-mini" [style.color]="getTypeColor(task)">
                  <span class="material-symbols-outlined mini-ico">{{ getTypeIcon(task) }}</span>
                  <span class="task-id font-mono">#{{ task.id }}</span>
                </span>
              </div>
              <span class="priority-pill" [attr.data-priority]="task.priority">
                {{ getPriorityLabel(task.priority) }}
              </span>
            </div>

            <!-- Card Title -->
            <button
              type="button"
              class="card-title kanban-title-open"
              [class.title-overdue]="isOverdue(task.endTime, task.statusId)"
              [attr.aria-label]="'tasks.open_task_named' | t:{id: task.id, title: task.title}"
              (click)="openTaskDetails.emit(task)"
            >
              {{ task.title }}
            </button>

            <!-- Card Meta -->
            <div class="card-meta" *ngIf="task.projectId || task.parentTaskId">
              <span class="project-tag-mini" *ngIf="getProjectName(task.projectId) as pName">
                <span class="material-symbols-outlined folder-ico">folder</span>
                {{ pName }}
              </span>
              <span *ngIf="task.parentTaskId" class="parent-chip font-mono">
                ↳ #{{ task.parentTaskId }}
              </span>
            </div>

            <!-- Card Bottom Row -->
            <div class="card-bottom-row" (click)="$event.stopPropagation()">
              <ng-container *ngIf="getDeadlineInfo(task.endTime, task.statusId) as dl">
                <span
                  *ngIf="dl.state !== 'none'"
                  class="deadline-pill"
                  [class.overdue]="dl.state === 'overdue'"
                  [class.deadline-today]="dl.state === 'today'"
                  [class.deadline-tomorrow]="dl.state === 'tomorrow'"
                  [title]="'tasks.deadline_value' | t:{date: (task.endTime | date:'dd.MM.yyyy HH:mm') || ''}"
                >
                  <span class="material-symbols-outlined ico">
                    {{ dl.state === 'overdue' ? 'warning' : (dl.state === 'today' ? 'alarm' : 'event') }}
                  </span>
                  {{ dl.label }}
                </span>
                <span *ngIf="dl.state === 'none'" class="text-muted text-xs">{{ 'tasks.bez_sroka' | t }}</span>
              </ng-container>

              <!-- Quick Move Buttons -->
              <div class="kanban-move-actions" *ngIf="canUpdateTask">
                <button
                  type="button"
                  class="move-btn"
                  [attr.aria-label]="'tasks.move_task_back' | t:{id: task.id}"
                  [title]="'tasks.peremestit_nazad' | t"
                  [disabled]="isFirstStatus(status.id)"
                  (click)="moveTaskStatus(task, -1)"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">chevron_left</span>
                </button>
                <button
                  type="button"
                  class="move-btn"
                  [attr.aria-label]="'tasks.move_task_forward' | t:{id: task.id}"
                  [title]="'tasks.peremestit_vpered' | t"
                  [disabled]="isLastStatus(status.id)"
                  (click)="moveTaskStatus(task, 1)"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
                </button>
              </div>
            </div>
          </div>

          <div *ngIf="getTasksByStatus(status.id).length === 0" class="kanban-empty-col">
            {{ 'tasks.peretaschite_zadachu_syuda' | t }}
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .kanban-board {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
      align-items: start;
      width: 100%;
    }
    .kanban-column {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-top: 3px solid var(--primary);
      border-radius: var(--radius-md);
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      min-height: 250px;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }
    .kanban-column.drag-over {
      background-color: rgba(99,102,241,0.06);
      border-color: var(--primary);
    }
    .column-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border-color);
    }
    .column-title-group { display: flex; align-items: center; gap: 6px; }
    .column-title { font-size: 13px; font-weight: 600; margin: 0; color: var(--text-main); }
    .column-badge {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      background-color: var(--bg-hover);
      padding: 1px 6px;
      border-radius: 10px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .column-tasks-dropzone {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 150px;
      border-radius: var(--radius-xs);
      transition: background-color 0.15s ease;
    }
    .column-tasks-dropzone.cdk-drop-list-dragging {
      background-color: rgba(99,102,241,0.03);
    }
    .kanban-card {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      cursor: default;
      transition: all 0.12s ease;
      box-shadow: var(--shadow-sm);
      user-select: none;
    }
    .kanban-card.can-drag { cursor: grab; }
    .kanban-card.can-drag:active { cursor: grabbing; }
    .kanban-card:hover {
      border-color: var(--primary);
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
    }
    .kanban-card.card-overdue {
      border-color: rgba(239, 68, 68, 0.4);
      background-color: rgba(239, 68, 68, 0.02);
    }
    .cdk-drag-preview {
      box-sizing: border-box;
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-overlay);
      background-color: var(--bg-surface);
      border: 1px solid var(--primary);
      padding: 10px;
      opacity: 0.95;
    }
    .cdk-drag-placeholder {
      opacity: 0.3;
      border: 2px dashed var(--primary);
      background-color: rgba(99,102,241,0.05);
      border-radius: var(--radius-sm);
      min-height: 70px;
    }
    .cdk-drag-animating {
      transition: transform 250ms cubic-bezier(0, 0, 0.2, 1);
    }
    .card-top-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .card-type-group { display: flex; align-items: center; gap: 4px; }
    .drag-grip-icon {
      font-size: 16px;
      color: var(--text-muted);
      cursor: grab;
      opacity: 0.6;
    }
    .drag-grip-icon:hover { opacity: 1; color: var(--primary); }
    .task-type-badge-mini {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 10px;
      font-weight: 500;
    }
    .task-type-badge-mini .mini-ico { font-size: 13px; }
    .card-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-main);
      margin: 0;
      line-height: 1.35;
      text-align: left;
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
    }
    .card-title:hover { color: var(--primary); text-decoration: underline; }
    .title-overdue { color: var(--danger); }
    .card-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .project-tag-mini {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      color: var(--text-muted);
    }
    .project-tag-mini .folder-ico { font-size: 13px; }
    .parent-chip {
      font-size: 10px;
      background-color: var(--bg-hover);
      color: var(--text-muted);
      padding: 1px 4px;
      border-radius: 3px;
      border: 1px solid var(--border-color);
    }
    .card-bottom-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 6px;
      border-top: 1px solid var(--border-color);
    }
    .kanban-move-actions { display: inline-flex; gap: 2px; }
    .move-btn {
      border: 1px solid var(--border-color);
      background-color: var(--bg-hover);
      color: var(--text-muted);
      border-radius: 3px;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
    }
    .move-btn:hover:not(:disabled) { color: var(--text-main); border-color: var(--primary); }
    .move-btn:disabled { opacity: 0.3; cursor: not-allowed; }
    .move-btn .material-symbols-outlined { font-size: 14px; }
    .kanban-empty-col {
      padding: 20px 10px;
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
      font-style: italic;
      border: 1px dashed var(--border-color);
      border-radius: var(--radius-xs);
    }
    .kanban-empty-recovery {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 12px;
      color: var(--text-muted);
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
    }
    .priority-pill {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: var(--radius-xs);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .priority-pill[data-priority="critical"],
    .priority-pill[data-priority="urgent"] { background-color: var(--danger-bg); color: var(--danger); }
    .priority-pill[data-priority="high"] { background-color: var(--warning-bg); color: var(--warning); }
    .priority-pill[data-priority="medium"],
    .priority-pill[data-priority="normal"] { background-color: rgba(59, 130, 246, 0.1); color: #2563eb; }
    .priority-pill[data-priority="low"] { background-color: var(--bg-hover); color: var(--text-muted); }
    .deadline-pill {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: var(--radius-xs);
      background-color: var(--bg-hover);
      color: var(--text-muted);
    }
    .deadline-pill.overdue { background-color: var(--danger-bg); color: var(--danger); font-weight: 500; }
    .deadline-pill.deadline-today { background-color: var(--warning-bg); color: var(--warning); font-weight: 500; }
    .deadline-pill.deadline-tomorrow { background-color: rgba(59,130,246,0.1); color: #2563eb; font-weight: 500; }
    .deadline-pill .ico { font-size: 13px; }
    .font-mono { font-family: ui-monospace, monospace; }
    .text-muted { color: var(--text-muted); }
    .text-xs { font-size: 11px; }
  `]
})
export class TaskKanbanViewComponent {
  @Input() tasks: Task[] = [];
  @Input() statuses: TaskStatus[] = [];
  @Input() projects: Project[] = [];
  @Input() taskTypes: TaskType[] = [];
  @Input() canCreateTask = false;
  @Input() canUpdateTask = false;
  @Input() hasActiveFilters = false;
  @Input() isLoading = false;
  @Input() listLoadError = false;

  @Input() getDeadlineInfo!: (endTime: string | null | undefined, statusId: number) => { state: string; label: string };
  @Input() getPriorityLabel!: (priority: string) => string;
  @Input() getTypeColor!: (task: Task) => string;
  @Input() getTypeIcon!: (task: Task) => string;
  @Input() getProjectName!: (projectId: number | null | undefined) => string | null;
  @Input() isOverdue!: (endTime: string | null | undefined, statusId: number) => boolean;

  @Output() openTaskDetails = new EventEmitter<Task>();
  @Output() taskStatusChange = new EventEmitter<{ task: Task; targetStatusId: number }>();
  @Output() taskDragStart = new EventEmitter<Task>();
  @Output() taskDragEnd = new EventEmitter<void>();
  @Output() resetFilters = new EventEmitter<void>();
  @Output() createTask = new EventEmitter<void>();

  private draggedTask: Task | null = null;

  getTasksByStatus(statusId: number): Task[] {
    return this.tasks.filter(t => t.statusId === statusId);
  }

  isFirstStatus(statusId: number): boolean {
    return this.statuses.length > 0 && this.statuses[0].id === statusId;
  }

  isLastStatus(statusId: number): boolean {
    return this.statuses.length > 0 && this.statuses[this.statuses.length - 1].id === statusId;
  }

  moveTaskStatus(task: Task, direction: -1 | 1) {
    if (!this.canUpdateTask) return;
    const currentIndex = this.statuses.findIndex(s => s.id === task.statusId);
    if (currentIndex === -1) return;

    const targetIndex = currentIndex + direction;
    if (targetIndex >= 0 && targetIndex < this.statuses.length) {
      const targetStatus = this.statuses[targetIndex];
      this.taskStatusChange.emit({ task, targetStatusId: targetStatus.id });
    }
  }

  onTaskDrop(event: CdkDragDrop<Task[]>, targetStatusId: number) {
    if (!this.canUpdateTask) return;
    const task = event.item.data as Task;
    if (!task || task.statusId === targetStatusId) return;
    this.taskStatusChange.emit({ task, targetStatusId });
  }

  onHtml5DragStart(event: DragEvent, task: Task) {
    if (!this.canUpdateTask) {
      event.preventDefault();
      return;
    }
    this.draggedTask = task;
    this.taskDragStart.emit(task);
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', String(task.id));
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onHtml5DragEnd() {
    this.draggedTask = null;
    this.taskDragEnd.emit();
  }

  onHtml5DragOver(event: DragEvent) {
    if (!this.canUpdateTask) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const col = (event.currentTarget as HTMLElement);
    if (col && !col.classList.contains('drag-over')) {
      col.classList.add('drag-over');
    }
  }

  onHtml5DragLeave(event: DragEvent) {
    if (!this.canUpdateTask) return;
    const col = (event.currentTarget as HTMLElement);
    if (col) {
      col.classList.remove('drag-over');
    }
  }

  onHtml5Drop(event: DragEvent, targetStatusId: number) {
    if (!this.canUpdateTask) return;
    event.preventDefault();
    const col = (event.currentTarget as HTMLElement);
    if (col) {
      col.classList.remove('drag-over');
    }

    const task = this.draggedTask;
    this.draggedTask = null;
    if (!task || task.statusId === targetStatusId) return;

    this.taskStatusChange.emit({ task, targetStatusId });
  }

  onTaskContainerClick(event: MouseEvent, task: Task) {
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('select') || target.closest('a') || target.closest('.kanban-move-actions')) {
      return;
    }
    this.openTaskDetails.emit(task);
  }
}
