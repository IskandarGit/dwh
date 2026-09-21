import { Injectable, inject, WritableSignal } from '@angular/core';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/services/i18n.service';
import { Task, TaskStatus } from '../../../core/models/task.models';
import { safeNumericRecordId } from '../../../core/services/search-target';

@Injectable({
  providedIn: 'root'
})
export class TaskKanbanService {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly uiI18n = inject(I18nService);

  draggedTask: Task | null = null;

  onTaskDrop(
    event: CdkDragDrop<Task[]>,
    targetStatusId: number,
    canUpdate: boolean,
    onStatusChange: (task: Task, targetStatusId: number) => void
  ): void {
    if (!canUpdate) return;
    const task = event.item.data as Task;
    if (!task || task.statusId === targetStatusId) return;
    onStatusChange(task, targetStatusId);
  }

  onHtml5DragStart(event: DragEvent, task: Task, canUpdate: boolean): void {
    if (!canUpdate) {
      event.preventDefault();
      return;
    }
    this.draggedTask = task;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', String(task.id));
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onHtml5DragOver(event: DragEvent, canUpdate: boolean): void {
    if (!canUpdate) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const col = event.currentTarget as HTMLElement;
    if (col && !col.classList.contains('drag-over')) {
      col.classList.add('drag-over');
    }
  }

  onHtml5DragLeave(event: DragEvent, canUpdate: boolean): void {
    if (!canUpdate) return;
    const col = event.currentTarget as HTMLElement;
    if (col) {
      col.classList.remove('drag-over');
    }
  }

  onHtml5Drop(
    event: DragEvent,
    targetStatusId: number,
    canUpdate: boolean,
    onStatusChange: (task: Task, targetStatusId: number) => void
  ): void {
    if (!canUpdate) return;
    event.preventDefault();
    const col = event.currentTarget as HTMLElement;
    if (col) {
      col.classList.remove('drag-over');
    }

    const task = this.draggedTask;
    this.draggedTask = null;
    if (!task || task.statusId === targetStatusId) return;

    onStatusChange(task, targetStatusId);
  }

  getTasksByStatus(statusId: number, tasks: Task[]): Task[] {
    return tasks.filter(t => t.statusId === statusId);
  }

  isFirstStatus(statusId: number, statuses: TaskStatus[]): boolean {
    return statuses.length > 0 && statuses[0].id === statusId;
  }

  isLastStatus(statusId: number, statuses: TaskStatus[]): boolean {
    return statuses.length > 0 && statuses[statuses.length - 1].id === statusId;
  }

  moveTaskStatus(
    task: Task,
    direction: -1 | 1,
    statuses: TaskStatus[],
    canUpdate: boolean,
    onUpdateStatus: (taskId: number, targetStatusId: number) => void
  ): void {
    if (!canUpdate) return;
    const currentIndex = statuses.findIndex(s => s.id === task.statusId);
    if (currentIndex === -1) return;

    const targetIndex = currentIndex + direction;
    if (targetIndex >= 0 && targetIndex < statuses.length) {
      const targetStatus = statuses[targetIndex];
      onUpdateStatus(task.id, targetStatus.id);
    }
  }

  updatePriority(
    taskId: number,
    newPriority: string,
    onLocalUpdate: () => void
  ): void {
    if (!safeNumericRecordId(taskId) || !newPriority) return;
    this.api.patch(`/tasks/${taskId}`, { priority: newPriority }).subscribe({
      next: () => {
        this.toast.success(this.uiI18n.translate('tasks.priority_updated'));
        onLocalUpdate();
      },
      error: err => {
        this.toast.error(err.error?.message || this.uiI18n.translate('tasks.ne_udalos_izmenit_prioritet'));
      }
    });
  }

  updateStatus(
    taskId: number,
    newStatusId: number,
    onApplyVisible: () => void,
    onUpdateSelected: () => void
  ): void {
    if (!safeNumericRecordId(taskId) || !safeNumericRecordId(newStatusId)) return;
    this.api.post(`/tasks/${taskId}/status`, { statusId: newStatusId }).subscribe({
      next: () => {
        this.toast.success(this.uiI18n.translate('tasks.status_zadachi_obnovlen'));
        onApplyVisible();
        onUpdateSelected();
      },
      error: err => {
        this.toast.error(err.error?.message || this.uiI18n.translate('tasks.ne_udalos_izmenit_status'));
      }
    });
  }

  executeStatusChange(
    task: Task,
    targetStatusId: number,
    statusName: string,
    onApplyVisible: () => void,
    onUpdateSelected: () => void,
    onErrorReload: () => void
  ): void {
    if (!safeNumericRecordId(task.id) || !safeNumericRecordId(targetStatusId)) return;
    onApplyVisible();
    onUpdateSelected();

    this.api.post(`/tasks/${task.id}/status`, { statusId: targetStatusId }).subscribe({
      next: () => {
        this.toast.success(this.uiI18n.translate('tasks.task_moved_to_status', { id: task.id, status: statusName }));
      },
      error: err => {
        this.toast.error(err.error?.message || this.uiI18n.translate('tasks.ne_udalos_izmenit_status_zadachi'));
        onErrorReload();
      }
    });
  }

  applyStatusToVisibleTasks(
    taskId: number,
    statusId: number,
    statuses: TaskStatus[],
    statusFilterMode: 'active' | 'all' | number,
    tasks: WritableSignal<Task[]>
  ): void {
    const targetStatus = statuses.find(status => status.id === statusId);
    const leavesCurrentFilter =
      (statusFilterMode === 'active' && targetStatus?.isTerminal === true) ||
      (typeof statusFilterMode === 'number' && statusFilterMode !== statusId);
    tasks.update(list => leavesCurrentFilter
      ? list.filter(task => task.id !== taskId)
      : list.map(task => task.id === taskId ? { ...task, statusId } : task));
  }
}
