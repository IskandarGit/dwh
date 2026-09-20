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
import { Project, TaskType } from '../../../core/models/task.models';
import { User } from '../../../core/models/auth.models';

@Component({
  selector: 'app-task-create-modal',
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
      [title]="createForm.parentTaskId ? ('tasks.create_subtask_for' | t:{id: createForm.parentTaskId}) : ('tasks.create_new_task' | t)"
      size="lg"
      [dismissible]="!isSubmitting"
      (close)="close.emit()"
    >
      <fieldset body class="modal-form modal-form-fieldset task-create-form" [disabled]="isSubmitting">
        <!-- Title Input (Required) -->
        <div class="form-group">
          <div class="label-row">
            <label class="clean-label" for="task-create-title">{{ 'task.title' | t }}</label>
            <span class="req-tag">{{ 'projects.obyazatelnoe_pole' | t }}</span>
          </div>
          <input
            id="task-create-title"
            name="taskCreateTitle"
            type="text"
            class="clean-input title-input"
            required
            [attr.aria-invalid]="isCreateSubmitted && !createForm.title.trim()"
            [attr.aria-describedby]="isCreateSubmitted && !createForm.title.trim() ? 'task-create-title-error' : null"
            [class.input-error]="isCreateSubmitted && !createForm.title.trim()"
            [(ngModel)]="createForm.title"
            [placeholder]="'tasks.kratkaya_i_yasnaya_formulirovka_zadachi' | t"
          />
          <span id="task-create-title-error" class="error-msg" *ngIf="isCreateSubmitted && !createForm.title.trim()">
            {{ 'tasks.pozhaluysta_ukazhite_nazvanie_zadachi' | t }}
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
              [class.active]="createForm.taskType === ty.code"
              [attr.aria-pressed]="createForm.taskType === ty.code"
              (click)="createForm.taskType = ty.code"
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
              [class.active]="createForm.priority === 'low'"
              [attr.aria-pressed]="createForm.priority === 'low'"
              (click)="createForm.priority = 'low'"
            >
              {{ 'task.priority.low' | t }}
            </button>
            <button
              type="button"
              class="prio-chip-btn prio-medium"
              [class.active]="createForm.priority === 'medium'"
              [attr.aria-pressed]="createForm.priority === 'medium'"
              (click)="createForm.priority = 'medium'"
            >
              {{ 'tasks.sredniy' | t }}
            </button>
            <button
              type="button"
              class="prio-chip-btn prio-high"
              [class.active]="createForm.priority === 'high'"
              [attr.aria-pressed]="createForm.priority === 'high'"
              (click)="createForm.priority = 'high'"
            >
              {{ 'task.priority.high' | t }}
            </button>
            <button
              type="button"
              class="prio-chip-btn prio-critical"
              [class.active]="createForm.priority === 'critical'"
              [attr.aria-pressed]="createForm.priority === 'critical'"
              (click)="createForm.priority = 'critical'"
            >
              {{ 'tasks.kriticheskiy' | t }}
            </button>
          </div>
        </div>

        <div class="form-grid-2">
          <!-- Project Selector -->
          <div class="form-group">
            <div class="label-row">
              <label class="clean-label" for="task-create-project">{{ 'projects.proekt' | t }}</label>
            </div>
            <select id="task-create-project" name="taskCreateProject" class="clean-input" [(ngModel)]="createForm.projectId">
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
              [options]="parentTaskOptions"
              [selectedId]="createForm.parentTaskId"
              [ariaLabel]="'task.parent' | t"
              (selectedIdChange)="createForm.parentTaskId = $event"
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
              [selectedId]="createForm.responsibleUserId"
              [ariaLabel]="'task.responsible' | t"
              (selectedIdChange)="createForm.responsibleUserId = $event"
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
              <label class="clean-label" for="task-create-deadline">{{ 'tasks.srok_sdachi_dedlayn' | t }}</label>
            </div>
            <input id="task-create-deadline" name="taskCreateDeadline" type="datetime-local" class="clean-input font-mono" [(ngModel)]="createForm.endTime" />
          </div>
        </div>

        <!-- Observers Searchable Multi-Select Tags Input -->
        <div class="form-group">
          <div class="label-row">
            <span class="clean-label">{{ 'tasks.nablyudateli_poluchayut_uvedomleniya' | t }}</span>
          </div>
          <ui-user-multi-select
            [users]="observerUsers"
            [selectedUserIds]="createForm.observerUserIds"
            [ariaLabel]="'tasks.nablyudateli' | t"
            (selectedUserIdsChange)="createForm.observerUserIds = $event"
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
            [value]="createForm.descriptionMarkdown"
            [ariaLabel]="'projects.opisanie' | t"
            (valueChange)="createForm.descriptionMarkdown = $event"
            [placeholder]="'tasks.kontekst_kriterii_gotovnosti_zadachi_ssylki_podd' | t"
            [rows]="4"
          ></ui-markdown-editor>
        </div>

        <!-- Custom Dynamic Fields -->
        <div class="custom-fields-section" *ngIf="taskCustomFields.length > 0">
          <h4 class="custom-fields-title">
            <span>{{ 'nav.custom_fields' | t }}</span>
          </h4>
          <ui-custom-fields
            [fields]="taskCustomFields"
            [(values)]="createForm.attributes"
          ></ui-custom-fields>
        </div>

        <div class="custom-fields-empty-tip" *ngIf="taskCustomFields.length === 0">
          <span class="material-symbols-outlined tip-icon" aria-hidden="true">extension</span>
          <span class="tip-text">{{ 'tasks.nuzhny_specificheskie_polya_byudzhet_nomer_dogov' | t }} <strong>{{ 'nav.custom_fields' | t }}</strong>.</span>
        </div>
      </fieldset>
      <div footer>
        <ui-button variant="secondary" size="md" [disabled]="isSubmitting" (onClick)="close.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="primary" size="md" [loading]="isSubmitting" (onClick)="submit.emit()">{{ 'tasks.sozdat_zadachu' | t }}</ui-button>
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
    .custom-fields-empty-tip {
      background: rgba(99, 102, 241, 0.06);
      border: 1px dashed rgba(99, 102, 241, 0.2);
      border-radius: 8px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 6px;
    }
    .custom-fields-empty-tip .tip-icon { font-size: 18px; color: var(--primary); flex-shrink: 0; }
    .custom-fields-empty-tip .tip-text { line-height: 1.4; }
    .font-mono { font-family: ui-monospace, monospace; }
  `]
})
export class TaskCreateModalComponent {
  @Input() isOpen = false;
  @Input() createForm: any = {};
  @Input() isSubmitting = false;
  @Input() isCreateSubmitted = false;
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

  @Output() close = new EventEmitter<void>();
  @Output() submit = new EventEmitter<void>();
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
