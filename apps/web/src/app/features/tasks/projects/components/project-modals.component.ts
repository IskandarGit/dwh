import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UiModalComponent } from '../../../../shared/ui/ui-modal.component';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { UiCustomFieldsComponent } from '../../../../shared/ui/ui-custom-fields.component';
import { TranslatePipe, I18nService } from '../../../../core/services/i18n.service';
import { Project } from '../../../../core/models/task.models';
import { CustomField } from '../../../../core/models/custom-field.models';
import { ProjectCreateForm, ProjectEditForm, ProjectAttributeItem } from '../projects.models';

@Component({
  selector: 'app-project-modals',
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
    <!-- Record View Modal -->
    <ui-modal *ngIf="routeRecordId !== null" [isOpen]="true" [title]="'projects.proekt' | t" size="sm" (close)="closeRecordView.emit()">
      <div body>
        <p *ngIf="recordLoading" role="status">{{ 'search.record_loading' | t }}</p>
        <div *ngIf="recordError" role="alert">
          <p>{{ (recordNotFound ? 'search.record_not_found' : 'search.record_load_error') | t }}</p>
          <ui-button *ngIf="!recordNotFound" variant="secondary" (onClick)="loadRecordView.emit(routeRecordId)">{{ 'audit.retry' | t }}</ui-button>
        </div>
        <div *ngIf="viewingProject as project" [attr.data-record-id]="routeRecordId">
          <p>#{{ routeRecordId }}</p>
          <h3>{{ project.name }}</h3>
          <p>{{ project.description }}</p>
          <p>{{ (project.state === 'A' ? 'common.active_masculine' : 'common.blocked_masculine') | t }}</p>
          <div class="attributes-stack" *ngIf="hasAttributes(project.attributes)">
            <h4>{{ 'projects.custom_fields' | t }}</h4>
            <div *ngFor="let item of formatAttributes(project.attributes)" class="attr-stack-item">
              <span class="attr-k">{{ item.key }}:</span>
              <span class="attr-v">{{ item.value }}</span>
            </div>
          </div>
        </div>
      </div>
      <div footer><ui-button variant="secondary" (onClick)="closeRecordView.emit()">{{ 'search.back_to_list' | t }}</ui-button></div>
    </ui-modal>

    <!-- Create Project Modal -->
    <ui-modal
      [isOpen]="isCreateModalOpen"
      [title]="'projects.sozdanie_novogo_proekta' | t"
      size="sm"
      [dismissible]="!isSubmitting"
      (close)="requestCloseCreate.emit()"
    >
      <form body id="project-create-form" (ngSubmit)="submitCreateProject.emit()">
        <fieldset class="modal-form modal-form-fieldset project-create-form" [disabled]="isSubmitting">
          <div class="form-group">
            <div class="label-row">
              <label class="clean-label" for="project-create-name">{{ 'projects.nazvanie_proekta' | t }}</label>
              <span class="req-tag">{{ 'projects.obyazatelnoe_pole' | t }}</span>
            </div>
            <input
              id="project-create-name"
              name="projectCreateName"
              type="text"
              class="clean-input"
              required
              [attr.aria-invalid]="isCreateSubmitted && !createForm.name.trim()"
              [attr.aria-describedby]="isCreateSubmitted && !createForm.name.trim() ? 'project-create-name-error' : null"
              [class.input-error]="isCreateSubmitted && !createForm.name.trim()"
              [(ngModel)]="createForm.name"
              [placeholder]="'projects.naprimer_vnedrenie_dwh_cdc' | t"
            />
            <span id="project-create-name-error" class="error-msg" *ngIf="isCreateSubmitted && !createForm.name.trim()">
              {{ 'projects.pozhaluysta_ukazhite_nazvanie_proekta' | t }}
            </span>
          </div>
          <div class="form-group">
            <div class="label-row">
              <label class="clean-label" for="project-create-description">{{ 'projects.opisanie_proekta' | t }}</label>
            </div>
            <textarea
              id="project-create-description"
              name="projectCreateDescription"
              class="clean-input clean-textarea"
              rows="3"
              [(ngModel)]="createForm.description"
              [placeholder]="'projects.celi_granicy_i_kontekst_proekta' | t"
            ></textarea>
          </div>
          <div class="form-group" *ngIf="projectCustomFields.length > 0">
            <ui-custom-fields
              [fields]="projectCustomFields"
              [values]="createForm.attributes || {}"
              (valuesChange)="createForm.attributes = $event"
            ></ui-custom-fields>
          </div>
          <div *ngIf="createSaveError" class="request-state request-error" data-testid="project-create-save-error" role="alert">
            {{ createSaveError }}
          </div>
        </fieldset>
      </form>
      <div footer>
        <ui-button variant="secondary" size="md" [disabled]="isSubmitting" (onClick)="requestCloseCreate.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button type="submit" form="project-create-form" variant="primary" size="md" [loading]="isSubmitting">{{ 'projects.sozdat_proekt' | t }}</ui-button>
      </div>
    </ui-modal>

    <ui-modal
      [isOpen]="isCreateDiscardConfirmationOpen"
      [title]="'projects.discard_create_title' | t"
      size="sm"
      (close)="cancelNavigationDiscard.emit('create')"
    >
      <div body><p>{{ 'projects.discard_create_message' | t }}</p></div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="cancelNavigationDiscard.emit('create')">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="danger" size="md" (onClick)="confirmDiscardCreate.emit()">{{ 'projects.discard_create_action' | t }}</ui-button>
      </div>
    </ui-modal>

    <!-- Edit Project Modal -->
    <ui-modal
      [isOpen]="isEditModalOpen"
      [title]="'projects.redaktirovanie_proekta' | t"
      size="sm"
      [dismissible]="!isSubmitting"
      (close)="requestCloseEdit.emit()"
    >
      <div body class="request-state" data-testid="project-edit-loading" *ngIf="editLoading" role="status">
        {{ 'projects.edit_loading' | t }}
      </div>
      <div body class="request-state request-error" data-testid="project-edit-load-error" *ngIf="editLoadError" role="alert">
        <span>{{ 'projects.edit_load_error' | t }}</span>
        <ui-button class="project-edit-retry" variant="secondary" size="sm" (onClick)="retryEditLoad.emit()">{{ 'projects.retry_edit_load' | t }}</ui-button>
      </div>
      <form body id="project-edit-form" (ngSubmit)="submitEditProject.emit()" *ngIf="editingProject as p">
        <fieldset class="modal-form modal-form-fieldset project-edit-form" [disabled]="isSubmitting">
          <div class="form-group">
            <div class="label-row">
              <label class="clean-label" for="project-edit-name">{{ 'projects.nazvanie_proekta' | t }}</label>
              <span class="req-tag">{{ 'projects.obyazatelnoe_pole' | t }}</span>
            </div>
            <input
              id="project-edit-name"
              name="projectEditName"
              type="text"
              class="clean-input"
              required
              [attr.aria-invalid]="isEditSubmitted && !editForm.name.trim()"
              [attr.aria-describedby]="isEditSubmitted && !editForm.name.trim() ? 'project-edit-name-error' : null"
              [class.input-error]="isEditSubmitted && !editForm.name.trim()"
              [(ngModel)]="editForm.name"
            />
            <span id="project-edit-name-error" class="error-msg" *ngIf="isEditSubmitted && !editForm.name.trim()">
              {{ 'projects.nazvanie_proekta_ne_mozhet_byt_pustym' | t }}
            </span>
          </div>
          <div class="form-group">
            <div class="label-row">
              <label class="clean-label" for="project-edit-state">{{ 'iam.status_aktivnosti' | t }}</label>
            </div>
            <select id="project-edit-state" name="projectEditState" class="clean-input" [(ngModel)]="editForm.state">
              <option value="A">{{ 'projects.state_active' | t }}</option>
              <option value="P">{{ 'projects.state_archived' | t }}</option>
            </select>
          </div>
          <div class="form-group">
            <div class="label-row">
              <label class="clean-label" for="project-edit-description">{{ 'projects.opisanie' | t }}</label>
            </div>
            <textarea id="project-edit-description" name="projectEditDescription" class="clean-input clean-textarea" rows="3" [(ngModel)]="editForm.description"></textarea>
          </div>
          <div class="form-group" *ngIf="projectCustomFields.length > 0">
            <ui-custom-fields
              [fields]="projectCustomFields"
              [values]="editForm.attributes || {}"
              (valuesChange)="editForm.attributes = $event"
            ></ui-custom-fields>
          </div>
          <div *ngIf="editSaveError" class="request-state request-error" data-testid="project-edit-save-error" role="alert">
            {{ editSaveError }}
          </div>
        </fieldset>
      </form>
      <div footer>
        <ui-button variant="secondary" size="md" [disabled]="isSubmitting" (onClick)="requestCloseEdit.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button *ngIf="editingProject" type="submit" form="project-edit-form" variant="primary" size="md" [loading]="isSubmitting">{{ 'common.save' | t }}</ui-button>
      </div>
    </ui-modal>

    <ui-modal
      [isOpen]="isEditDiscardConfirmationOpen"
      [title]="'projects.discard_edit_title' | t"
      size="sm"
      (close)="cancelNavigationDiscard.emit('edit')"
    >
      <div body><p>{{ 'projects.discard_edit_message' | t }}</p></div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="cancelNavigationDiscard.emit('edit')">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="danger" size="md" (onClick)="confirmDiscardEdit.emit()">{{ 'projects.discard_edit_action' | t }}</ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    .modal-form { display: flex; flex-direction: column; gap: 12px; }
    .form-group { display: flex; flex-direction: column; gap: 4px; }
    .label-row { display: flex; align-items: center; justify-content: space-between; }
    .clean-label { font-size: 11px; font-weight: 500; color: var(--text-muted); }
    .req-tag {
      font-size: 10px;
      font-weight: 500;
      color: var(--danger);
      background-color: var(--danger-bg);
      padding: 1px 5px;
      border-radius: 4px;
    }
    .clean-input {
      height: 32px;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-size: 13px;
      outline: none;
    }
    .clean-input:focus { border-color: var(--primary); }
    .clean-input.input-error { border-color: var(--danger); background-color: var(--danger-bg); }
    .error-msg { font-size: 11px; color: var(--danger); margin-top: 2px; }
    .modal-form-fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
    .clean-textarea { height: auto; padding: 6px 8px; resize: vertical; font-family: inherit; }

    .request-state {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 40px;
      padding: 9px 12px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      background-color: var(--bg-surface);
      color: var(--text-muted);
      font-size: 12px;
    }
    .request-error {
      border-color: var(--danger);
      background-color: var(--danger-bg);
      color: var(--danger);
    }
    .attributes-stack { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; }
    .attr-stack-item { display: flex; gap: 8px; font-size: 13px; }
    .attr-k { color: var(--text-muted); font-weight: 500; }
    .attr-v { color: var(--text-main); }
  `]
})
export class ProjectModalsComponent {
  private readonly uiI18n = inject(I18nService);

  // Record View
  @Input() routeRecordId: string | null = null;
  @Input() viewingProject: Project | null = null;
  @Input() recordLoading = false;
  @Input() recordError = false;
  @Input() recordNotFound = false;
  @Output() closeRecordView = new EventEmitter<void>();
  @Output() loadRecordView = new EventEmitter<string | null>();

  // Create Modal
  @Input() isCreateModalOpen = false;
  @Input() isCreateSubmitted = false;
  @Input() isCreateDiscardConfirmationOpen = false;
  @Input() createSaveError: string | null = null;
  @Input() createForm: ProjectCreateForm = { name: '', description: '', attributes: {} };
  @Output() requestCloseCreate = new EventEmitter<void>();
  @Output() confirmDiscardCreate = new EventEmitter<void>();
  @Output() submitCreateProject = new EventEmitter<void>();

  // Edit Modal
  @Input() isEditModalOpen = false;
  @Input() isEditSubmitted = false;
  @Input() isEditDiscardConfirmationOpen = false;
  @Input() editLoading = false;
  @Input() editLoadError = false;
  @Input() editSaveError: string | null = null;
  @Input() editingProject: Project | null = null;
  @Input() editForm: ProjectEditForm = { name: '', description: '', state: 'A', attributes: {} };
  @Output() requestCloseEdit = new EventEmitter<void>();
  @Output() confirmDiscardEdit = new EventEmitter<void>();
  @Output() submitEditProject = new EventEmitter<void>();
  @Output() retryEditLoad = new EventEmitter<void>();

  // Discard helper
  @Output() cancelNavigationDiscard = new EventEmitter<'create' | 'edit'>();

  // Shared
  @Input() isSubmitting = false;
  @Input() projectCustomFields: CustomField[] = [];

  hasAttributes(attrs: any): boolean {
    if (!attrs || typeof attrs !== 'object') return false;
    return Object.keys(attrs).length > 0;
  }

  formatAttributes(attrs: any): ProjectAttributeItem[] {
    if (!this.hasAttributes(attrs)) return [];
    const fields = this.projectCustomFields;
    return Object.entries(attrs).map(([k, v]) => {
      const field = fields.find(f => f.code === k);
      const keyLabel = field ? field.name : k;
      let valueStr = String(v ?? '');
      if (field?.fieldType === 'boolean') {
        valueStr = v === true || v === 'true'
          ? this.uiI18n.translate('common.yes')
          : this.uiI18n.translate('common.no');
      } else if (field?.fieldType === 'select' && field.optionsJson) {
        try {
          const opts = JSON.parse(field.optionsJson);
          if (Array.isArray(opts)) {
            const matched = opts.find(o => typeof o === 'object' && o !== null ? o.value === v : o === v);
            if (matched && typeof matched === 'object' && matched.label) {
              valueStr = matched.label;
            }
          }
        } catch {
          // ignore
        }
      }
      return { key: keyLabel, value: valueStr };
    });
  }
}
