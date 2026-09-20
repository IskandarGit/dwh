import { Component, OnDestroy, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { canonicalRecordId, recordResponseMatches, safeNumericRecordId } from '../../../core/services/search-target';
import { Subscription, Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { Project, ProjectTaskStats } from '../../../core/models/task.models';
import { CustomField } from '../../../core/models/custom-field.models';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { ProjectCreateForm, ProjectEditForm, ProjectViewState, ProjectStateFilter } from './projects.models';
import { ProjectFilterBarComponent } from './components/project-filter-bar.component';
import { ProjectTableViewComponent } from './components/project-table-view.component';
import { ProjectCardsViewComponent } from './components/project-cards-view.component';
import { ProjectModalsComponent } from './components/project-modals.component';
import { ProjectFormsService } from './services/project-forms.service';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TranslatePipe,
    UiButtonComponent,
    ProjectFilterBarComponent,
    ProjectTableViewComponent,
    ProjectCardsViewComponent,
    ProjectModalsComponent
  ],
  providers: [ProjectFormsService],
  templateUrl: './projects.component.html',
  styleUrl: './projects.component.css'
})
export class ProjectsComponent implements OnInit, OnDestroy {
  readonly forms = inject(ProjectFormsService);
  private readonly recordRoute = inject(ActivatedRoute, { optional: true });
  private recordRouteSubscription?: Subscription;
  private recordRequest?: Subscription;
  private recordRequestId = 0;
  readonly routeRecordId = signal<string | null>(null);
  readonly viewingProject = signal<Project | null>(null);
  readonly recordLoading = signal(false);
  readonly recordError = signal(false);
  readonly recordNotFound = signal(false);
  private listRequest?: Subscription;
  private statsRequest?: Subscription;
  private destroyed = false;

  readonly projects = signal<Project[]>([]);
  readonly projectStats = signal<Record<number, ProjectTaskStats>>({});
  readonly isLoading = signal<boolean>(false);
  readonly listLoadError = signal<boolean>(false);
  readonly listLoaded = signal<boolean>(false);
  readonly statsLoading = signal<boolean>(false);
  readonly statsLoadError = signal<boolean>(false);
  readonly statsLoaded = signal<boolean>(false);

  readonly isCreateModalOpen = this.forms.isCreateModalOpen;
  readonly isEditModalOpen = this.forms.isEditModalOpen;
  readonly isCreateDiscardConfirmationOpen = this.forms.isCreateDiscardConfirmationOpen;
  readonly isEditDiscardConfirmationOpen = this.forms.isEditDiscardConfirmationOpen;
  readonly isSubmitting = this.forms.isSubmitting;
  readonly editLoading = this.forms.editLoading;
  readonly editLoadError = this.forms.editLoadError;
  readonly createSaveError = this.forms.createSaveError;
  readonly editSaveError = this.forms.editSaveError;

  viewMode: ProjectViewState = 'list';
  searchQuery = '';
  selectedState: ProjectStateFilter = 'all';
  currentPage = 1;
  pageSize = 10;

  readonly projectCustomFields = signal<CustomField[]>([]);

  get createForm(): ProjectCreateForm { return this.forms.createForm; }
  set createForm(val: ProjectCreateForm) { this.forms.createForm = val; }

  get editForm(): ProjectEditForm { return this.forms.editForm; }
  set editForm(val: ProjectEditForm) { this.forms.editForm = val; }

  get isCreateSubmitted(): boolean { return this.forms.isCreateSubmitted; }
  set isCreateSubmitted(val: boolean) { this.forms.isCreateSubmitted = val; }

  get isEditSubmitted(): boolean { return this.forms.isEditSubmitted; }
  set isEditSubmitted(val: boolean) { this.forms.isEditSubmitted = val; }

  get editingProject(): Project | null { return this.forms.editingProject; }
  set editingProject(val: Project | null) { this.forms.editingProject = val; }

  constructor(
    public permService: PermissionService,
    private api: ApiService,
    private router: Router
  ) {}

  ngOnInit() {
    this.forms.onProjectCreated = (created) => {
      this.searchQuery = '';
      this.selectedState = 'all';
      this.loadProjects(created.id);
      this.loadStats();
    };
    this.forms.onProjectUpdated = () => {
      this.loadProjects();
      this.loadStats();
    };
    this.loadProjects();
    this.loadStats();
    this.loadProjectCustomFields();
    this.recordRouteSubscription = this.recordRoute?.paramMap?.subscribe(params => this.loadRecordView(params.get('id')));
  }

  ngOnDestroy() {
    this.forms.destroy();
    this.recordRouteSubscription?.unsubscribe();
    this.recordRequest?.unsubscribe();
    this.recordRequestId++;
    this.destroyed = true;
    this.listRequest?.unsubscribe();
    this.statsRequest?.unsubscribe();
  }

  canCreateProject(): boolean {
    return this.forms.canCreateProject();
  }

  canUpdateProject(): boolean {
    return this.forms.canUpdateProject();
  }

  canViewTasks(): boolean {
    return this.permService.canView('tasks.items');
  }

  openCreateModal() { this.forms.openCreateModal(); }
  requestCloseCreate() { this.forms.requestCloseCreate(); }
  confirmDiscardCreate() { this.forms.confirmDiscardCreate(); }
  submitCreateProject() { this.forms.submitCreateProject(); }

  openEditModal(p: Project) { this.forms.openEditModal(p); }
  retryEditLoad() { this.forms.retryEditLoad(); }
  requestCloseEdit() { this.forms.requestCloseEdit(); }
  confirmDiscardEdit() { this.forms.confirmDiscardEdit(); }
  submitEditProject() { this.forms.submitEditProject(); }

  cancelNavigationDiscard(kind: 'create' | 'edit') { this.forms.cancelNavigationDiscard(kind); }
  canLeaveRecordPage(): boolean | Observable<boolean> | Promise<boolean> { return this.forms.canLeaveRecordPage(); }

  loadProjects(focusProjectId?: number) {
    if (this.destroyed) return;

    this.listRequest?.unsubscribe();
    this.isLoading.set(true);
    this.listLoadError.set(false);
    this.listLoaded.set(false);
    this.projects.set([]);
    this.listRequest = this.api.get<Project[]>('/tasks/projects', undefined, { notifyError: false }).subscribe({
      next: res => {
        if (this.destroyed) return;
        this.isLoading.set(false);
        const projects = res || [];
        this.projects.set(projects);
        this.listLoaded.set(true);

        const filteredProjects = this.filteredProjects();
        if (focusProjectId !== undefined) {
          const projectIndex = filteredProjects.findIndex(project => project.id === focusProjectId);
          if (projectIndex >= 0) {
            this.currentPage = Math.floor(projectIndex / this.pageSize) + 1;
            return;
          }
        }

        this.clampCurrentPage();
      },
      error: () => {
        if (this.destroyed) return;
        this.isLoading.set(false);
        this.listLoadError.set(true);
      }
    });
  }

  loadStats() {
    this.statsRequest?.unsubscribe();
    this.projectStats.set({});
    this.statsLoading.set(false);
    this.statsLoadError.set(false);
    this.statsLoaded.set(false);

    if (this.destroyed || !this.canViewTasks()) return;

    this.statsLoading.set(true);
    this.statsRequest = this.api.get<ProjectTaskStats[]>('/tasks/projects/stats', undefined, { notifyError: false }).subscribe({
      next: res => {
        if (this.destroyed) return;
        const map: Record<number, ProjectTaskStats> = {};
        for (const s of res || []) {
          map[s.projectId] = s;
        }
        this.projectStats.set(map);
        this.statsLoading.set(false);
        this.statsLoaded.set(true);
      },
      error: () => {
        if (this.destroyed) return;
        this.statsLoading.set(false);
        this.statsLoadError.set(true);
      }
    });
  }

  setSearchQuery(value: string) {
    this.searchQuery = value;
    this.currentPage = 1;
  }

  clearSearch() {
    this.searchQuery = '';
    this.currentPage = 1;
  }

  setSelectedState(state: ProjectStateFilter) {
    this.selectedState = state;
    this.currentPage = 1;
  }

  setPage(page: number) {
    if (!this.isListReady()) return;
    this.currentPage = page;
  }

  setPageSize(pageSize: number) {
    if (!this.isListReady()) return;
    this.pageSize = pageSize;
    this.currentPage = 1;
  }

  isListReady(): boolean {
    return this.listLoaded() && !this.isLoading() && !this.listLoadError();
  }

  private clampCurrentPage() {
    const lastPage = Math.max(1, Math.ceil(this.filteredProjects().length / this.pageSize));
    this.currentPage = Math.min(this.currentPage, lastPage);
  }

  filteredProjects(): Project[] {
    const q = this.searchQuery.trim().toLowerCase();
    const st = this.selectedState;

    return this.projects().filter(p => {
      const matchSearch = !q || p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q));
      const matchState = st === 'all' || p.state === st;
      return matchSearch && matchState;
    });
  }

  paginatedProjects(): Project[] {
    const list = this.filteredProjects();
    const start = (this.currentPage - 1) * this.pageSize;
    return list.slice(start, start + this.pageSize);
  }

  viewProjectTasks(project: Project) {
    if (!this.canViewTasks() || !safeNumericRecordId(project.id)) return;
    this.router.navigate(['/tasks'], { queryParams: { project_id: project.id } });
  }

  loadRecordView(id: string | null) {
    const requestId = ++this.recordRequestId;
    this.recordRequest?.unsubscribe();
    this.routeRecordId.set(id);
    this.viewingProject.set(null);
    this.recordLoading.set(false);
    this.recordError.set(false);
    this.recordNotFound.set(false);
    if (id === null) return;
    if (!canonicalRecordId(id)) {
      this.recordError.set(true); this.recordNotFound.set(true); return;
    }
    this.recordLoading.set(true);
    this.recordRequest = this.api.get<Project>(`/tasks/projects/${id}`, undefined, { notifyError: false }).subscribe({
      next: project => {
        if (this.destroyed || requestId !== this.recordRequestId) return;
        this.recordLoading.set(false);
        if (recordResponseMatches(project?.id, id)) this.viewingProject.set(project);
        else this.recordError.set(true);
      },
      error: error => {
        if (this.destroyed || requestId !== this.recordRequestId) return;
        this.recordLoading.set(false); this.recordError.set(true);
        this.recordNotFound.set(error?.status === 404 || error?.status === 403);
      }
    });
  }

  closeRecordView() { this.router.navigate(['/tasks/projects'], { queryParamsHandling: 'preserve' }); }

  loadProjectCustomFields() {
    this.api.get<CustomField[]>('/custom-fields', { entity_type: 'PROJECT' }).subscribe({
      next: res => {
        if (Array.isArray(res)) {
          const validFields = res.filter(f => f && typeof f === 'object' && typeof f.code === 'string' && typeof f.fieldType === 'string');
          this.projectCustomFields.set(validFields);
        } else {
          this.projectCustomFields.set([]);
        }
      },
      error: () => {}
    });
  }
}
