import { Component, OnDestroy, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { canonicalRecordId, safeNumericRecordId } from '../../core/services/search-target';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { ApiService } from '../../core/services/api.service';
import { PermissionService } from '../../core/services/permission.service';
import { ToastService } from '../../core/services/toast.service';
import { UiButtonComponent } from '../../shared/ui/ui-button.component';
import { SelectOption } from '../../shared/ui/ui-searchable-select.component';
import { UiPaginationComponent } from '../../shared/ui/ui-pagination.component';
import { Task, Project, TaskStatus, TaskType, TaskFile } from '../../core/models/task.models';
import { CustomField } from '../../core/models/custom-field.models';
import { KeysetPage } from '../../core/models/common.models';
import { TranslatePipe, I18nService } from '../../core/services/i18n.service';
import { Subscription } from 'rxjs';
import { TaskDictionariesModalComponent } from './components/task-dictionaries-modal.component';
import { TaskKanbanViewComponent } from './components/task-kanban-view.component';
import { TaskTableViewComponent } from './components/task-table-view.component';
import { TaskFilterBarComponent } from './components/task-filter-bar.component';
import { TaskDetailModalComponent } from './components/task-detail-modal.component';
import { TaskCreateModalComponent } from './components/task-create-modal.component';
import { TaskEditModalComponent } from './components/task-edit-modal.component';
import {
  TaskDeadlineInfo,
  TaskCreateFormValue,
  TaskEditFormValue,
  getTypeObj,
  getTypeLabel,
  getTypeIcon,
  getTypeColor,
  getTypeBg,
  getProjectName,
  getStatusName,
  getStatusColor,
  getPriorityLabel,
  isOverdue,
  getDeadlineInfo,
  getInvolveKindLabel,
  getInitials,
  hasAttributes,
  formatAttributes
} from './tasks.models';
import { TaskDictionariesService } from './services/task-dictionaries.service';
import { TaskLookupsService } from './services/task-lookups.service';
import { TaskDetailsService } from './services/task-details.service';
import { TaskFormsService } from './services/task-forms.service';
import { TaskKanbanService } from './services/task-kanban.service';
import { TaskFilterService } from './services/task-filter.service';

export type { TaskDeadlineInfo, TaskCreateFormValue, TaskEditFormValue };

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [
    TranslatePipe, CommonModule, FormsModule, UiButtonComponent, UiPaginationComponent,
    TaskDictionariesModalComponent, TaskKanbanViewComponent, TaskTableViewComponent,
    TaskFilterBarComponent, TaskDetailModalComponent, TaskCreateModalComponent, TaskEditModalComponent
  ],
  templateUrl: './tasks.component.html',
  styleUrl: './tasks.component.css'
})
export class TasksComponent implements OnInit, OnDestroy {
  detailRecordId(): string | null {
    return this.routeRecordId() ?? (this.selectedTask() ? String(this.selectedTask()!.id) : null);
  }

  private readonly uiI18n = inject(I18nService);
  private readonly recordRouter = inject(Router, { optional: true });

  public readonly dictService = inject(TaskDictionariesService);
  public readonly lookupsService = inject(TaskLookupsService);
  public readonly detailsService = inject(TaskDetailsService);
  public readonly formsService = inject(TaskFormsService);
  public readonly kanbanService = inject(TaskKanbanService);
  public readonly filterService = inject(TaskFilterService);

  readonly routeRecordId = signal<string | null>(null);
  readonly detailNotFound = this.detailsService.detailNotFound;
  readonly safeRecordId = safeNumericRecordId;
  private recordRouteSubscription?: Subscription;
  private routeSubscription?: Subscription;

  readonly tasks = signal<Task[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly taskCustomFields = signal<CustomField[]>([]);

  readonly isLoading = signal<boolean>(false);
  readonly listLoadError = signal<boolean>(false);
  readonly hasMore = signal<boolean>(false);
  nextCursor: string | null = null;

  private destroyed = false;
  private listRequestId = 0;
  private listRequest?: Subscription;

  // Filter delegates
  get activePreset() { return this.filterService.activePreset; }
  set activePreset(v) { this.filterService.activePreset = v; }
  get viewMode() { return this.filterService.viewMode; }
  set viewMode(v) { this.filterService.viewMode = v; }
  get searchQuery() { return this.filterService.searchQuery; }
  set searchQuery(v) { this.filterService.searchQuery = v; }
  get selectedPriority() { return this.filterService.selectedPriority; }
  set selectedPriority(v) { this.filterService.selectedPriority = v; }
  get selectedProjectId() { return this.filterService.selectedProjectId; }
  set selectedProjectId(v) { this.filterService.selectedProjectId = v; }
  get statusFilterMode() { return this.filterService.statusFilterMode; }
  set statusFilterMode(v) { this.filterService.statusFilterMode = v; }
  get currentPage() { return this.filterService.currentPage; }
  set currentPage(v) { this.filterService.currentPage = v; }
  get pageSize() { return this.filterService.pageSize; }
  get showExportMenu() { return this.filterService.showExportMenu; }
  set showExportMenu(v) { this.filterService.showExportMenu = v; }

  // Delegated signals from Dictionaries Service
  readonly statuses = this.dictService.statuses;
  readonly taskTypes = this.dictService.taskTypes;
  readonly isSettingsModalOpen = this.dictService.isSettingsModalOpen;

  // Delegated signals from Lookups Service
  readonly parentTaskOptions = this.lookupsService.parentTaskOptions;
  readonly responsibleUsers = this.lookupsService.responsibleUsers;
  readonly executorUsers = this.lookupsService.executorUsers;
  readonly observerUsers = this.lookupsService.observerUsers;
  readonly parentLookupLoading = this.lookupsService.parentLookupLoading;
  readonly parentLookupError = this.lookupsService.parentLookupError;
  readonly parentLookupHasMore = this.lookupsService.parentLookupHasMore;
  readonly responsibleLookupLoading = this.lookupsService.responsibleLookupLoading;
  readonly responsibleLookupError = this.lookupsService.responsibleLookupError;
  readonly responsibleLookupHasMore = this.lookupsService.responsibleLookupHasMore;
  readonly executorLookupLoading = this.lookupsService.executorLookupLoading;
  readonly executorLookupError = this.lookupsService.executorLookupError;
  readonly executorLookupHasMore = this.lookupsService.executorLookupHasMore;
  readonly observerLookupLoading = this.lookupsService.observerLookupLoading;
  readonly observerLookupError = this.lookupsService.observerLookupError;
  readonly observerLookupHasMore = this.lookupsService.observerLookupHasMore;

  // Delegated signals from Details Service
  readonly selectedTask = this.detailsService.selectedTask;
  readonly taskMembers = this.detailsService.taskMembers;
  readonly taskSubtasks = this.detailsService.taskSubtasks;
  readonly taskAncestors = this.detailsService.taskAncestors;
  readonly taskFiles = this.detailsService.taskFiles;
  readonly comments = this.detailsService.comments;
  readonly detailLoading = this.detailsService.detailLoading;
  readonly detailLoadError = this.detailsService.detailLoadError;
  readonly commentsLoading = this.detailsService.commentsLoading;
  readonly commentsLoadError = this.detailsService.commentsLoadError;
  readonly isCommentSubmitting = this.detailsService.isCommentSubmitting;
  get commentDraft() { return this.detailsService.commentDraft; }
  set commentDraft(v: string) { this.detailsService.commentDraft = v; }

  // Delegated signals from Forms Service
  readonly isCreateModalOpen = this.formsService.isCreateModalOpen;
  get isCreateSubmitted() { return this.formsService.isCreateSubmitted; }
  set isCreateSubmitted(v: boolean) { this.formsService.isCreateSubmitted = v; }
  get createForm() { return this.formsService.createForm; }
  set createForm(f: TaskCreateFormValue) { this.formsService.createForm = f; }
  readonly isEditModalOpen = this.formsService.isEditModalOpen;
  readonly isEditDiscardConfirmationOpen = this.formsService.isEditDiscardConfirmationOpen;
  get isEditSubmitted() { return this.formsService.isEditSubmitted; }
  set isEditSubmitted(v: boolean) { this.formsService.isEditSubmitted = v; }
  readonly editLoading = this.formsService.editLoading;
  readonly editLoadError = this.formsService.editLoadError;
  readonly isSubmitting = this.formsService.isSubmitting;
  get editingTask() { return this.formsService.editingTask; }
  set editingTask(t: Task | null) { this.formsService.editingTask = t; }
  get editForm() { return this.formsService.editForm; }
  set editForm(f: TaskEditFormValue) { this.formsService.editForm = f; }

  // Delegated getters from Kanban Service
  get draggedTask() { return this.kanbanService.draggedTask; }
  set draggedTask(t: Task | null) { this.kanbanService.draggedTask = t; }

  // Function delegates for templates
  readonly getDeadlineInfoFn = (e: string | null | undefined, id: number) => this.getDeadlineInfo(e, id);
  readonly getPriorityLabelFn = (p: string) => this.getPriorityLabel(p);
  readonly getTypeColorFn = (t: Task) => this.getTypeColor(t);
  readonly getTypeIconFn = (t: Task) => this.getTypeIcon(t);
  readonly getProjectNameFn = (id: number | null | undefined) => this.getProjectName(id);
  readonly isOverdueFn = (e: string | null | undefined, id: number) => this.isOverdue(e, id);
  readonly getTypeLabelFn = (t: Task) => this.getTypeLabel(t);
  readonly getTypeBgFn = (t: Task) => this.getTypeBg(t);
  readonly getStatusColorFn = (id: number | null | undefined) => this.getStatusColor(id);
  readonly getStatusNameFn = (id: number | null | undefined) => this.getStatusName(id);
  readonly getAvailableParentTaskOptionsFn = (taskId: number) => this.getAvailableParentTaskOptions(taskId);

  constructor(
    public permService: PermissionService,
    private api: ApiService,
    private toast: ToastService,
    private route: ActivatedRoute
  ) {}

  ngOnInit() {
    this.routeSubscription = this.route.queryParams.subscribe(params => {
      if (params['project_id']) this.selectedProjectId = Number(params['project_id']);
    });
    this.dictService.loadStatuses();
    this.dictService.loadTypes();
    this.loadProjects();
    this.loadTaskCustomFields();
    this.loadTasks(true);

    this.recordRouteSubscription = this.route.paramMap?.subscribe(params => {
      this.detailsService.clearTaskDetails();
      const id = params.get('id');
      this.routeRecordId.set(id);
      if (id === null) return;
      if (!canonicalRecordId(id)) {
        this.detailNotFound.set(true);
        this.detailsService.detailLoadError.set(true);
        return;
      }
      this.detailsService.loadTaskFullDetails(id, () => this.routeRecordId());
      this.detailsService.loadComments(id, () => this.routeRecordId());
    });
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.listRequestId++;
    this.routeSubscription?.unsubscribe();
    this.recordRouteSubscription?.unsubscribe();
    this.listRequest?.unsubscribe();
    this.filterService.cleanup();
    this.lookupsService.cleanup();
    this.detailsService.cleanup();
    this.formsService.cleanup();
  }

  canCreateTask() { return this.permService.canCreate('tasks.items') || this.permService.canCreate('tasks') || this.permService.canCreate('ms_tasks'); }
  canUpdateTask() { return this.permService.canUpdate('tasks.items') || this.permService.canUpdate('tasks') || this.permService.canUpdate('ms_tasks'); }
  canCommentTask() { return this.permService.canCreate('tasks.comments') && (this.routeRecordId() === null || safeNumericRecordId(this.selectedTask()?.id)); }

  loadProjects() {
    this.api.get<Project[]>('/tasks/projects').subscribe({ next: res => this.projects.set(res || []), error: () => {} });
  }

  loadTaskCustomFields() {
    this.api.get<CustomField[]>('/custom-fields', { entity_type: 'TASK' }).subscribe({ next: res => this.taskCustomFields.set(res || []), error: () => {} });
  }

  loadTasks(reset: boolean = false) {
    clearTimeout(this.filterService.taskSearchTimer);
    const page = reset ? 1 : this.currentPage;
    const cursor = reset ? null : (this.filterService.taskPageCursors[page - 1] ?? null);
    this.requestTaskPage(page, cursor, reset);
  }

  onTaskSearchChange(query: string) {
    this.searchQuery = query;
    clearTimeout(this.filterService.taskSearchTimer);
    this.cancelListRequestForFilterChange();
    this.filterService.taskSearchTimer = setTimeout(() => this.loadTasks(true), 350);
  }

  applyTaskSearchImmediately() {
    clearTimeout(this.filterService.taskSearchTimer);
    this.loadTasks(true);
  }

  private cancelListRequestForFilterChange() {
    this.listRequestId++;
    this.listRequest?.unsubscribe();
    this.isLoading.set(true);
    this.listLoadError.set(false);
  }

  private requestTaskPage(targetPage: number, cursor: string | null, reset: boolean) {
    this.filterService.lastListAttempt = { page: targetPage, cursor, reset };
    const params = this.filterService.buildListParams(cursor);

    const requestId = ++this.listRequestId;
    this.listRequest?.unsubscribe();
    this.isLoading.set(true);
    this.listLoadError.set(false);
    this.listRequest = this.api.get<KeysetPage<Task>>('/tasks', params).subscribe({
      next: res => {
        if (this.destroyed || requestId !== this.listRequestId) return;
        this.isLoading.set(false);
        if (reset) this.filterService.taskPageCursors = [null];
        this.filterService.taskPageCursors[targetPage - 1] = cursor;
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
    const attempt = this.filterService.lastListAttempt;
    if (!attempt || this.isLoading()) return;
    this.requestTaskPage(attempt.page, attempt.cursor, attempt.reset);
  }

  goToTaskPage(page: number) {
    if (this.isLoading() || this.listLoadError() || page === this.currentPage || page < 1 || Math.abs(page - this.currentPage) !== 1) return;
    let cursor: string | null;
    if (page > this.currentPage) {
      if (!this.hasMore() || !this.nextCursor) return;
      cursor = this.nextCursor;
    } else if (this.filterService.taskPageCursors[page - 1] === undefined) {
      return;
    } else {
      cursor = this.filterService.taskPageCursors[page - 1];
    }
    this.requestTaskPage(page, cursor, false);
  }

  paginatedTasks(): Task[] { return this.tasks(); }
  hasActiveFilters(): boolean { return this.filterService.hasActiveFilters(); }
  clearSearch() { this.cancelListRequestForFilterChange(); this.filterService.clearSearch(() => this.loadTasks(true)); }
  setPreset(preset: 'all' | 'my' | 'executor' | 'observer' | 'reported' | 'overdue') { this.filterService.setPreset(preset, () => this.loadTasks(true)); }
  setStatusFilterMode(mode: 'active' | 'all' | number) { this.filterService.setStatusFilterMode(mode, () => this.loadTasks(true)); }
  onProjectFilterChange(projectId: number | null) { this.filterService.onProjectFilterChange(projectId, () => this.loadTasks(true)); }
  onPriorityFilterChange(priority: string) { this.filterService.onPriorityFilterChange(priority, () => this.loadTasks(true)); }
  resetFilters() { this.cancelListRequestForFilterChange(); this.filterService.resetFilters(() => this.loadTasks(true)); }

  updatePriority(taskId: number, newPriority: string) {
    this.kanbanService.updatePriority(taskId, newPriority, () => {
      this.tasks.update(list => list.map(t => t.id === taskId ? { ...t, priority: newPriority } : t));
      if (this.selectedTask()?.id === taskId) {
        this.selectedTask.update(t => t ? { ...t, priority: newPriority } : null);
      }
    });
  }

  updateStatus(taskId: number, newStatusId: number) {
    this.kanbanService.updateStatus(
      taskId,
      newStatusId,
      () => this.applyStatusToVisibleTasks(taskId, newStatusId),
      () => {
        if (this.selectedTask()?.id === taskId) {
          this.selectedTask.update(t => t ? { ...t, statusId: newStatusId } : null);
        }
      }
    );
  }

  executeStatusChange(task: Task, targetStatusId: number) {
    this.kanbanService.executeStatusChange(
      task,
      targetStatusId,
      this.getStatusName(targetStatusId),
      () => this.applyStatusToVisibleTasks(task.id, targetStatusId),
      () => {
        if (this.selectedTask()?.id === task.id) {
          this.selectedTask.update(t => t ? { ...t, statusId: targetStatusId } : null);
        }
      },
      () => this.loadTasks(true)
    );
  }

  private applyStatusToVisibleTasks(taskId: number, statusId: number) {
    this.kanbanService.applyStatusToVisibleTasks(taskId, statusId, this.statuses(), this.statusFilterMode, this.tasks);
  }

  exportTasks(format: 'xlsx' | 'csv'): void {
    this.showExportMenu = false;
    window.open(`/api/v1/reports/tasks/export?format=${format}`, '_blank');
  }

  // Lookups methods
  responsibleUserOptions(): SelectOption[] { return this.lookupsService.responsibleUserOptions(); }
  getAvailableParentTaskOptions(taskId: number): SelectOption[] { return this.lookupsService.getAvailableParentTaskOptions(taskId); }
  private getSelectedParentId(): number | null { return this.isEditModalOpen() ? this.editForm.parentTaskId : this.createForm.parentTaskId; }
  private getSelectedUserId(): number | null { return this.isEditModalOpen() ? this.editForm.responsibleUserId : this.createForm.responsibleUserId; }
  private getSelectedExecutorIds(): number[] { return this.isEditModalOpen() ? this.editForm.executorUserIds : this.createForm.executorUserIds; }
  private getSelectedObserverIds(): number[] { return this.isEditModalOpen() ? this.editForm.observerUserIds : this.createForm.observerUserIds; }

  onParentSearch(query: string) { this.lookupsService.onParentSearch(query, () => this.getSelectedParentId()); }
  loadMoreParents() { this.lookupsService.loadMoreParents(() => this.getSelectedParentId()); }
  retryParentLookup() { this.lookupsService.retryParentLookup(() => this.getSelectedParentId()); }
  onResponsibleSearch(query: string) { this.lookupsService.onResponsibleSearch(query, () => this.getSelectedUserId()); }
  loadMoreResponsibleUsers() { this.lookupsService.loadMoreResponsibleUsers(() => this.getSelectedUserId()); }
  retryResponsibleLookup() { this.lookupsService.retryResponsibleLookup(() => this.getSelectedUserId()); }
  onExecutorSearch(query: string) { this.lookupsService.onExecutorSearch(query, () => this.getSelectedExecutorIds()); }
  loadMoreExecutors() { this.lookupsService.loadMoreExecutors(() => this.getSelectedExecutorIds()); }
  retryExecutorLookup() { this.lookupsService.retryExecutorLookup(() => this.getSelectedExecutorIds()); }
  onObserverSearch(query: string) { this.lookupsService.onObserverSearch(query, () => this.getSelectedObserverIds()); }
  loadMoreObservers() { this.lookupsService.loadMoreObservers(() => this.getSelectedObserverIds()); }
  retryObserverLookup() { this.lookupsService.retryObserverLookup(() => this.getSelectedObserverIds()); }

  // Details methods
  openTaskDetails(task: Task) {
    this.detailsService.openTaskDetails(task, () => this.isEditModalOpen(), () => this.routeRecordId(), (id) => this.recordRouter?.navigate(['/tasks/items', id], { queryParamsHandling: 'preserve' }));
  }
  onTaskContainerClick(event: MouseEvent, task: Task) {
    this.detailsService.onTaskContainerClick(event, task, () => this.isEditModalOpen(), () => this.routeRecordId(), (id) => this.recordRouter?.navigate(['/tasks/items', id], { queryParamsHandling: 'preserve' }));
  }
  retryTaskDetails() { this.detailsService.retryTaskDetails(() => this.routeRecordId()); }
  closeTaskDetails(returnToList = true) {
    this.detailsService.closeTaskDetails(returnToList, () => this.routeRecordId(), () => this.recordRouter?.navigate(['/tasks/items'], { queryParamsHandling: 'preserve' }));
  }
  onTaskFileAttached(file: TaskFile) { this.detailsService.onTaskFileAttached(file); }
  onTaskFileRemoved(file: TaskFile) { this.detailsService.onTaskFileRemoved(file); }
  loadComments(taskId: number | string) { this.detailsService.loadComments(taskId, () => this.routeRecordId()); }
  retryComments() { this.detailsService.retryComments(() => this.routeRecordId()); }
  submitComment() { this.detailsService.submitComment(() => this.canCommentTask(), () => this.routeRecordId()); }

  // Forms methods
  openCreateTaskModal() {
    const defaultType = this.taskTypes().length > 0 ? this.taskTypes()[0].code : 'task';
    this.formsService.openCreateTaskModal(defaultType, this.selectedProjectId);
  }
  openAddSubtaskModal(parentTask: Task) {
    const defaultType = this.taskTypes().length > 0 ? this.taskTypes()[0].code : 'task';
    this.formsService.openAddSubtaskModal(parentTask, defaultType, (id, title) => this.lookupsService.retainParentOption(id, title));
  }
  requestCloseCreate() { this.formsService.requestCloseCreate(); }
  submitCreateTask() {
    this.formsService.submitCreateTask((parentId) => {
      this.loadTasks(true);
      if (this.selectedTask() && parentId === this.selectedTask()?.id) {
        this.detailsService.loadTaskFullDetails(this.selectedTask()!.id, () => this.routeRecordId());
      }
    });
  }
  openEditModal(task: Task) {
    this.formsService.openEditModal(
      task,
      () => {
        const ret = this.selectedTask()?.id === task.id ? this.selectedTask() : null;
        if (ret) this.closeTaskDetails(false);
        return ret;
      },
      (m) => this.lookupsService.retainTaskMember(m),
      (id, title) => this.lookupsService.retainParentOption(id, title),
      (respId, execIds, obsIds) => this.lookupsService.syncSelectedUsers(respId, execIds, obsIds)
    );
  }
  retryEditLoad() {
    this.formsService.retryEditLoad(
      (m) => this.lookupsService.retainTaskMember(m),
      (id, title) => this.lookupsService.retainParentOption(id, title),
      (respId, execIds, obsIds) => this.lookupsService.syncSelectedUsers(respId, execIds, obsIds)
    );
  }
  requestCloseEdit() { this.formsService.requestCloseEdit((t) => this.openTaskDetails(t)); }
  confirmDiscardEdit() { this.formsService.confirmDiscardEdit((t) => this.openTaskDetails(t)); }
  cancelDiscardEdit() { this.formsService.cancelDiscardEdit(); }
  canLeaveRecordPage() {
    return this.formsService.canLeaveRecordPage(() => this.isCommentSubmitting(), () => this.commentDraft, (t) => this.openTaskDetails(t));
  }
  submitEditTask() {
    this.formsService.submitEditTask((returnTask, editedTaskId) => {
      this.loadTasks(true);
      if (returnTask) this.openTaskDetails({ ...returnTask, id: editedTaskId });
    });
  }

  // Kanban / Drag & Drop
  onTaskDrop(event: CdkDragDrop<Task[]>, targetStatusId: number) { this.kanbanService.onTaskDrop(event, targetStatusId, this.canUpdateTask(), (task, sId) => this.executeStatusChange(task, sId)); }
  onHtml5DragStart(event: DragEvent, task: Task) { this.kanbanService.onHtml5DragStart(event, task, this.canUpdateTask()); }
  onHtml5DragOver(event: DragEvent) { this.kanbanService.onHtml5DragOver(event, this.canUpdateTask()); }
  onHtml5DragLeave(event: DragEvent) { this.kanbanService.onHtml5DragLeave(event, this.canUpdateTask()); }
  onHtml5Drop(event: DragEvent, targetStatusId: number) {
    this.kanbanService.onHtml5Drop(event, targetStatusId, this.canUpdateTask(), (task, sId) => this.executeStatusChange(task, sId));
  }
  getTasksByStatus(statusId: number) { return this.kanbanService.getTasksByStatus(statusId, this.tasks()); }
  isFirstStatus(statusId: number) { return this.kanbanService.isFirstStatus(statusId, this.statuses()); }
  isLastStatus(statusId: number) { return this.kanbanService.isLastStatus(statusId, this.statuses()); }
  moveTaskStatus(task: Task, direction: -1 | 1) {
    this.kanbanService.moveTaskStatus(task, direction, this.statuses(), this.canUpdateTask(), (id, sId) => this.updateStatus(id, sId));
  }

  // Dictionaries methods
  openSettingsModal() { this.dictService.openSettingsModal(); }
  handleCreateType(e: any) { this.dictService.handleCreateType(e); }
  handleCreateStatus(e: any) { this.dictService.handleCreateStatus(e); }
  handleDeleteDictionaryItem(t: any) { this.dictService.handleDeleteDictionaryItem(t); }
  handleReorderTypes(l: any) { this.dictService.handleReorderTypes(l); }
  handleReorderStatuses(l: any) { this.dictService.handleReorderStatuses(l); }

  // Helpers
  getTypeObj(task: Task) { return getTypeObj(task, this.taskTypes()); }
  getTypeLabel(task: Task) { return getTypeLabel(task, this.taskTypes(), this.uiI18n); }
  getTypeIcon(task: Task) { return getTypeIcon(task, this.taskTypes()); }
  getTypeColor(task: Task) { return getTypeColor(task, this.taskTypes()); }
  getTypeBg(task: Task) { return getTypeBg(task, this.taskTypes()); }
  getProjectName(projectId: number | null | undefined) { return getProjectName(projectId, this.projects()); }
  getStatusName(statusId: number | null | undefined) { return getStatusName(statusId, this.statuses(), this.uiI18n); }
  getStatusColor(statusId: number | null | undefined) { return getStatusColor(statusId, this.statuses()); }
  getPriorityLabel(priority: string) { return getPriorityLabel(priority, this.uiI18n); }
  isOverdue(endTime: string | null | undefined, statusId: number) { return isOverdue(endTime, statusId, this.statuses()); }
  getDeadlineInfo(endTime: string | null | undefined, statusId: number) { return getDeadlineInfo(endTime, statusId, this.statuses(), this.uiI18n); }
  getInvolveKindLabel(kind: string | undefined) { return getInvolveKindLabel(kind, this.uiI18n); }
  getInitials(name: string | undefined) { return getInitials(name); }
  hasAttributes(attrs: any) { return hasAttributes(attrs); }
  formatAttributes(attrs: any) { return formatAttributes(attrs, this.taskCustomFields(), this.responsibleUsers(), this.observerUsers(), this.uiI18n); }
}
