import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FileDetail } from '../files.models';
import { TaskFile } from '../../../core/models/task.models';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiFileUploadComponent } from '../../../shared/ui/ui-file-upload.component';
import { TranslatePipe } from '../../../core/services/i18n.service';

@Component({
  selector: 'app-files-modals',
  standalone: true,
  imports: [
    CommonModule,
    UiModalComponent,
    UiButtonComponent,
    UiFileUploadComponent,
    TranslatePipe
  ],
  template: `
    <!-- Upload Modal -->
    <ui-modal
      [isOpen]="isUploadModalOpen"
      [title]="'files.zagruzka_faylov_v_hranilische' | t"
      size="md"
      (close)="closeUpload.emit()"
    >
      <div body class="upload-modal-body">
        <ui-file-upload
          [files]="uploadedBatch"
          [canUpload]="true"
          [canDelete]="true"
          (fileAttached)="batchFileUploaded.emit($event)"
          (fileRemoved)="batchFileRemoved.emit($event)"
        ></ui-file-upload>
      </div>
      <div footer class="modal-footer-actions">
        <ui-button variant="secondary" (onClick)="closeUpload.emit()">{{ 'audit.zakryt' | t }}</ui-button>
      </div>
    </ui-modal>

    <!-- Confirm Delete Modal -->
    <ui-modal
      [isOpen]="fileToDelete !== null"
      [title]="'files.podtverzhdenie_udaleniya' | t"
      [dismissible]="!isDeleting"
      size="sm"
      (close)="cancelDelete.emit()"
    >
      <div body *ngIf="fileToDelete">
        <p>{{ 'files.vy_deystvitelno_hotite_udalit_fayl' | t }} <strong>{{ fileToDelete.originalName }}</strong>?</p>
        <p class="text-muted text-xs">{{ 'files.quota_will_be_released' | t:{size: formatBytes(fileToDelete.sizeBytes)} }}</p>
      </div>
      <div footer class="modal-footer-actions">
        <ui-button variant="secondary" [disabled]="isDeleting" (onClick)="cancelDelete.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="danger" [loading]="isDeleting" [disabled]="!fileToDelete || !canDeleteFn(fileToDelete)" (onClick)="executeDelete.emit()">{{ 'common.delete' | t }}</ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    :host {
      display: contents;
    }

    .upload-modal-body {
      padding: 8px 0;
    }

    .modal-footer-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }
  `]
})
export class FilesModalsComponent {
  @Input() isUploadModalOpen = false;
  @Input() uploadedBatch: TaskFile[] = [];
  @Input() fileToDelete: FileDetail | null = null;
  @Input() isDeleting = false;
  @Input() canDeleteFn: (file: FileDetail) => boolean = () => false;

  @Output() closeUpload = new EventEmitter<void>();
  @Output() batchFileUploaded = new EventEmitter<TaskFile>();
  @Output() batchFileRemoved = new EventEmitter<TaskFile>();
  @Output() cancelDelete = new EventEmitter<void>();
  @Output() executeDelete = new EventEmitter<void>();

  formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
