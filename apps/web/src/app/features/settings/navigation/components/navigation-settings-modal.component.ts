import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CustomNavigationItem, NavigationTargetType } from '../../../../core/models/navigation.models';
import { UiModalComponent } from '../../../../shared/ui/ui-modal.component';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { TranslatePipe } from '../../../../core/services/i18n.service';

@Component({
  selector: 'app-navigation-settings-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    UiModalComponent,
    UiButtonComponent,
    TranslatePipe
  ],
  template: `
    <!-- Create/Edit Modal -->
    <ui-modal
      *ngIf="isModalOpen"
      [isOpen]="isModalOpen"
      [title]="editingItem ? ('nav.settings.edit_modal_title' | t) : ('nav.settings.create_modal_title' | t)"
      (close)="closeModal.emit()"
    >
      <div class="modal-form">
        <div class="form-row">
          <div class="form-group flex-2">
            <label class="form-label" for="nav-title">{{ 'nav.settings.field_title' | t }} *</label>
            <input
              id="nav-title"
              type="text"
              class="form-input"
              [ngModel]="formTitle"
              (ngModelChange)="formTitleChange.emit($event); titleChange.emit()"
              [placeholder]="'nav.settings.title_placeholder' | t"
            />
          </div>
          <div class="form-group flex-1">
            <label class="form-label" for="nav-code">{{ 'nav.settings.field_code' | t }} *</label>
            <input
              id="nav-code"
              type="text"
              class="form-input"
              [ngModel]="formCode"
              (ngModelChange)="formCodeChange.emit($event)"
              placeholder="superset-sales"
            />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label" for="nav-type">{{ 'nav.settings.field_type' | t }}</label>
            <select id="nav-type" class="form-input" [ngModel]="formTargetType" (ngModelChange)="formTargetTypeChange.emit($event)">
              <option value="EMBEDDED_IFRAME">{{ 'nav.settings.type_embedded' | t }}</option>
              <option value="EXTERNAL_LINK">{{ 'nav.settings.type_external' | t }}</option>
              <option value="INTERNAL_ROUTE">{{ 'nav.settings.type_internal' | t }}</option>
            </select>
          </div>
          <div class="form-group flex-1">
            <label class="form-label" for="nav-section">{{ 'nav.settings.field_section' | t }}</label>
            <select id="nav-section" class="form-input" [ngModel]="formSectionId" (ngModelChange)="formSectionIdChange.emit($event)">
              <option value="custom">{{ 'nav.settings.section_custom' | t }}</option>
              <option value="workspace">{{ 'nav.section.workspace' | t }}</option>
              <option value="iam">{{ 'nav.section.iam' | t }}</option>
              <option value="administration">{{ 'nav.section.administration' | t }}</option>
            </select>
          </div>
          <div class="form-group flex-1">
            <label class="form-label" for="nav-order">{{ 'nav.settings.field_order' | t }}</label>
            <input
              id="nav-order"
              type="number"
              class="form-input"
              [ngModel]="formSortOrder"
              (ngModelChange)="formSortOrderChange.emit($event)"
            />
          </div>
        </div>

        <div *ngIf="formTargetType === 'EMBEDDED_IFRAME'" class="type-hint-box">
          <span class="material-symbols-outlined hint-icon" aria-hidden="true">info</span>
          <span>{{ 'nav.settings.iframe_type_hint' | t }}</span>
        </div>

        <div class="form-group">
          <label class="form-label" for="nav-url">{{ 'nav.settings.field_url' | t }} *</label>
          <input
            id="nav-url"
            type="text"
            class="form-input"
            [ngModel]="formUrl"
            (ngModelChange)="formUrlChange.emit($event)"
            (blur)="urlBlur.emit()"
            placeholder="https://bi.company.uz/superset/dashboard/123/"
          />
          <span class="form-hint">{{ 'nav.settings.url_hint' | t }}</span>
        </div>

        <div class="form-group">
          <label class="form-label">{{ 'nav.settings.field_icon' | t }}</label>
          <div class="icon-selector-row">
            <input
              type="text"
              class="form-input icon-input"
              [ngModel]="formIcon"
              (ngModelChange)="formIconChange.emit($event)"
              placeholder="analytics"
            />
            <span class="material-symbols-outlined icon-preview" aria-hidden="true">{{ formIcon || 'bar_chart' }}</span>
          </div>
          <div class="icon-quick-chips">
            <button
              *ngFor="let ic of popularIcons"
              type="button"
              class="chip-btn"
              [class.active]="formIcon === ic"
              (click)="formIconChange.emit(ic)"
            >
              <span class="material-symbols-outlined" aria-hidden="true">{{ ic }}</span>
            </button>
          </div>
        </div>
      </div>

      <div footer class="modal-footer-btns">
        <ui-button variant="secondary" (onClick)="closeModal.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="primary" [loading]="isSubmitting" (onClick)="saveItem.emit()" [disabled]="!isFormValid">
          {{ 'common.save' | t }}
        </ui-button>
      </div>
    </ui-modal>

    <!-- Delete Confirmation Modal -->
    <ui-modal
      *ngIf="deleteTarget"
      [isOpen]="deleteTarget !== null"
      [title]="'nav.settings.delete_modal_title' | t"
      (close)="cancelDelete.emit()"
    >
      <p *ngIf="deleteTarget as target">{{ 'nav.settings.delete_confirm' | t: { title: target.title } }}</p>
      <div footer class="modal-footer-btns">
        <ui-button variant="secondary" (onClick)="cancelDelete.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="danger" (onClick)="executeDelete.emit()">{{ 'common.delete' | t }}</ui-button>
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
      padding: 8px 0;
    }

    .form-row {
      display: flex;
      gap: 12px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .flex-1 { flex: 1; }
    .flex-2 { flex: 2; }

    .form-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-main);
    }

    .form-input {
      padding: 8px 12px;
      font-size: 13px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background-color: var(--bg-surface);
      color: var(--text-main);
      outline: none;
      transition: border-color 0.15s ease;
    }

    .form-input:focus {
      border-color: var(--primary);
    }

    .form-hint {
      font-size: 11px;
      color: var(--text-muted);
    }

    .type-hint-box {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1e40af;
      font-size: 12px;
      line-height: 1.4;
    }

    .hint-icon {
      font-size: 18px;
      flex-shrink: 0;
      color: #3b82f6;
    }

    .icon-selector-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .icon-input {
      flex: 1;
    }

    .icon-preview {
      font-size: 24px;
      color: var(--primary);
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg-hover);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
    }

    .icon-quick-chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 4px;
    }

    .chip-btn {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background: var(--bg-surface);
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.12s ease;
    }

    .chip-btn:hover {
      background: var(--bg-hover);
      color: var(--text-main);
    }

    .chip-btn.active {
      background: var(--primary);
      color: #fff;
      border-color: var(--primary);
    }

    .chip-btn .material-symbols-outlined {
      font-size: 18px;
    }

    .modal-footer-btns {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }
  `]
})
export class NavigationSettingsModalComponent {
  @Input() isModalOpen = false;
  @Input() editingItem: CustomNavigationItem | null = null;
  @Input() deleteTarget: CustomNavigationItem | null = null;
  @Input() isSubmitting = false;
  @Input() isFormValid = false;

  @Input() formTitle = '';
  @Input() formCode = '';
  @Input() formTargetType: NavigationTargetType = 'EMBEDDED_IFRAME';
  @Input() formSectionId = 'custom';
  @Input() formSortOrder = 10;
  @Input() formUrl = '';
  @Input() formIcon = 'analytics';
  @Input() popularIcons: string[] = [];

  @Output() formTitleChange = new EventEmitter<string>();
  @Output() formCodeChange = new EventEmitter<string>();
  @Output() formTargetTypeChange = new EventEmitter<NavigationTargetType>();
  @Output() formSectionIdChange = new EventEmitter<string>();
  @Output() formSortOrderChange = new EventEmitter<number>();
  @Output() formUrlChange = new EventEmitter<string>();
  @Output() formIconChange = new EventEmitter<string>();

  @Output() titleChange = new EventEmitter<void>();
  @Output() urlBlur = new EventEmitter<void>();
  @Output() closeModal = new EventEmitter<void>();
  @Output() saveItem = new EventEmitter<void>();
  @Output() cancelDelete = new EventEmitter<void>();
  @Output() executeDelete = new EventEmitter<void>();
}
