import { Injectable, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/services/i18n.service';
import {
  Task,
  TaskMember,
  TaskFile,
  TaskComment,
  TaskDetailResponse
} from '../../../core/models/task.models';
import { recordResponseMatches, safeNumericRecordId } from '../../../core/services/search-target';

@Injectable({
  providedIn: 'root'
})
export class TaskDetailsService {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly uiI18n = inject(I18nService);

  readonly selectedTask = signal<Task | null>(null);
  readonly taskMembers = signal<TaskMember[]>([]);
  readonly taskSubtasks = signal<Task[]>([]);
  readonly taskAncestors = signal<Task[]>([]);
  readonly taskFiles = signal<TaskFile[]>([]);
  readonly comments = signal<TaskComment[]>([]);

  readonly detailLoading = signal<boolean>(false);
  readonly detailLoadError = signal<boolean>(false);
  readonly detailNotFound = signal<boolean>(false);
  readonly commentsLoading = signal<boolean>(false);
  readonly commentsLoadError = signal<boolean>(false);
  readonly isCommentSubmitting = signal<boolean>(false);

  private readonly commentDrafts = new Map<number, string>();
  private detailRequestId = 0;
  private commentsRequestId = 0;
  private commentPostRequestId = 0;
  detailContextId = 0;

  private detailRequest?: Subscription;
  private commentsRequest?: Subscription;
  private commentPostRequest?: Subscription;

  get commentDraft(): string {
    const taskId = this.selectedTask()?.id;
    return taskId == null ? '' : this.commentDrafts.get(taskId) || '';
  }

  set commentDraft(value: string) {
    const taskId = this.selectedTask()?.id;
    if (taskId != null) this.commentDrafts.set(taskId, value);
  }

  detailRecordId(routeRecordId: () => string | null): string | null {
    return routeRecordId() ?? (this.selectedTask() ? String(this.selectedTask()!.id) : null);
  }

  openTaskDetails(
    task: Task,
    isEditModalOpen: () => boolean,
    routeRecordId: () => string | null,
    navigateToRecord: (id: string) => void
  ): void {
    if (!safeNumericRecordId(task.id)) return;
    if (isEditModalOpen()) return;
    const currentRouteId = routeRecordId();
    if (currentRouteId !== null && currentRouteId !== String(task.id)) {
      navigateToRecord(String(task.id));
      return;
    }
    this.cancelDetailRequests();
    this.detailContextId++;
    this.selectedTask.set(task);
    this.taskMembers.set([]);
    this.taskSubtasks.set([]);
    this.taskAncestors.set([]);
    this.taskFiles.set([]);
    this.comments.set([]);
    this.loadTaskFullDetails(task.id, routeRecordId);
    this.loadComments(task.id, routeRecordId);
  }

  onTaskContainerClick(
    event: MouseEvent,
    task: Task,
    isEditModalOpen: () => boolean,
    routeRecordId: () => string | null,
    navigateToRecord: (id: string) => void
  ): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, select, input, textarea, a, [role="button"], [role="option"]')) return;
    this.openTaskDetails(task, isEditModalOpen, routeRecordId, navigateToRecord);
  }

  loadTaskFullDetails(taskId: number | string, routeRecordId: () => string | null): void {
    const requestId = ++this.detailRequestId;
    this.detailRequest?.unsubscribe();
    this.detailLoading.set(true);
    this.detailLoadError.set(false);
    this.detailNotFound.set(false);
    this.detailRequest = this.api.get<TaskDetailResponse>(`/tasks/${taskId}`, undefined, { notifyError: false }).subscribe({
      next: res => {
        if (requestId !== this.detailRequestId || this.detailRecordId(routeRecordId) !== String(taskId)) return;
        this.detailLoading.set(false);
        if (recordResponseMatches(res?.task?.id, String(taskId))) {
          this.selectedTask.set(res.task);
          this.taskMembers.set(res.members || []);
          this.taskSubtasks.set(res.subtasks || []);
          this.taskAncestors.set(res.ancestors || []);
          this.taskFiles.set(res.files || []);
        } else {
          this.detailLoadError.set(true);
        }
      },
      error: error => {
        if (requestId !== this.detailRequestId || this.detailRecordId(routeRecordId) !== String(taskId)) return;
        this.detailLoading.set(false);
        this.detailLoadError.set(true);
        this.detailNotFound.set(error?.status === 404 || error?.status === 403);
      }
    });
  }

  retryTaskDetails(routeRecordId: () => string | null): void {
    const taskId = this.detailRecordId(routeRecordId);
    if (taskId != null) this.loadTaskFullDetails(taskId, routeRecordId);
  }

  closeTaskDetails(returnToList: boolean, routeRecordId: () => string | null, navigateToList: () => void): void {
    if (returnToList && routeRecordId() !== null) {
      navigateToList();
      return;
    }
    this.clearTaskDetails();
  }

  clearTaskDetails(): void {
    this.cancelDetailRequests();
    this.detailContextId++;
    this.selectedTask.set(null);
    this.taskMembers.set([]);
    this.taskSubtasks.set([]);
    this.taskAncestors.set([]);
    this.taskFiles.set([]);
    this.comments.set([]);
    this.detailLoading.set(false);
    this.detailLoadError.set(false);
    this.detailNotFound.set(false);
    this.commentsLoading.set(false);
    this.commentsLoadError.set(false);
  }

  cancelDetailRequests(): void {
    this.detailRequestId++;
    this.commentsRequestId++;
    this.detailRequest?.unsubscribe();
    this.commentsRequest?.unsubscribe();
  }

  onTaskFileAttached(file: TaskFile): void {
    const t = this.selectedTask();
    if (!t || !safeNumericRecordId(t.id)) return;
    const currentContextId = this.detailContextId;
    this.api.post(`/tasks/${t.id}/files`, { fileId: file.fileId }).subscribe({
      next: () => {
        if (currentContextId !== this.detailContextId || this.selectedTask()?.id !== t.id) return;
        this.taskFiles.update(list => [...list, file]);
        this.toast.success(this.uiI18n.translate('tasks.file_attached', { name: file.fileName }));
      },
      error: err => {
        if (currentContextId !== this.detailContextId || this.selectedTask()?.id !== t.id) return;
        this.toast.error(err.error?.message || this.uiI18n.translate('tasks.ne_udalos_prikrepit_fayl'));
      }
    });
  }

  onTaskFileRemoved(file: TaskFile): void {
    const t = this.selectedTask();
    if (!t || !safeNumericRecordId(t.id)) return;
    const currentContextId = this.detailContextId;
    this.api.delete(`/tasks/${t.id}/files/${file.fileId}`).subscribe({
      next: () => {
        if (currentContextId !== this.detailContextId || this.selectedTask()?.id !== t.id) return;
        this.taskFiles.update(list => list.filter(f => f.fileId !== file.fileId));
        this.toast.success(this.uiI18n.translate('tasks.file_removed', { name: file.fileName }));
      },
      error: err => {
        if (currentContextId !== this.detailContextId || this.selectedTask()?.id !== t.id) return;
        this.toast.error(err.error?.message || this.uiI18n.translate('files.ne_udalos_udalit_fayl'));
      }
    });
  }

  loadComments(taskId: number | string, routeRecordId: () => string | null): void {
    const requestId = ++this.commentsRequestId;
    this.commentsRequest?.unsubscribe();
    this.commentsLoading.set(true);
    this.commentsLoadError.set(false);
    this.commentsRequest = this.api.get<TaskComment[]>(`/tasks/${taskId}/comments`, undefined, { notifyError: false }).subscribe({
      next: res => {
        if (requestId !== this.commentsRequestId || this.detailRecordId(routeRecordId) !== String(taskId)) return;
        this.commentsLoading.set(false);
        this.comments.set((res || []).filter(comment => recordResponseMatches(comment.taskId, String(taskId))));
      },
      error: () => {
        if (requestId !== this.commentsRequestId || this.detailRecordId(routeRecordId) !== String(taskId)) return;
        this.commentsLoading.set(false);
        this.commentsLoadError.set(true);
      }
    });
  }

  retryComments(routeRecordId: () => string | null): void {
    const taskId = this.detailRecordId(routeRecordId);
    if (taskId != null) this.loadComments(taskId, routeRecordId);
  }

  submitComment(canComment: () => boolean, routeRecordId: () => string | null): void {
    const task = this.selectedTask();
    const text = this.commentDraft.trim();
    if (!task || !safeNumericRecordId(task.id) || !text || !canComment() || this.isCommentSubmitting()) return;

    const requestId = ++this.commentPostRequestId;
    this.isCommentSubmitting.set(true);
    this.commentPostRequest = this.api.post(`/tasks/${task.id}/comments`, { textMarkdown: text }).subscribe({
      next: () => {
        if (requestId !== this.commentPostRequestId) return;
        this.isCommentSubmitting.set(false);
        this.commentDrafts.delete(task.id);
        if (this.selectedTask()?.id === task.id) this.loadComments(task.id, routeRecordId);
        this.toast.success(this.uiI18n.translate('tasks.kommentariy_dobavlen'));
      },
      error: err => {
        if (requestId !== this.commentPostRequestId) return;
        this.isCommentSubmitting.set(false);
        this.toast.error(err.error?.message || this.uiI18n.translate('tasks.ne_udalos_otpravit_kommentariy'));
      }
    });
  }

  cleanup(): void {
    this.cancelDetailRequests();
    this.commentPostRequestId++;
    this.commentPostRequest?.unsubscribe();
  }
}
