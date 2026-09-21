import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Role } from '../../../../core/models/rbac.models';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../../../shared/ui/ui-modal.component';

@Component({
  selector: 'app-role-modals',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, UiButtonComponent, UiModalComponent],
  template: `
    <!-- Create Role Modal -->
    <ui-modal
      [isOpen]="isCreateModalOpen"
      [title]="'iam.sozdanie_novoy_roli' | t"
      size="sm"
      (close)="closeCreate.emit()"
    >
      <div body class="modal-body-form">
        <div class="modal-field">
          <label class="modal-label" for="role-create-name">{{ 'iam.nazvanie_roli' | t }} <span class="req">*</span></label>
          <input
            id="role-create-name"
            name="roleCreateName"
            type="text"
            class="modal-text-input"
            required
            [class.input-error]="isCreateSubmitted && !newRoleForm.name.trim()"
            [attr.aria-invalid]="isCreateSubmitted && !newRoleForm.name.trim()"
            [attr.aria-describedby]="isCreateSubmitted && !newRoleForm.name.trim() ? 'role-create-name-error' : null"
            [(ngModel)]="newRoleForm.name"
            [placeholder]="'iam.naprimer_starshiy_analitik_dannyh' | t"
          />
          <span id="role-create-name-error" class="field-error" *ngIf="isCreateSubmitted && !newRoleForm.name.trim()">{{ 'iam.ukazhite_nazvanie_roli' | t }}</span>
        </div>
        <div class="modal-field">
          <label class="modal-label" for="role-create-order">{{ 'iam.poryadok_otobrazheniya' | t }}</label>
          <input
            id="role-create-order"
            name="roleCreateOrder"
            type="number"
            class="modal-text-input font-mono"
            [(ngModel)]="newRoleForm.orderNo"
            placeholder="0"
          />
        </div>
      </div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="closeCreate.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="primary" size="md" [loading]="isSubmittingRole" (onClick)="submitCreate.emit()">{{ 'common.create' | t }}</ui-button>
      </div>
    </ui-modal>

    <!-- Edit Role Modal -->
    <ui-modal
      [isOpen]="isEditModalOpen"
      [title]="'iam.redaktirovanie_roli' | t"
      size="sm"
      (close)="closeEdit.emit()"
    >
      <div body class="modal-body-form" *ngIf="editingRole as r">
        <div class="modal-field">
          <label class="modal-label" for="role-edit-name">{{ 'iam.nazvanie_roli' | t }} <span class="req">*</span></label>
          <input id="role-edit-name" name="roleEditName" type="text" class="modal-text-input" required
            [class.input-error]="isEditSubmitted && !editRoleForm.name.trim()"
            [attr.aria-invalid]="isEditSubmitted && !editRoleForm.name.trim()"
            [attr.aria-describedby]="isEditSubmitted && !editRoleForm.name.trim() ? 'role-edit-name-error' : null"
            [(ngModel)]="editRoleForm.name" />
          <span id="role-edit-name-error" class="field-error" *ngIf="isEditSubmitted && !editRoleForm.name.trim()">{{ 'iam.ukazhite_nazvanie_roli' | t }}</span>
        </div>
        <div class="modal-field">
          <label class="modal-label" for="role-edit-state">{{ 'iam.status_aktivnosti' | t }}</label>
          <select id="role-edit-state" name="roleEditState" class="modal-text-input" [(ngModel)]="editRoleForm.state" [disabled]="r.pcode === 'admin'">
            <option value="A">{{ 'iam.aktivna_a' | t }}</option>
            <option value="P">{{ 'iam.otklyuchena_p' | t }}</option>
          </select>
          <span class="modal-help" *ngIf="r.pcode === 'admin'">{{ 'iam.rol_superadministratora_vsegda_aktivna' | t }}</span>
        </div>
        <div class="modal-field">
          <label class="modal-label" for="role-edit-order">{{ 'iam.poryadok_otobrazheniya' | t }}</label>
          <input id="role-edit-order" name="roleEditOrder" type="number" class="modal-text-input font-mono" [(ngModel)]="editRoleForm.orderNo" />
        </div>
      </div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="closeEdit.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="primary" size="md" [loading]="isSubmittingRole" (onClick)="submitEdit.emit()">{{ 'common.save' | t }}</ui-button>
      </div>
    </ui-modal>

    <!-- Delete Role Modal -->
    <ui-modal
      [isOpen]="isDeleteModalOpen"
      [title]="'iam.udalenie_roli' | t"
      size="sm"
      [dismissible]="!isSubmittingRole"
      (close)="closeDelete.emit()"
    >
      <div body class="modal-delete-body" *ngIf="deletingRole as r">
        <p class="delete-title">
          {{ 'iam.vy_deystvitelno_hotite_udalit_polzovatelskuyu_ro' | t }} <strong>{{ r.name }}</strong>?
        </p>
        <span class="delete-desc">{{ 'iam.vse_naznachennye_prava_etoy_roli_budut_udaleny_e' | t }}</span>
      </div>
      <div footer>
        <ui-button variant="secondary" size="md" [disabled]="isSubmittingRole" (onClick)="closeDelete.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="danger" size="md" [loading]="isSubmittingRole" (onClick)="confirmDelete.emit()">{{ 'common.delete' | t }}</ui-button>
      </div>
    </ui-modal>

    <!-- Unsaved Changes Confirmation Modal -->
    <ui-modal
      [isOpen]="isDiscardPermissionsModalOpen"
      [title]="'iam.nesohranennye_izmeneniya_prav' | t"
      size="sm"
      [dismissible]="!isSaving"
      (close)="closeDiscard.emit()"
    >
      <div body class="modal-delete-body" *ngIf="selectedRole as r">
        <p class="delete-title">
          {{ 'iam.u_vas_est_nesohranennye_izmeneniya_v_matrice' | t:{name: r.name, count: dirtyPermissionsCount} }}
        </p>
      </div>
      <div footer>
        <ui-button variant="secondary" size="md" [disabled]="isSaving" (onClick)="closeDiscard.emit()">
          {{ 'common.cancel' | t }}
        </ui-button>
        <ui-button variant="danger" size="md" [disabled]="isSaving" (onClick)="confirmDiscardAndSwitch.emit()">
          {{ 'iam.sbrosit_i_pereyti' | t }}
        </ui-button>
        <ui-button variant="primary" size="md" [loading]="isSaving" (onClick)="saveAndSwitch.emit()">
          {{ 'iam.sohranit_i_pereyti' | t }}
        </ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    .modal-body-form { display: flex; flex-direction: column; gap: 14px; }
    .modal-field { display: flex; flex-direction: column; gap: 5px; }
    .modal-label { font-size: 12px; font-weight: 500; color: var(--text-main); }
    .modal-text-input {
      width: 100%;
      height: 34px;
      padding: 4px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-size: 13px;
      outline: none;
    }
    .modal-text-input:focus { border-color: var(--primary); }
    .modal-text-input.input-error { border-color: var(--danger); }
    .modal-help { font-size: 11px; color: var(--text-muted); }
    .field-error { font-size: 10px; color: var(--danger); }

    .modal-delete-body { display: flex; flex-direction: column; gap: 6px; }
    .delete-title { font-size: 13px; margin: 0; }
    .delete-desc { font-size: 11px; color: var(--text-muted); }

    .req { color: var(--danger); }
    .font-mono { font-family: monospace; }
  `]
})
export class RoleModalsComponent {
  @Input() isCreateModalOpen = false;
  @Input() isCreateSubmitted = false;
  @Input() newRoleForm = { name: '', orderNo: 0 };

  @Input() isEditModalOpen = false;
  @Input() isEditSubmitted = false;
  @Input() editingRole: Role | null = null;
  @Input() editRoleForm = { name: '', state: 'A', orderNo: 0 };

  @Input() isDeleteModalOpen = false;
  @Input() deletingRole: Role | null = null;

  @Input() isDiscardPermissionsModalOpen = false;
  @Input() selectedRole: Role | null = null;
  @Input() dirtyPermissionsCount = 0;

  @Input() isSubmittingRole = false;
  @Input() isSaving = false;

  @Output() closeCreate = new EventEmitter<void>();
  @Output() submitCreate = new EventEmitter<void>();

  @Output() closeEdit = new EventEmitter<void>();
  @Output() submitEdit = new EventEmitter<void>();

  @Output() closeDelete = new EventEmitter<void>();
  @Output() confirmDelete = new EventEmitter<void>();

  @Output() closeDiscard = new EventEmitter<void>();
  @Output() confirmDiscardAndSwitch = new EventEmitter<void>();
  @Output() saveAndSwitch = new EventEmitter<void>();
}
