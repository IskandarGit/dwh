import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { PermissionService } from '../../core/services/permission.service';
import { UiButtonComponent } from '../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../shared/ui/ui-modal.component';
import { TranslatePipe, I18nService } from '../../core/services/i18n.service';

export interface Note {
  id: number;
  title: string;
  contentMd: string;
  color: string;
  isPinned: boolean;
  attributes: Record<string, any>;
  createdBy: number;
  createdAt: string;
  modifiedAt: string;
}

@Component({
  selector: 'app-notes',
  standalone: true,
  imports: [CommonModule, FormsModule, UiButtonComponent, UiModalComponent, TranslatePipe],
  template: `
    <div class="notes-view">
      <div class="view-header">
        <div class="header-left">
          <h1 class="view-title">{{ 'nav.notes' | t }}</h1>
          <span class="count-badge">{{ notes().length }}</span>
        </div>
        <div class="header-right">
          <div class="search-box">
            <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
            <input
              type="text"
              class="search-input"
              [placeholder]="'common.search' | t"
              [(ngModel)]="searchQuery"
              (ngModelChange)="onSearchChange()"
            />
            <button
              *ngIf="searchQuery"
              type="button"
              class="search-clear-btn"
              [attr.aria-label]="'search.clear_query' | t"
              (click)="clearSearch()"
            >
              <span class="material-symbols-outlined" aria-hidden="true">cancel</span>
            </button>
          </div>
          <ui-button
            *ngIf="canCreate()"
            variant="primary"
            size="md"
            icon="add"
            (onClick)="openCreateModal()"
          >
            {{ 'notes.create' | t }}
          </ui-button>
        </div>
      </div>

      <!-- Notes Grid -->
      <div class="notes-grid" *ngIf="notes().length > 0; else emptyState">
        <div
          *ngFor="let note of notes()"
          class="note-card"
          [ngClass]="'color-' + note.color"
          [class.is-pinned]="note.isPinned"
        >
          <div class="card-header">
            <span class="note-title">{{ note.title }}</span>
            <div class="card-actions">
              <button
                type="button"
                class="icon-btn"
                [class.pinned]="note.isPinned"
                [title]="note.isPinned ? ('notes.unpin' | t) : ('notes.pin' | t)"
                (click)="togglePin(note)"
              >
                <span class="material-symbols-outlined">{{ note.isPinned ? 'keep' : 'push_pin' }}</span>
              </button>
              <button
                *ngIf="canEdit()"
                type="button"
                class="icon-btn"
                [title]="'common.edit' | t"
                (click)="openEditModal(note)"
              >
                <span class="material-symbols-outlined">edit</span>
              </button>
              <button
                *ngIf="canDelete()"
                type="button"
                class="icon-btn text-danger"
                [title]="'common.delete' | t"
                (click)="deleteNote(note)"
              >
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>
          </div>

          <div class="card-body">
            <p class="note-content">{{ note.contentMd }}</p>
          </div>

          <div class="card-footer">
            <span class="note-date">{{ note.modifiedAt | date:'short' }}</span>
          </div>
        </div>
      </div>

      <ng-template #emptyState>
        <div class="empty-state">
          <span class="material-symbols-outlined empty-icon">description</span>
          <h3>{{ 'notes.empty_title' | t }}</h3>
          <p>{{ 'notes.empty_desc' | t }}</p>
          <ui-button
            *ngIf="canCreate()"
            variant="primary"
            size="md"
            icon="add"
            (onClick)="openCreateModal()"
          >
            {{ 'notes.create' | t }}
          </ui-button>
        </div>
      </ng-template>

      <!-- Modal Create / Edit -->
      <ui-modal
        [isOpen]="isModalOpen()"
        [title]="editingNote() ? ('notes.edit_title' | t) : ('notes.create_title' | t)"
        (onClose)="closeModal()"
      >
        <div class="modal-form">
          <div class="form-group">
            <label class="form-label">{{ 'notes.title_label' | t }} *</label>
            <input
              type="text"
              class="form-control"
              [(ngModel)]="formData.title"
              [placeholder]="'notes.title_placeholder' | t"
            />
          </div>

          <div class="form-group">
            <label class="form-label">{{ 'notes.content_label' | t }}</label>
            <textarea
              class="form-control"
              rows="6"
              [(ngModel)]="formData.contentMd"
              [placeholder]="'notes.content_placeholder' | t"
            ></textarea>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">{{ 'notes.color_label' | t }}</label>
              <select class="form-control" [(ngModel)]="formData.color">
                <option value="default">{{ 'notes.color_default' | t }}</option>
                <option value="blue">{{ 'notes.color_blue' | t }}</option>
                <option value="green">{{ 'notes.color_green' | t }}</option>
                <option value="yellow">{{ 'notes.color_yellow' | t }}</option>
                <option value="purple">{{ 'notes.color_purple' | t }}</option>
                <option value="red">{{ 'notes.color_red' | t }}</option>
              </select>
            </div>

            <div class="form-group checkbox-group">
              <label class="checkbox-label">
                <input type="checkbox" [(ngModel)]="formData.isPinned" />
                <span>{{ 'notes.pinned_label' | t }}</span>
              </label>
            </div>
          </div>
        </div>

        <div class="modal-footer" slot="footer">
          <ui-button variant="secondary" (onClick)="closeModal()">{{ 'common.cancel' | t }}</ui-button>
          <ui-button variant="primary" (onClick)="saveNote()">{{ 'common.save' | t }}</ui-button>
        </div>
      </ui-modal>
    </div>
  `,
  styles: [`
    .notes-view {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .view-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .view-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-primary, #1e293b);
      margin: 0;
    }
    .count-badge {
      background: var(--bg-surface-secondary, #f1f5f9);
      padding: 2px 10px;
      border-radius: 9999px;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-secondary, #64748b);
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .search-box {
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-icon {
      position: absolute;
      left: 10px;
      font-size: 18px;
      color: var(--text-secondary, #64748b);
    }
    .search-input {
      padding: 8px 30px 8px 34px;
      border-radius: 8px;
      border: 1px solid var(--border-color, #e2e8f0);
      background: var(--bg-surface, #ffffff);
      font-size: 0.875rem;
      width: 220px;
    }
    .search-clear-btn {
      position: absolute;
      right: 8px;
      background: none;
      border: none;
      color: var(--text-muted, #94a3b8);
      cursor: pointer;
      display: flex;
      align-items: center;
      padding: 0;
    }
    .search-clear-btn:hover {
      color: var(--text-main, #0f172a);
    }
    .search-clear-btn .material-symbols-outlined {
      font-size: 18px;
    }
    .notes-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }
    .note-card {
      border: 1px solid var(--border-color, #e2e8f0);
      border-radius: 12px;
      padding: 16px;
      background: var(--bg-surface, #ffffff);
      display: flex;
      flex-direction: column;
      gap: 12px;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .note-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }
    .note-card.is-pinned {
      border-color: #3b82f6;
      box-shadow: 0 0 0 1px #3b82f6;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }
    .note-title {
      font-weight: 600;
      font-size: 1.05rem;
      color: var(--text-primary, #1e293b);
    }
    .card-actions {
      display: flex;
      gap: 4px;
    }
    .icon-btn {
      background: transparent;
      border: none;
      padding: 4px;
      border-radius: 6px;
      cursor: pointer;
      color: var(--text-secondary, #64748b);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon-btn:hover {
      background: var(--bg-hover, #f1f5f9);
      color: var(--text-primary, #0f172a);
    }
    .icon-btn.pinned {
      color: #3b82f6;
    }
    .text-danger:hover {
      color: #ef4444;
    }
    .card-body {
      flex: 1;
    }
    .note-content {
      font-size: 0.9rem;
      color: var(--text-secondary, #475569);
      margin: 0;
      white-space: pre-wrap;
      max-height: 160px;
      overflow-y: auto;
    }
    .card-footer {
      font-size: 0.75rem;
      color: var(--text-muted, #94a3b8);
      border-top: 1px solid var(--border-color, #f1f5f9);
      padding-top: 8px;
    }
    /* Color tags */
    .color-blue { border-top: 4px solid #3b82f6; }
    .color-green { border-top: 4px solid #10b981; }
    .color-yellow { border-top: 4px solid #f59e0b; }
    .color-purple { border-top: 4px solid #8b5cf6; }
    .color-red { border-top: 4px solid #ef4444; }

    .empty-state {
      text-align: center;
      padding: 48px;
      border: 2px dashed var(--border-color, #e2e8f0);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .empty-icon {
      font-size: 48px;
      color: var(--text-secondary, #94a3b8);
    }
    .modal-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-row {
      display: flex;
      gap: 16px;
      align-items: center;
    }
    .form-label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-primary, #334155);
    }
    .form-control {
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid var(--border-color, #cbd5e1);
      font-size: 0.875rem;
      background: var(--bg-surface, #ffffff);
    }
    .checkbox-group {
      margin-top: 24px;
    }
    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.875rem;
      cursor: pointer;
    }
    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `]
})
export class NotesComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private perm = inject(PermissionService);

  notes = signal<Note[]>([]);
  searchQuery = '';
  isModalOpen = signal(false);
  editingNote = signal<Note | null>(null);

  formData = {
    title: '',
    contentMd: '',
    color: 'default',
    isPinned: false
  };

  private readonly uiI18n = inject(I18nService);

  canCreate = computed(() => this.perm.hasPermission('notes', 'create'));
  canEdit = computed(() => this.perm.hasPermission('notes', 'update'));
  canDelete = computed(() => this.perm.hasPermission('notes', 'delete'));

  ngOnInit(): void {
    this.loadNotes();
  }

  loadNotes(): void {
    const params = this.searchQuery ? { q: this.searchQuery } : undefined;
    this.api.get<Note[]>('/notes', params).subscribe({
      next: (data) => this.notes.set(data || []),
      error: () => this.toast.error(this.uiI18n.translate('notes.load_error'))
    });
  }

  onSearchChange(): void {
    this.loadNotes();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.loadNotes();
  }

  openCreateModal(): void {
    this.editingNote.set(null);
    this.formData = { title: '', contentMd: '', color: 'default', isPinned: false };
    this.isModalOpen.set(true);
  }

  openEditModal(note: Note): void {
    this.editingNote.set(note);
    this.formData = {
      title: note.title,
      contentMd: note.contentMd,
      color: note.color,
      isPinned: note.isPinned
    };
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
  }

  saveNote(): void {
    if (!this.formData.title.trim()) {
      this.toast.error(this.uiI18n.translate('notes.title_required'));
      return;
    }

    const current = this.editingNote();
    if (current) {
      this.api.put<Note>(`/notes/${current.id}`, this.formData).subscribe({
        next: () => {
          this.toast.success(this.uiI18n.translate('notes.updated'));
          this.closeModal();
          this.loadNotes();
        },
        error: () => this.toast.error(this.uiI18n.translate('notes.save_error'))
      });
    } else {
      this.api.post<Note>('/notes', this.formData).subscribe({
        next: () => {
          this.toast.success(this.uiI18n.translate('notes.created'));
          this.closeModal();
          this.loadNotes();
        },
        error: () => this.toast.error(this.uiI18n.translate('notes.create_error'))
      });
    }
  }

  togglePin(note: Note): void {
    this.api.post<Note>(`/notes/${note.id}/pin`, {}).subscribe({
      next: () => this.loadNotes(),
      error: () => this.toast.error(this.uiI18n.translate('notes.pin_error'))
    });
  }

  deleteNote(note: Note): void {
    if (!confirm(this.uiI18n.translate('notes.delete_confirm', { title: note.title }))) return;
    this.api.delete(`/notes/${note.id}`).subscribe({
      next: () => {
        this.toast.success(this.uiI18n.translate('notes.deleted'));
        this.loadNotes();
      },
      error: () => this.toast.error(this.uiI18n.translate('notes.delete_error'))
    });
  }
}
