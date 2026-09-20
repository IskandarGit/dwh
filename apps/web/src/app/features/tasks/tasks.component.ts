import { Component, OnDestroy, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { canonicalRecordId, recordResponseMatches, safeNumericRecordId } from '../../core/services/search-target';
import { RecordNavigationDecision } from '../../core/guards/record-navigation.guard';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { ApiService } from '../../core/services/api.service';
import { PermissionService } from '../../core/services/permission.service';
import { ToastService } from '../../core/services/toast.service';
import { UiButtonComponent } from '../../shared/ui/ui-button.component';
import { SelectOption } from '../../shared/ui/ui-searchable-select.component';
import { UiPaginationComponent } from '../../shared/ui/ui-pagination.component';
import { Task, Project, TaskStatus, TaskType, TaskComment, TaskMember, TaskDetailResponse, TaskFile } from '../../core/models/task.models';
import { CustomField } from '../../core/models/custom-field.models';
import { User } from '../../core/models/auth.models';
import { AuthService } from '../../core/services/auth.service';
import { KeysetPage } from '../../core/models/common.models';
import { TranslatePipe, I18nService } from '../../core/services/i18n.service';
import { Subscription } from 'rxjs';
import { toLocalDateTime, toTaskInstant } from './task-form-value';
import { TaskDictionariesModalComponent } from './components/task-dictionaries-modal.component';
import { TaskKanbanViewComponent } from './components/task-kanban-view.component';
import { TaskTableViewComponent } from './components/task-table-view.component';
import { TaskFilterBarComponent } from './components/task-filter-bar.component';
import { TaskDetailModalComponent } from './components/task-detail-modal.component';
import { TaskCreateModalComponent } from './components/task-create-modal.component';
import { TaskEditModalComponent } from './components/task-edit-modal.component';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    FormsModule,
    UiButtonComponent,
    UiPaginationComponent,
    TaskDictionariesModalComponent,
    TaskKanbanViewComponent,
    TaskTableViewComponent,
    TaskFilterBarComponent,
    TaskDetailModalComponent,
    TaskCreateModalComponent,
    TaskEditModalComponent
  ],


  template: `
    <div class="tasks-page">
      <!-- Header -->
      <div class="view-header">
        <div class="header-left">
          <h1 class="view-title">{{ 'nav.tasks' | t }}</h1>
          <span class="count-badge">{{ 'tasks.loaded_count' | t:{count: tasks().length} }}</span>

          <!-- View Mode Switcher: Table / Kanban -->
          <div class="status-tabs" role="group" [attr.aria-label]="'tasks.rezhim_otobrazheniya_zadach' | t">
            <button
              type="button"
              class="status-tab"
              [class.active]="viewMode === 'table'"
              [attr.aria-pressed]="viewMode === 'table'"
              (click)="viewMode = 'table'"
              [title]="'tasks.tablichnyy_vid' | t"
            >
              <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">table_rows</span>
              <span>{{ 'projects.spisok' | t }}</span>
            </button>
            <button
              type="button"
              class="status-tab"
              [class.active]="viewMode === 'kanban'"
              [attr.aria-pressed]="viewMode === 'kanban'"
              (click)="viewMode = 'kanban'"
              [title]="'tasks.kanban_doska' | t"
            >
              <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">view_kanban</span>
              <span>{{ 'tasks.kanban' | t }}</span>
            </button>
          </div>
        </div>

        <div class="header-right">
          <!-- Dictionary Settings Button -->
          <button
            type="button"
            class="btn btn-secondary compact-secondary-action"
            [title]="'tasks.upravlenie_statusami_i_tipami_zadach' | t"
            (click)="openSettingsModal()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">tune</span>
            <span>{{ 'tasks.spravochniki' | t }}</span>
          </button>

          <!-- Export Dropdown -->
          <div class="export-dropdown-container" style="position: relative; display: inline-block;">
            <button
              type="button"
              class="btn btn-secondary compact-secondary-action"
              [title]="'tasks.export_all_accessible' | t"
              (click)="showExportMenu = !showExportMenu"
            >
              <span class="material-symbols-outlined" aria-hidden="true">download</span>
              <span>{{ 'analytics.eksport' | t }}</span>
              <span class="material-symbols-outlined" style="font-size: 16px;">arrow_drop_down</span>
            </button>
            <div class="export-popover" *ngIf="showExportMenu">
              <strong class="export-scope-title">{{ 'tasks.export_all_accessible' | t }}</strong>
              <span class="export-scope-note">{{ 'tasks.export_filters_not_applied' | t }}</span>
              <button type="button" class="export-item-btn" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 12px; background: none; border: none; width: 100%; text-align: left; cursor: pointer; color: var(--text-main);" (click)="exportTasks('xlsx')">
                <span class="material-symbols-outlined" style="color: var(--success); font-size: 18px;">table_view</span>
                <span>Excel (.xlsx)</span>
              </button>
              <button type="button" class="export-item-btn" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 12px; background: none; border: none; width: 100%; text-align: left; cursor: pointer; color: var(--text-main); border-top: 1px solid var(--border-subtle);" (click)="exportTasks('csv')">
                <span class="material-symbols-outlined" style="color: var(--primary); font-size: 18px;">description</span>
                <span>CSV (UTF-8)</span>
              </button>
            </div>
          </div>

          <!-- Create Task Button -->
          <ui-button
            *ngIf="canCreateTask()"
            variant="primary"
            size="md"
            icon="add"
            (onClick)="openCreateTaskModal()"
          >
            {{ 'task.new' | t }}
          </ui-button>
        </div>
      </div>

      <!-- Linear-Style Toolbar -->
      <app-task-filter-bar
        [activePreset]="activePreset"
        [searchQuery]="searchQuery"
        [statusFilterMode]="statusFilterMode"
        [statuses]="statuses()"
        [selectedProjectId]="selectedProjectId"
        [projects]="projects()"
        [selectedPriority]="selectedPriority"
        [hasActiveFilters]="hasActiveFilters()"
        (activePresetChange)="setPreset($event)"
        (searchQueryChange)="onTaskSearchChange($event)"
        (searchApply)="applyTaskSearchImmediately()"
        (searchClear)="clearSearch()"
        (statusFilterModeChange)="setStatusFilterMode($event)"
        (selectedProjectIdChange)="onProjectFilterChange($event)"
        (selectedPriorityChange)="onPriorityFilterChange($event)"
        (resetFilters)="resetFilters()"
      ></app-task-filter-bar>

      <div class="request-state request-loading" *ngIf="isLoading()" role="status">
        {{ 'common.loading' | t }}
      </div>
      <div class="request-state request-error" *ngIf="listLoadError()" role="alert">
        <span>{{ (tasks().length ? 'tasks.list_load_error_stale' : 'tasks.list_load_error') | t }}</span>
        <ui-button variant="secondary" size="sm" (onClick)="retryTaskList()">{{ 'audit.retry' | t }}</ui-button>
      </div>

      <!-- ======================================================================= -->
      <!-- VIEW 1: TABLE / LIST VIEW (Default View)                                -->
      <!-- ======================================================================= -->
      <app-task-table-view
        *ngIf="viewMode === 'table'"
        [tasks]="tasks()"
        [paginatedTasks]="paginatedTasks()"
        [statuses]="statuses()"
        [projects]="projects()"
        [taskTypes]="taskTypes()"
        [canCreateTask]="canCreateTask()"
        [canUpdateTask]="canUpdateTask()"
        [hasActiveFilters]="hasActiveFilters()"
        [isLoading]="isLoading()"
        [listLoadError]="listLoadError()"
        [isOverdue]="isOverdueFn"
        [getTypeColor]="getTypeColorFn"
        [getTypeBg]="getTypeBgFn"
        [getTypeIcon]="getTypeIconFn"
        [getTypeLabel]="getTypeLabelFn"
        [getProjectName]="getProjectNameFn"
        [getStatusColor]="getStatusColorFn"
        [getDeadlineInfo]="getDeadlineInfoFn"
        (openTaskDetails)="openTaskDetails($event)"
        (openEditModal)="openEditModal($event)"
        (updatePriority)="updatePriority($event.taskId, $event.priority)"
        (updateStatus)="updateStatus($event.taskId, $event.statusId)"
        (resetFilters)="resetFilters()"
        (createTask)="openCreateTaskModal()"
      ></app-task-table-view>


      <!-- ======================================================================= -->
      <!-- VIEW 2: KANBAN BOARD WITH DRAG & DROP                                  -->
      <!-- ======================================================================= -->
      <app-task-kanban-view
        *ngIf="viewMode === 'kanban'"
        [tasks]="tasks()"
        [statuses]="statuses()"
        [projects]="projects()"
        [taskTypes]="taskTypes()"
        [canCreateTask]="canCreateTask()"
        [canUpdateTask]="canUpdateTask()"
        [hasActiveFilters]="hasActiveFilters()"
        [isLoading]="isLoading()"
        [listLoadError]="listLoadError()"
        [getDeadlineInfo]="getDeadlineInfoFn"
        [getPriorityLabel]="getPriorityLabelFn"
        [getTypeColor]="getTypeColorFn"
        [getTypeIcon]="getTypeIconFn"
        [getProjectName]="getProjectNameFn"
        [isOverdue]="isOverdueFn"
        (openTaskDetails)="openTaskDetails($event)"
        (taskStatusChange)="executeStatusChange($event.task, $event.targetStatusId)"
        (taskDragStart)="draggedTask = $event"
        (taskDragEnd)="draggedTask = null"
        (resetFilters)="resetFilters()"
        (createTask)="openCreateTaskModal()"
      ></app-task-kanban-view>

      <ui-pagination
        [totalItems]="tasks().length"
        [currentPage]="currentPage"
        [pageSize]="pageSize"
        [showPageSize]="false"
        [cursorMode]="true"
        [cursorItemsArePageLength]="true"
        [hasNextPage]="hasMore()"
        [disabled]="isLoading() || listLoadError()"
        (pageChange)="goToTaskPage($event)"
      ></ui-pagination>
    </div>

    <!-- ======================================================================= -->
    <!-- Task Details Modal (Sleek Linear/Jira 2-Pane View)                     -->
    <!-- ======================================================================= -->
    <app-task-detail-modal
      [isOpen]="(selectedTask() !== null || routeRecordId() !== null) && !isEditModalOpen()"
      [selectedTask]="selectedTask()"
      [routeRecordId]="routeRecordId()"
      [detailRecordId]="detailRecordId()"
      [detailLoading]="detailLoading()"
      [detailLoadError]="detailLoadError()"
      [detailNotFound]="detailNotFound()"
      [taskAncestors]="taskAncestors()"
      [taskSubtasks]="taskSubtasks()"
      [taskFiles]="taskFiles()"
      [comments]="comments()"
      [commentsLoading]="commentsLoading()"
      [commentsLoadError]="commentsLoadError()"
      [taskMembers]="taskMembers()"
      [taskCustomFields]="taskCustomFields()"
      [statuses]="statuses()"
      [projects]="projects()"
      [taskTypes]="taskTypes()"
      [commentDraft]="commentDraft"
      [isCommentSubmitting]="isCommentSubmitting()"
      [canCreateTask]="canCreateTask()"
      [canUpdateTask]="canUpdateTask()"
      [canCommentTask]="canCommentTask()"
      [isOverdue]="isOverdueFn"
      [getTypeColor]="getTypeColorFn"
      [getTypeBg]="getTypeBgFn"
      [getTypeIcon]="getTypeIconFn"
      [getTypeLabel]="getTypeLabelFn"
      [getStatusName]="getStatusNameFn"
      [getStatusColor]="getStatusColorFn"
      [getPriorityLabel]="getPriorityLabelFn"
      [getProjectName]="getProjectNameFn"
      (close)="closeTaskDetails()"
      (retryTaskDetails)="retryTaskDetails()"
      (openTaskDetails)="openTaskDetails($event)"
      (openAddSubtask)="openAddSubtaskModal($event)"
      (openEditModal)="openEditModal($event)"
      (statusChange)="updateStatus($event.taskId, $event.statusId)"
      (fileAttached)="onTaskFileAttached($event)"
      (fileRemoved)="onTaskFileRemoved($event)"
      (retryComments)="retryComments()"
      (commentDraftChange)="commentDraft = $event"
      (submitComment)="submitComment()"
    ></app-task-detail-modal>

    <!-- ======================================================================= -->
    <!-- Create Task Modal (With RichText MD Editor & User Multi-Select)         -->
    <!-- ======================================================================= -->
    <app-task-create-modal
      [isOpen]="isCreateModalOpen()"
      [createForm]="createForm"
      [isSubmitting]="isSubmitting()"
      [isCreateSubmitted]="isCreateSubmitted"
      [taskTypes]="taskTypes()"
      [projects]="projects()"
      [parentTaskOptions]="parentTaskOptions()"
      [parentLookupLoading]="parentLookupLoading()"
      [parentLookupError]="parentLookupError()"
      [parentLookupHasMore]="parentLookupHasMore()"
      [responsibleUserOptions]="responsibleUserOptions()"
      [responsibleLookupLoading]="responsibleLookupLoading()"
      [responsibleLookupError]="responsibleLookupError()"
      [responsibleLookupHasMore]="responsibleLookupHasMore()"
      [observerUsers]="observerUsers()"
      [observerLookupLoading]="observerLookupLoading()"
      [observerLookupError]="observerLookupError()"
      [observerLookupHasMore]="observerLookupHasMore()"
      [taskCustomFields]="taskCustomFields()"
      (close)="requestCloseCreate()"
      (submit)="submitCreateTask()"
      (parentSearch)="onParentSearch($event)"
      (parentLoadMore)="loadMoreParents()"
      (parentRetry)="retryParentLookup()"
      (responsibleSearch)="onResponsibleSearch($event)"
      (responsibleLoadMore)="loadMoreResponsibleUsers()"
      (responsibleRetry)="retryResponsibleLookup()"
      (observerSearch)="onObserverSearch($event)"
      (observerLoadMore)="loadMoreObservers()"
      (observerRetry)="retryObserverLookup()"
    ></app-task-create-modal>

    <!-- ======================================================================= -->
    <!-- Edit Task Modal (Delegated Component)                                   -->
    <!-- ======================================================================= -->
    <app-task-edit-modal
      [isOpen]="isEditModalOpen()"
      [editingTask]="editingTask"
      [editForm]="editForm"
      [editLoading]="editLoading()"
      [editLoadError]="editLoadError()"
      [isSubmitting]="isSubmitting()"
      [isEditSubmitted]="isEditSubmitted"
      [isEditDiscardConfirmationOpen]="isEditDiscardConfirmationOpen()"
      [taskTypes]="taskTypes()"
      [projects]="projects()"
      [parentTaskOptions]="parentTaskOptions()"
      [parentLookupLoading]="parentLookupLoading()"
      [parentLookupError]="parentLookupError()"
      [parentLookupHasMore]="parentLookupHasMore()"
      [responsibleUserOptions]="responsibleUserOptions()"
      [responsibleLookupLoading]="responsibleLookupLoading()"
      [responsibleLookupError]="responsibleLookupError()"
      [responsibleLookupHasMore]="responsibleLookupHasMore()"
      [observerUsers]="observerUsers()"
      [observerLookupLoading]="observerLookupLoading()"
      [observerLookupError]="observerLookupError()"
      [observerLookupHasMore]="observerLookupHasMore()"
      [taskCustomFields]="taskCustomFields()"
      [getAvailableParentTaskOptions]="getAvailableParentTaskOptionsFn"
      (close)="requestCloseEdit()"
      (submit)="submitEditTask()"
      (retryEditLoad)="retryEditLoad()"
      (cancelDiscard)="cancelDiscardEdit()"
      (confirmDiscard)="confirmDiscardEdit()"
      (parentSearch)="onParentSearch($event)"
      (parentLoadMore)="loadMoreParents()"
      (parentRetry)="retryParentLookup()"
      (responsibleSearch)="onResponsibleSearch($event)"
      (responsibleLoadMore)="loadMoreResponsibleUsers()"
      (responsibleRetry)="retryResponsibleLookup()"
      (observerSearch)="onObserverSearch($event)"
      (observerLoadMore)="loadMoreObservers()"
      (observerRetry)="retryObserverLookup()"
    ></app-task-edit-modal>

    <!-- ======================================================================= -->
    <!-- Dictionaries Settings Modal (Delegated Component)                       -->
    <!-- ======================================================================= -->
    <app-task-dictionaries-modal
      [isOpen]="isSettingsModalOpen()"
      [taskTypes]="taskTypes()"
      [statuses]="statuses()"
      (close)="isSettingsModalOpen.set(false)"
      (createType)="handleCreateType($event)"
      (createStatus)="handleCreateStatus($event)"
      (deleteItem)="handleDeleteDictionaryItem($event)"
      (reorderTypes)="handleReorderTypes($event)"
      (reorderStatuses)="handleReorderStatuses($event)"
    ></app-task-dictionaries-modal>
  `,
  styles: [`
    .tasks-page {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
    }

    /* Header */
    .view-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .header-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .view-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-main);
      margin: 0;
    }
    .count-badge {
      font-size: 12px;
      color: var(--text-muted);
      background-color: var(--bg-hover);
      padding: 1px 7px;
      border-radius: 10px;
      font-weight: 500;
      border: 1px solid var(--border-color);
    }

    /* View Switcher */
    .status-tabs {
      display: flex;
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 2px;
      gap: 2px;
    }
    .status-tab {
      border: none;
      background: transparent;
      min-height: 28px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      border-radius: var(--radius-xs);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.1s ease;
      white-space: nowrap;
    }
    .status-tab:hover { color: var(--text-main); }
    .status-tab.active {
      background-color: var(--bg-surface);
      color: var(--text-main);
      box-shadow: var(--shadow-sm);
    }

    .header-right { display: flex; align-items: center; gap: 8px; }

    .compact-secondary-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }

    .export-dropdown-container {
      position: relative;
      display: inline-block;
    }
    .export-popover {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-md);
      z-index: 100;
      min-width: 230px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .export-scope-title { padding: 10px 12px 2px; color: var(--text-main); font-size: 12px; }
    .export-scope-note { padding: 0 12px 8px; color: var(--text-muted); font-size: 11px; line-height: 1.35; }
    .export-item-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      font-size: 12px;
      background: none;
      border: none;
      width: 100%;
      text-align: left;
      cursor: pointer;
      color: var(--text-main);
    }
    .export-item-btn:hover {
      background-color: var(--bg-hover);
    }

    .request-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 48px;
      padding: 10px 14px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-muted);
      font-size: 12px;
    }
    .request-error { color: var(--danger); }

    @media (max-width: 768px) {
      .header-right > ui-button { order: -1; }
      .compact-secondary-action { padding-inline: 7px; }
      .compact-secondary-action > span:not(.material-symbols-outlined) { display: none; }
      .status-tabs {
        max-width: 100%;
        overflow-x: auto;
      }
    }
  `]
})
export class TasksComponent implements OnInit, OnDestroy {
  private readonly uiI18n = inject(I18nService);
  private readonly authService = inject(AuthService, { optional: true });
  private readonly recordRouter = inject(Router, { optional: true });
  activePreset: 'all' | 'my' | 'reported' | 'overdue' = 'all';
  readonly routeRecordId = signal<string | null>(null);
  readonly detailNotFound = signal(false);
  readonly safeRecordId = safeNumericRecordId;
  private recordRouteSubscription?: Subscription;
  private readonly navigationDecision = new RecordNavigationDecision();
  private createFormBaseline = '';
  readonly tasks = signal<Task[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly statuses = signal<TaskStatus[]>([]);
  readonly taskTypes = signal<TaskType[]>([]);
  readonly parentTaskOptions = signal<SelectOption[]>([]);
  readonly responsibleUsers = signal<User[]>([]);
  readonly observerUsers = signal<User[]>([]);
  readonly parentLookupLoading = signal(false);
  readonly parentLookupError = signal(false);
  readonly parentLookupHasMore = signal(false);
  readonly responsibleLookupLoading = signal(false);
  readonly responsibleLookupError = signal(false);
  readonly responsibleLookupHasMore = signal(false);
  readonly observerLookupLoading = signal(false);
  readonly observerLookupError = signal(false);
  readonly observerLookupHasMore = signal(false);
  readonly taskCustomFields = signal<CustomField[]>([]);

  readonly selectedTask = signal<Task | null>(null);
  readonly taskMembers = signal<TaskMember[]>([]);
  readonly taskSubtasks = signal<Task[]>([]);
  readonly taskAncestors = signal<Task[]>([]);
  readonly taskFiles = signal<TaskFile[]>([]);
  readonly comments = signal<TaskComment[]>([]);

  readonly isLoading = signal<boolean>(false);
  readonly listLoadError = signal<boolean>(false);
  readonly detailLoading = signal<boolean>(false);
  readonly detailLoadError = signal<boolean>(false);
  readonly commentsLoading = signal<boolean>(false);
  readonly commentsLoadError = signal<boolean>(false);
  readonly editLoading = signal<boolean>(false);
  readonly editLoadError = signal<boolean>(false);
  readonly isCommentSubmitting = signal<boolean>(false);
  readonly isSubmitting = signal<boolean>(false);
  readonly hasMore = signal<boolean>(false);
  nextCursor: string | null = null;

  private destroyed = false;
  private listRequestId = 0;
  private detailRequestId = 0;
  private detailContextId = 0;
  private commentsRequestId = 0;
  private editRequestId = 0;
  private commentPostRequestId = 0;
  private listRequest?: Subscription;
  private detailRequest?: Subscription;
  private commentsRequest?: Subscription;
  private editRequest?: Subscription;
  private editSaveRequest?: Subscription;
  private commentPostRequest?: Subscription;
  private routeSubscription?: Subscription;
  private taskPageCursors: Array<string | null> = [null];
  private parentLookupRequest?: Subscription;
  private responsibleLookupRequest?: Subscription;
  private observerLookupRequest?: Subscription;
  private parentLookupRequestId = 0;
  private responsibleLookupRequestId = 0;
  private observerLookupRequestId = 0;
  private parentSearchTimer?: ReturnType<typeof setTimeout>;
  private responsibleSearchTimer?: ReturnType<typeof setTimeout>;
  private observerSearchTimer?: ReturnType<typeof setTimeout>;
  private taskSearchTimer?: ReturnType<typeof setTimeout>;
  private parentLookupQuery = '';
  private responsibleLookupQuery = '';
  private observerLookupQuery = '';
  private parentLookupCursor: string | null = null;
  private responsibleLookupCursor: string | null = null;
  private observerLookupCursor: string | null = null;
  private parentLastReset = true;
  private responsibleLastReset = true;
  private observerLastReset = true;
  private lastListAttempt: { page: number; cursor: string | null; reset: boolean } | null = null;
  private readonly retainedParentOptions = new Map<number, SelectOption>();
  private readonly retainedUsers = new Map<number, User>();

  // View Mode: 'table' (List / Table) is now default as requested
  viewMode: 'table' | 'kanban' = 'table';
  searchQuery = '';
  selectedPriority = '';
  selectedProjectId: number | null = null;
  currentPage = 1;
  readonly pageSize = 50;

  // Status Filter Mode: 'active' (default excludes done & cancelled), 'all', or number (specific status ID)
  statusFilterMode: 'active' | 'all' | number = 'active';


  private readonly commentDrafts = new Map<number, string>();
  draggedTask: Task | null = null;

  readonly getDeadlineInfoFn = (endTime: string | null | undefined, statusId: number) => this.getDeadlineInfo(endTime, statusId);
  readonly getPriorityLabelFn = (priority: string) => this.getPriorityLabel(priority);
  readonly getTypeColorFn = (task: Task) => this.getTypeColor(task);
  readonly getTypeIconFn = (task: Task) => this.getTypeIcon(task);
  readonly getProjectNameFn = (projectId: number | null | undefined) => this.getProjectName(projectId);
  readonly isOverdueFn = (endTime: string | null | undefined, statusId: number) => this.isOverdue(endTime, statusId);
  readonly getTypeLabelFn = (task: Task) => this.getTypeLabel(task);
  readonly getTypeBgFn = (task: Task) => this.getTypeBg(task);
  readonly getStatusColorFn = (statusId: number | null | undefined) => this.getStatusColor(statusId);
  readonly getStatusNameFn = (statusId: number | null | undefined) => this.getStatusName(statusId);

  showExportMenu = false;

  exportTasks(format: 'xlsx' | 'csv'): void {
    this.showExportMenu = false;
    window.open(`/api/v1/reports/tasks/export?format=${format}`, '_blank');
  }

  // Dictionaries Settings Modal
  readonly isSettingsModalOpen = signal<boolean>(false);
  settingsTab: 'types' | 'statuses' = 'types';
  newTypeForm = { code: '', name: '', icon: 'task_alt', color: '#6366f1' };
  newStatusForm = { name: '', color: '#3b82f6', isTerminal: false };
  dictionaryDeleteTarget: { kind: 'type' | 'status'; id: number; name: string } | null = null;

  // Create Modal
  readonly isCreateModalOpen = signal<boolean>(false);
  isCreateSubmitted = false;
  createForm = {
    title: '',
    taskType: 'task',
    descriptionMarkdown: '',
    projectId: null as number | null,
    priority: 'medium',
    responsibleUserId: null as number | null,
    parentTaskId: null as number | null,
    observerUserIds: [] as number[],
    beginTime: '',
    endTime: '',
    attributes: {} as Record<string, any>
  };

  // Edit Modal
  readonly isEditModalOpen = signal<boolean>(false);
  readonly isEditDiscardConfirmationOpen = signal<boolean>(false);
  isEditSubmitted = false;
  editingTask: Task | null = null;
  private editTargetId: number | null = null;
  private editReturnTask: Task | null = null;
  private editFormBaseline = '';
  private editAssignmentBaseline: { parentTaskId: number | null; responsibleUserId: number | null; observerUserIds: number[] } | null = null;
  editForm = {
    title: '',
    taskType: 'task',
    descriptionMarkdown: '',
    projectId: null as number | null,
    priority: 'medium',
    responsibleUserId: null as number | null,
    parentTaskId: null as number | null,
    observerUserIds: [] as number[],
    beginTime: '',
    endTime: '',
    attributes: {} as Record<string, any>
  };

  constructor(
    public permService: PermissionService,
    private api: ApiService,
    private toast: ToastService,
    private route: ActivatedRoute
  ) {}

  ngOnInit() {
    this.routeSubscription = this.route.queryParams.subscribe(params => {
      if (params['project_id']) {
        this.selectedProjectId = Number(params['project_id']);
      }
    });

    this.loadStatuses();
    this.loadTypes();
    this.loadProjects();
    this.loadTaskCustomFields();
    this.loadTasks(true);
    this.recordRouteSubscription = this.route.paramMap?.subscribe(params => {
      this.clearTaskDetails();
      const id = params.get('id');
      this.routeRecordId.set(id);
      if (id === null) return;
      if (!canonicalRecordId(id)) {
        this.detailNotFound.set(true);
        this.detailLoadError.set(true);
        return;
      }
      this.loadTaskFullDetails(id);
      this.loadComments(id);
    });
  }

  ngOnDestroy() {
    this.navigationDecision.settle(false);
    this.destroyed = true;
    this.listRequestId++;
    this.detailRequestId++;
    this.commentsRequestId++;
    this.editRequestId++;
    this.commentPostRequestId++;
    this.parentLookupRequestId++;
    this.responsibleLookupRequestId++;
    this.observerLookupRequestId++;
    clearTimeout(this.parentSearchTimer);
    clearTimeout(this.responsibleSearchTimer);
    clearTimeout(this.observerSearchTimer);
    clearTimeout(this.taskSearchTimer);
    this.routeSubscription?.unsubscribe();
    this.recordRouteSubscription?.unsubscribe();
    this.listRequest?.unsubscribe();
    this.detailRequest?.unsubscribe();
    this.commentsRequest?.unsubscribe();
    this.editRequest?.unsubscribe();
    this.editSaveRequest?.unsubscribe();
    this.commentPostRequest?.unsubscribe();
    this.parentLookupRequest?.unsubscribe();
    this.responsibleLookupRequest?.unsubscribe();
    this.observerLookupRequest?.unsubscribe();
  }

  get commentDraft(): string {
    const taskId = this.selectedTask()?.id;
    return taskId == null ? '' : this.commentDrafts.get(taskId) || '';
  }

  set commentDraft(value: string) {
    const taskId = this.selectedTask()?.id;
    if (taskId != null) this.commentDrafts.set(taskId, value);
  }

  responsibleUserOptions(): SelectOption[] {
    return this.responsibleUsers().map(user => ({
      id: user.id,
      label: user.name,
      subLabel: `@${user.login}`
    }));
  }

  readonly getAvailableParentTaskOptionsFn = (taskId: number) => this.getAvailableParentTaskOptions(taskId);

  getAvailableParentTaskOptions(currentTaskId: number): SelectOption[] {
    return this.parentTaskOptions().filter(option => Number(option.id) !== currentTaskId);
  }

  canCreateTask(): boolean {
    return this.permService.canCreate('tasks.items') || this.permService.canCreate('tasks') || this.permService.canCreate('ms_tasks');
  }

  canUpdateTask(): boolean {
    return this.permService.canUpdate('tasks.items') || this.permService.canUpdate('tasks') || this.permService.canUpdate('ms_tasks');
  }

  loadStatuses() {
    this.api.get<TaskStatus[]>('/tasks/statuses').subscribe({
      next: res => this.statuses.set(res || []),
      error: () => {}
    });
  }

  loadTypes() {
    this.api.get<TaskType[]>('/tasks/types').subscribe({
      next: res => this.taskTypes.set(res || []),
      error: () => {}
    });
  }

  loadProjects() {
    this.api.get<Project[]>('/tasks/projects').subscribe({
      next: res => this.projects.set(res || []),
      error: () => {}
    });
  }

  onParentSearch(query: string) {
    this.parentLookupQuery = query.trim();
    clearTimeout(this.parentSearchTimer);
    this.parentLookupRequestId++;
    this.parentLookupRequest?.unsubscribe();
    this.parentLookupCursor = null;
    this.parentLookupHasMore.set(false);
    this.parentLookupLoading.set(true);
    this.parentLookupError.set(false);
    this.parentSearchTimer = setTimeout(() => this.loadParentTasks(true), 300);
  }

  loadMoreParents() {
    if (this.parentLookupCursor && !this.parentLookupLoading()) this.loadParentTasks(false);
  }

  retryParentLookup() {
    this.loadParentTasks(this.parentLastReset);
  }

  onResponsibleSearch(query: string) {
    this.responsibleLookupQuery = query.trim();
    clearTimeout(this.responsibleSearchTimer);
    this.responsibleLookupRequestId++;
    this.responsibleLookupRequest?.unsubscribe();
    this.responsibleLookupCursor = null;
    this.responsibleLookupHasMore.set(false);
    this.responsibleLookupLoading.set(true);
    this.responsibleLookupError.set(false);
    this.responsibleSearchTimer = setTimeout(() => this.loadResponsibleUsers(true), 300);
  }

  loadMoreResponsibleUsers() {
    if (this.responsibleLookupCursor && !this.responsibleLookupLoading()) this.loadResponsibleUsers(false);
  }

  retryResponsibleLookup() {
    this.loadResponsibleUsers(this.responsibleLastReset);
  }

  onObserverSearch(query: string) {
    this.observerLookupQuery = query.trim();
    clearTimeout(this.observerSearchTimer);
    this.observerLookupRequestId++;
    this.observerLookupRequest?.unsubscribe();
    this.observerLookupCursor = null;
    this.observerLookupHasMore.set(false);
    this.observerLookupLoading.set(true);
    this.observerLookupError.set(false);
    this.observerSearchTimer = setTimeout(() => this.loadObserverUsers(true), 300);
  }

  loadMoreObservers() {
    if (this.observerLookupCursor && !this.observerLookupLoading()) this.loadObserverUsers(false);
  }

  retryObserverLookup() {
    this.loadObserverUsers(this.observerLastReset);
  }

  private loadParentTasks(reset: boolean) {
    this.parentLastReset = reset;
    if (reset) this.parentLookupCursor = null;
    const requestId = ++this.parentLookupRequestId;
    this.parentLookupRequest?.unsubscribe();
    this.parentLookupLoading.set(true);
    this.parentLookupError.set(false);
    this.parentLookupRequest = this.api.get<KeysetPage<Task>>('/tasks', {
      limit: 50,
      cursor: this.parentLookupCursor || undefined,
      search: this.parentLookupQuery || undefined
    }).subscribe({
      next: page => {
        if (this.destroyed || requestId !== this.parentLookupRequestId) return;
        const incoming = (page.items || []).map(item => {
          const option = { id: item.id, label: `#${item.id} ${item.title}`, icon: 'task_alt' };
          this.retainedParentOptions.set(item.id, option);
          return option;
        });
        const selectedId = this.isEditModalOpen() ? this.editForm.parentTaskId : this.createForm.parentTaskId;
        const retained = selectedId == null ? [] : [this.retainedParentOptions.get(selectedId)].filter((item): item is SelectOption => !!item);
        this.parentTaskOptions.set(this.mergeOptions(reset ? retained : this.parentTaskOptions(), incoming));
        this.parentLookupCursor = page.nextCursor;
        this.parentLookupHasMore.set(page.hasMore);
        this.parentLookupLoading.set(false);
      },
      error: () => {
        if (this.destroyed || requestId !== this.parentLookupRequestId) return;
        this.parentLookupLoading.set(false);
        this.parentLookupError.set(true);
      }
    });
  }

  private loadResponsibleUsers(reset: boolean) {
    this.responsibleLastReset = reset;
    if (reset) this.responsibleLookupCursor = null;
    const requestId = ++this.responsibleLookupRequestId;
    this.responsibleLookupRequest?.unsubscribe();
    this.responsibleLookupLoading.set(true);
    this.responsibleLookupError.set(false);
    this.responsibleLookupRequest = this.api.get<KeysetPage<User>>('/iam/users', {
      limit: 50,
      cursor: this.responsibleLookupCursor || undefined,
      search: this.responsibleLookupQuery || undefined,
      state: 'A'
    }).subscribe({
      next: page => {
        if (this.destroyed || requestId !== this.responsibleLookupRequestId) return;
        const selectedId = this.isEditModalOpen() ? this.editForm.responsibleUserId : this.createForm.responsibleUserId;
        this.responsibleUsers.set(this.mergeUserResults(reset ? [] : this.responsibleUsers(), page.items || [], selectedId == null ? [] : [selectedId]));
        this.responsibleLookupCursor = page.nextCursor;
        this.responsibleLookupHasMore.set(page.hasMore);
        this.responsibleLookupLoading.set(false);
      },
      error: () => {
        if (this.destroyed || requestId !== this.responsibleLookupRequestId) return;
        this.responsibleLookupLoading.set(false);
        this.responsibleLookupError.set(true);
      }
    });
  }

  private loadObserverUsers(reset: boolean) {
    this.observerLastReset = reset;
    if (reset) this.observerLookupCursor = null;
    const requestId = ++this.observerLookupRequestId;
    this.observerLookupRequest?.unsubscribe();
    this.observerLookupLoading.set(true);
    this.observerLookupError.set(false);
    this.observerLookupRequest = this.api.get<KeysetPage<User>>('/iam/users', {
      limit: 50,
      cursor: this.observerLookupCursor || undefined,
      search: this.observerLookupQuery || undefined,
      state: 'A'
    }).subscribe({
      next: page => {
        if (this.destroyed || requestId !== this.observerLookupRequestId) return;
        const selectedIds = this.isEditModalOpen() ? this.editForm.observerUserIds : this.createForm.observerUserIds;
        this.observerUsers.set(this.mergeUserResults(reset ? [] : this.observerUsers(), page.items || [], selectedIds));
        this.observerLookupCursor = page.nextCursor;
        this.observerLookupHasMore.set(page.hasMore);
        this.observerLookupLoading.set(false);
      },
      error: () => {
        if (this.destroyed || requestId !== this.observerLookupRequestId) return;
        this.observerLookupLoading.set(false);
        this.observerLookupError.set(true);
      }
    });
  }

  private mergeOptions(existing: SelectOption[], incoming: SelectOption[]): SelectOption[] {
    const merged = new Map<string, SelectOption>();
    [...existing, ...incoming].forEach(option => merged.set(String(option.id), option));
    return [...merged.values()];
  }

  private mergeUserResults(existing: User[], incoming: User[], selectedIds: number[]): User[] {
    incoming.forEach(user => this.retainedUsers.set(user.id, user));
    const selected = selectedIds.map(id => this.retainedUsers.get(id)).filter((user): user is User => !!user);
    const merged = new Map<number, User>();
    [...existing, ...incoming, ...selected].forEach(user => merged.set(user.id, user));
    return [...merged.values()];
  }

  private retainTaskMember(member: TaskMember) {
    const existing = this.retainedUsers.get(member.userId);
    this.retainedUsers.set(member.userId, {
      id: member.userId,
      name: member.userName,
      login: member.userLogin,
      email: member.userEmail || existing?.email || '',
      state: 'A',
      language: existing?.language || 'ru',
      timezone: existing?.timezone || 'UTC',
      attributes: existing?.attributes || {},
      is2faEnabled: existing?.is2faEnabled || false,
      forcePasswordChange: existing?.forcePasswordChange || false,
      createdAt: existing?.createdAt || '',
      modifiedAt: existing?.modifiedAt || ''
    });
  }

  loadTaskCustomFields() {
    this.api.get<CustomField[]>('/custom-fields', { entity_type: 'TASK' }).subscribe({
      next: res => this.taskCustomFields.set(res || []),
      error: () => {}
    });
  }

  loadTasks(reset: boolean = false) {
    clearTimeout(this.taskSearchTimer);
    const page = reset ? 1 : this.currentPage;
    const cursor = reset ? null : (this.taskPageCursors[page - 1] ?? null);
    this.requestTaskPage(page, cursor, reset);
  }

  onTaskSearchChange(query: string) {
    this.searchQuery = query;
    clearTimeout(this.taskSearchTimer);
    this.cancelListRequestForFilterChange();
    this.taskSearchTimer = setTimeout(() => this.loadTasks(true), 350);
  }

  applyTaskSearchImmediately() {
    clearTimeout(this.taskSearchTimer);
    this.loadTasks(true);
  }

  private cancelListRequestForFilterChange() {
    this.listRequestId++;
    this.listRequest?.unsubscribe();
    this.isLoading.set(true);
    this.listLoadError.set(false);
  }

  private requestTaskPage(targetPage: number, cursor: string | null, reset: boolean) {
    this.lastListAttempt = { page: targetPage, cursor, reset };

    let statusIdParam: number | undefined = undefined;
    let hideTerminalParam: boolean | undefined = undefined;

    if (this.statusFilterMode === 'active') {
      hideTerminalParam = true;
    } else if (this.statusFilterMode === 'all') {
      hideTerminalParam = false;
    } else if (typeof this.statusFilterMode === 'number') {
      statusIdParam = this.statusFilterMode;
    }

    let assignedUserIdParam: number | undefined = undefined;
    let reporterIdParam: number | undefined = undefined;
    let overdueParam: boolean | undefined = undefined;

    const currentUserId = this.authService?.currentUser()?.id;
    if (this.activePreset === 'my' && currentUserId) {
      assignedUserIdParam = currentUserId;
    } else if (this.activePreset === 'reported' && currentUserId) {
      reporterIdParam = currentUserId;
    } else if (this.activePreset === 'overdue') {
      overdueParam = true;
    }

    const requestId = ++this.listRequestId;
    this.listRequest?.unsubscribe();
    this.isLoading.set(true);
    this.listLoadError.set(false);
    this.listRequest = this.api.get<KeysetPage<Task>>('/tasks', {
      limit: 50,
      cursor: cursor || undefined,
      search: this.searchQuery || undefined,
      priority: this.selectedPriority || undefined,
      project_id: this.selectedProjectId || undefined,
      status_id: statusIdParam,
      hide_terminal: hideTerminalParam,
      assigned_user_id: assignedUserIdParam,
      reporter_id: reporterIdParam,
      overdue: overdueParam
    }).subscribe({
      next: res => {
        if (this.destroyed || requestId !== this.listRequestId) return;
        this.isLoading.set(false);
        if (reset) this.taskPageCursors = [null];
        this.taskPageCursors[targetPage - 1] = cursor;
        this.currentPage = targetPage;
        this.tasks.set(res.items || []);
        this.nextCursor = res.nextCursor;
        this.hasMore.set(res.hasMore);
      },
      error: () => {
        if (this.destroyed || requestId !== this.listRequestId) return;
        this.isLoading.set(false);
        this.listLoadError.set(true);
      }
    });
  }

  retryTaskList() {
    const attempt = this.lastListAttempt;
    if (!attempt || this.isLoading()) return;
    this.requestTaskPage(attempt.page, attempt.cursor, attempt.reset);
  }

  goToTaskPage(page: number) {
    if (this.isLoading() || this.listLoadError() || page === this.currentPage || page < 1 || Math.abs(page - this.currentPage) !== 1) return;
    let cursor: string | null;
    if (page > this.currentPage) {
      if (!this.hasMore() || !this.nextCursor) return;
      cursor = this.nextCursor;
    } else if (this.taskPageCursors[page - 1] === undefined) {
      return;
    } else {
      cursor = this.taskPageCursors[page - 1];
    }
    this.requestTaskPage(page, cursor, false);
  }

  paginatedTasks(): Task[] {
    return this.tasks();
  }

  hasActiveFilters(): boolean {
    return !!this.searchQuery || !!this.selectedPriority || this.selectedProjectId !== null || this.statusFilterMode !== 'active' || this.activePreset !== 'all';
  }

  clearSearch() {
    clearTimeout(this.taskSearchTimer);
    this.cancelListRequestForFilterChange();
    this.searchQuery = '';
    this.loadTasks(true);
  }

  setPreset(preset: 'all' | 'my' | 'reported' | 'overdue') {
    if (this.activePreset === preset) return;
    this.activePreset = preset;
    this.loadTasks(true);
  }

  updatePriority(taskId: number, newPriority: string) {
    if (!safeNumericRecordId(taskId) || !newPriority) return;
    this.api.patch(`/tasks/${taskId}`, { priority: newPriority }).subscribe({
      next: () => {
        this.toast.success(this.uiI18n.translate('tasks.priority_updated'));
        this.tasks.update(list => list.map(t => t.id === taskId ? { ...t, priority: newPriority } : t));
        if (this.selectedTask()?.id === taskId) {
          this.selectedTask.update(t => t ? { ...t, priority: newPriority } : null);
        }
      },
      error: err => {
        this.toast.error(err.error?.message || this.uiI18n.translate('tasks.ne_udalos_izmenit_prioritet'));
      }
    });
  }

  setStatusFilterMode(mode: 'active' | 'all' | number) {
    this.statusFilterMode = mode;
    this.loadTasks(true);
  }

  onProjectFilterChange(projectId: number | null) {
    this.selectedProjectId = projectId;
    this.loadTasks(true);
  }

  onPriorityFilterChange(priority: string) {
    this.selectedPriority = priority;
    this.loadTasks(true);
  }

  resetFilters() {
    clearTimeout(this.taskSearchTimer);
    this.cancelListRequestForFilterChange();
    this.searchQuery = '';
    this.selectedPriority = '';
    this.selectedProjectId = null;
    this.statusFilterMode = 'active';
    this.activePreset = 'all';
    this.loadTasks(true);
  }

  getTasksByStatus(statusId: number): Task[] {
    return this.tasks().filter(t => t.statusId === statusId);
  }

  isFirstStatus(statusId: number): boolean {
    const list = this.statuses();
    return list.length > 0 && list[0].id === statusId;
  }

  isLastStatus(statusId: number): boolean {
    const list = this.statuses();
    return list.length > 0 && list[list.length - 1].id === statusId;
  }

  moveTaskStatus(task: Task, direction: -1 | 1) {
    if (!this.canUpdateTask()) return;
    const list = this.statuses();
    const currentIndex = list.findIndex(s => s.id === task.statusId);
    if (currentIndex === -1) return;

    const targetIndex = currentIndex + direction;
    if (targetIndex >= 0 && targetIndex < list.length) {
      const targetStatus = list[targetIndex];
      this.updateStatus(task.id, targetStatus.id);
    }
  }

  // =========================================================================
  // Drag & Drop: Angular CDK Handler
  // =========================================================================
  onTaskDrop(event: CdkDragDrop<Task[]>, targetStatusId: number) {
    if (!this.canUpdateTask()) return;
    const task = event.item.data as Task;
    if (!task) return;

    if (task.statusId === targetStatusId) {
      return;
    }

    this.executeStatusChange(task, targetStatusId);
  }

  // =========================================================================
  // Drag & Drop: HTML5 Native Fallback Handlers
  // =========================================================================
  onHtml5DragStart(event: DragEvent, task: Task) {
    if (!this.canUpdateTask()) {
      event.preventDefault();
      return;
    }
    this.draggedTask = task;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', String(task.id));
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onHtml5DragOver(event: DragEvent) {
    if (!this.canUpdateTask()) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const col = (event.currentTarget as HTMLElement);
    if (col && !col.classList.contains('drag-over')) {
      col.classList.add('drag-over');
    }
  }

  onHtml5DragLeave(event: DragEvent) {
    if (!this.canUpdateTask()) return;
    const col = (event.currentTarget as HTMLElement);
    if (col) {
      col.classList.remove('drag-over');
    }
  }

  onHtml5Drop(event: DragEvent, targetStatusId: number) {
    if (!this.canUpdateTask()) return;
    event.preventDefault();
    const col = (event.currentTarget as HTMLElement);
    if (col) {
      col.classList.remove('drag-over');
    }

    const task = this.draggedTask;
    this.draggedTask = null;
    if (!task || task.statusId === targetStatusId) return;

    this.executeStatusChange(task, targetStatusId);
  }

  executeStatusChange(task: Task, targetStatusId: number) {
    if (!safeNumericRecordId(task.id) || !safeNumericRecordId(targetStatusId)) return;
    // Optimistic UI update
    this.applyStatusToVisibleTasks(task.id, targetStatusId);
    if (this.selectedTask()?.id === task.id) {
      this.selectedTask.update(t => t ? { ...t, statusId: targetStatusId } : null);
    }

    // Backend update
    this.api.post(`/tasks/${task.id}/status`, { statusId: targetStatusId }).subscribe({
      next: () => {
        const sName = this.getStatusName(targetStatusId);
        this.toast.success(this.uiI18n.translate('tasks.task_moved_to_status', { id: task.id, status: sName }));
      },
      error: err => {
        this.toast.error(err.error?.message || this.uiI18n.translate('tasks.ne_udalos_izmenit_status_zadachi'));
        this.loadTasks(true);
      }
    });
  }

  // =========================================================================
  // CDK Drag & Drop Handlers for Settings Modal
  // =========================================================================
  onStatusDrop(event: CdkDragDrop<TaskStatus[]>) {
    const list = [...this.statuses()];
    moveItemInArray(list, event.previousIndex, event.currentIndex);
    this.statuses.set(list);
    this.persistStatusOrder(list);
  }

  onTypeDrop(event: CdkDragDrop<TaskType[]>) {
    const list = [...this.taskTypes()];
    moveItemInArray(list, event.previousIndex, event.currentIndex);
    this.taskTypes.set(list);
    this.persistTypeOrder(list);
  }

  moveDictionaryStatus(index: number, delta: -1 | 1) {
    const list = [...this.statuses()];
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return;
    moveItemInArray(list, index, nextIndex);
    this.statuses.set(list);
    this.persistStatusOrder(list);
  }

  moveDictionaryType(index: number, delta: -1 | 1) {
    const list = [...this.taskTypes()];
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return;
    moveItemInArray(list, index, nextIndex);
    this.taskTypes.set(list);
    this.persistTypeOrder(list);
  }

  private persistStatusOrder(list: TaskStatus[]) {
    const orderedIds = list.map(status => status.id);
    this.api.post('/tasks/statuses/reorder', orderedIds).subscribe({
      next: () => this.toast.success(this.uiI18n.translate('tasks.poryadok_statusov_sohranen')),
      error: err => this.toast.error(err.error?.message || this.uiI18n.translate('tasks.oshibka_izmeneniya_poryadka'))
    });
  }

  private persistTypeOrder(list: TaskType[]) {
    const orderedIds = list.map(t => t.id);
    this.api.post('/tasks/types/reorder', orderedIds).subscribe({
      next: () => this.toast.success(this.uiI18n.translate('tasks.poryadok_tipov_zadach_sohranen')),
      error: err => this.toast.error(err.error?.message || this.uiI18n.translate('tasks.oshibka_izmeneniya_poryadka'))
    });
  }

  openTaskDetails(task: Task) {
    if (!safeNumericRecordId(task.id)) return;
    if (this.isEditModalOpen()) return;
    if (this.routeRecordId() !== null && this.routeRecordId() !== String(task.id)) {
      this.recordRouter?.navigate(['/tasks/items', String(task.id)], { queryParamsHandling: 'preserve' });
      return;
    }
    this.cancelDetailRequests();
    this.detailContextId++;
    this.selectedTask.set(task);
    this.taskMembers.set([]);
    this.taskSubtasks.set([]);
    this.taskAncestors.set([]);
    this.taskFiles.set([]);
    this.comments.set([]);
    this.loadTaskFullDetails(task.id);
    this.loadComments(task.id);
  }

  onTaskContainerClick(event: MouseEvent, task: Task) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, select, input, textarea, a, [role="button"], [role="option"]')) return;
    this.openTaskDetails(task);
  }

  detailRecordId(): string | null {
    return this.routeRecordId() ?? (this.selectedTask() ? String(this.selectedTask()!.id) : null);
  }

  loadTaskFullDetails(taskId: number | string) {
    const requestId = ++this.detailRequestId;
    this.detailRequest?.unsubscribe();
    this.detailLoading.set(true);
    this.detailLoadError.set(false);
    this.detailNotFound.set(false);
    this.detailRequest = this.api.get<TaskDetailResponse>(`/tasks/${taskId}`, undefined, { notifyError: false }).subscribe({
      next: res => {
        if (this.destroyed || requestId !== this.detailRequestId || this.detailRecordId() !== String(taskId)) return;
        this.detailLoading.set(false);
        if (recordResponseMatches(res?.task?.id, String(taskId))) {
          this.selectedTask.set(res.task);
          this.taskMembers.set(res.members || []);
          this.taskSubtasks.set(res.subtasks || []);
          this.taskAncestors.set(res.ancestors || []);
          this.taskFiles.set(res.files || []);
        } else {
          this.detailLoadError.set(true);
        }
      },
      error: error => {
        if (this.destroyed || requestId !== this.detailRequestId || this.detailRecordId() !== String(taskId)) return;
        this.detailLoading.set(false);
        this.detailLoadError.set(true);
        this.detailNotFound.set(error?.status === 404 || error?.status === 403);
      }
    });
  }

  retryTaskDetails() {
    const taskId = this.detailRecordId();
    if (taskId != null) this.loadTaskFullDetails(taskId);
  }

  closeTaskDetails(returnToList = true) {
    if (returnToList && this.routeRecordId() !== null) {
      this.recordRouter?.navigate(['/tasks/items'], { queryParamsHandling: 'preserve' });
      return;
    }
    this.clearTaskDetails();
  }

  private clearTaskDetails() {
    this.cancelDetailRequests();
    this.detailContextId++;
    this.selectedTask.set(null);
    this.taskMembers.set([]);
    this.taskSubtasks.set([]);
    this.taskAncestors.set([]);
    this.taskFiles.set([]);
    this.comments.set([]);
    this.detailLoading.set(false);
    this.detailLoadError.set(false);
    this.detailNotFound.set(false);
    this.commentsLoading.set(false);
    this.commentsLoadError.set(false);
  }

  private cancelDetailRequests() {
    this.detailRequestId++;
    this.commentsRequestId++;
    this.detailRequest?.unsubscribe();
    this.commentsRequest?.unsubscribe();
  }

  onTaskFileAttached(file: TaskFile) {
    const t = this.selectedTask();
    if (!t || !safeNumericRecordId(t.id)) return;
    const detailContextId = this.detailContextId;
    this.api.post(`/tasks/${t.id}/files`, { fileId: file.fileId }).subscribe({
      next: () => {
        if (this.destroyed || detailContextId !== this.detailContextId || this.selectedTask()?.id !== t.id) return;
        this.taskFiles.update(list => [...list, file]);
        this.toast.success(this.uiI18n.translate('tasks.file_attached', { name: file.fileName }));
      },
      error: err => {
        if (this.destroyed || detailContextId !== this.detailContextId || this.selectedTask()?.id !== t.id) return;
        this.toast.error(err.error?.message || this.uiI18n.translate('tasks.ne_udalos_prikrepit_fayl'));
      }
    });
  }

  onTaskFileRemoved(file: TaskFile) {
    const t = this.selectedTask();
    if (!t || !safeNumericRecordId(t.id)) return;
    const detailContextId = this.detailContextId;
    this.api.delete(`/tasks/${t.id}/files/${file.fileId}`).subscribe({
      next: () => {
        if (this.destroyed || detailContextId !== this.detailContextId || this.selectedTask()?.id !== t.id) return;
        this.taskFiles.update(list => list.filter(f => f.fileId !== file.fileId));
        this.toast.success(this.uiI18n.translate('tasks.file_removed', { name: file.fileName }));
      },
      error: err => {
        if (this.destroyed || detailContextId !== this.detailContextId || this.selectedTask()?.id !== t.id) return;
        this.toast.error(err.error?.message || this.uiI18n.translate('files.ne_udalos_udalit_fayl'));
      }
    });
  }


  loadComments(taskId: number | string) {
    const requestId = ++this.commentsRequestId;
    this.commentsRequest?.unsubscribe();
    this.commentsLoading.set(true);
    this.commentsLoadError.set(false);
    this.commentsRequest = this.api.get<TaskComment[]>(`/tasks/${taskId}/comments`, undefined, { notifyError: false }).subscribe({
      next: res => {
        if (this.destroyed || requestId !== this.commentsRequestId || this.detailRecordId() !== String(taskId)) return;
        this.commentsLoading.set(false);
        this.comments.set((res || []).filter(comment => recordResponseMatches(comment.taskId, String(taskId))));
      },
      error: () => {
        if (this.destroyed || requestId !== this.commentsRequestId || this.detailRecordId() !== String(taskId)) return;
        this.commentsLoading.set(false);
        this.commentsLoadError.set(true);
      }
    });
  }

  retryComments() {
    const taskId = this.detailRecordId();
    if (taskId != null) this.loadComments(taskId);
  }

  canCommentTask(): boolean {
    return this.permService.canCreate('tasks.comments') &&
      (this.routeRecordId() === null || safeNumericRecordId(this.selectedTask()?.id));
  }

  submitComment() {
    const task = this.selectedTask();
    const text = this.commentDraft.trim();
    if (!task || !safeNumericRecordId(task.id) || !text || !this.canCommentTask() || this.isCommentSubmitting()) return;

    const requestId = ++this.commentPostRequestId;
    this.isCommentSubmitting.set(true);
    this.commentPostRequest = this.api.post(`/tasks/${task.id}/comments`, { textMarkdown: text }).subscribe({
      next: () => {
        if (this.destroyed || requestId !== this.commentPostRequestId) return;
        this.isCommentSubmitting.set(false);
        this.commentDrafts.delete(task.id);
        if (this.selectedTask()?.id === task.id) this.loadComments(task.id);
        this.toast.success(this.uiI18n.translate('tasks.kommentariy_dobavlen'));
      },
      error: err => {
        if (this.destroyed || requestId !== this.commentPostRequestId) return;
        this.isCommentSubmitting.set(false);
        this.toast.error(err.error?.message || this.uiI18n.translate('tasks.ne_udalos_otpravit_kommentariy'));
      }
    });
  }

  updateStatus(taskId: number, newStatusId: number) {
    if (!safeNumericRecordId(taskId) || !safeNumericRecordId(newStatusId)) return;
    this.api.post(`/tasks/${taskId}/status`, { statusId: newStatusId }).subscribe({
      next: () => {
        this.toast.success(this.uiI18n.translate('tasks.status_zadachi_obnovlen'));
        this.applyStatusToVisibleTasks(taskId, newStatusId);
        if (this.selectedTask()?.id === taskId) {
          this.selectedTask.update(t => t ? { ...t, statusId: newStatusId } : null);
        }
      },
      error: err => {
        this.toast.error(err.error?.message || this.uiI18n.translate('tasks.ne_udalos_izmenit_status'));
      }
    });
  }

  // =========================================================================
  // Task Creation & Subtasks
  // =========================================================================
  openCreateTaskModal() {
    this.isCreateSubmitted = false;
    this.createForm = {
      title: '',
      taskType: this.taskTypes().length > 0 ? this.taskTypes()[0].code : 'task',
      descriptionMarkdown: '',
      projectId: this.selectedProjectId,
      priority: 'medium',
      responsibleUserId: null,
      parentTaskId: null,
      observerUserIds: [],
      beginTime: '',
      endTime: '',
      attributes: {}
    };
    this.createFormBaseline = JSON.stringify(this.createForm);
    this.isCreateModalOpen.set(true);
  }

  openAddSubtaskModal(parentTask: Task) {
    if (!safeNumericRecordId(parentTask.id)) return;
    this.isCreateSubmitted = false;
    this.createForm = {
      title: '',
      taskType: this.taskTypes().length > 0 ? this.taskTypes()[0].code : 'task',
      descriptionMarkdown: '',
      projectId: parentTask.projectId || null,
      priority: parentTask.priority || 'medium',
      responsibleUserId: null,
      parentTaskId: parentTask.id,
      observerUserIds: [],
      beginTime: '',
      endTime: '',
      attributes: {}
    };
    const parentOption = { id: parentTask.id, label: `#${parentTask.id} ${parentTask.title}`, icon: 'task_alt' };
    this.retainedParentOptions.set(parentTask.id, parentOption);
    this.parentTaskOptions.set(this.mergeOptions(this.parentTaskOptions(), [parentOption]));
    this.createFormBaseline = JSON.stringify(this.createForm);
    this.isCreateModalOpen.set(true);
  }

  requestCloseCreate() {
    if (this.isSubmitting()) return;
    this.isCreateModalOpen.set(false);
  }

  submitCreateTask() {
    if (this.isSubmitting()) return;
    this.isCreateSubmitted = true;
    if (!this.createForm.title.trim()) {
      this.toast.warning(this.uiI18n.translate('tasks.ukazhite_nazvanie_zadachi'));
      return;
    }

    const attrs = { ...this.createForm.attributes, task_type: this.createForm.taskType };

    const payload = {
      title: this.createForm.title.trim(),
      descriptionMarkdown: this.createForm.descriptionMarkdown?.trim() || '',
      projectId: this.createForm.projectId ? Number(this.createForm.projectId) : null,
      priority: this.createForm.priority || 'medium',
      responsibleUserId: this.createForm.responsibleUserId ? Number(this.createForm.responsibleUserId) : null,
      parentTaskId: this.createForm.parentTaskId ? Number(this.createForm.parentTaskId) : null,
      observerUserIds: this.createForm.observerUserIds,
      beginTime: toTaskInstant(this.createForm.beginTime),
      endTime: toTaskInstant(this.createForm.endTime),
      attributes: attrs
    };

    this.isSubmitting.set(true);
    this.api.post<Task>('/tasks', payload).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.isCreateModalOpen.set(false);
        this.toast.success(this.uiI18n.translate('tasks.zadacha_uspeshno_sozdana'));
        this.loadTasks(true);
        if (this.selectedTask() && this.createForm.parentTaskId === this.selectedTask()?.id) {
          this.loadTaskFullDetails(this.selectedTask()!.id);
        }
      },
      error: err => {
        this.isSubmitting.set(false);
        this.toast.error(err.error?.message || this.uiI18n.translate('tasks.oshibka_pri_sohranenii_zadachi'));
      }
    });
  }

  // =========================================================================
  // Task Editing
  // =========================================================================
  openEditModal(task: Task) {
    if (!safeNumericRecordId(task.id)) return;
    if (this.isSubmitting() || this.isEditModalOpen()) return;
    this.isEditSubmitted = false;
    this.isEditDiscardConfirmationOpen.set(false);
    this.editReturnTask = this.selectedTask()?.id === task.id ? this.selectedTask() : null;
    if (this.editReturnTask) this.closeTaskDetails(false);
    this.editTargetId = task.id;
    this.editingTask = null;
    this.editFormBaseline = '';
    this.editAssignmentBaseline = null;
    this.isEditModalOpen.set(true);
    this.loadEditDetails(task.id);
  }

  private loadEditDetails(taskId: number) {
    const requestId = ++this.editRequestId;
    this.editRequest?.unsubscribe();
    this.editLoading.set(true);
    this.editLoadError.set(false);
    this.editingTask = null;

    this.editRequest = this.api.get<TaskDetailResponse>(`/tasks/${taskId}`).subscribe({
      next: res => {
        if (this.destroyed || requestId !== this.editRequestId || this.editTargetId !== taskId || !this.isEditModalOpen()) return;
        if (!res?.task || res.task.id !== taskId || !Array.isArray(res.members)) {
          this.editLoading.set(false);
          this.editLoadError.set(true);
          return;
        }
        const freshTask = res.task;
        const obsIds = res.members
          .filter(m => (m.involveKind || m.involvementKind) === 'O')
          .map(m => m.userId);

        const respMember = res.members.find(m => (m.involveKind || m.involvementKind) === 'R');
        res.members.forEach(member => this.retainTaskMember(member));
        const parent = (res.ancestors || []).find(ancestor => ancestor.id === freshTask.parentTaskId);
        if (parent) {
          const option = { id: parent.id, label: `#${parent.id} ${parent.title}`, icon: 'task_alt' };
          this.retainedParentOptions.set(parent.id, option);
          this.parentTaskOptions.set(this.mergeOptions(this.parentTaskOptions(), [option]));
        }

        this.editingTask = freshTask;
        this.editForm = {
          title: freshTask.title,
          taskType: (freshTask.attributes && freshTask.attributes['task_type']) || 'task',
          descriptionMarkdown: freshTask.descriptionMarkdown || '',
          projectId: freshTask.projectId ?? null,
          priority: freshTask.priority || 'medium',
          responsibleUserId: respMember ? respMember.userId : null,
          parentTaskId: freshTask.parentTaskId ?? null,
          observerUserIds: obsIds,
          beginTime: toLocalDateTime(freshTask.beginTime),
          endTime: toLocalDateTime(freshTask.endTime),
          attributes: { ...(freshTask.attributes || {}) }
        };
        this.editFormBaseline = this.serializeEditForm();
        this.editAssignmentBaseline = {
          parentTaskId: this.editForm.parentTaskId,
          responsibleUserId: this.editForm.responsibleUserId,
          observerUserIds: [...this.editForm.observerUserIds]
        };
        this.responsibleUsers.set(this.mergeUserResults(this.responsibleUsers(), [], this.editForm.responsibleUserId == null ? [] : [this.editForm.responsibleUserId]));
        this.observerUsers.set(this.mergeUserResults(this.observerUsers(), [], this.editForm.observerUserIds));
        this.editLoading.set(false);
      },
      error: () => {
        if (this.destroyed || requestId !== this.editRequestId || this.editTargetId !== taskId || !this.isEditModalOpen()) return;
        this.editLoading.set(false);
        this.editLoadError.set(true);
      }
    });
  }

  private applyStatusToVisibleTasks(taskId: number, statusId: number) {
    const targetStatus = this.statuses().find(status => status.id === statusId);
    const leavesCurrentFilter =
      (this.statusFilterMode === 'active' && targetStatus?.isTerminal === true) ||
      (typeof this.statusFilterMode === 'number' && this.statusFilterMode !== statusId);
    this.tasks.update(list => leavesCurrentFilter
      ? list.filter(task => task.id !== taskId)
      : list.map(task => task.id === taskId ? { ...task, statusId } : task));
  }

  retryEditLoad() {
    if (this.editTargetId != null && !this.isSubmitting()) this.loadEditDetails(this.editTargetId);
  }

  requestCloseEdit() {
    if (this.isSubmitting()) return;
    if (this.editingTask && this.editFormBaseline !== this.serializeEditForm()) {
      this.isEditDiscardConfirmationOpen.set(true);
      return;
    }
    this.closeEditModal(true);
  }

  confirmDiscardEdit() {
    if (this.isSubmitting()) return;
    if (this.navigationDecision.pending) {
      this.isCreateModalOpen.set(false);
      this.closeEditModal(false);
      this.navigationDecision.settle(true);
      return;
    }
    this.isEditDiscardConfirmationOpen.set(false);
    this.closeEditModal(true);
  }

  cancelDiscardEdit() {
    this.isEditDiscardConfirmationOpen.set(false);
    this.navigationDecision.settle(false);
  }

  canLeaveRecordPage() {
    if (this.isSubmitting() || this.isCommentSubmitting()) return false;
    const dirtyEdit = this.isEditModalOpen() && this.editingTask && this.editFormBaseline !== this.serializeEditForm();
    const dirtyCreate = this.isCreateModalOpen() && this.createFormBaseline !== JSON.stringify(this.createForm);
    if (dirtyEdit || dirtyCreate || this.commentDraft.trim()) {
      return this.navigationDecision.request(
        () => this.isEditDiscardConfirmationOpen.set(true),
        () => this.isEditDiscardConfirmationOpen.set(false));
    }
    if (this.isEditModalOpen()) this.closeEditModal(false);
    this.isCreateModalOpen.set(false);
    return true;
  }

  private closeEditModal(returnToDetails: boolean) {
    const returnTask = returnToDetails ? this.editReturnTask : null;
    this.editRequestId++;
    this.editRequest?.unsubscribe();
    this.isEditModalOpen.set(false);
    this.isEditDiscardConfirmationOpen.set(false);
    this.editLoading.set(false);
    this.editLoadError.set(false);
    this.editingTask = null;
    this.editTargetId = null;
    this.editReturnTask = null;
    this.editFormBaseline = '';
    this.editAssignmentBaseline = null;
    if (returnTask) this.openTaskDetails(returnTask);
  }

  private serializeEditForm(): string {
    return JSON.stringify(this.editForm);
  }

  private sameIdSet(left: number[], right: number[]): boolean {
    if (left.length !== right.length) return false;
    const rightIds = new Set(right);
    return left.every(id => rightIds.has(id));
  }

  submitEditTask() {
    if (!this.editingTask || this.isSubmitting() || this.editLoading() || this.editLoadError()) return;
    this.isEditSubmitted = true;
    if (!this.editForm.title.trim()) {
      this.toast.warning(this.uiI18n.translate('tasks.nazvanie_zadachi_obyazatelno'));
      return;
    }

    const attrs = { ...this.editForm.attributes, task_type: this.editForm.taskType };

    const payload: Record<string, unknown> = {
      title: this.editForm.title.trim(),
      descriptionMarkdown: this.editForm.descriptionMarkdown?.trim() || '',
      projectId: this.editForm.projectId ? Number(this.editForm.projectId) : null,
      priority: this.editForm.priority || 'medium',
      beginTime: toTaskInstant(this.editForm.beginTime, this.editingTask.beginTime),
      endTime: toTaskInstant(this.editForm.endTime, this.editingTask.endTime),
      attributes: attrs
    };
    const currentAssignments = {
      parentTaskId: this.editForm.parentTaskId == null ? null : Number(this.editForm.parentTaskId),
      responsibleUserId: this.editForm.responsibleUserId == null ? null : Number(this.editForm.responsibleUserId),
      observerUserIds: [...this.editForm.observerUserIds]
    };
    if (!this.editAssignmentBaseline || currentAssignments.parentTaskId !== this.editAssignmentBaseline.parentTaskId) {
      payload['parentTaskId'] = currentAssignments.parentTaskId;
    }
    if (!this.editAssignmentBaseline || currentAssignments.responsibleUserId !== this.editAssignmentBaseline.responsibleUserId) {
      payload['responsibleUserId'] = currentAssignments.responsibleUserId;
    }
    if (!this.editAssignmentBaseline || !this.sameIdSet(currentAssignments.observerUserIds, this.editAssignmentBaseline.observerUserIds)) {
      payload['observerUserIds'] = currentAssignments.observerUserIds;
    }

    const editedTask = this.editingTask;
    const returnTask = this.editReturnTask;
    this.isSubmitting.set(true);
    this.editSaveRequest = this.api.patch(`/tasks/${editedTask.id}`, payload).subscribe({
      next: () => {
        if (this.destroyed || this.editingTask?.id !== editedTask.id) return;
        this.isSubmitting.set(false);
        this.closeEditModal(false);
        this.toast.success(this.uiI18n.translate('tasks.zadacha_uspeshno_obnovlena'));
        this.loadTasks(true);
        if (returnTask) this.openTaskDetails({ ...returnTask, id: editedTask.id });
      },
      error: err => {
        if (this.destroyed || this.editingTask?.id !== editedTask.id) return;
        this.isSubmitting.set(false);
        this.toast.error(err.error?.message || this.uiI18n.translate('tasks.oshibka_pri_obnovlenii_zadachi'));
      }
    });
  }

  // =========================================================================
  // Dictionaries Management
  // =========================================================================
  // =========================================================================
  // Dictionaries Management (Delegated to TaskDictionariesModalComponent)
  // =========================================================================
  openSettingsModal() {
    this.isSettingsModalOpen.set(true);
  }

  handleCreateType(event: { code: string; name: string; icon: string; color: string }) {
    this.api.post('/tasks/types', {
      code: event.code,
      name: event.name,
      icon: event.icon,
      color: event.color,
      orderNo: (this.taskTypes().length + 1) * 10
    }).subscribe({
      next: () => {
        this.toast.success(this.uiI18n.translate('tasks.tip_zadachi_dobavlen'));
        this.loadTypes();
      },
      error: err => this.toast.error(err.error?.message || this.uiI18n.translate('tasks.oshibka_dobavleniya_tipa'))
    });
  }

  handleCreateStatus(event: { name: string; color: string; isTerminal: boolean }) {
    this.api.post('/tasks/statuses', {
      name: event.name,
      color: event.color,
      orderNo: (this.statuses().length + 1) * 10,
      isTerminal: event.isTerminal
    }).subscribe({
      next: () => {
        this.toast.success(this.uiI18n.translate('tasks.status_zadachi_dobavlen'));
        this.loadStatuses();
      },
      error: err => this.toast.error(err.error?.message || this.uiI18n.translate('tasks.oshibka_dobavleniya_statusa'))
    });
  }

  handleDeleteDictionaryItem(target: { kind: 'type' | 'status'; id: number; name: string }) {
    const endpoint = target.kind === 'type' ? `/tasks/types/${target.id}` : `/tasks/statuses/${target.id}`;
    this.api.delete(endpoint).subscribe({
      next: () => {
        if (target.kind === 'type') {
          this.toast.success(this.uiI18n.translate('tasks.tip_zadachi_udalen'));
          this.loadTypes();
        } else {
          this.toast.success(this.uiI18n.translate('tasks.status_udalen'));
          this.loadStatuses();
        }
      },
      error: err => this.toast.error(err.error?.message || (target.kind === 'type'
        ? this.uiI18n.translate('tasks.oshibka_udaleniya_tipa')
        : this.uiI18n.translate('tasks.nelzya_udalit_status_privyazannyy_k_zadacham')))
    });
  }

  handleReorderTypes(list: TaskType[]) {
    this.taskTypes.set(list);
    this.persistTypeOrder(list);
  }

  handleReorderStatuses(list: TaskStatus[]) {
    this.statuses.set(list);
    this.persistStatusOrder(list);
  }

  // =========================================================================
  // Helpers
  // =========================================================================
  getTypeObj(task: Task): TaskType | null {
    const code = (task.attributes && task.attributes['task_type']) || 'task';
    return this.taskTypes().find(ty => ty.code === code) || null;
  }

  getTypeLabel(task: Task): string {
    const obj = this.getTypeObj(task);
    return obj ? obj.name : this.uiI18n.translate('tasks.zadacha');
  }

  getTypeIcon(task: Task): string {
    const obj = this.getTypeObj(task);
    return obj ? obj.icon : 'task_alt';
  }

  getTypeColor(task: Task): string {
    const obj = this.getTypeObj(task);
    return obj ? obj.color : 'var(--primary)';
  }

  getTypeBg(task: Task): string {
    const obj = this.getTypeObj(task);
    if (!obj) return 'var(--bg-hover)';
    return `${obj.color}18`;
  }

  getProjectName(projectId: number | null | undefined): string | null {
    if (!projectId) return null;
    const p = this.projects().find(x => x.id === projectId);
    return p ? p.name : `#${projectId}`;
  }

  getStatusName(statusId: number | null | undefined): string {
    if (!statusId) return this.uiI18n.translate('tasks.novaya');
    const s = this.statuses().find(x => x.id === statusId);
    return s ? s.name : this.uiI18n.translate('tasks.v_rabote');
  }

  getStatusColor(statusId: number | null | undefined): string {
    if (!statusId) return 'var(--primary)';
    const s = this.statuses().find(x => x.id === statusId);
    return s?.color || 'var(--primary)';
  }

  getPriorityLabel(priority: string): string {
    switch (priority) {
      case 'critical':
      case 'urgent':
        return this.uiI18n.translate('tasks.kriticheskiy');
      case 'high':
        return this.uiI18n.translate('task.priority.high');
      case 'medium':
      case 'normal':
        return this.uiI18n.translate('tasks.sredniy');
      default:
        return this.uiI18n.translate('task.priority.low');
    }
  }

  isOverdue(endTime: string | null | undefined, statusId: number): boolean {
    if (!endTime) return false;
    const s = this.statuses().find(x => x.id === statusId);
    if (s && s.isTerminal) return false;
    return new Date(endTime).getTime() < Date.now();
  }

  getDeadlineInfo(endTime: string | null | undefined, statusId: number): {
    state: 'none' | 'overdue' | 'today' | 'tomorrow' | 'upcoming';
    label: string;
    detail?: string;
  } {
    if (!endTime) return { state: 'none', label: '—' };
    const s = this.statuses().find(x => x.id === statusId);
    if (s && s.isTerminal) {
      const d = new Date(endTime);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      return { state: 'upcoming', label: `${day}.${month}.${d.getFullYear()}` };
    }

    const targetDate = new Date(endTime);
    const now = new Date();
    const diffMs = targetDate.getTime() - now.getTime();

    if (diffMs < 0) {
      const overdueDays = Math.max(1, Math.floor(Math.abs(diffMs) / (1000 * 60 * 60 * 24)));
      const day = String(targetDate.getDate()).padStart(2, '0');
      const month = String(targetDate.getMonth() + 1).padStart(2, '0');
      return {
        state: 'overdue',
        label: this.uiI18n.translate('tasks.deadline_overdue_days', { days: overdueDays }),
        detail: `${day}.${month}.${targetDate.getFullYear()}`
      };
    }

    const isToday = targetDate.getFullYear() === now.getFullYear() &&
                    targetDate.getMonth() === now.getMonth() &&
                    targetDate.getDate() === now.getDate();
    if (isToday) {
      const hours = String(targetDate.getHours()).padStart(2, '0');
      const mins = String(targetDate.getMinutes()).padStart(2, '0');
      return {
        state: 'today',
        label: `${this.uiI18n.translate('tasks.deadline_today')}, ${hours}:${mins}`
      };
    }

    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const isTomorrow = targetDate.getFullYear() === tomorrow.getFullYear() &&
                      targetDate.getMonth() === tomorrow.getMonth() &&
                      targetDate.getDate() === tomorrow.getDate();
    if (isTomorrow) {
      return {
        state: 'tomorrow',
        label: this.uiI18n.translate('tasks.deadline_tomorrow')
      };
    }

    const day = String(targetDate.getDate()).padStart(2, '0');
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    return {
      state: 'upcoming',
      label: `${day}.${month}.${targetDate.getFullYear()}`
    };
  }

  getInvolveKindLabel(kind: string | undefined): string {
    switch (kind) {
      case 'R': return this.uiI18n.translate('task.responsible');
      case 'E': return this.uiI18n.translate('tasks.ispolnitel');
      case 'O': return this.uiI18n.translate('tasks.nablyudatel');
      case 'A': return this.uiI18n.translate('tasks.avtor');
      default: return this.uiI18n.translate('tasks.uchastnik');
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
    const fields = this.taskCustomFields();
    return Object.entries(attrs)
      .filter(([k]) => k !== 'task_type')
      .map(([k, v]) => {
        const field = fields.find(f => f.code === k);
        const keyLabel = field ? field.name : k;
        let valueStr = String(v ?? '');
        if (field?.fieldType === 'boolean') {
          valueStr = v === true || v === 'true'
            ? this.uiI18n.translate('common.yes')
            : this.uiI18n.translate('common.no');
        } else if (field?.fieldType === 'user_ref') {
          const user = this.responsibleUsers().find(u => u.id === Number(v))
            || this.observerUsers().find(u => u.id === Number(v));
          if (user) {
            valueStr = user.name || user.login;
          }
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
