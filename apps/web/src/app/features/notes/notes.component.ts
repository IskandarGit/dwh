import { Component, OnInit, OnDestroy, signal, computed, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, finalize } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { PermissionService } from '../../core/services/permission.service';
import { UiButtonComponent } from '../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../shared/ui/ui-modal.component';
import { UiMarkdownEditorComponent } from '../../shared/ui/ui-markdown-editor.component';
import { UiMarkdownViewComponent } from '../../shared/ui/ui-markdown-view.component';
import { UiCustomFieldsComponent } from '../../shared/ui/ui-custom-fields.component';
import { CustomField } from '../../core/models/custom-field.models';
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
  imports: [
    CommonModule,
    FormsModule,
    UiButtonComponent,
    UiModalComponent,
    UiMarkdownEditorComponent,
    UiMarkdownViewComponent,
    UiCustomFieldsComponent,
    TranslatePipe
  ],
  template: `
    <div class="notes-view" role="region" [attr.aria-label]="'notes.title' | t">
      <div class="view-header">
        <div class="header-left">
          <h1 class="view-title">{{ 'notes.title' | t }}</h1>
          <span class="count-badge" [attr.aria-label]="'notes.title' | t">{{ notes().length }}</span>

          <div class="tabs-bar" role="tablist" [attr.aria-label]="'notes.title' | t">
            <button
              type="button"
              class="tab-btn"
              [class.active]="activeTab() === 'all'"
              role="tab"
              [attr.aria-selected]="activeTab() === 'all'"
              (click)="activeTab.set('all')"
            >
              {{ 'notes.tab.all' | t }}
            </button>
            <button
              type="button"
              class="tab-btn"
              [class.active]="activeTab() === 'pinned'"
              role="tab"
              [attr.aria-selected]="activeTab() === 'pinned'"
              (click)="activeTab.set('pinned')"
            >
              {{ 'notes.tab.pinned' | t }}
            </button>
          </div>
        </div>
        <div class="header-right">
          <div class="search-box">
            <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
            <input
              type="text"
              class="search-input"
              [placeholder]="'notes.search_placeholder' | t"
              [attr.aria-label]="'notes.search_placeholder' | t"
              [ngModel]="searchQuery"
              (ngModelChange)="onSearchChange($event)"
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
            [attr.aria-label]="'notes.create' | t"
            (onClick)="openCreateModal()"
          >
            {{ 'notes.create' | t }}
          </ui-button>
        </div>
      </div>

      <!-- Notes Grid -->
      <div class="notes-grid" *ngIf="filteredNotes().length > 0; else emptyState">
        <div
          *ngFor="let note of filteredNotes()"
          class="note-card"
          [ngClass]="'color-' + (note.color || 'default')"
          [class.is-pinned]="note.isPinned"
        >
          <div class="card-header">
            <span class="note-title">{{ note.title }}</span>
            <div class="card-actions">
              <button
                type="button"
                class="icon-btn"
                [class.pinned]="note.isPinned"
                [attr.aria-label]="note.isPinned ? ('notes.unpin' | t) : ('notes.pin' | t)"
                [attr.aria-pressed]="note.isPinned"
                [title]="note.isPinned ? ('notes.unpin' | t) : ('notes.pin' | t)"
                (click)="togglePin(note)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">{{ note.isPinned ? 'keep' : 'push_pin' }}</span>
              </button>
              <button
                *ngIf="canEdit()"
                type="button"
                class="icon-btn"
                [attr.aria-label]="'common.edit' | t"
                [title]="'common.edit' | t"
                (click)="openEditModal(note)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">edit</span>
              </button>
              <button
                *ngIf="canDelete()"
                type="button"
                class="icon-btn text-danger"
                [attr.aria-label]="'common.delete' | t"
                [title]="'common.delete' | t"
                (click)="deleteNote(note)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">delete</span>
              </button>
            </div>
          </div>

          <div class="card-body">
            <ui-markdown-view class="note-content" [content]="note.contentMd"></ui-markdown-view>
          </div>

          <div class="card-footer">
            <span class="note-date">{{ note.modifiedAt | date:'short' }}</span>
          </div>
        </div>
      </div>

      <ng-template #emptyState>
        <div class="empty-state">
          <span class="material-symbols-outlined empty-icon" aria-hidden="true">description</span>
          <h3>{{ 'notes.empty_title' | t }}</h3>
          <p>{{ 'notes.empty_desc' | t }}</p>
          <ui-button
            *ngIf="canCreate()"
            variant="primary"
            size="md"
            icon="add"
            [attr.aria-label]="'notes.create' | t"
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
        size="md"
        [dismissible]="!isSaving()"
        (close)="closeModal()"
      >
        <form ngNoForm (submit)="$event.preventDefault(); saveNote()" class="modal-form" novalidate id="noteForm">
          <div class="form-group">
            <label class="form-label" for="note-title-input">{{ 'notes.title_label' | t }} *</label>
            <input
              id="note-title-input"
              name="title"
              type="text"
              class="form-control"
              [class.has-error]="isSubmitted() && !formData.title.trim()"
              [attr.aria-invalid]="isSubmitted() && !formData.title.trim()"
              [attr.aria-describedby]="isSubmitted() && !formData.title.trim() ? 'note-title-error' : null"
              maxlength="255"
              [(ngModel)]="formData.title"
              [ngModelOptions]="{standalone: true}"
              [placeholder]="'notes.title_placeholder' | t"
              required
            />
            <span id="note-title-error" class="field-error" *ngIf="isSubmitted() && !formData.title.trim()">
              {{ 'notes.title_required' | t }}
            </span>
          </div>

          <div class="form-group">
            <label class="form-label">{{ 'notes.content_label' | t }}</label>
            <ui-markdown-editor
              [value]="formData.contentMd"
              [placeholder]="'notes.content_placeholder' | t"
              [ariaLabel]="'notes.content_label' | t"
              [rows]="6"
              (valueChange)="formData.contentMd = $event"
            ></ui-markdown-editor>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="note-color-select">{{ 'notes.color_label' | t }}</label>
              <select
                id="note-color-select"
                name="color"
                class="form-control"
                [(ngModel)]="formData.color"
                [ngModelOptions]="{standalone: true}"
              >
                <option value="default">{{ 'notes.color_default' | t }}</option>
                <option value="blue">{{ 'notes.color_blue' | t }}</option>
                <option value="green">{{ 'notes.color_green' | t }}</option>
                <option value="yellow">{{ 'notes.color_yellow' | t }}</option>
                <option value="purple">{{ 'notes.color_purple' | t }}</option>
                <option value="red">{{ 'notes.color_red' | t }}</option>
              </select>
            </div>

            <div class="form-group checkbox-group">
              <label class="checkbox-label" for="note-pinned-checkbox">
                <input
                  id="note-pinned-checkbox"
                  name="isPinned"
                  type="checkbox"
                  [(ngModel)]="formData.isPinned"
                  [ngModelOptions]="{standalone: true}"
                />
                <span>{{ 'notes.pinned_label' | t }}</span>
              </label>
            </div>
          </div>

          <!-- Custom Fields -->
          <div class="custom-fields-section" *ngIf="noteCustomFields().length > 0">
            <h4 class="custom-fields-title">{{ 'nav.custom_fields' | t }}</h4>
            <ui-custom-fields
              [fields]="noteCustomFields()"
              [(values)]="formData.attributes"
            ></ui-custom-fields>
          </div>
        </form>

        <div footer>
          <div class="modal-footer-actions">
            <ui-button variant="secondary" [disabled]="isSaving()" (onClick)="closeModal()">{{ 'common.cancel' | t }}</ui-button>
            <ui-button variant="primary" type="submit" form="noteForm" [loading]="isSaving()" (onClick)="saveNote()">{{ 'common.save' | t }}</ui-button>
          </div>
        </div>
      </ui-modal>

      <!-- Delete Confirmation Modal -->
      <ui-modal
        [isOpen]="!!deletingNote()"
        [title]="'common.delete' | t"
        size="sm"
        [dismissible]="!isDeleting()"
        (close)="cancelDelete()"
      >
        <p class="delete-dialog-text">
          {{ 'notes.delete_confirm' | t:{ title: deletingNote()?.title || '' } }}
        </p>
        <div footer>
          <div class="modal-footer-actions">
            <ui-button variant="secondary" [disabled]="isDeleting()" (onClick)="cancelDelete()">{{ 'common.cancel' | t }}</ui-button>
            <ui-button variant="danger" [loading]="isDeleting()" (onClick)="confirmDelete()">{{ 'common.delete' | t }}</ui-button>
          </div>
        </div>
      </ui-modal>
    </div>
  `,
  styleUrl: './notes.component.css'
})
export class NotesComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private perm = inject(PermissionService);
  private destroyRef = inject(DestroyRef);
  private readonly uiI18n = inject(I18nService);

  private readonly searchSubject = new Subject<string>();

  notes = signal<Note[]>([]);
  activeTab = signal<'all' | 'pinned'>('all');
  searchQuery = '';
  isModalOpen = signal(false);
  editingNote = signal<Note | null>(null);
  deletingNote = signal<Note | null>(null);
  isSaving = signal(false);
  isDeleting = signal(false);
  isSubmitted = signal(false);
  noteCustomFields = signal<CustomField[]>([]);

  formData = {
    title: '',
    contentMd: '',
    color: 'default',
    isPinned: false,
    attributes: {} as Record<string, any>
  };

  canCreate = computed(() => this.perm.hasPermission('notes', 'create'));
  canEdit = computed(() => this.perm.hasPermission('notes', 'update'));
  canDelete = computed(() => this.perm.hasPermission('notes', 'delete'));

  filteredNotes = computed(() => {
    const list = this.notes();
    if (this.activeTab() === 'pinned') {
      return list.filter(n => n.isPinned);
    }
    return list;
  });

  ngOnInit(): void {
    this.loadNotes();
    this.loadCustomFields();

    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => this.loadNotes());
  }

  ngOnDestroy(): void {
    this.searchSubject.complete();
  }

  loadNotes(): void {
    const params = this.searchQuery ? { q: this.searchQuery } : undefined;
    this.api.get<Note[]>('/notes', params).subscribe({
      next: (data) => this.notes.set(data || []),
      error: () => this.toast.error(this.uiI18n.translate('notes.load_error'))
    });
  }

  loadCustomFields(): void {
    this.api.get<CustomField[]>('/custom-fields', { entity_type: 'NOTE' }).subscribe({
      next: (data) => this.noteCustomFields.set(data || []),
      error: () => {}
    });
  }

  onSearchChange(value: string): void {
    this.searchQuery = value;
    this.searchSubject.next(value);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.loadNotes();
  }

  openCreateModal(): void {
    this.editingNote.set(null);
    this.isSubmitted.set(false);
    this.formData = {
      title: '',
      contentMd: '',
      color: 'default',
      isPinned: false,
      attributes: {}
    };
    this.isModalOpen.set(true);
  }

  openEditModal(note: Note): void {
    this.editingNote.set(note);
    this.isSubmitted.set(false);
    this.formData = {
      title: note.title,
      contentMd: note.contentMd,
      color: note.color || 'default',
      isPinned: note.isPinned,
      attributes: note.attributes ? { ...note.attributes } : {}
    };
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    if (this.isSaving()) return;
    this.isModalOpen.set(false);
  }

  saveNote(): void {
    this.isSubmitted.set(true);
    if (!this.formData.title.trim()) {
      this.toast.error(this.uiI18n.translate('notes.title_required'));
      return;
    }

    this.isSaving.set(true);
    const payload = {
      title: this.formData.title.trim(),
      contentMd: this.formData.contentMd || '',
      color: this.formData.color || 'default',
      isPinned: !!this.formData.isPinned,
      attributes: this.formData.attributes || {}
    };

    const current = this.editingNote();
    if (current) {
      this.api.put<Note>(`/notes/${current.id}`, payload).pipe(
        finalize(() => this.isSaving.set(false))
      ).subscribe({
        next: () => {
          this.toast.success(this.uiI18n.translate('notes.updated'));
          this.isSaving.set(false);
          this.isModalOpen.set(false);
          this.loadNotes();
        },
        error: () => this.toast.error(this.uiI18n.translate('notes.save_error'))
      });
    } else {
      this.api.post<Note>('/notes', payload).pipe(
        finalize(() => this.isSaving.set(false))
      ).subscribe({
        next: () => {
          this.toast.success(this.uiI18n.translate('notes.created'));
          this.isSaving.set(false);
          this.isModalOpen.set(false);
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
    this.deletingNote.set(note);
  }

  cancelDelete(): void {
    if (this.isDeleting()) return;
    this.deletingNote.set(null);
  }

  confirmDelete(): void {
    const note = this.deletingNote();
    if (!note) return;

    this.isDeleting.set(true);
    this.api.delete(`/notes/${note.id}`).pipe(
      finalize(() => this.isDeleting.set(false))
    ).subscribe({
      next: () => {
        this.toast.success(this.uiI18n.translate('notes.deleted'));
        this.deletingNote.set(null);
        this.loadNotes();
      },
      error: () => this.toast.error(this.uiI18n.translate('notes.delete_error'))
    });
  }
}
