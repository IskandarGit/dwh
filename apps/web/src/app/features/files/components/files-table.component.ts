import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FileDetail } from '../files.models';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination.component';
import { TranslatePipe } from '../../../core/services/i18n.service';

@Component({
  selector: 'app-files-table',
  standalone: true,
  imports: [
    CommonModule,
    UiPaginationComponent,
    TranslatePipe
  ],
  template: `
    <div class="table-container" role="region" [attr.aria-label]="'files.tablica_faylov' | t" tabindex="0" [attr.aria-busy]="isLoading">
      <table class="data-table" [attr.aria-label]="'files.spisok_faylov' | t">
        <thead>
          <tr>
            <th style="width: 48px;"></th>
            <th>{{ 'files.imya_fayla' | t }}</th>
            <th>{{ 'files.razmer' | t }}</th>
            <th>{{ 'files.tip_mime' | t }}</th>
            <th>{{ 'files.zagruzil' | t }}</th>
            <th>{{ 'files.data_zagruzki' | t }}</th>
            <th style="width: 100px; text-align: right;">{{ 'common.actions' | t }}</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let file of files">
            <!-- Icon -->
            <td>
              <div class="file-icon-wrapper" [ngClass]="getFileCategory(file.mimeType, file.originalName)">
                <span class="material-symbols-outlined" aria-hidden="true">{{ getFileIcon(file.mimeType, file.originalName) }}</span>
              </div>
            </td>

            <!-- File Name -->
            <td>
              <button type="button" class="file-name-cell" (click)="download.emit(file)" [attr.aria-label]="'files.download_named' | t:{name: file.originalName}" [title]="'files.skachat_fayl' | t">
                <span class="primary-name">{{ file.originalName }}</span>
                <span class="sha-sub text-muted text-xs font-mono">{{ file.sha256.substring(0, 12) }}...</span>
              </button>
            </td>

            <!-- Size -->
            <td>
              <span class="size-pill font-mono">{{ formatBytes(file.sizeBytes) }}</span>
            </td>

            <!-- MIME Type -->
            <td>
              <span class="mime-badge">{{ file.mimeType }}</span>
            </td>

            <!-- Creator -->
            <td>
              <div class="creator-cell" *ngIf="file.creatorName">
                <span class="creator-name">{{ file.creatorName }}</span>
                <span class="creator-login text-muted text-xs">&#64;{{ file.creatorLogin }}</span>
              </div>
              <span *ngIf="!file.creatorName" class="text-muted">—</span>
            </td>

            <!-- Date -->
            <td>
              <span class="date-cell tabular-nums">{{ file.createdAt | date:'dd.MM.yyyy HH:mm' }}</span>
            </td>

            <!-- Actions -->
            <td style="text-align: right;">
              <div class="row-actions">
                <button type="button" class="action-btn download-btn" [attr.aria-label]="'files.download_named' | t:{name: file.originalName}" (click)="download.emit(file)" [title]="'files.skachat' | t">
                  <span class="material-symbols-outlined" aria-hidden="true">download</span>
                </button>
                <button
                  *ngIf="canDeleteFn(file)"
                  type="button"
                  class="action-btn delete-btn"
                  [disabled]="isDeleting"
                  [attr.aria-label]="'files.delete_named' | t:{name: file.originalName}"
                  (click)="delete.emit(file)"
                  [title]="'common.delete' | t"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">delete</span>
                </button>
              </div>
            </td>
          </tr>

          <!-- Empty State -->
          <tr *ngIf="allFilesCount === 0 && !isLoading">
            <td colspan="7" class="empty-state-cell">
              <div class="empty-state-box">
                <span class="material-symbols-outlined empty-icon" aria-hidden="true">folder_open</span>
                <h3>{{ 'files.fayly_ne_naydeny' | t }}</h3>
                <p>{{ 'files.zagruzite_pervyy_fayl_s_pomoschyu_knopki_zagruzi' | t }}</p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Universal Pagination -->
    <ui-pagination
      *ngIf="allFilesCount > 0"
      [totalItems]="allFilesCount"
      [pageSize]="pageSize"
      [currentPage]="currentPage"
      (pageChange)="pageChange.emit($event)"
      (pageSizeChange)="pageSizeChange.emit($event)"
    ></ui-pagination>
  `,
  styles: [`
    :host {
      display: block;
    }

    .table-container {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      overflow-x: auto;
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }

    .data-table th {
      padding: 12px 16px;
      font-weight: 600;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
      background: var(--bg-surface);
    }

    .data-table td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-subtle);
      color: var(--text-main);
      vertical-align: middle;
    }

    .data-table tbody tr:hover {
      background: var(--bg-hover);
    }

    .data-table tbody tr:last-child td {
      border-bottom: none;
    }

    .file-icon-wrapper {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }

    .file-icon-wrapper.image { background: var(--success-bg); color: var(--success); }
    .file-icon-wrapper.pdf { background: var(--danger-bg); color: var(--danger); }
    .file-icon-wrapper.doc { background: var(--info-bg); color: var(--info); }
    .file-icon-wrapper.sheet { background: var(--success-bg); color: var(--success); }
    .file-icon-wrapper.archive { background: var(--warning-bg); color: var(--warning); }
    .file-icon-wrapper.other { background: var(--bg-hover); color: var(--text-muted); }

    .file-name-cell {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      background: transparent;
      border: none;
      padding: 0;
      cursor: pointer;
      text-align: left;
    }

    .file-name-cell:hover .primary-name {
      color: var(--primary);
      text-decoration: underline;
    }

    .primary-name {
      font-weight: 600;
      color: var(--text-main);
      font-size: 13px;
    }

    .sha-sub {
      font-size: 11px;
      color: var(--text-light);
    }

    .size-pill {
      font-size: 12px;
      color: var(--text-muted);
    }

    .mime-badge {
      font-size: 11px;
      font-family: monospace;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--bg-hover);
      color: var(--text-muted);
    }

    .creator-cell {
      display: flex;
      flex-direction: column;
    }

    .creator-name {
      font-size: 13px;
      color: var(--text-main);
    }

    .date-cell {
      font-size: 12px;
      color: var(--text-light);
    }

    .row-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
    }

    .action-btn {
      width: 28px;
      height: 28px;
      border-radius: 4px;
      border: none;
      background: transparent;
      color: var(--text-light);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .action-btn .material-symbols-outlined {
      font-size: 18px;
    }

    .action-btn.download-btn:hover {
      background: var(--primary-subtle);
      color: var(--primary-text);
    }

    .action-btn.delete-btn:hover {
      background: var(--danger-bg);
      color: var(--danger);
    }

    .empty-state-cell {
      padding: 48px !important;
      text-align: center;
    }

    .empty-state-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .empty-icon {
      font-size: 48px;
      color: var(--text-light);
    }

    .empty-state-box h3 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-main);
      margin: 0;
    }

    .empty-state-box p {
      font-size: 13px;
      color: var(--text-light);
      margin: 0;
    }
  `]
})
export class FilesTableComponent {
  @Input() files: FileDetail[] = [];
  @Input() allFilesCount: number = 0;
  @Input() isLoading: boolean = false;
  @Input() pageSize: number = 15;
  @Input() currentPage: number = 1;
  @Input() isDeleting: boolean = false;
  @Input() canDeleteFn: (file: FileDetail) => boolean = () => false;

  @Output() download = new EventEmitter<FileDetail>();
  @Output() delete = new EventEmitter<FileDetail>();
  @Output() pageChange = new EventEmitter<number>();
  @Output() pageSizeChange = new EventEmitter<number>();

  getFileCategory(mimeType?: string, fileName?: string): string {
    const mime = (mimeType || '').toLowerCase();
    const name = (fileName || '').toLowerCase();

    if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) return 'image';
    if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (/\.(docx?|odt|rtf|txt|md)$/.test(name)) return 'doc';
    if (/\.(xlsx?|csv|ods)$/.test(name)) return 'sheet';
    if (/\.(zip|tar|gz|rar|7z)$/.test(name)) return 'archive';
    return 'other';
  }

  getFileIcon(mimeType?: string, fileName?: string): string {
    const cat = this.getFileCategory(mimeType, fileName);
    switch (cat) {
      case 'image': return 'image';
      case 'pdf': return 'picture_as_pdf';
      case 'doc': return 'description';
      case 'sheet': return 'table_chart';
      case 'archive': return 'folder_zip';
      default: return 'attach_file';
    }
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
