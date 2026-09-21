import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/services/i18n.service';
import { Task, TaskDetailResponse, TaskMember } from '../../../core/models/task.models';
import { RecordNavigationDecision } from '../../../core/guards/record-navigation.guard';
import { safeNumericRecordId } from '../../../core/services/search-target';
import { toLocalDateTime, toTaskInstant } from '../task-form-value';
import {
  TaskCreateFormValue,
  TaskEditFormValue,
  createDefaultTaskCreateForm,
  sameIdSet
} from '../tasks.models';

@Injectable({
  providedIn: 'root'
})
export class TaskFormsService {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly uiI18n = inject(I18nService);
  readonly navigationDecision = new RecordNavigationDecision();

  readonly isCreateModalOpen = signal<boolean>(false);
  isCreateSubmitted = false;
  createForm: TaskCreateFormValue = createDefaultTaskCreateForm();
  createFormBaseline = '';

  readonly isEditModalOpen = signal<boolean>(false);
  readonly isEditDiscardConfirmationOpen = signal<boolean>(false);
  readonly editLoading = signal<boolean>(false);
  readonly editLoadError = signal<boolean>(false);
  readonly isSubmitting = signal<boolean>(false);

  isEditSubmitted = false;
  editingTask: Task | null = null;
  editTargetId: number | null = null;
  editReturnTask: Task | null = null;
  editFormBaseline = '';
  editAssignmentBaseline: { parentTaskId: number | null; responsibleUserId: number | null; executorUserIds: number[]; observerUserIds: number[] } | null = null;

  editForm: TaskEditFormValue = {
    title: '',
    taskType: 'task',
    descriptionMarkdown: '',
    projectId: null,
    priority: 'medium',
    responsibleUserId: null,
    parentTaskId: null,
    executorUserIds: [],
    observerUserIds: [],
    beginTime: '',
    endTime: '',
    attributes: {}
  };

  private editRequestId = 0;
  private editRequest?: Subscription;
  private editSaveRequest?: Subscription;

  openCreateTaskModal(defaultType = 'task', projectId: number | null = null): void {
    this.isCreateSubmitted = false;
    this.createForm = createDefaultTaskCreateForm(projectId, defaultType);
    this.createFormBaseline = JSON.stringify(this.createForm);
    this.isCreateModalOpen.set(true);
  }

  openAddSubtaskModal(
    parentTask: Task,
    defaultType = 'task',
    onRetainParent: (id: number, title: string) => void
  ): void {
    if (!safeNumericRecordId(parentTask.id)) return;
    this.isCreateSubmitted = false;
    this.createForm = {
      title: '',
      taskType: defaultType,
      descriptionMarkdown: '',
      projectId: parentTask.projectId || null,
      priority: parentTask.priority || 'medium',
      responsibleUserId: null,
      parentTaskId: parentTask.id,
      executorUserIds: [],
      observerUserIds: [],
      beginTime: '',
      endTime: '',
      attributes: {}
    };
    onRetainParent(parentTask.id, parentTask.title);
    this.createFormBaseline = JSON.stringify(this.createForm);
    this.isCreateModalOpen.set(true);
  }

  requestCloseCreate(): void {
    if (this.isSubmitting()) return;
    this.isCreateModalOpen.set(false);
  }

  submitCreateTask(
    onSuccess: (parentTaskId: number | null) => void
  ): void {
    if (this.isSubmitting()) return;
    this.isCreateSubmitted = true;
    if (!this.createForm.title.trim()) {
      this.toast.warning(this.uiI18n.translate('tasks.ukazhite_nazvanie_zadachi'));
      return;
    }

    const attrs = { ...this.createForm.attributes, task_type: this.createForm.taskType };

    const payload = {
      title: this.createForm.title.trim(),
      descriptionMarkdown: this.createForm.descriptionMarkdown?.trim() || '',
      projectId: this.createForm.projectId ? Number(this.createForm.projectId) : null,
      priority: this.createForm.priority || 'medium',
      responsibleUserId: this.createForm.responsibleUserId ? Number(this.createForm.responsibleUserId) : null,
      parentTaskId: this.createForm.parentTaskId ? Number(this.createForm.parentTaskId) : null,
      executorUserIds: this.createForm.executorUserIds,
      observerUserIds: this.createForm.observerUserIds,
      beginTime: toTaskInstant(this.createForm.beginTime),
      endTime: toTaskInstant(this.createForm.endTime),
      attributes: attrs
    };

    const parentId = this.createForm.parentTaskId ? Number(this.createForm.parentTaskId) : null;
    this.isSubmitting.set(true);
    this.api.post<Task>('/tasks', payload).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.isCreateModalOpen.set(false);
        this.toast.success(this.uiI18n.translate('tasks.zadacha_uspeshno_sozdana'));
        onSuccess(parentId);
      },
      error: err => {
        this.isSubmitting.set(false);
        this.toast.error(err.error?.message || this.uiI18n.translate('tasks.oshibka_pri_sohranenii_zadachi'));
      }
    });
  }

  openEditModal(
    task: Task,
    closeDetailsIfMatches: () => Task | null,
    onRetainMember: (m: TaskMember) => void,
    onRetainParent: (id: number, title: string) => void,
    onSyncUsers: (responsibleId: number | null, executorIds: number[], observerIds: number[]) => void
  ): void {
    if (!safeNumericRecordId(task.id)) return;
    if (this.isSubmitting() || this.isEditModalOpen()) return;
    this.isEditSubmitted = false;
    this.isEditDiscardConfirmationOpen.set(false);
    this.editReturnTask = closeDetailsIfMatches();
    this.editTargetId = task.id;
    this.editingTask = null;
    this.editFormBaseline = '';
    this.editAssignmentBaseline = null;
    this.isEditModalOpen.set(true);
    this.loadEditDetails(task.id, onRetainMember, onRetainParent, onSyncUsers);
  }

  loadEditDetails(
    taskId: number,
    onRetainMember: (m: TaskMember) => void,
    onRetainParent: (id: number, title: string) => void,
    onSyncUsers: (responsibleId: number | null, executorIds: number[], observerIds: number[]) => void
  ): void {
    const requestId = ++this.editRequestId;
    this.editRequest?.unsubscribe();
    this.editLoading.set(true);
    this.editLoadError.set(false);
    this.editingTask = null;

    this.editRequest = this.api.get<TaskDetailResponse>(`/tasks/${taskId}`).subscribe({
      next: res => {
        if (requestId !== this.editRequestId || this.editTargetId !== taskId || !this.isEditModalOpen()) return;
        if (!res?.task || res.task.id !== taskId || !Array.isArray(res.members)) {
          this.editLoading.set(false);
          this.editLoadError.set(true);
          return;
        }
        const freshTask = res.task;
        const execIds = res.members
          .filter(m => (m.involveKind || m.involvementKind) === 'E')
          .map(m => m.userId);
        const obsIds = res.members
          .filter(m => (m.involveKind || m.involvementKind) === 'O')
          .map(m => m.userId);

        const respMember = res.members.find(m => (m.involveKind || m.involvementKind) === 'R');
        res.members.forEach(member => onRetainMember(member));
        const parent = (res.ancestors || []).find(ancestor => ancestor.id === freshTask.parentTaskId);
        if (parent) {
          onRetainParent(parent.id, parent.title);
        }

        this.editingTask = freshTask;
        this.editForm = {
          title: freshTask.title,
          taskType: (freshTask.attributes && freshTask.attributes['task_type']) || 'task',
          descriptionMarkdown: freshTask.descriptionMarkdown || '',
          projectId: freshTask.projectId ?? null,
          priority: freshTask.priority || 'medium',
          responsibleUserId: respMember ? respMember.userId : null,
          parentTaskId: freshTask.parentTaskId ?? null,
          executorUserIds: execIds,
          observerUserIds: obsIds,
          beginTime: toLocalDateTime(freshTask.beginTime),
          endTime: toLocalDateTime(freshTask.endTime),
          attributes: { ...(freshTask.attributes || {}) }
        };
        this.editFormBaseline = this.serializeEditForm();
        this.editAssignmentBaseline = {
          parentTaskId: this.editForm.parentTaskId,
          responsibleUserId: this.editForm.responsibleUserId,
          executorUserIds: [...this.editForm.executorUserIds],
          observerUserIds: [...this.editForm.observerUserIds]
        };
        onSyncUsers(this.editForm.responsibleUserId, this.editForm.executorUserIds, this.editForm.observerUserIds);
        this.editLoading.set(false);
      },
      error: () => {
        if (requestId !== this.editRequestId || this.editTargetId !== taskId || !this.isEditModalOpen()) return;
        this.editLoading.set(false);
        this.editLoadError.set(true);
      }
    });
  }

  retryEditLoad(
    onRetainMember: (m: TaskMember) => void,
    onRetainParent: (id: number, title: string) => void,
    onSyncUsers: (responsibleId: number | null, executorIds: number[], observerIds: number[]) => void
  ): void {
    if (this.editTargetId != null && !this.isSubmitting()) {
      this.loadEditDetails(this.editTargetId, onRetainMember, onRetainParent, onSyncUsers);
    }
  }

  requestCloseEdit(onOpenDetails: (t: Task) => void): void {
    if (this.isSubmitting()) return;
    if (this.editingTask && this.editFormBaseline !== this.serializeEditForm()) {
      this.isEditDiscardConfirmationOpen.set(true);
      return;
    }
    this.closeEditModal(true, onOpenDetails);
  }

  confirmDiscardEdit(onOpenDetails: (t: Task) => void): void {
    if (this.isSubmitting()) return;
    if (this.navigationDecision.pending) {
      this.isCreateModalOpen.set(false);
      this.closeEditModal(false, onOpenDetails);
      this.navigationDecision.settle(true);
      return;
    }
    this.isEditDiscardConfirmationOpen.set(false);
    this.closeEditModal(true, onOpenDetails);
  }

  cancelDiscardEdit(): void {
    this.isEditDiscardConfirmationOpen.set(false);
    this.navigationDecision.settle(false);
  }

  canLeaveRecordPage(isCommentSubmitting: () => boolean, commentDraft: () => string, onOpenDetails: (t: Task) => void): boolean | Observable<boolean> {
    if (this.isSubmitting() || isCommentSubmitting()) return false;
    const dirtyEdit = this.isEditModalOpen() && this.editingTask && this.editFormBaseline !== this.serializeEditForm();
    const dirtyCreate = this.isCreateModalOpen() && this.createFormBaseline !== JSON.stringify(this.createForm);
    if (dirtyEdit || dirtyCreate || commentDraft().trim()) {
      return this.navigationDecision.request(
        () => this.isEditDiscardConfirmationOpen.set(true),
        () => this.isEditDiscardConfirmationOpen.set(false));
    }
    if (this.isEditModalOpen()) this.closeEditModal(false, onOpenDetails);
    this.isCreateModalOpen.set(false);
    return true;
  }

  closeEditModal(returnToDetails: boolean, onOpenDetails: (t: Task) => void): void {
    const returnTask = returnToDetails ? this.editReturnTask : null;
    this.editRequestId++;
    this.editRequest?.unsubscribe();
    this.isEditModalOpen.set(false);
    this.isEditDiscardConfirmationOpen.set(false);
    this.editLoading.set(false);
    this.editLoadError.set(false);
    this.editingTask = null;
    this.editTargetId = null;
    this.editReturnTask = null;
    this.editFormBaseline = '';
    this.editAssignmentBaseline = null;
    if (returnTask) onOpenDetails(returnTask);
  }

  serializeEditForm(): string {
    return JSON.stringify(this.editForm);
  }

  submitEditTask(
    onSuccess: (returnTask: Task | null, editedTaskId: number) => void
  ): void {
    if (!this.editingTask || this.isSubmitting() || this.editLoading() || this.editLoadError()) return;
    this.isEditSubmitted = true;
    if (!this.editForm.title.trim()) {
      this.toast.warning(this.uiI18n.translate('tasks.nazvanie_zadachi_obyazatelno'));
      return;
    }

    const attrs = { ...this.editForm.attributes, task_type: this.editForm.taskType };

    const payload: Record<string, unknown> = {
      title: this.editForm.title.trim(),
      descriptionMarkdown: this.editForm.descriptionMarkdown?.trim() || '',
      projectId: this.editForm.projectId ? Number(this.editForm.projectId) : null,
      priority: this.editForm.priority || 'medium',
      beginTime: toTaskInstant(this.editForm.beginTime, this.editingTask.beginTime),
      endTime: toTaskInstant(this.editForm.endTime, this.editingTask.endTime),
      attributes: attrs
    };
    const currentAssignments = {
      parentTaskId: this.editForm.parentTaskId == null ? null : Number(this.editForm.parentTaskId),
      responsibleUserId: this.editForm.responsibleUserId == null ? null : Number(this.editForm.responsibleUserId),
      executorUserIds: [...this.editForm.executorUserIds],
      observerUserIds: [...this.editForm.observerUserIds]
    };
    if (!this.editAssignmentBaseline || currentAssignments.parentTaskId !== this.editAssignmentBaseline.parentTaskId) {
      payload['parentTaskId'] = currentAssignments.parentTaskId;
    }
    if (!this.editAssignmentBaseline || currentAssignments.responsibleUserId !== this.editAssignmentBaseline.responsibleUserId) {
      payload['responsibleUserId'] = currentAssignments.responsibleUserId;
    }
    if (!this.editAssignmentBaseline || !sameIdSet(currentAssignments.executorUserIds, this.editAssignmentBaseline.executorUserIds)) {
      payload['executorUserIds'] = currentAssignments.executorUserIds;
    }
    if (!this.editAssignmentBaseline || !sameIdSet(currentAssignments.observerUserIds, this.editAssignmentBaseline.observerUserIds)) {
      payload['observerUserIds'] = currentAssignments.observerUserIds;
    }

    const editedTask = this.editingTask;
    const returnTask = this.editReturnTask;
    this.isSubmitting.set(true);
    this.editSaveRequest = this.api.patch(`/tasks/${editedTask.id}`, payload).subscribe({
      next: () => {
        if (this.editingTask?.id !== editedTask.id) return;
        this.isSubmitting.set(false);
        this.closeEditModal(false, () => {});
        this.toast.success(this.uiI18n.translate('tasks.zadacha_uspeshno_obnovlena'));
        onSuccess(returnTask, editedTask.id);
      },
      error: err => {
        if (this.editingTask?.id !== editedTask.id) return;
        this.isSubmitting.set(false);
        this.toast.error(err.error?.message || this.uiI18n.translate('tasks.oshibka_pri_obnovlenii_zadachi'));
      }
    });
  }

  cleanup(): void {
    this.navigationDecision.settle(false);
    this.editRequestId++;
    this.editRequest?.unsubscribe();
    this.editSaveRequest?.unsubscribe();
  }
}
