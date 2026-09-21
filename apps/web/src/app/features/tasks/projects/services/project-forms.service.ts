import { Injectable, inject, signal } from '@angular/core';
import { Subscription, Observable } from 'rxjs';
import { ApiService } from '../../../../core/services/api.service';
import { PermissionService } from '../../../../core/services/permission.service';
import { ToastService } from '../../../../core/services/toast.service';
import { I18nService } from '../../../../core/services/i18n.service';
import { RecordNavigationDecision } from '../../../../core/guards/record-navigation.guard';
import { safeNumericRecordId } from '../../../../core/services/search-target';
import { Project } from '../../../../core/models/task.models';
import { ProjectCreateForm, ProjectEditForm } from '../projects.models';

@Injectable()
export class ProjectFormsService {
  private readonly api = inject(ApiService);
  private readonly permService = inject(PermissionService);
  private readonly toast = inject(ToastService);
  private readonly uiI18n = inject(I18nService);
  private readonly navigationDecision = new RecordNavigationDecision();

  private editDetailRequest?: Subscription;
  private createSaveRequest?: Subscription;
  private editSaveRequest?: Subscription;
  private editDetailRequestId = 0;
  private createSaveRequestId = 0;
  private editSaveRequestId = 0;
  private destroyed = false;

  readonly isSubmitting = signal<boolean>(false);
  readonly editLoading = signal<boolean>(false);
  readonly editLoadError = signal<boolean>(false);
  readonly createSaveError = signal<string | null>(null);
  readonly editSaveError = signal<string | null>(null);

  isCreateSubmitted = false;
  isEditSubmitted = false;

  readonly isCreateModalOpen = signal<boolean>(false);
  readonly isEditModalOpen = signal<boolean>(false);
  readonly isCreateDiscardConfirmationOpen = signal<boolean>(false);
  readonly isEditDiscardConfirmationOpen = signal<boolean>(false);

  createForm: ProjectCreateForm = { name: '', description: '', attributes: {} };
  editForm: ProjectEditForm = { name: '', description: '', state: 'A', attributes: {} };
  editingProject: Project | null = null;
  private createFormBaseline: ProjectCreateForm = { name: '', description: '', attributes: {} };
  private editFormBaseline: ProjectEditForm | null = null;
  private editTargetId: number | null = null;

  onProjectCreated?: (created: Project) => void;
  onProjectUpdated?: () => void;

  destroy() {
    this.navigationDecision.settle(false);
    this.destroyed = true;
    this.editDetailRequestId++;
    this.createSaveRequestId++;
    this.editSaveRequestId++;
    this.editDetailRequest?.unsubscribe();
    this.createSaveRequest?.unsubscribe();
    this.editSaveRequest?.unsubscribe();
  }

  canCreateProject(): boolean {
    return this.permService.canCreate('tasks.projects');
  }

  canUpdateProject(): boolean {
    return this.permService.canUpdate('tasks.projects');
  }

  openCreateModal() {
    if (
      this.destroyed
      || !this.canCreateProject()
      || this.isSubmitting()
      || this.isCreateModalOpen()
      || this.isEditModalOpen()
      || this.isCreateDiscardConfirmationOpen()
      || this.isEditDiscardConfirmationOpen()
    ) return;
    this.isCreateSubmitted = false;
    this.createForm = { name: '', description: '' };
    this.createFormBaseline = { ...this.createForm };
    this.createSaveError.set(null);
    this.isCreateDiscardConfirmationOpen.set(false);
    this.isCreateModalOpen.set(true);
  }

  requestCloseCreate() {
    if (this.destroyed || this.isSubmitting() || !this.isCreateModalOpen()) return;
    if (this.isCreateDraftDirty()) {
      this.isCreateDiscardConfirmationOpen.set(true);
      return;
    }
    this.closeCreateModal();
  }

  confirmDiscardCreate() {
    if (
      this.destroyed
      || this.isSubmitting()
      || !this.isCreateModalOpen()
      || !this.isCreateDiscardConfirmationOpen()
    ) return;
    this.closeCreateModal();
    this.navigationDecision.settle(true);
  }

  submitCreateProject() {
    if (
      this.destroyed
      || !this.canCreateProject()
      || !this.isCreateModalOpen()
      || this.isEditModalOpen()
      || this.isCreateDiscardConfirmationOpen()
      || this.isEditDiscardConfirmationOpen()
      || this.isSubmitting()
    ) return;
    this.isCreateSubmitted = true;
    if (!this.createForm.name.trim()) {
      this.toast.warning(this.uiI18n.translate('projects.vvedite_nazvanie_proekta'));
      return;
    }

    const requestId = ++this.createSaveRequestId;
    this.createSaveError.set(null);
    this.isSubmitting.set(true);
    const payload: any = {
      name: this.createForm.name.trim(),
      description: this.createForm.description.trim()
    };
    if (this.createForm.attributes && Object.keys(this.createForm.attributes).length > 0) {
      payload.attributes = this.createForm.attributes;
    }
    this.createSaveRequest = this.api.post<Project>('/tasks/projects', payload).subscribe({
      next: created => {
        if (
          this.destroyed
          || requestId !== this.createSaveRequestId
          || !this.isCreateModalOpen()
          || this.isEditModalOpen()
        ) return;
        this.isSubmitting.set(false);
        this.closeCreateModal();
        this.toast.success(this.uiI18n.translate('projects.proekt_uspeshno_sozdan'));
        this.onProjectCreated?.(created);
      },
      error: err => {
        if (
          this.destroyed
          || requestId !== this.createSaveRequestId
          || !this.isCreateModalOpen()
          || this.isEditModalOpen()
        ) return;
        this.isSubmitting.set(false);
        this.createSaveError.set(err?.detail || this.uiI18n.translate('projects.create_save_error'));
      }
    });
  }

  openEditModal(p: Project) {
    if (!safeNumericRecordId(p.id)) return;
    if (
      this.destroyed
      || !this.canUpdateProject()
      || this.isSubmitting()
      || this.isCreateModalOpen()
      || this.isEditModalOpen()
      || this.isCreateDiscardConfirmationOpen()
      || this.isEditDiscardConfirmationOpen()
    ) return;
    this.isEditSubmitted = false;
    this.editTargetId = p.id;
    this.editingProject = null;
    this.editFormBaseline = null;
    this.editSaveError.set(null);
    this.isEditDiscardConfirmationOpen.set(false);
    this.isEditModalOpen.set(true);
    this.loadEditDetails(p.id);
  }

  retryEditLoad() {
    if (
      this.destroyed
      || this.isSubmitting()
      || this.editLoading()
      || !this.isEditModalOpen()
      || this.isCreateModalOpen()
      || this.isCreateDiscardConfirmationOpen()
      || this.isEditDiscardConfirmationOpen()
      || this.editTargetId == null
    ) return;
    this.loadEditDetails(this.editTargetId);
  }

  requestCloseEdit() {
    if (this.destroyed || this.isSubmitting() || !this.isEditModalOpen()) return;
    if (this.isEditDraftDirty()) {
      this.isEditDiscardConfirmationOpen.set(true);
      return;
    }
    this.closeEditModal();
  }

  confirmDiscardEdit() {
    if (
      this.destroyed
      || this.isSubmitting()
      || !this.isEditModalOpen()
      || !this.isEditDiscardConfirmationOpen()
    ) return;
    this.closeEditModal();
    this.navigationDecision.settle(true);
  }

  submitEditProject() {
    if (
      this.destroyed
      || !this.canUpdateProject()
      || !this.isEditModalOpen()
      || this.isCreateModalOpen()
      || this.isCreateDiscardConfirmationOpen()
      || this.isEditDiscardConfirmationOpen()
      || !this.editingProject
      || !this.editFormBaseline
      || this.editLoading()
      || this.editLoadError()
      || this.isSubmitting()
    ) return;
    this.isEditSubmitted = true;
    if (!this.editForm.name.trim()) {
      this.toast.warning(this.uiI18n.translate('projects.nazvanie_proekta_obyazatelno'));
      return;
    }

    const payload: Record<string, unknown> = {};
    const name = this.editForm.name.trim();
    const description = this.editForm.description.trim();
    if (name !== this.editFormBaseline.name) payload['name'] = name;
    if (description !== this.editFormBaseline.description) payload['description'] = description;
    if (this.editForm.state !== this.editFormBaseline.state) payload['state'] = this.editForm.state;
    if (JSON.stringify(this.editForm.attributes || {}) !== JSON.stringify(this.editFormBaseline.attributes || {})) {
      payload['attributes'] = this.editForm.attributes;
    }
    if (Object.keys(payload).length === 0) {
      this.closeEditModal();
      return;
    }

    const editedProjectId = this.editingProject.id;
    const requestId = ++this.editSaveRequestId;
    this.editSaveError.set(null);
    this.isSubmitting.set(true);
    this.editSaveRequest = this.api.patch<void>(`/tasks/projects/${editedProjectId}`, payload).subscribe({
      next: () => {
        if (
          this.destroyed
          || requestId !== this.editSaveRequestId
          || !this.isEditModalOpen()
          || this.editingProject?.id !== editedProjectId
        ) return;
        this.isSubmitting.set(false);
        this.closeEditModal();
        this.toast.success(this.uiI18n.translate('projects.proekt_obnovlen'));
        this.onProjectUpdated?.();
      },
      error: err => {
        if (
          this.destroyed
          || requestId !== this.editSaveRequestId
          || !this.isEditModalOpen()
          || this.editingProject?.id !== editedProjectId
        ) return;
        this.isSubmitting.set(false);
        this.editSaveError.set(err?.detail || this.uiI18n.translate('projects.edit_save_error'));
      }
    });
  }

  private loadEditDetails(projectId: number) {
    const requestId = ++this.editDetailRequestId;
    this.editDetailRequest?.unsubscribe();
    this.editLoading.set(true);
    this.editLoadError.set(false);
    this.editSaveError.set(null);
    this.editingProject = null;
    this.editFormBaseline = null;

    this.editDetailRequest = this.api.get<Project>(`/tasks/projects/${projectId}`, undefined, { notifyError: false }).subscribe({
      next: project => {
        if (
          this.destroyed
          || requestId !== this.editDetailRequestId
          || !this.isEditModalOpen()
          || this.isCreateModalOpen()
          || this.editTargetId !== projectId
        ) return;
        this.editLoading.set(false);
        if (!project || project.id !== projectId) {
          this.editLoadError.set(true);
          return;
        }
        const normalized: ProjectEditForm = {
          name: project.name.trim(),
          description: (project.description || '').trim(),
          state: project.state
        };
        if (project.attributes && Object.keys(project.attributes).length > 0) {
          normalized.attributes = { ...project.attributes };
        }
        this.editingProject = project;
        this.editForm = { ...normalized };
        this.editFormBaseline = { ...normalized, ...(normalized.attributes ? { attributes: { ...normalized.attributes } } : {}) };
      },
      error: () => {
        if (
          this.destroyed
          || requestId !== this.editDetailRequestId
          || !this.isEditModalOpen()
          || this.editTargetId !== projectId
        ) return;
        this.editLoading.set(false);
        this.editLoadError.set(true);
      }
    });
  }

  isCreateDraftDirty(): boolean {
    return this.createForm.name !== this.createFormBaseline.name
      || this.createForm.description !== this.createFormBaseline.description
      || (!!this.createForm.attributes && Object.keys(this.createForm.attributes).length > 0);
  }

  isEditDraftDirty(): boolean {
    return !!this.editFormBaseline && (
      this.editForm.name !== this.editFormBaseline.name
      || this.editForm.description !== this.editFormBaseline.description
      || this.editForm.state !== this.editFormBaseline.state
      || JSON.stringify(this.editForm.attributes || {}) !== JSON.stringify(this.editFormBaseline.attributes || {})
    );
  }

  closeCreateModal() {
    this.createSaveRequestId++;
    this.createSaveRequest?.unsubscribe();
    this.isCreateModalOpen.set(false);
    this.isCreateDiscardConfirmationOpen.set(false);
    this.createSaveError.set(null);
    this.createForm = { name: '', description: '' };
    this.createFormBaseline = { ...this.createForm };
  }

  closeEditModal() {
    this.editDetailRequestId++;
    this.editSaveRequestId++;
    this.editDetailRequest?.unsubscribe();
    this.editSaveRequest?.unsubscribe();
    this.isEditModalOpen.set(false);
    this.isEditDiscardConfirmationOpen.set(false);
    this.editLoading.set(false);
    this.editLoadError.set(false);
    this.editSaveError.set(null);
    this.editingProject = null;
    this.editTargetId = null;
    this.editFormBaseline = null;
  }

  cancelNavigationDiscard(kind: 'create' | 'edit') {
    (kind === 'create' ? this.isCreateDiscardConfirmationOpen : this.isEditDiscardConfirmationOpen).set(false);
    this.navigationDecision.settle(false);
  }

  canLeaveRecordPage(): boolean | Observable<boolean> | Promise<boolean> {
    if (this.isSubmitting()) return false;
    const dialog = this.isCreateModalOpen() && this.isCreateDraftDirty() ? this.isCreateDiscardConfirmationOpen :
      this.isEditModalOpen() && this.isEditDraftDirty() ? this.isEditDiscardConfirmationOpen : null;
    if (dialog) return this.navigationDecision.request(() => dialog.set(true), () => dialog.set(false));
    if (this.isCreateModalOpen()) this.closeCreateModal();
    if (this.isEditModalOpen()) this.closeEditModal();
    return true;
  }
}
