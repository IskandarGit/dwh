import { Injectable, signal, inject } from '@angular/core';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { I18nService } from '../../../../core/services/i18n.service';
import { Role } from '../../../../core/models/rbac.models';
import { safeNumericRecordId } from '../../../../core/services/search-target';

@Injectable({ providedIn: 'root' })
export class RoleFormsService {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly uiI18n = inject(I18nService);

  readonly isCreateModalOpen = signal<boolean>(false);
  readonly isEditModalOpen = signal<boolean>(false);
  readonly isDeleteModalOpen = signal<boolean>(false);
  readonly isSubmittingRole = signal<boolean>(false);

  isCreateSubmitted = false;
  isEditSubmitted = false;

  editingRole: Role | null = null;
  deletingRole: Role | null = null;

  newRoleForm = {
    name: '',
    orderNo: 0
  };

  editRoleForm = {
    name: '',
    state: 'A',
    orderNo: 0
  };

  openCreateModal() {
    this.newRoleForm = { name: '', orderNo: 0 };
    this.isCreateSubmitted = false;
    this.isCreateModalOpen.set(true);
  }

  submitCreateRole(onSuccess: (newRole: Role) => void) {
    this.isCreateSubmitted = true;
    if (!this.newRoleForm.name.trim()) {
      this.toast.warning(this.uiI18n.translate('iam.vvedite_nazvanie_roli'));
      return;
    }

    this.isSubmittingRole.set(true);
    this.api.post<Role>('/rbac/roles', {
      name: this.newRoleForm.name.trim(),
      orderNo: this.newRoleForm.orderNo || 0
    }).subscribe({
      next: newRole => {
        this.isSubmittingRole.set(false);
        this.isCreateModalOpen.set(false);
        this.toast.success(this.uiI18n.translate('iam.rol_uspeshno_sozdana'));
        onSuccess(newRole);
      },
      error: () => {
        this.isSubmittingRole.set(false);
      }
    });
  }

  openEditRoleModal(role: Role) {
    this.editingRole = role;
    this.editRoleForm = {
      name: role.name,
      state: role.state,
      orderNo: role.orderNo
    };
    this.isEditSubmitted = false;
    this.isEditModalOpen.set(true);
  }

  submitEditRole(onSuccess: () => void) {
    if (!this.editingRole) return;
    this.isEditSubmitted = true;
    if (!this.editRoleForm.name.trim()) {
      this.toast.warning(this.uiI18n.translate('iam.nazvanie_roli_obyazatelno'));
      return;
    }

    this.isSubmittingRole.set(true);
    this.api.patch(`/rbac/roles/${this.editingRole.id}`, this.editRoleForm).subscribe({
      next: () => {
        this.isSubmittingRole.set(false);
        this.isEditModalOpen.set(false);
        this.toast.success(this.uiI18n.translate('iam.dannye_roli_obnovleny'));
        onSuccess();
      },
      error: () => {
        this.isSubmittingRole.set(false);
      }
    });
  }

  openDeleteRoleModal(role: Role, isSaving: boolean, isScopeBusy: boolean) {
    if (isSaving || isScopeBusy || this.isSubmittingRole() || this.isDeleteModalOpen() || !safeNumericRecordId(role.id)) return;
    this.deletingRole = { ...role };
    this.isDeleteModalOpen.set(true);
  }

  closeDeleteRoleModal(): void {
    if (this.isSubmittingRole()) return;
    this.isDeleteModalOpen.set(false);
    this.deletingRole = null;
  }

  deleteRole(target: Role, onSuccess: () => void): void {
    if (this.isSubmittingRole() || !this.isDeleteModalOpen()) return;
    this.isSubmittingRole.set(true);
    this.api.delete(`/rbac/roles/${target.id}`).subscribe({
      next: () => {
        this.isSubmittingRole.set(false);
        this.isDeleteModalOpen.set(false);
        this.deletingRole = null;
        this.toast.success(this.uiI18n.translate('iam.rol_udalena'));
        onSuccess();
      },
      error: () => {
        this.isSubmittingRole.set(false);
      }
    });
  }
}
