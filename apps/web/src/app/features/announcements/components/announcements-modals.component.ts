import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import { AnnouncementAdminRecord, AnnouncementBannerType, Confirmation } from '../announcements.models';

@Component({
  selector: 'app-announcements-modals',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, UiButtonComponent, UiModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Create / Edit Draft Modal -->
    <ui-modal
      [isOpen]="isEditorOpen()"
      [title]="(editingId() === null ? 'announcements.new_announcement' : 'announcements.edit_announcement') | t"
      size="lg"
      [hasFooter]="false"
      (close)="closeEditor.emit()"
    >
      <form body id="announcement-editor" class="editor-form" (ngSubmit)="onSaveDraft()" novalidate>
        <!-- Language selector tabs for multilingual content -->
        <div class="lang-selector-row">
          <span class="lang-selector-label">{{ 'announcements.yazyk_redaktirovaniya' | t }}:</span>
          <div class="lang-chips" role="tablist">
            <button
              *ngFor="let lang of availableLanguages()"
              type="button"
              role="tab"
              class="lang-chip"
              [class.active]="selectedLang() === lang.code"
              [attr.aria-selected]="selectedLang() === lang.code"
              (click)="selectedLang.set(lang.code)"
            >
              <span>{{ lang.name }}</span>
              <span class="lang-required-tag" *ngIf="lang.code === 'ru'">*</span>
            </button>
          </div>
        </div>

        <!-- Russian language inputs (Authoritative primary fields) -->
        <ng-container *ngIf="selectedLang() === 'ru'">
          <div class="field-group">
            <div class="field-header">
              <label for="announcement-title-ru">{{ 'announcements.zagolovok_ru' | t }} <span aria-hidden="true">*</span></label>
              <span class="char-count">{{ titleRu.length }} / 10 000 {{ 'announcements.simvolov' | t }}</span>
            </div>
            <input
              id="announcement-title-ru"
              name="announcementTitleRu"
              type="text"
              maxlength="10000"
              required
              [(ngModel)]="titleRu"
              [attr.aria-invalid]="titleRu.trim().length === 0"
              aria-describedby="announcement-title-hint"
            />
            <span id="announcement-title-hint" class="field-hint">{{ 'announcements.korotko_opishite_glavnoe_soobschenie' | t }}</span>
          </div>
          <div class="field-group">
            <div class="field-header">
              <label for="announcement-body-ru">{{ 'announcements.tekst_obyavleniya_ru' | t }} <span aria-hidden="true">*</span></label>
              <span class="char-count">{{ bodyRu.length }} / 10 000 {{ 'announcements.simvolov' | t }}</span>
            </div>
            <textarea
              id="announcement-body-ru"
              name="announcementBodyRu"
              rows="7"
              maxlength="10000"
              required
              [(ngModel)]="bodyRu"
              [attr.aria-invalid]="bodyRu.trim().length === 0"
              aria-describedby="announcement-body-hint"
            ></textarea>
            <span id="announcement-body-hint" class="field-hint">{{ 'announcements.do_10_000_simvolov_tekst_uvidyat_vse_polzovateli' | t }}</span>
          </div>
        </ng-container>

        <!-- Non-Russian language inputs -->
        <ng-container *ngIf="selectedLang() !== 'ru'">
          <div class="field-group">
            <div class="field-header">
              <label for="announcement-title-other">{{ 'task.title' | t }} ({{ selectedLang().toUpperCase() }})</label>
              <span class="char-count">{{ (draftTitles()[selectedLang()] || '').length }} / 10 000</span>
            </div>
            <input
              id="announcement-title-other"
              name="announcementTitleOther"
              type="text"
              maxlength="10000"
              [ngModel]="draftTitles()[selectedLang()]"
              (ngModelChange)="onDraftTitleChange(selectedLang(), $event)"
            />
          </div>
          <div class="field-group">
            <div class="field-header">
              <label for="announcement-body-other">{{ 'announcements.empty_body' | t }} ({{ selectedLang().toUpperCase() }})</label>
              <span class="char-count">{{ (draftBodies()[selectedLang()] || '').length }} / 10 000</span>
            </div>
            <textarea
              id="announcement-body-other"
              name="announcementBodyOther"
              rows="7"
              maxlength="10000"
              [ngModel]="draftBodies()[selectedLang()]"
              (ngModelChange)="onDraftBodyChange(selectedLang(), $event)"
            ></textarea>
          </div>
        </ng-container>

        <div class="field-group">
          <label for="announcement-banner-type">{{ 'announcements.uroven_soobscheniya' | t }}</label>
          <select
            id="announcement-banner-type"
            name="announcementBannerType"
            [ngModel]="bannerType()"
            (ngModelChange)="bannerTypeChange.emit($event)"
          >
            <option value="INFO">{{ 'announcements.informaciya' | t }}</option>
            <option value="WARNING">{{ 'announcements.preduprezhdenie' | t }}</option>
            <option value="CRITICAL">{{ 'announcements.kriticheskoe' | t }}</option>
          </select>
        </div>
        <div class="form-actions">
          <ui-button variant="secondary" (onClick)="closeEditor.emit()">{{ 'common.cancel' | t }}</ui-button>
          <button
            type="submit"
            class="primary-button"
            data-testid="save-draft"
            [disabled]="!isDraftValid() || isSaving()"
            [attr.aria-busy]="isSaving()"
          >{{ (isSaving() ? 'common.saving' : 'announcements.save_draft') | t }}</button>
        </div>
      </form>
    </ui-modal>

    <!-- Confirmation modal with action-specific button and item title -->
    <ui-modal
      [isOpen]="confirmation() !== null"
      [title]="confirmationTitle()"
      size="sm"
      [dismissible]="!isSaving()"
      (close)="cancelConfirmation.emit()"
    >
      <div body *ngIf="confirmation() as pending" class="confirmation-copy">
        <p class="confirmation-target">
          <strong>«{{ localizedValue(pending.announcement.titleJson) }}»</strong>
        </p>
        <p *ngIf="pending.action === 'publish'">{{ 'announcements.posle_publikacii_obyavlenie_uvidyat_polzovateli_' | t }}</p>
        <p *ngIf="pending.action === 'archive'">{{ 'announcements.obyavlenie_ischeznet_u_polzovateley_i_ostanetsya' | t }}</p>
      </div>
      <div footer class="modal-actions">
        <ui-button variant="secondary" [disabled]="isSaving()" (onClick)="cancelConfirmation.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button
          [variant]="confirmation()?.action === 'archive' ? 'danger' : 'primary'"
          [loading]="isSaving()"
          (onClick)="confirmAction.emit()"
        >{{ (confirmation()?.action === 'archive' ? 'announcements.arhivirovat' : 'announcements.opublikovat') | t }}</ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    :host { display: block; }
    .editor-form { display: flex; flex-direction: column; gap: 16px; }
    .lang-selector-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-bottom: 8px; border-bottom: 1px solid var(--border-color); }
    .lang-selector-label { font-size: 12px; font-weight: 600; color: var(--text-muted); }
    .lang-chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .lang-chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; font-size: 12px; font-weight: 500; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--text-muted); cursor: pointer; transition: all 0.15s ease; }
    .lang-chip:hover { background: var(--bg-hover); color: var(--text-main); }
    .lang-chip.active { background: var(--primary-subtle); border-color: var(--primary); color: var(--primary); font-weight: 600; }
    .lang-required-tag { color: var(--danger); font-weight: 700; }

    .field-group { display: flex; flex-direction: column; gap: 6px; }
    .field-header { display: flex; align-items: center; justify-content: space-between; }
    .field-group label { color: var(--text-main); font-size: 12px; font-weight: 600; }
    .char-count { font-size: 11px; color: var(--text-muted); }
    .field-group input, .field-group textarea, .field-group select { width: 100%; box-sizing: border-box; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font: inherit; font-size: 13px; padding: 9px 11px; }
    .field-group textarea { resize: vertical; min-height: 140px; line-height: 1.5; }
    .field-hint { color: var(--text-muted); font-size: 11px; }
    .form-actions, .modal-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
    .form-actions { margin: 4px -18px -18px; padding: 12px 18px; border-top: 1px solid var(--border-color); }
    .primary-button { height: 34px; padding: 6px 14px; border: 0; border-radius: var(--radius-sm); background: var(--primary); color: var(--text-inverse, #ffffff); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .primary-button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid var(--focus-ring, var(--primary)); outline-offset: 2px; }
    .primary-button:disabled { cursor: not-allowed; opacity: .5; }
    .confirmation-copy { color: var(--text-muted); font-size: 13px; line-height: 1.5; }
    .confirmation-copy p { margin: 0 0 8px 0; }
    .confirmation-target { margin-bottom: 12px !important; color: var(--text-main); font-size: 14px; }
  `]
})
export class AnnouncementsModalsComponent {
  private readonly uiI18n = inject(I18nService);

  readonly isEditorOpen = input.required<boolean>();
  readonly editingId = input<number | null>(null);
  readonly isSaving = input.required<boolean>();
  readonly draftTitles = input.required<Record<string, string>>();
  readonly draftBodies = input.required<Record<string, string>>();
  readonly bannerType = input.required<AnnouncementBannerType>();
  readonly confirmation = input<Confirmation | null>(null);

  readonly closeEditor = output<void>();
  readonly saveDraft = output<void>();
  readonly bannerTypeChange = output<AnnouncementBannerType>();
  readonly draftTitlesChange = output<Record<string, string>>();
  readonly draftBodiesChange = output<Record<string, string>>();
  readonly confirmAction = output<void>();
  readonly cancelConfirmation = output<void>();

  readonly selectedLang = signal('ru');

  readonly availableLanguages = () => this.uiI18n.languages().filter(l => l.active);

  get titleRu(): string {
    return this.draftTitles()['ru'] || '';
  }
  set titleRu(val: string) {
    this.draftTitlesChange.emit({ ...this.draftTitles(), ru: val });
  }

  get bodyRu(): string {
    return this.draftBodies()['ru'] || '';
  }
  set bodyRu(val: string) {
    this.draftBodiesChange.emit({ ...this.draftBodies(), ru: val });
  }

  onDraftTitleChange(lang: string, val: string): void {
    this.draftTitlesChange.emit({ ...this.draftTitles(), [lang]: val });
  }

  onDraftBodyChange(lang: string, val: string): void {
    this.draftBodiesChange.emit({ ...this.draftBodies(), [lang]: val });
  }

  isDraftValid(): boolean {
    return this.titleRu.trim().length > 0
      && this.titleRu.length <= 10_000
      && this.bodyRu.trim().length > 0
      && this.bodyRu.length <= 10_000;
  }

  onSaveDraft(): void {
    if (this.isDraftValid() && !this.isSaving()) {
      this.saveDraft.emit();
    }
  }

  confirmationTitle(): string {
    return this.confirmation()?.action === 'archive'
      ? this.uiI18n.translate('announcements.arhivirovat_obyavlenie')
      : this.uiI18n.translate('announcements.opublikovat_obyavlenie');
  }

  localizedValue(values: Record<string, string> | null | undefined): string {
    if (!values) return '';
    const current = this.uiI18n.currentLang();
    return values[current] ?? values['ru'] ?? Object.values(values).find(value => value?.trim().length > 0) ?? '';
  }
}
