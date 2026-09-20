import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CustomField, CustomFieldFormData } from '../custom-fields.models';
import { UiModalComponent } from '../../../../shared/ui/ui-modal.component';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { TranslatePipe } from '../../../../core/services/i18n.service';

@Component({
  selector: 'app-custom-fields-modals',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    UiModalComponent,
    UiButtonComponent,
    TranslatePipe
  ],
  template: `
    <!-- Create / Edit Modal -->
    <ui-modal
      *ngIf="showModal"
      [isOpen]="showModal"
      [title]="(editingField ? 'iam.edit_field' : 'iam.new_custom_field') | t"
      [hasFooter]="true"
      (close)="closeModal.emit()"
    >
      <form id="customFieldForm" body class="modal-form" (ngSubmit)="saveField.emit()">
        <!-- Entity Target (only in creation) -->
        <div class="form-group" *ngIf="!editingField">
          <label class="form-label" for="custom-field-entity">
            {{ 'iam.celevaya_suschnost' | t }} <span class="req" aria-hidden="true">*</span>
          </label>
          <select id="custom-field-entity" name="entityType" class="form-select" [(ngModel)]="formData.entityType" required>
            <option value="USER">{{ 'iam.polzovatel_user' | t }}</option>
            <option value="PROJECT">{{ 'iam.proekt_project' | t }}</option>
            <option value="TASK">{{ 'iam.zadacha_task' | t }}</option>
            <option value="NOTE">{{ 'iam.zametka_note' | t }}</option>
          </select>
        </div>

        <!-- Code & Name -->
        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label" for="custom-field-code">
              {{ 'iam.kod_polya_slug' | t }} <span class="req" aria-hidden="true">*</span>
            </label>
            <input
              id="custom-field-code"
              name="code"
              type="text"
              class="form-input font-mono"
              [(ngModel)]="formData.code"
              (input)="codeInput.emit($event)"
              [disabled]="!!editingField"
              [placeholder]="'iam.naprimer_inn_budget' | t"
              maxlength="64"
              autocomplete="off"
              [attr.aria-invalid]="!!formError"
              [attr.aria-describedby]="formError ? 'custom-field-form-error' : null"
              required
            />
            <span class="form-hint" *ngIf="!editingField">{{ 'iam.kod_polya_help' | t }}</span>
            <span class="form-hint readonly-hint" *ngIf="editingField">{{ 'iam.kod_polya_readonly' | t }}</span>
          </div>

          <div class="form-group flex-1">
            <label class="form-label" for="custom-field-name">
              {{ 'iam.nazvanie_polya' | t }} <span class="req" aria-hidden="true">*</span>
            </label>
            <input
              id="custom-field-name"
              name="name"
              type="text"
              class="form-input"
              [(ngModel)]="formData.name"
              [placeholder]="'iam.naprimer_inn_byudzhet_proekta' | t"
              maxlength="100"
              [attr.aria-invalid]="!!formError"
              [attr.aria-describedby]="formError ? 'custom-field-form-error' : null"
              required
            />
          </div>
        </div>

        <!-- Type, Default Value & Order -->
        <div class="form-row">
          <div class="form-group flex-1" *ngIf="!editingField">
            <label class="form-label" for="custom-field-type">
              {{ 'iam.tip_dannyh' | t }} <span class="req" aria-hidden="true">*</span>
            </label>
            <select id="custom-field-type" name="fieldType" class="form-select" [(ngModel)]="formData.fieldType" required>
              <option value="string">{{ 'iam.tekst_string' | t }}</option>
              <option value="number">{{ 'iam.chislo_number' | t }}</option>
              <option value="boolean">{{ 'iam.logicheskiy_pereklyuchatel_boolean' | t }}</option>
              <option value="date">{{ 'iam.data_date' | t }}</option>
              <option value="select">{{ 'iam.vypadayuschiy_spisok_select' | t }}</option>
              <option value="user_ref">{{ 'iam.ssylka_na_polzovatelya_user_ref' | t }}</option>
            </select>
          </div>

          <div class="form-group flex-1">
            <label class="form-label" for="custom-field-default">
              {{ 'iam.znachenie_po_umolchaniyu' | t }}
            </label>
            <input
              id="custom-field-default"
              name="defaultValue"
              type="text"
              class="form-input"
              [(ngModel)]="formData.defaultValue"
              [placeholder]="'iam.ne_obyazatelno' | t"
              maxlength="255"
            />
          </div>

          <div class="form-group order-input-group">
            <label class="form-label" for="custom-field-order">
              {{ 'iam.poryadok_sortirovki' | t }}
            </label>
            <input
              id="custom-field-order"
              name="orderNo"
              type="number"
              class="form-input font-mono"
              [(ngModel)]="formData.orderNo"
              [placeholder]="'iam.poryadok_sortirovki_hint' | t"
              min="0"
              max="99999"
            />
          </div>
        </div>

        <!-- Options for select type -->
        <div class="form-group" *ngIf="formData.fieldType === 'select'">
          <label class="form-label" for="custom-field-options">
            {{ 'iam.varianty_spiska' | t }} <span class="req" aria-hidden="true">*</span>
          </label>
          <textarea
            id="custom-field-options"
            name="optionsText"
            class="form-input options-input"
            [(ngModel)]="formData.optionsText"
            rows="4"
            [placeholder]="'iam.po_odnomu_variantu_v_stroke' | t"
            [attr.aria-invalid]="!!formError"
            [attr.aria-describedby]="formError ? 'custom-field-form-error' : null"
            required
          ></textarea>
          <span class="form-hint">{{ 'iam.po_odnomu_variantu_v_stroke_dlya_otdelnogo_koda_' | t }}</span>
        </div>

        <!-- Required Toggle -->
        <div class="form-group checkbox-group">
          <label class="checkbox-label" for="custom-field-required">
            <input id="custom-field-required" name="isRequired" type="checkbox" [(ngModel)]="formData.isRequired" />
            <span>{{ 'iam.obyazatelnoe_dlya_zapolneniya' | t }}</span>
          </label>
        </div>

        <p *ngIf="formError" id="custom-field-form-error" class="form-error" role="alert">{{ formError }}</p>
      </form>

      <div footer class="modal-footer-actions">
        <ui-button type="button" variant="secondary" (onClick)="closeModal.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button type="submit" form="customFieldForm" variant="primary" [loading]="saving" (onClick)="saveField.emit()">{{ 'common.save' | t }}</ui-button>
      </div>
    </ui-modal>

    <!-- Delete Confirmation Modal -->
    <ui-modal
      *ngIf="fieldToDelete !== null"
      [isOpen]="fieldToDelete !== null"
      [title]="'iam.udalenie_dinamicheskogo_polya' | t"
      size="sm"
      (close)="cancelDelete.emit()"
    >
      <div body class="delete-confirmation" *ngIf="fieldToDelete as field">
        <p>{{ 'iam.udalit_dinamicheskoe_pole' | t }} <strong>«{{ field.name }}»</strong> ({{ field.code }})?</p>
        <span>{{ 'iam.sohranennye_znacheniya_etogo_atributa_mogut_stat' | t }}</span>
      </div>
      <div footer>
        <ui-button type="button" variant="secondary" (onClick)="cancelDelete.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button type="button" variant="danger" [loading]="isDeleting" (onClick)="confirmDelete.emit()">{{ 'common.delete' | t }}</ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    :host {
      display: contents;
    }

    .modal-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 4px 0;
    }

    .form-row {
      display: flex;
      gap: 16px;
    }

    .flex-1 { flex: 1; }

    .order-input-group {
      flex: 0 0 110px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-main);
    }

    .req { color: var(--danger, #dc2626); }

    .form-input, .form-select {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 9px 12px;
      color: var(--text-main);
      font-size: 14px;
      transition: border-color 0.2s;
    }

    .form-input:focus, .form-select:focus {
      outline: none;
      border-color: var(--primary);
    }

    .form-input:disabled {
      background: var(--bg-hover);
      color: var(--text-muted);
      cursor: not-allowed;
    }

    .options-input {
      min-height: 92px;
      resize: vertical;
      font-family: inherit;
    }

    .form-hint {
      color: var(--text-light);
      font-size: 12px;
      line-height: 1.4;
    }

    .readonly-hint {
      color: var(--warning, #d97706);
    }

    .form-error {
      margin: 0;
      color: var(--danger, #dc2626);
      font-size: 13px;
      padding: 8px 12px;
      background: var(--danger-subtle, rgba(239, 68, 68, 0.1));
      border-radius: 6px;
      border: 1px solid var(--danger-border, rgba(239, 68, 68, 0.2));
    }

    .checkbox-group {
      margin-top: 4px;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: var(--text-main);
      cursor: pointer;
    }

    .modal-footer-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      width: 100%;
    }

    .delete-confirmation {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .delete-confirmation p { margin: 0; font-size: 14px; }
    .delete-confirmation span { color: var(--text-muted); font-size: 12px; }

    @media (max-width: 768px) {
      .form-row {
        flex-direction: column;
        gap: 12px;
      }

      .order-input-group {
        flex: 1 1 auto;
      }
    }
  `]
})
export class CustomFieldsModalsComponent {
  @Input() showModal = false;
  @Input() editingField: CustomField | null = null;
  @Input() fieldToDelete: CustomField | null = null;
  @Input() formData!: CustomFieldFormData;
  @Input() formError = '';
  @Input() saving = false;
  @Input() isDeleting = false;

  @Output() closeModal = new EventEmitter<void>();
  @Output() saveField = new EventEmitter<void>();
  @Output() cancelDelete = new EventEmitter<void>();
  @Output() confirmDelete = new EventEmitter<void>();
  @Output() codeInput = new EventEmitter<Event>();
}
