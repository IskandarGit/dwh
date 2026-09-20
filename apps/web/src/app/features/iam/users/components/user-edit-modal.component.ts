import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { UiModalComponent } from '../../../../shared/ui/ui-modal.component';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { UiCustomFieldsComponent } from '../../../../shared/ui/ui-custom-fields.component';
import { User } from '../../../../core/models/auth.models';
import { Role } from '../../../../core/models/rbac.models';
import { CustomField } from '../../../../core/models/custom-field.models';

@Component({
  selector: 'app-user-edit-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    UiModalComponent,
    UiButtonComponent,
    UiCustomFieldsComponent
  ],
  template: `
    <ui-modal
      [isOpen]="isOpen"
      [title]="'iam.redaktirovat_polzovatelya' | t"
      size="md"
      (close)="close.emit()"
    >
      <div body class="clean-modal-body" *ngIf="editingUser as u">
        <div class="form-grid">
          <div class="form-group span-2">
            <label class="clean-label" for="user-edit-name">{{ 'iam.fio' | t }} <span class="req">*</span></label>
            <input
              id="user-edit-name"
              name="userEditName"
              type="text"
              class="clean-input"
              required
              [attr.aria-invalid]="isEditSubmitted && !editForm.name.trim()"
              [attr.aria-describedby]="isEditSubmitted && !editForm.name.trim() ? 'user-edit-name-error' : null"
              [(ngModel)]="editForm.name"
              [placeholder]="'iam.ivanov_ivan_ivanovich' | t"
            />
            <span id="user-edit-name-error" class="field-error" *ngIf="isEditSubmitted && !editForm.name.trim()">
              {{ 'iam.ukazhite_fio_polzovatelya' | t }}
            </span>
          </div>

          <div class="form-group">
            <label class="clean-label" for="user-edit-login">{{ 'iam.login_chtenie' | t }}</label>
            <input id="user-edit-login" type="text" class="clean-input font-mono disabled" [value]="u.login" disabled />
          </div>

          <div class="form-group">
            <label class="clean-label" for="user-edit-email">{{ 'iam.email_chtenie' | t }}</label>
            <input id="user-edit-email" type="email" class="clean-input font-mono disabled" [value]="u.email" disabled />
          </div>

          <div class="form-group">
            <label class="clean-label" for="user-edit-phone">{{ 'iam.telefon.822f9fd' | t }}</label>
            <input
              id="user-edit-phone"
              name="userEditPhone"
              type="tel"
              class="clean-input font-mono"
              autocomplete="tel"
              [(ngModel)]="editForm.phone"
              placeholder="+998901234567"
            />
          </div>

          <div class="form-group">
            <label class="clean-label" for="user-edit-manager">{{ 'iam.rukovoditel' | t }}</label>
            <select id="user-edit-manager" name="userEditManager" class="clean-input" [(ngModel)]="editForm.managerId">
              <option [ngValue]="null">{{ 'iam.bez_rukovoditelya' | t }}</option>
              <option *ngFor="let m of getAvailableManagers(u.id)" [ngValue]="m.id">
                {{ m.name }} (&#64;{{ m.login }})
              </option>
            </select>
          </div>

          <div class="form-group">
            <label class="clean-label" for="user-edit-language">{{ 'iam.yazyk' | t }}</label>
            <select id="user-edit-language" name="userEditLanguage" class="clean-input" [(ngModel)]="editForm.language">
              <option *ngFor="let lang of languages" [value]="lang.code">
                {{ lang.name }} ({{ lang.code }})
              </option>
            </select>
          </div>

          <div class="form-group">
            <label class="clean-label" for="user-edit-timezone">{{ 'iam.chasovoy_poyas' | t }}</label>
            <select id="user-edit-timezone" name="userEditTimezone" class="clean-input" [(ngModel)]="editForm.timezone">
              <option value="Asia/Tashkent">Asia/Tashkent (UTC+5)</option>
              <option value="Europe/Moscow">Europe/Moscow (UTC+3)</option>
              <option value="UTC">UTC (UTC+0)</option>
              <option value="Asia/Almaty">Asia/Almaty (UTC+5)</option>
              <option value="Asia/Dubai">Asia/Dubai (UTC+4)</option>
            </select>
          </div>

          <div class="form-group span-2">
            <label class="clean-checkbox">
              <input name="userEdit2fa" type="checkbox" [(ngModel)]="editForm.is2faEnabled" />
              <span>{{ 'iam.vklyuchit_dvuhfaktornuyu_zaschitu_2fa_otp' | t }}</span>
            </label>
          </div>

          <!-- Roles -->
          <div class="form-group span-2" *ngIf="roles.length > 0">
            <span class="clean-label">{{ 'iam.roli_dostupa_rbac' | t }}</span>
            <div class="roles-chips">
              <label
                *ngFor="let role of roles"
                class="role-chip"
                [class.selected]="isRoleSelected(role.id)"
                [class.locked]="u.login === 'admin' && role.pcode === 'admin'"
              >
                <input
                  type="checkbox"
                  [checked]="isRoleSelected(role.id)"
                  (change)="toggleRole.emit(role.id)"
                  [disabled]="u.login === 'admin' && role.pcode === 'admin'"
                />
                <span>{{ role.name }}</span>
                <span *ngIf="u.login === 'admin' && role.pcode === 'admin'" class="material-symbols-outlined lock-ico" [title]="'iam.zaschischeno' | t">lock</span>
              </label>
            </div>
          </div>

          <!-- Custom Fields -->
          <div class="form-group span-2" *ngIf="customFields.length > 0">
            <span class="clean-label">{{ 'iam.dopolnitelnye_polya' | t }}</span>
            <ui-custom-fields
              [fields]="customFields"
              [(values)]="editForm.attributes"
            ></ui-custom-fields>
          </div>
        </div>
      </div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="close.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="primary" size="md" [loading]="isSubmitting" (onClick)="submit.emit()">{{ 'common.save' | t }}</ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    .clean-modal-body {
      padding: 4px 0;
    }
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .span-2 { grid-column: 1 / -1; }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .clean-label {
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
    }
    .clean-input {
      height: 34px;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .clean-input:focus { border-color: var(--primary); }
    .clean-input.disabled {
      background-color: var(--bg-hover);
      color: var(--text-muted);
      cursor: not-allowed;
    }
    .font-mono { font-family: monospace; }
    .req { color: var(--danger); }
    .field-error { font-size: 10px; color: var(--danger); }

    .clean-checkbox {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-main);
      cursor: pointer;
    }

    .roles-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .role-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      font-size: 12px;
      color: var(--text-main);
      cursor: pointer;
    }
    .role-chip.selected {
      border-color: var(--primary);
      background-color: rgba(99,102,241,0.06);
    }
    .role-chip.locked { opacity: 0.8; cursor: not-allowed; }
    .lock-ico { font-size: 13px; color: var(--text-muted); }

    @media (max-width: 640px) {
      .modal-form,
      .form-group { min-width: 0; }
      .form-grid { grid-template-columns: minmax(0, 1fr); }
      .span-2 { grid-column: auto; }
    }
  `]
})
export class UserEditModalComponent {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() isEditSubmitted = false;
  @Input() editingUser: User | null = null;
  @Input() editForm: any = {};
  @Input() roles: Role[] = [];
  @Input() languages: Array<{ code: string, name: string }> = [];
  @Input() customFields: CustomField[] = [];
  @Input() getAvailableManagers!: (userId: number) => User[];
  @Input() isRoleSelected!: (roleId: number) => boolean;

  @Output() close = new EventEmitter<void>();
  @Output() submit = new EventEmitter<void>();
  @Output() toggleRole = new EventEmitter<number>();
}
