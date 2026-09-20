import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, I18nService } from '../../../core/services/i18n.service';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiMarkdownViewComponent } from '../../../shared/ui/ui-markdown-view.component';
import { UiFileUploadComponent } from '../../../shared/ui/ui-file-upload.component';
import { CustomField } from '../../../core/models/custom-field.models';
import { Task, Project, TaskStatus, TaskType, TaskMember, TaskComment, TaskFile } from '../../../core/models/task.models';
import { safeNumericRecordId } from '../../../core/services/search-target';

@Component({
  selector: 'app-task-detail-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    UiModalComponent,
    UiButtonComponent,
    UiMarkdownViewComponent,
    UiFileUploadComponent
  ],
  template: `
    <ui-modal
      [isOpen]="isOpen"
      [title]="'tasks.task_number' | t:{id: detailRecordId || ''}"
      size="lg"
      (close)="close.emit()"
    >
      <div body class="request-state request-loading" *ngIf="detailLoading" role="status">
        {{ 'tasks.detail_loading' | t }}
      </div>

      <div body class="request-state request-error" *ngIf="detailLoadError" role="alert">
        <span>{{ (detailNotFound ? 'search.record_not_found' : 'tasks.detail_load_error') | t }}</span>
        <ui-button *ngIf="!detailNotFound" variant="secondary" size="sm" (onClick)="retryTaskDetails.emit()">{{ 'audit.retry' | t }}</ui-button>
        <ui-button *ngIf="detailNotFound" variant="secondary" size="sm" (onClick)="close.emit()">{{ 'search.back_to_list' | t }}</ui-button>
      </div>

      <div body class="task-details-view" [attr.data-record-id]="detailRecordId" *ngIf="!detailLoading && !detailLoadError && selectedTask as t">
        <p *ngIf="!safeRecordId(t.id)" role="status">{{ 'search.record_readonly_id' | t }}</p>
        <!-- Ancestor Breadcrumbs Trail -->
        <div class="ancestor-trail" *ngIf="taskAncestors.length > 0">
          <span class="trail-label">{{ 'tasks.ierarhiya' | t }}</span>
          <ng-container *ngFor="let anc of taskAncestors">
            <button type="button" class="anc-link" [disabled]="!safeRecordId(anc.id)" (click)="openTaskDetails.emit(anc)">
              #{{ anc.id }} {{ anc.title }}
            </button>
            <span class="anc-sep" aria-hidden="true">›</span>
          </ng-container>
          <span class="anc-current">#{{ detailRecordId }} {{ t.title }}</span>
        </div>

        <!-- Overdue Notice Banner -->
        <div class="overdue-banner" *ngIf="isOverdue(t.endTime, t.statusId)">
          <span class="material-symbols-outlined">error</span>
          <span>{{ 'tasks.deadline_expired_at' | t:{date: (t.endTime | date:'dd.MM.yyyy HH:mm') || ''} }}</span>
        </div>

        <div class="details-2col-layout">
          <!-- Left Column (Main) -->
          <div class="details-main-col">
            <div class="detail-header-group">
              <h2 class="detail-main-title">{{ t.title }}</h2>
            </div>

            <!-- Description (Rich Markdown View) -->
            <div class="detail-section">
              <h4 class="section-label">{{ 'tasks.opisanie_zadachi' | t }}</h4>
              <div class="description-card" *ngIf="t.descriptionMarkdown">
                <ui-markdown-view [content]="t.descriptionMarkdown"></ui-markdown-view>
              </div>
              <div class="description-card empty-desc text-muted" *ngIf="!t.descriptionMarkdown">
                {{ 'tasks.opisanie_otsutstvuet_nazhmite_redaktirovat_chtob' | t }}
              </div>
            </div>

            <!-- Subtasks Section -->
            <div class="detail-section">
              <div class="section-header-between">
                <h4 class="section-label">{{ 'tasks.subtasks_count' | t:{count: taskSubtasks.length} }}</h4>
                <button
                  *ngIf="canCreateTask && safeRecordId(t.id)"
                  type="button"
                  class="add-subtask-btn"
                  (click)="openAddSubtask.emit(t)"
                >
                  <span class="material-symbols-outlined">add</span>
                  {{ 'tasks.dobavit_podzadachu' | t }}
                </button>
              </div>

              <div class="subtasks-list" *ngIf="taskSubtasks.length > 0">
                <button
                  type="button"
                  *ngFor="let sub of taskSubtasks"
                  class="subtask-row"
                  [disabled]="!safeRecordId(sub.id)"
                  [attr.aria-label]="'tasks.open_subtask_named' | t:{id: sub.id, title: sub.title}"
                  [class.row-overdue]="isOverdue(sub.endTime, sub.statusId)"
                  (click)="openTaskDetails.emit(sub)"
                >
                  <span class="subtask-type" [style.color]="getTypeColor(sub)">
                    <span class="material-symbols-outlined type-icon">{{ getTypeIcon(sub) }}</span>
                  </span>
                  <span class="font-mono text-muted text-xs">#{{ sub.id }}</span>
                  <span class="subtask-title">{{ sub.title }}</span>
                  <span class="inline-status-badge status-label">
                    <span class="status-dot" [style.background-color]="getStatusColor(sub.statusId)" aria-hidden="true"></span>
                    {{ getStatusName(sub.statusId) }}
                  </span>
                  <span class="priority-pill" [attr.data-priority]="sub.priority">
                    {{ getPriorityLabel(sub.priority) }}
                  </span>
                </button>
              </div>
              <div *ngIf="taskSubtasks.length === 0" class="no-subtasks-hint text-muted">
                {{ 'tasks.u_etoy_zadachi_poka_net_podzadach' | t }}
              </div>
            </div>

            <!-- Attachments & Files Section -->
            <div class="detail-section files-section">
              <h4 class="section-label">{{ 'tasks.attachments_count' | t:{count: taskFiles.length} }}</h4>
              <ui-file-upload
                [files]="taskFiles"
                [canUpload]="canUpdateTask && safeRecordId(t.id)"
                [canDelete]="canUpdateTask && safeRecordId(t.id)"
                (fileAttached)="fileAttached.emit($event)"
                (fileRemoved)="fileRemoved.emit($event)"
              ></ui-file-upload>
            </div>

            <!-- Comments Feed -->
            <div class="detail-section comments-section">
              <h4 class="section-label">{{ 'tasks.comments_count' | t:{count: comments.length} }}</h4>

              <div class="request-state request-loading" *ngIf="commentsLoading" role="status">
                {{ 'tasks.comments_loading' | t }}
              </div>
              <div class="request-state request-error" *ngIf="commentsLoadError" role="alert">
                <span>{{ 'tasks.comments_load_error' | t }}</span>
                <ui-button variant="secondary" size="sm" (onClick)="retryComments.emit()">{{ 'audit.retry' | t }}</ui-button>
              </div>

              <div class="comments-feed" *ngIf="!commentsLoading && !commentsLoadError">
                <div *ngFor="let c of comments" class="comment-card">
                  <div class="comment-top">
                    <div class="comment-author-badge">
                      <span class="avatar-mini">{{ getInitials(c.userName || undefined) }}</span>
                      <span class="comment-author">{{ c.userName || ('tasks.removed_comment_author' | t) }} <span *ngIf="c.userLogin" class="text-muted">&#64;{{ c.userLogin }}</span></span>
                    </div>
                    <span class="comment-time tabular-nums">{{ c.createdAt | date:'dd.MM.yyyy HH:mm' }}</span>
                  </div>
                  <div class="comment-text">
                    <ui-markdown-view [content]="c.textMarkdown || c.commentMarkdown"></ui-markdown-view>
                  </div>
                </div>
                <div *ngIf="comments.length === 0" class="no-comments-hint text-muted">
                  {{ 'tasks.kommentariev_poka_net' | t }}
                </div>
              </div>

              <div class="add-comment-box" *ngIf="canCommentTask">
                <textarea
                  class="comment-textarea"
                  [attr.aria-label]="'tasks.comment_task_aria' | t:{id: t.id}"
                  rows="2"
                  [placeholder]="'tasks.napisat_kommentariy_k_zadache_ctrl_enter_dlya_ot' | t"
                  [ngModel]="commentDraft"
                  (ngModelChange)="commentDraftChange.emit($event)"
                  [disabled]="isCommentSubmitting"
                  (keydown.ctrl.enter)="submitComment.emit()"
                ></textarea>
                <ui-button variant="primary" size="sm" icon="send" [loading]="isCommentSubmitting" (onClick)="submitComment.emit()">
                  {{ 'tasks.otpravit' | t }}
                </ui-button>
              </div>
            </div>
          </div>

          <!-- Right Column (Properties Sidebar) -->
          <div class="details-side-col">
            <div class="side-card">
              <div class="side-prop-row">
                <span class="prop-k">{{ 'common.status' | t }}</span>
                <div class="prop-v">
                  <span class="status-dot" [style.background-color]="getStatusColor(t.statusId)" aria-hidden="true"></span>
                  <select
                    class="clean-select status-select"
                    [ngModel]="t.statusId"
                    (ngModelChange)="statusChange.emit({ taskId: t.id, statusId: $event })"
                    [disabled]="!canUpdateTask || !safeRecordId(t.id)"
                    [attr.aria-label]="'tasks.task_status_aria' | t:{id: t.id}"
                  >
                    <option *ngFor="let s of statuses" [ngValue]="s.id">{{ s.name }}</option>
                  </select>
                </div>
              </div>

              <div class="side-prop-row">
                <span class="prop-k">{{ 'tasks.tip_zadachi' | t }}</span>
                <div class="prop-v">
                  <span class="task-type-badge" [style.color]="getTypeColor(t)" [style.background-color]="getTypeBg(t)">
                    <span class="material-symbols-outlined type-icon">{{ getTypeIcon(t) }}</span>
                    {{ getTypeLabel(t) }}
                  </span>
                </div>
              </div>

              <div class="side-prop-row">
                <span class="prop-k">{{ 'common.priority' | t }}</span>
                <div class="prop-v">
                  <span class="priority-pill" [attr.data-priority]="t.priority">
                    {{ getPriorityLabel(t.priority) }}
                  </span>
                </div>
              </div>

              <div class="side-prop-row">
                <span class="prop-k">{{ 'projects.proekt' | t }}</span>
                <div class="prop-v">{{ getProjectName(t.projectId) || ('tasks.without_project' | t) }}</div>
              </div>

              <div class="side-prop-row" *ngIf="t.parentTaskId">
                <span class="prop-k">{{ 'tasks.roditel' | t }}</span>
                <div class="prop-v font-mono text-xs">#{{ t.parentTaskId }}</div>
              </div>

              <div class="side-prop-row">
                <span class="prop-k">{{ 'tasks.dedlayn' | t }}</span>
                <div class="prop-v" [class.text-danger]="isOverdue(t.endTime, t.statusId)">
                  {{ t.endTime ? (t.endTime | date:'dd.MM.yyyy HH:mm') : ('common.not_set' | t) }}
                </div>
              </div>

              <div class="side-prop-row" *ngIf="t.beginTime">
                <span class="prop-k">{{ 'tasks.data_nachala' | t }}</span>
                <div class="prop-v">{{ t.beginTime | date:'dd.MM.yyyy HH:mm' }}</div>
              </div>

              <div class="side-prop-row">
                <span class="prop-k">{{ 'iam.sozdana' | t }}</span>
                <div class="prop-v text-muted">{{ t.createdAt | date:'dd.MM.yyyy HH:mm' }}</div>
              </div>
            </div>

            <!-- Members Card -->
            <div class="side-card" *ngIf="taskMembers.length > 0">
              <h5 class="side-card-title">{{ 'tasks.uchastniki' | t }}</h5>
              <div class="members-stack">
                <div *ngFor="let m of taskMembers" class="member-stack-item">
                  <span class="member-role-badge" [attr.data-role]="m.involveKind || m.involvementKind">
                    {{ getInvolveKindLabel(m.involveKind || m.involvementKind) }}
                  </span>
                  <span class="member-name">{{ m.userName }}</span>
                  <span class="member-login text-muted">&#64;{{ m.userLogin }}</span>
                </div>
              </div>
            </div>

            <!-- Custom Attributes Card -->
            <div class="side-card" *ngIf="hasAttributes(t.attributes)">
              <h5 class="side-card-title">{{ 'nav.custom_fields' | t }}</h5>
              <div class="attributes-stack">
                <div *ngFor="let item of formatAttributes(t.attributes)" class="attr-stack-item">
                  <span class="attr-k">{{ item.key }}:</span>
                  <span class="attr-v">{{ item.value }}</span>
                </div>
              </div>
            </div>

            <button
              *ngIf="canUpdateTask && safeRecordId(t.id)"
              type="button"
              class="side-edit-btn"
              (click)="openEditModal.emit(t)"
            >
              <span class="material-symbols-outlined">edit</span>
              {{ 'tasks.redaktirovat_zadachu' | t }}
            </button>
          </div>
        </div>
      </div>

      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="close.emit()">{{ 'audit.zakryt' | t }}</ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    .task-details-view { display: flex; flex-direction: column; gap: 14px; }
    .ancestor-trail {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      font-size: 11px;
      background-color: var(--bg-hover);
      padding: 5px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
    }
    .trail-label { color: var(--text-muted); font-weight: 500; }
    .anc-link {
      border: 0;
      background: transparent;
      color: var(--primary);
      cursor: pointer;
      font: inherit;
      padding: 0;
      text-decoration: underline;
    }
    .anc-sep { color: var(--text-muted); }
    .anc-current { font-weight: 600; color: var(--text-main); }
    .overdue-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background-color: var(--danger-bg);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: var(--radius-sm);
      color: var(--danger);
      font-size: 12px;
      font-weight: 500;
    }
    .overdue-banner .material-symbols-outlined { font-size: 18px; }
    .details-2col-layout {
      display: grid;
      grid-template-columns: 1fr 280px;
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 768px) {
      .details-2col-layout { grid-template-columns: 1fr; }
    }
    .details-main-col { display: flex; flex-direction: column; gap: 16px; }
    .detail-main-title { font-size: 18px; font-weight: 600; margin: 0; color: var(--text-main); line-height: 1.35; }
    .detail-section { display: flex; flex-direction: column; gap: 6px; }
    .section-header-between { display: flex; align-items: center; justify-content: space-between; }
    .section-label { font-size: 12px; font-weight: 600; color: var(--text-muted); margin: 0; }
    .description-card {
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
    }
    .empty-desc { font-style: italic; }
    .add-subtask-btn {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      border: 1px solid var(--border-color);
      background-color: var(--bg-hover);
      color: var(--primary);
      padding: 2px 8px;
      border-radius: var(--radius-xs);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
    }
    .add-subtask-btn .material-symbols-outlined { font-size: 14px; }
    .add-subtask-btn:hover { border-color: var(--primary); }
    .subtasks-list { display: flex; flex-direction: column; gap: 4px; }
    .subtask-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-xs);
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
      color: inherit;
      text-align: left;
      width: 100%;
      transition: background 0.1s ease;
    }
    .subtask-row:hover { border-color: var(--primary); }
    .subtask-title { flex: 1; font-weight: 500; }
    .inline-status-badge { font-size: 11px; font-weight: 500; }
    .status-label { display: inline-flex; align-items: center; gap: 4px; color: var(--text-main); }
    .no-subtasks-hint { font-size: 12px; font-style: italic; padding: 4px 0; }
    .comments-section { border-top: 1px solid var(--border-color); padding-top: 12px; }
    .comments-feed {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 220px;
      overflow-y: auto;
    }
    .comment-card {
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .comment-top { display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
    .comment-author-badge { display: flex; align-items: center; gap: 5px; }
    .avatar-mini {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background-color: var(--primary);
      color: #fff;
      font-size: 9px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .comment-author { font-weight: 600; color: var(--text-main); }
    .comment-time { color: var(--text-muted); font-size: 10px; }
    .comment-text { font-size: 12px; color: var(--text-main); }
    .add-comment-box {
      display: flex;
      gap: 8px;
      align-items: flex-end;
      margin-top: 6px;
    }
    .comment-textarea {
      flex: 1;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background-color: var(--bg-surface);
      color: var(--text-main);
      padding: 6px 8px;
      font-size: 12px;
      font-family: inherit;
      outline: none;
      resize: vertical;
    }
    .details-side-col { display: flex; flex-direction: column; gap: 12px; }
    .side-card {
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .side-card-title { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin: 0; }
    .side-prop-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
    .prop-k { color: var(--text-muted); font-size: 11px; flex-shrink: 0; }
    .prop-v { font-weight: 500; text-align: right; word-break: break-all; }
    .members-stack { display: flex; flex-direction: column; gap: 4px; }
    .member-stack-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      background-color: var(--bg-surface);
      padding: 3px 6px;
      border-radius: 3px;
      border: 1px solid var(--border-color);
    }
    .member-role-badge {
      font-size: 9px;
      font-weight: 600;
      padding: 1px 4px;
      border-radius: 3px;
      background-color: rgba(99,102,241,0.15);
      color: var(--primary);
    }
    .member-role-badge[data-role="R"] { background-color: var(--warning-bg); color: var(--warning); }
    .member-role-badge[data-role="O"] { background-color: rgba(14,165,233,0.15); color: #0284c7; }
    .member-role-badge[data-role="A"] { background-color: rgba(16,185,129,0.15); color: var(--success); }
    .attributes-stack { display: flex; flex-direction: column; gap: 4px; }
    .attr-stack-item { display: flex; justify-content: space-between; font-size: 11px; }
    .side-edit-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      height: 32px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }
    .side-edit-btn:hover { border-color: var(--primary); color: var(--primary); }
    .side-edit-btn .material-symbols-outlined { font-size: 16px; }
    .font-mono { font-family: ui-monospace, monospace; }
    .text-muted { color: var(--text-muted); }
    .text-danger { color: var(--danger); }
    .text-xs { font-size: 11px; }
    .tabular-nums { font-variant-numeric: tabular-nums; }
    .clean-select {
      height: 26px;
      padding: 1px 6px;
      font-size: 11px;
      font-weight: 500;
      border-radius: 10px;
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-main);
      cursor: pointer;
      outline: none;
    }
    .clean-select:focus { border-color: var(--primary); }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .task-type-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      font-weight: 500;
      padding: 1px 6px;
      border-radius: 4px;
    }
    .task-type-badge .type-icon { font-size: 13px; }
    .priority-pill {
      font-size: 11px;
      font-weight: 500;
      padding: 2px 7px;
      border-radius: 10px;
      display: inline-block;
    }
    .priority-pill[data-priority="critical"] { background-color: var(--danger-bg); color: var(--danger); }
    .priority-pill[data-priority="high"] { background-color: var(--warning-bg); color: var(--warning); }
    .priority-pill[data-priority="medium"] { background-color: var(--bg-hover); color: var(--text-muted); }
    .priority-pill[data-priority="low"] { background-color: var(--bg-hover); color: var(--text-light); }
  `]
})
export class TaskDetailModalComponent {
  readonly safeRecordId = safeNumericRecordId;

  @Input() isOpen = false;
  @Input() selectedTask: Task | null = null;
  @Input() routeRecordId: string | null = null;
  @Input() detailRecordId: string | null = null;
  @Input() detailLoading = false;
  @Input() detailLoadError = false;
  @Input() detailNotFound = false;
  @Input() taskAncestors: Task[] = [];
  @Input() taskSubtasks: Task[] = [];
  @Input() taskFiles: TaskFile[] = [];
  @Input() comments: TaskComment[] = [];
  @Input() commentsLoading = false;
  @Input() commentsLoadError = false;
  @Input() taskMembers: TaskMember[] = [];
  @Input() taskCustomFields: CustomField[] = [];
  @Input() statuses: TaskStatus[] = [];
  @Input() projects: Project[] = [];
  @Input() taskTypes: TaskType[] = [];
  @Input() commentDraft = '';
  @Input() isCommentSubmitting = false;
  @Input() canCreateTask = false;
  @Input() canUpdateTask = false;
  @Input() canCommentTask = false;

  @Input() isOverdue!: (endTime: string | null | undefined, statusId: number) => boolean;
  @Input() getTypeColor!: (task: Task) => string;
  @Input() getTypeBg!: (task: Task) => string;
  @Input() getTypeIcon!: (task: Task) => string;
  @Input() getTypeLabel!: (task: Task) => string;
  @Input() getStatusName!: (statusId: number | null | undefined) => string;
  @Input() getStatusColor!: (statusId: number | null | undefined) => string;
  @Input() getPriorityLabel!: (priority: string) => string;
  @Input() getProjectName!: (projectId: number | null | undefined) => string | null;

  @Output() close = new EventEmitter<void>();
  @Output() retryTaskDetails = new EventEmitter<void>();
  @Output() openTaskDetails = new EventEmitter<Task>();
  @Output() openAddSubtask = new EventEmitter<Task>();
  @Output() openEditModal = new EventEmitter<Task>();
  @Output() statusChange = new EventEmitter<{ taskId: number; statusId: number }>();
  @Output() fileAttached = new EventEmitter<TaskFile>();
  @Output() fileRemoved = new EventEmitter<TaskFile>();
  @Output() retryComments = new EventEmitter<void>();
  @Output() commentDraftChange = new EventEmitter<string>();
  @Output() submitComment = new EventEmitter<void>();

  constructor(private readonly i18n: I18nService) {}

  getInvolveKindLabel(kind: string | undefined): string {
    switch (kind) {
      case 'R': return this.i18n.translate('task.responsible');
      case 'E': return this.i18n.translate('tasks.ispolnitel');
      case 'O': return this.i18n.translate('tasks.nablyudatel');
      case 'A': return this.i18n.translate('tasks.avtor');
      default: return this.i18n.translate('tasks.uchastnik');
    }
  }

  getInitials(name: string | undefined): string {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  hasAttributes(attrs: any): boolean {
    if (!attrs || typeof attrs !== 'object') return false;
    const keys = Object.keys(attrs).filter(k => k !== 'task_type');
    return keys.length > 0;
  }

  formatAttributes(attrs: any): Array<{ key: string; value: string }> {
    if (!this.hasAttributes(attrs)) return [];
    const fields = this.taskCustomFields;
    return Object.entries(attrs)
      .filter(([k]) => k !== 'task_type')
      .map(([k, v]) => {
        const field = fields.find(f => f.code === k);
        const keyLabel = field ? field.name : k;
        let valueStr = String(v ?? '');
        if (field?.fieldType === 'boolean') {
          valueStr = v === true || v === 'true'
            ? this.i18n.translate('common.yes')
            : this.i18n.translate('common.no');
        }
        return { key: keyLabel, value: valueStr };
      });
  }
}
