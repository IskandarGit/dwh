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
  selector: 'app-user-create-modal',
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
      [title]="'iam.sozdat_polzovatelya' | t"
      size="md"
      (close)="close.emit()"
    >
      <div body class="clean-modal-body">
        <div class="form-grid">
          <div class="form-group span-2">
            <label class="clean-label" for="user-create-name">{{ 'iam.fio' | t }} <span class="req">*</span></label>
            <input
              id="user-create-name"
              name="userCreateName"
              type="text"
              class="clean-input"
              required
              [attr.aria-invalid]="isCreateSubmitted && !createForm.name.trim()"
              [attr.aria-describedby]="isCreateSubmitted && !createForm.name.trim() ? 'user-create-name-error' : null"
              [(ngModel)]="createForm.name"
              [placeholder]="'iam.ivanov_ivan_ivanovich' | t"
            />
            <span id="user-create-name-error" class="field-error" *ngIf="isCreateSubmitted && !createForm.name.trim()">
              {{ 'iam.ukazhite_fio_polzovatelya' | t }}
            </span>
          </div>

          <div class="form-group">
            <label class="clean-label" for="user-create-login">{{ 'analytics.login' | t }} <span class="req">*</span></label>
            <input
              id="user-create-login"
              name="userCreateLogin"
              type="text"
              class="clean-input font-mono"
              required
              autocomplete="username"
              [attr.aria-invalid]="isCreateSubmitted && !createForm.login.trim()"
              [attr.aria-describedby]="isCreateSubmitted && !createForm.login.trim() ? 'user-create-login-error' : null"
              [(ngModel)]="createForm.login"
              placeholder="ivanov"
            />
            <span id="user-create-login-error" class="field-error" *ngIf="isCreateSubmitted && !createForm.login.trim()">
              {{ 'iam.ukazhite_login' | t }}
            </span>
          </div>

          <div class="form-group">
            <label class="clean-label" for="user-create-email">Email <span class="req">*</span></label>
            <input
              id="user-create-email"
              name="userCreateEmail"
              type="email"
              class="clean-input font-mono"
              required
              autocomplete="email"
              [attr.aria-invalid]="isCreateSubmitted && !createForm.email.trim()"
              [attr.aria-describedby]="isCreateSubmitted && !createForm.email.trim() ? 'user-create-email-error' : null"
              [(ngModel)]="createForm.email"
              placeholder="ivanov@company.local"
            />
            <span id="user-create-email-error" class="field-error" *ngIf="isCreateSubmitted && !createForm.email.trim()">
              {{ 'iam.ukazhite_email' | t }}
            </span>
          </div>

          <div class="form-group">
            <label class="clean-label" for="user-create-phone">{{ 'iam.telefon.822f9fd' | t }}</label>
            <input
              id="user-create-phone"
              name="userCreatePhone"
              type="tel"
              class="clean-input font-mono"
              autocomplete="tel"
              [(ngModel)]="createForm.phone"
              placeholder="+998901234567"
            />
          </div>

          <div class="form-group">
            <label class="clean-label" for="user-create-manager">{{ 'iam.rukovoditel' | t }}</label>
            <select id="user-create-manager" name="userCreateManager" class="clean-input" [(ngModel)]="createForm.managerId">
              <option [ngValue]="null">{{ 'iam.bez_rukovoditelya' | t }}</option>
              <option *ngFor="let u of users" [ngValue]="u.id">{{ u.name }} (&#64;{{ u.login }})</option>
            </select>
          </div>

          <div class="form-group span-2">
            <label class="clean-label" for="user-create-password">{{ 'iam.vremennyy_parol' | t }} <span class="req">*</span></label>
            <div class="pwd-wrapper">
              <input
                id="user-create-password"
                name="userCreatePassword"
                [type]="showPassword ? 'text' : 'password'"
                class="clean-input font-mono"
                required
                minlength="10"
                autocomplete="new-password"
                [attr.aria-invalid]="isCreateSubmitted && createForm.password.length < 10"
                [attr.aria-describedby]="isCreateSubmitted && createForm.password.length < 10 ? 'user-create-password-error user-create-password-hint' : 'user-create-password-hint'"
                [(ngModel)]="createForm.password"
                [placeholder]="'iam.minimum_10_simvolov' | t"
              />
              <div class="pwd-actions">
                <button
                  type="button"
                  class="pwd-btn"
                  [attr.aria-label]="(showPassword ? 'iam.hide_password' : 'iam.show_password') | t"
                  [attr.aria-pressed]="showPassword"
                  [title]="(showPassword ? 'iam.hide_password' : 'iam.show_password') | t"
                  (click)="toggleShowPassword.emit()"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">{{ showPassword ? 'visibility_off' : 'visibility' }}</span>
                </button>
                <button
                  type="button"
                  class="pwd-btn"
                  [title]="'iam.sgenerirovat_parol' | t"
                  [attr.aria-label]="'iam.sgenerirovat_parol' | t"
                  (click)="generatePassword.emit()"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">auto_fix_high</span>
                </button>
                <button
                  type="button"
                  class="pwd-btn"
                  *ngIf="createForm.password"
                  [title]="'iam.skopirovat_parol' | t"
                  [attr.aria-label]="'iam.skopirovat_parol' | t"
                  (click)="copyPassword.emit()"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>
                </button>
              </div>
            </div>

            <!-- Dynamic Password Strength Meter -->
            <div class="pwd-strength-container" *ngIf="createForm.password">
              <div class="pwd-meter-header">
                <div class="pwd-meter-bars">
                  <div class="pwd-bar" [class.filled]="passwordStrength.score >= 1" [style.background-color]="passwordStrength.score >= 1 ? passwordStrength.color : ''"></div>
                  <div class="pwd-bar" [class.filled]="passwordStrength.score >= 2" [style.background-color]="passwordStrength.score >= 2 ? passwordStrength.color : ''"></div>
                  <div class="pwd-bar" [class.filled]="passwordStrength.score >= 3" [style.background-color]="passwordStrength.score >= 3 ? passwordStrength.color : ''"></div>
                  <div class="pwd-bar" [class.filled]="passwordStrength.score >= 4" [style.background-color]="passwordStrength.score >= 4 ? passwordStrength.color : ''"></div>
                </div>
                <span class="pwd-strength-label" [style.color]="passwordStrength.color">{{ passwordStrength.label }}</span>
              </div>

              <div class="pwd-checklist">
                <div class="check-item" [class.valid]="hasMinLength">
                  <span class="material-symbols-outlined check-ico">{{ hasMinLength ? 'check' : 'close' }}</span>
                  <span>{{ 'iam.ne_menee_10_simvolov' | t }}</span>
                </div>
                <div class="check-item" [class.valid]="hasUpperAndLower">
                  <span class="material-symbols-outlined check-ico">{{ hasUpperAndLower ? 'check' : 'close' }}</span>
                  <span>{{ 'iam.zaglavnye_i_strochnye_bukvy' | t }}</span>
                </div>
                <div class="check-item" [class.valid]="hasDigitsOrSymbols">
                  <span class="material-symbols-outlined check-ico">{{ hasDigitsOrSymbols ? 'check' : 'close' }}</span>
                  <span>{{ 'iam.cifry_ili_specsimvoly' | t }}</span>
                </div>
                <div class="check-item" [class.valid]="doesNotContainLogin">
                  <span class="material-symbols-outlined check-ico">{{ doesNotContainLogin ? 'check' : 'close' }}</span>
                  <span>{{ 'iam.bez_sovpadeniy_s_loginom' | t }}</span>
                </div>
              </div>
            </div>

            <span id="user-create-password-hint" class="clean-hint" *ngIf="!createForm.password">
              {{ 'iam.ne_menee_10_simvolov_bez_sovpadeniy_s_loginom' | t }}
            </span>
            <span id="user-create-password-error" class="field-error" *ngIf="isCreateSubmitted && createForm.password.length < 10">
              {{ 'iam.parol_dolzhen_soderzhat_ne_menee_10_simvolov' | t }}
            </span>
          </div>

          <div class="form-group">
            <label class="clean-label" for="user-create-language">{{ 'iam.yazyk' | t }}</label>
            <select id="user-create-language" name="userCreateLanguage" class="clean-input" [(ngModel)]="createForm.language">
              <option *ngFor="let lang of languages" [value]="lang.code">
                {{ lang.name }} ({{ lang.code }})
              </option>
            </select>
          </div>

          <div class="form-group">
            <label class="clean-label" for="user-create-timezone">{{ 'iam.chasovoy_poyas' | t }}</label>
            <select id="user-create-timezone" name="userCreateTimezone" class="clean-input" [(ngModel)]="createForm.timezone">
              <option value="Asia/Tashkent">Asia/Tashkent (UTC+5)</option>
              <option value="Europe/Moscow">Europe/Moscow (UTC+3)</option>
              <option value="UTC">UTC (UTC+0)</option>
              <option value="Asia/Almaty">Asia/Almaty (UTC+5)</option>
              <option value="Asia/Dubai">Asia/Dubai (UTC+4)</option>
            </select>
          </div>

          <div class="form-group span-2">
            <label class="clean-checkbox">
              <input name="userCreate2fa" type="checkbox" [(ngModel)]="createForm.is2faEnabled" />
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
              >
                <input
                  type="checkbox"
                  [checked]="isRoleSelected(role.id)"
                  (change)="toggleRole.emit(role.id)"
                />
                <span>{{ role.name }}</span>
              </label>
            </div>
          </div>

          <!-- Custom Fields -->
          <div class="form-group span-2" *ngIf="customFields.length > 0">
            <span class="clean-label">{{ 'iam.dopolnitelnye_polya' | t }}</span>
            <ui-custom-fields
              [fields]="customFields"
              [(values)]="createForm.attributes"
            ></ui-custom-fields>
          </div>
        </div>
      </div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="close.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="primary" size="md" [loading]="isSubmitting" (onClick)="submit.emit()">{{ 'common.create' | t }}</ui-button>
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
    .font-mono { font-family: monospace; }
    .req { color: var(--danger); }
    .field-error { font-size: 10px; color: var(--danger); }
    .clean-hint { font-size: 10px; color: var(--text-muted); }

    .clean-checkbox {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-main);
      cursor: pointer;
    }

    .pwd-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    .pwd-wrapper .clean-input {
      width: 100%;
      padding-right: 90px;
    }
    .pwd-actions {
      position: absolute;
      right: 4px;
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .pwd-btn {
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      border-radius: var(--radius-sm);
      transition: color 0.15s ease, background-color 0.15s ease;
    }
    .pwd-btn:hover {
      color: var(--text-main);
      background-color: var(--bg-hover);
    }
    .pwd-btn:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 1px;
    }
    .pwd-btn .material-symbols-outlined {
      font-size: 18px;
    }

    /* Password Strength Meter */
    .pwd-strength-container {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 4px;
      padding: 8px 10px;
      background-color: var(--bg-hover);
      border-radius: var(--radius-sm);
    }
    .pwd-meter-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .pwd-meter-bars {
      display: flex;
      gap: 4px;
      flex: 1;
    }
    .pwd-bar {
      height: 4px;
      flex: 1;
      border-radius: 2px;
      background-color: var(--border-color);
      transition: background-color 0.2s ease;
    }
    .pwd-strength-label {
      font-size: 11px;
      font-weight: 600;
    }
    .pwd-checklist {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 10px;
      margin-top: 4px;
    }
    .check-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--text-muted);
    }
    .check-item.valid {
      color: var(--success);
    }
    .check-ico {
      font-size: 13px;
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

    @media (max-width: 640px) {
      .modal-form,
      .form-group { min-width: 0; }
      .form-grid { grid-template-columns: minmax(0, 1fr); }
      .span-2 { grid-column: auto; }
    }
  `]
})
export class UserCreateModalComponent {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() isCreateSubmitted = false;
  @Input() createForm: any = {};
  @Input() users: User[] = [];
  @Input() roles: Role[] = [];
  @Input() languages: Array<{ code: string, name: string }> = [];
  @Input() customFields: CustomField[] = [];
  @Input() showPassword = false;
  @Input() passwordStrength: { score: number, label: string, color: string } = { score: 0, label: '', color: '' };
  @Input() hasMinLength = false;
  @Input() hasUpperAndLower = false;
  @Input() hasDigitsOrSymbols = false;
  @Input() doesNotContainLogin = false;
  @Input() isRoleSelected!: (roleId: number) => boolean;

  @Output() close = new EventEmitter<void>();
  @Output() submit = new EventEmitter<void>();
  @Output() toggleShowPassword = new EventEmitter<void>();
  @Output() generatePassword = new EventEmitter<void>();
  @Output() copyPassword = new EventEmitter<void>();
  @Output() toggleRole = new EventEmitter<number>();
}
