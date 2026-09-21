import { Component, OnDestroy, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { finalize, Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { PermissionService } from '../../core/services/permission.service';
import { ToastService } from '../../core/services/toast.service';
import { UiButtonComponent } from '../../shared/ui/ui-button.component';
import { TaskFile } from '../../core/models/task.models';
import { TranslatePipe, I18nService } from '../../core/services/i18n.service';
import { FileDetail, StorageStats } from './files.models';
import { FilesMetricsCardsComponent } from './components/files-metrics-cards.component';
import { FilesToolbarComponent } from './components/files-toolbar.component';
import { FilesTableComponent } from './components/files-table.component';
import { FilesModalsComponent } from './components/files-modals.component';

export type { FileDetail, StorageStats } from './files.models';

@Component({
  selector: 'app-files',
  standalone: true,
  imports: [
    CommonModule,
    UiButtonComponent,
    TranslatePipe,
    FilesMetricsCardsComponent,
    FilesToolbarComponent,
    FilesTableComponent,
    FilesModalsComponent
  ],
  template: `
    <div class="files-page">
      <!-- Page Header -->
      <div class="view-header">
        <div class="header-left">
          <h1 class="view-title">{{ 'files.faylovoe_hranilische' | t }}</h1>
          <span class="count-badge">{{ files().length }}</span>
        </div>
        <div class="header-right">
          <ui-button variant="primary" icon="cloud_upload" (onClick)="isUploadModalOpen.set(true)">
            {{ 'files.zagruzit_fayl' | t }}
          </ui-button>
        </div>
      </div>

      <!-- Storage Quotas & Metrics Dashboard -->
      <app-files-metrics-cards [stats]="stats()"></app-files-metrics-cards>

      <!-- Filters & Search Toolbar -->
      <app-files-toolbar
        [scope]="scope"
        [searchQuery]="searchQuery"
        (scopeChange)="setScope($event)"
        (searchQueryChange)="onSearchQueryChange($event)"
        (search)="searchFiles()"
        (clear)="onClearSearch()"
        (refresh)="refreshAll()"
      ></app-files-toolbar>

      <!-- Files Table & Pagination -->
      <app-files-table
        [files]="paginatedFiles()"
        [allFilesCount]="files().length"
        [isLoading]="isLoading()"
        [pageSize]="pageSize"
        [currentPage]="currentPage"
        [isDeleting]="isDeleting()"
        [canDeleteFn]="canDeleteFileBound"
        (download)="downloadFile($event)"
        (delete)="confirmDeleteFile($event)"
        (pageChange)="currentPage = $event"
        (pageSizeChange)="onPageSizeChange($event)"
      ></app-files-table>

      <!-- Modals (Upload & Delete Confirmation) -->
      <app-files-modals
        [isUploadModalOpen]="isUploadModalOpen()"
        [uploadedBatch]="uploadedBatch()"
        [fileToDelete]="fileToDelete"
        [isDeleting]="isDeleting()"
        [canDeleteFn]="canDeleteFileBound"
        (closeUpload)="closeUploadModal()"
        (batchFileUploaded)="onBatchFileUploaded($event)"
        (batchFileRemoved)="onBatchFileRemoved($event)"
        (cancelDelete)="cancelDeleteFile()"
        (executeDelete)="executeDeleteFile()"
      ></app-files-modals>
    </div>
  `,
  styles: [`
    .files-page {
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding: 0;
      max-width: 1400px;
      margin: 0 auto;
    }

    .view-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .view-title {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-main);
      margin: 0;
    }

    .count-badge {
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      background: var(--primary-subtle);
      color: var(--primary-text);
    }
  `]
})
export class FilesComponent implements OnInit, OnDestroy {
  private readonly uiI18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private listRequest?: Subscription;
  private statsRequest?: Subscription;
  private destroyed = false;
  readonly files = signal<FileDetail[]>([]);
  readonly stats = signal<StorageStats | null>(null);
  readonly isLoading = signal<boolean>(false);
  readonly isUploadModalOpen = signal<boolean>(false);
  readonly uploadedBatch = signal<TaskFile[]>([]);
  readonly isDeleting = signal(false);

  scope: 'all' | 'mine' = 'all';
  searchQuery = '';
  currentPage = 1;
  pageSize = 15;

  fileToDelete: FileDetail | null = null;

  readonly canDeleteFileBound = (file: FileDetail) => this.canDeleteFile(file);

  constructor(
    private api: ApiService,
    private permService: PermissionService,
    private toast: ToastService
  ) {}

  ngOnInit() {
    this.refreshAll();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.listRequest?.unsubscribe();
    this.statsRequest?.unsubscribe();
  }

  refreshAll() {
    this.loadStats();
    this.loadFiles();
  }

  loadStats() {
    if (this.destroyed) return;
    this.statsRequest?.unsubscribe();
    this.statsRequest = this.api.get<StorageStats>('/files/storage/stats').subscribe({
      next: res => this.stats.set(res),
      error: () => {}
    });
  }

  loadFiles() {
    if (this.destroyed) return;
    this.listRequest?.unsubscribe();
    this.isLoading.set(true);
    this.listRequest = this.api.get<FileDetail[]>('/files', {
      scope: this.scope,
      q: this.searchQuery,
      limit: 100
    }).subscribe({
      next: res => {
        this.files.set(res || []);
        const lastPage = Math.max(1, Math.ceil(this.files().length / this.pageSize));
        this.currentPage = Math.max(1, Math.min(this.currentPage, lastPage));
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  searchFiles() {
    this.currentPage = 1;
    this.loadFiles();
  }

  setScope(scope: 'all' | 'mine') {
    this.scope = scope;
    this.currentPage = 1;
    this.loadFiles();
  }

  onSearchQueryChange(query: string) {
    this.searchQuery = query;
  }

  onClearSearch() {
    this.searchQuery = '';
    this.searchFiles();
  }

  onPageSizeChange(size: number) {
    this.pageSize = size;
    this.currentPage = 1;
  }

  paginatedFiles(): FileDetail[] {
    const list = this.files();
    const start = (this.currentPage - 1) * this.pageSize;
    return list.slice(start, start + this.pageSize);
  }

  downloadFile(file: FileDetail) {
    window.open(`/api/v1/files/${file.id}/download`, '_blank');
  }

  canDeleteFile(file: FileDetail): boolean {
    return this.permService.hasPermission('platform.files', 'delete') &&
      (this.permService.hasPermission('platform.files', 'manage_quotas') ||
        (file.createdBy != null && file.createdBy === this.auth.currentUser()?.id));
  }

  confirmDeleteFile(file: FileDetail) {
    if (this.isDeleting() || !this.canDeleteFile(file)) return;
    this.fileToDelete = file;
  }

  cancelDeleteFile() {
    if (!this.isDeleting()) this.fileToDelete = null;
  }

  executeDeleteFile() {
    if (this.isDeleting() || !this.fileToDelete || !this.canDeleteFile(this.fileToDelete)) return;
    const f = this.fileToDelete;
    this.isDeleting.set(true);
    this.api.delete(`/files/${f.id}`).pipe(
      finalize(() => this.isDeleting.set(false))
    ).subscribe({
      next: () => {
        this.toast.success(this.uiI18n.translate('files.deleted_named', { name: f.originalName }));
        this.fileToDelete = null;
        this.refreshAll();
      },
      error: () => {}
    });
  }

  onBatchFileUploaded(taskFile: TaskFile) {
    this.uploadedBatch.update(list => [...list, taskFile]);
    this.refreshAll();
  }

  onBatchFileRemoved(taskFile: TaskFile) {
    this.api.delete(`/files/${taskFile.fileId}`).subscribe({
      next: () => {
        this.uploadedBatch.update(list => list.filter(f => f.fileId !== taskFile.fileId));
        this.refreshAll();
      }
    });
  }

  closeUploadModal() {
    this.isUploadModalOpen.set(false);
    this.uploadedBatch.set([]);
    this.refreshAll();
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
