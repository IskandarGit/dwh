import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiSearchableSelectComponent, SelectOption } from '../../../shared/ui/ui-searchable-select.component';
import { UiUserMultiSelectComponent } from '../../../shared/ui/ui-user-multi-select.component';
import { UiMarkdownEditorComponent } from '../../../shared/ui/ui-markdown-editor.component';
import { UiCustomFieldsComponent } from '../../../shared/ui/ui-custom-fields.component';
import { CustomField } from '../../../core/models/custom-field.models';
import { Project, Task, TaskType } from '../../../core/models/task.models';
import { User } from '../../../core/models/auth.models';

@Component({
  selector: 'app-task-edit-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    UiModalComponent,
    UiButtonComponent,
    UiSearchableSelectComponent,
    UiUserMultiSelectComponent,
    UiMarkdownEditorComponent,
    UiCustomFieldsComponent
  ],
  template: `
    <ui-modal
      [isOpen]="isOpen"
      [title]="'tasks.redaktirovanie_zadachi' | t"
      size="lg"
      [dismissible]="!isSubmitting"
      (close)="close.emit()"
    >
      <div body class="request-state request-loading" *ngIf="editLoading" role="status">
        {{ 'tasks.edit_loading' | t }}
      </div>
      <div body class="request-state request-error" *ngIf="editLoadError" role="alert">
        <span>{{ 'tasks.edit_load_error' | t }}</span>
        <ui-button variant="secondary" size="sm" (onClick)="retryEditLoad.emit()">{{ 'audit.retry' | t }}</ui-button>
      </div>
      <fieldset body class="modal-form modal-form-fieldset task-edit-form" [disabled]="isSubmitting" *ngIf="editingTask as task">
        <!-- Title Input (Required) -->
        <div class="form-group">
          <div class="label-row">
            <label class="clean-label" for="task-edit-title">{{ 'task.title' | t }}</label>
            <span class="req-tag">{{ 'projects.obyazatelnoe_pole' | t }}</span>
          </div>
          <input
            id="task-edit-title"
            name="taskEditTitle"
            type="text"
            class="clean-input title-input"
            required
            [attr.aria-invalid]="isEditSubmitted && !editForm.title.trim()"
            [attr.aria-describedby]="isEditSubmitted && !editForm.title.trim() ? 'task-edit-title-error' : null"
            [class.input-error]="isEditSubmitted && !editForm.title.trim()"
            [(ngModel)]="editForm.title"
          />
          <span id="task-edit-title-error" class="error-msg" *ngIf="isEditSubmitted && !editForm.title.trim()">
            {{ 'tasks.nazvanie_zadachi_ne_mozhet_byt_pustym' | t }}
          </span>
        </div>

        <!-- Visual Type Selector Chips -->
        <div class="form-group">
          <div class="label-row">
            <span class="clean-label">{{ 'tasks.tip_zadachi' | t }}</span>
          </div>
          <div class="type-chips-selector" role="group" [attr.aria-label]="'tasks.tip_zadachi' | t">
            <button
              *ngFor="let ty of taskTypes"
              type="button"
              class="type-chip-btn"
              [class.active]="editForm.taskType === ty.code"
              [attr.aria-pressed]="editForm.taskType === ty.code"
              (click)="editForm.taskType = ty.code"
              [style.--chip-color]="ty.color"
            >
              <span class="material-symbols-outlined" aria-hidden="true">{{ ty.icon }}</span>
              <span>{{ ty.name }}</span>
            </button>
          </div>
        </div>

        <!-- Visual Priority Selector Pills -->
        <div class="form-group">
          <div class="label-row">
            <span class="clean-label">{{ 'common.priority' | t }}</span>
          </div>
          <div class="priority-chips-selector" role="group" [attr.aria-label]="'tasks.prioritet_zadachi' | t">
            <button
              type="button"
              class="prio-chip-btn prio-low"
              [class.active]="editForm.priority === 'low'"
              [attr.aria-pressed]="editForm.priority === 'low'"
              (click)="editForm.priority = 'low'"
            >
              {{ 'task.priority.low' | t }}
            </button>
            <button
              type="button"
              class="prio-chip-btn prio-medium"
              [class.active]="editForm.priority === 'medium'"
              [attr.aria-pressed]="editForm.priority === 'medium'"
              (click)="editForm.priority = 'medium'"
            >
              {{ 'tasks.sredniy' | t }}
            </button>
            <button
              type="button"
              class="prio-chip-btn prio-high"
              [class.active]="editForm.priority === 'high'"
              [attr.aria-pressed]="editForm.priority === 'high'"
              (click)="editForm.priority = 'high'"
            >
              {{ 'task.priority.high' | t }}
            </button>
            <button
              type="button"
              class="prio-chip-btn prio-critical"
              [class.active]="editForm.priority === 'critical'"
              [attr.aria-pressed]="editForm.priority === 'critical'"
              (click)="editForm.priority = 'critical'"
            >
              {{ 'tasks.kriticheskiy' | t }}
            </button>
          </div>
        </div>

        <div class="form-grid-2">
          <!-- Project Selector -->
          <div class="form-group">
            <div class="label-row">
              <label class="clean-label" for="task-edit-project">{{ 'projects.proekt' | t }}</label>
            </div>
            <select id="task-edit-project" name="taskEditProject" class="clean-input" [(ngModel)]="editForm.projectId">
              <option [ngValue]="null">{{ 'tasks.bez_proekta' | t }}</option>
              <option *ngFor="let p of projects" [ngValue]="p.id">{{ p.name }}</option>
            </select>
          </div>

          <!-- Parent Task (Searchable Select) -->
          <div class="form-group">
            <div class="label-row">
              <span class="clean-label">{{ 'task.parent' | t }}</span>
            </div>
            <ui-searchable-select
              [options]="getAvailableParentTaskOptions(task.id)"
              [selectedId]="editForm.parentTaskId"
              [ariaLabel]="'task.parent' | t"
              (selectedIdChange)="editForm.parentTaskId = $event"
              [placeholder]="'tasks.bez_roditelya_kornevaya_zadacha' | t"
              [searchPlaceholder]="'tasks.poisk_zadachi_po_id_ili_nazvaniyu' | t"
              [emptyLabel]="'tasks.without_parent' | t"
              [remoteSearch]="true"
              [loading]="parentLookupLoading"
              [loadError]="parentLookupError"
              [hasMore]="parentLookupHasMore"
              (searchChange)="parentSearch.emit($event)"
              (loadMore)="parentLoadMore.emit()"
              (retry)="parentRetry.emit()"
            ></ui-searchable-select>
          </div>
        </div>

        <div class="form-grid-2">
          <!-- Responsible User (Searchable Select) -->
          <div class="form-group">
            <div class="label-row">
              <span class="clean-label">{{ 'task.responsible' | t }}</span>
            </div>
            <ui-searchable-select
              [options]="responsibleUserOptions"
              [selectedId]="editForm.responsibleUserId"
              [ariaLabel]="'task.responsible' | t"
              (selectedIdChange)="editForm.responsibleUserId = $event"
              [placeholder]="'tasks.vyberite_otvetstvennogo' | t"
              [searchPlaceholder]="'tasks.poisk_sotrudnika_po_imeni_ili_loginu' | t"
              [emptyLabel]="'common.not_assigned' | t"
              [remoteSearch]="true"
              [loading]="responsibleLookupLoading"
              [loadError]="responsibleLookupError"
              [hasMore]="responsibleLookupHasMore"
              (searchChange)="responsibleSearch.emit($event)"
              (loadMore)="responsibleLoadMore.emit()"
              (retry)="responsibleRetry.emit()"
            ></ui-searchable-select>
          </div>

          <!-- Deadlines: End Date / Deadline -->
          <div class="form-group">
            <div class="label-row">
              <label class="clean-label" for="task-edit-deadline">{{ 'tasks.srok_sdachi_dedlayn' | t }}</label>
            </div>
            <input id="task-edit-deadline" name="taskEditDeadline" type="datetime-local" class="clean-input font-mono" [(ngModel)]="editForm.endTime" />
          </div>
        </div>

        <!-- Observers Searchable Multi-Select Tags Input -->
        <div class="form-group">
          <div class="label-row">
            <span class="clean-label">{{ 'tasks.nablyudateli_poluchayut_uvedomleniya' | t }}</span>
          </div>
          <ui-user-multi-select
            [users]="observerUsers"
            [selectedUserIds]="editForm.observerUserIds"
            [ariaLabel]="'tasks.nablyudateli' | t"
            (selectedUserIdsChange)="editForm.observerUserIds = $event"
            [placeholder]="'tasks.nazhmite_dlya_dobavleniya_nablyudateley' | t"
            [searchPlaceholder]="'tasks.poisk_sotrudnika' | t"
            [remoteSearch]="true"
            [loading]="observerLookupLoading"
            [loadError]="observerLookupError"
            [hasMore]="observerLookupHasMore"
            (searchChange)="observerSearch.emit($event)"
            (loadMore)="observerLoadMore.emit()"
            (retry)="observerRetry.emit()"
          ></ui-user-multi-select>
        </div>

        <!-- RichText Markdown Editor for Description -->
        <div class="form-group">
          <div class="label-row">
            <span class="clean-label">{{ 'projects.opisanie' | t }}</span>
          </div>
          <ui-markdown-editor
            [value]="editForm.descriptionMarkdown"
            [ariaLabel]="'projects.opisanie' | t"
            (valueChange)="editForm.descriptionMarkdown = $event"
            [rows]="4"
          ></ui-markdown-editor>
        </div>

        <!-- Custom Dynamic Fields -->
        <div class="custom-fields-section" *ngIf="taskCustomFields.length > 0">
          <h4 class="custom-fields-title">{{ 'nav.custom_fields' | t }}</h4>
          <ui-custom-fields
            [fields]="taskCustomFields"
            [(values)]="editForm.attributes"
          ></ui-custom-fields>
        </div>
      </fieldset>
      <div footer>
        <ui-button variant="secondary" size="md" [disabled]="isSubmitting" (onClick)="close.emit()">{{ editLoadError ? ('audit.zakryt' | t) : ('common.cancel' | t) }}</ui-button>
        <ui-button *ngIf="editingTask" variant="primary" size="md" [loading]="isSubmitting" (onClick)="submit.emit()">{{ 'tasks.sohranit_izmeneniya' | t }}</ui-button>
      </div>
    </ui-modal>

    <ui-modal
      [isOpen]="isEditDiscardConfirmationOpen"
      [title]="'tasks.discard_edit_title' | t"
      size="sm"
      (close)="cancelDiscard.emit()"
    >
      <div body class="dictionary-delete-body">
        <p>{{ 'tasks.discard_edit_message' | t }}</p>
      </div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="cancelDiscard.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="danger" size="md" (onClick)="confirmDiscard.emit()">{{ 'tasks.discard_edit_action' | t }}</ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    .modal-form { display: flex; flex-direction: column; gap: 14px; }
    .modal-form-fieldset { border: none; padding: 0; margin: 0; min-width: 0; }
    .modal-form-fieldset:disabled { opacity: 0.75; }
    .form-group { display: flex; flex-direction: column; gap: 4px; }
    .label-row { display: flex; align-items: center; justify-content: space-between; }
    .clean-label { font-size: 12px; font-weight: 600; color: var(--text-main); }
    .req-tag { font-size: 10px; color: var(--text-muted); }
    .clean-input {
      height: 34px;
      padding: 6px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-size: 13px;
      outline: none;
      transition: border-color 0.12s ease;
    }
    .clean-input:focus { border-color: var(--primary); }
    .title-input { font-size: 14px; font-weight: 500; }
    .input-error { border-color: var(--danger); }
    .error-msg { font-size: 11px; color: var(--danger); margin-top: 2px; }
    .form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 640px) { .form-grid-2 { grid-template-columns: 1fr; } }

    .type-chips-selector {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .type-chip-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-xs);
      background-color: var(--bg-surface);
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .type-chip-btn .material-symbols-outlined { font-size: 16px; color: var(--chip-color); }
    .type-chip-btn:hover { border-color: var(--chip-color); color: var(--text-main); }
    .type-chip-btn.active {
      border-color: var(--chip-color);
      background-color: var(--bg-hover);
      color: var(--text-main);
      font-weight: 600;
      box-shadow: 0 0 0 1px var(--chip-color);
    }

    .priority-chips-selector {
      display: flex;
      gap: 6px;
      background-color: var(--bg-hover);
      padding: 3px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
    }
    .prio-chip-btn {
      flex: 1;
      border: none;
      background: transparent;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      border-radius: var(--radius-xs);
      cursor: pointer;
      transition: all 0.1s ease;
      text-align: center;
    }
    .prio-chip-btn.active {
      background-color: var(--bg-surface);
      font-weight: 600;
      box-shadow: var(--shadow-sm);
    }
    .prio-chip-btn.prio-low.active { color: #10b981; }
    .prio-chip-btn.prio-medium.active { color: var(--text-main); }
    .prio-chip-btn.prio-high.active { color: var(--warning); }
    .prio-chip-btn.prio-critical.active { color: var(--danger); }

    .custom-fields-section {
      border-top: 1px dashed var(--border-color);
      padding-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .custom-fields-title { font-size: 12px; font-weight: 600; color: var(--text-muted); margin: 0; display: flex; align-items: center; gap: 6px; }
    .font-mono { font-family: ui-monospace, monospace; }
    .dictionary-delete-body { padding: 10px 0; font-size: 13px; color: var(--text-main); }
  `]
})
export class TaskEditModalComponent {
  @Input() isOpen = false;
  @Input() editingTask: Task | null = null;
  @Input() editForm: any = {};
  @Input() editLoading = false;
  @Input() editLoadError = false;
  @Input() isSubmitting = false;
  @Input() isEditSubmitted = false;
  @Input() isEditDiscardConfirmationOpen = false;
  @Input() taskTypes: TaskType[] = [];
  @Input() projects: Project[] = [];
  @Input() parentTaskOptions: SelectOption[] = [];
  @Input() parentLookupLoading = false;
  @Input() parentLookupError = false;
  @Input() parentLookupHasMore = false;
  @Input() responsibleUserOptions: SelectOption[] = [];
  @Input() responsibleLookupLoading = false;
  @Input() responsibleLookupError = false;
  @Input() responsibleLookupHasMore = false;
  @Input() observerUsers: User[] = [];
  @Input() observerLookupLoading = false;
  @Input() observerLookupError = false;
  @Input() observerLookupHasMore = false;
  @Input() taskCustomFields: CustomField[] = [];

  @Input() getAvailableParentTaskOptions!: (taskId: number) => SelectOption[];

  @Output() close = new EventEmitter<void>();
  @Output() submit = new EventEmitter<void>();
  @Output() retryEditLoad = new EventEmitter<void>();
  @Output() cancelDiscard = new EventEmitter<void>();
  @Output() confirmDiscard = new EventEmitter<void>();
  @Output() parentSearch = new EventEmitter<string>();
  @Output() parentLoadMore = new EventEmitter<void>();
  @Output() parentRetry = new EventEmitter<void>();
  @Output() responsibleSearch = new EventEmitter<string>();
  @Output() responsibleLoadMore = new EventEmitter<void>();
  @Output() responsibleRetry = new EventEmitter<void>();
  @Output() observerSearch = new EventEmitter<string>();
  @Output() observerLoadMore = new EventEmitter<void>();
  @Output() observerRetry = new EventEmitter<void>();
}
