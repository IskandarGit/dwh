import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { A11yModule } from '@angular/cdk/a11y';
import { ApiService } from '../../core/services/api.service';
import { PermissionService } from '../../core/services/permission.service';
import { ToastService } from '../../core/services/toast.service';
import { UiButtonComponent } from '../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../shared/ui/ui-modal.component';
import { TranslatePipe, I18nService } from '../../core/services/i18n.service';

export type AnnouncementState = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type AnnouncementBannerType = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AnnouncementAdminRecord {
  id: number;
  titleJson: Record<string, string>;
  bodyJson: Record<string, string>;
  bannerType: AnnouncementBannerType;
  state: AnnouncementState;
  createdBy: number | null;
  createdAt: string;
  modifiedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  lockVersion: number;
}

interface AnnouncementDraftPayload {
  titleJson: Record<string, string>;
  bodyJson: Record<string, string>;
  bannerType: AnnouncementBannerType;
  lockVersion: number | null;
}

interface Confirmation {
  action: 'publish' | 'archive';
  announcement: AnnouncementAdminRecord;
}

interface ApiProblem {
  status?: number;
  code?: string;
  detail?: string;
}

@Component({
  selector: 'app-announcements',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    FormsModule,
    A11yModule,
    UiButtonComponent,
    UiModalComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="announcements-page" aria-labelledby="announcements-title">
      <header class="view-header">
        <div>
          <p class="eyebrow">{{ 'announcements.lokalnye_soobscheniya' | t }}</p>
          <h1 id="announcements-title">{{ 'announcements.obyavleniya' | t }}</h1>
          <p class="subtitle">{{ 'announcements.publikuyte_vazhnye_soobscheniya_polzovatelyam_et' | t }}</p>
        </div>
        <div class="header-actions">
          <ui-button
            variant="secondary"
            icon="refresh"
            [loading]="isLoading()"
            [ariaLabel]="'announcements.obnovit_spisok_obyavleniy' | t"
            (onClick)="loadAnnouncements()"
          >{{ 'common.refresh' | t }}</ui-button>
          <ui-button
            *ngIf="canCreate()"
            icon="add"
            [ariaLabel]="'announcements.sozdat_obyavlenie' | t"
            (onClick)="openCreate()"
          >{{ 'common.create' | t }}</ui-button>
        </div>
      </header>

      <div *ngIf="operationError()" class="inline-alert" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">sync_problem</span>
        <div>
          <strong>{{ 'announcements.izmeneniya_ne_sohraneny' | t }}</strong>
          <p>{{ operationError() }}</p>
        </div>
        <ui-button variant="secondary" size="sm" [ariaLabel]="'announcements.obnovit_spisok_obyavleniy' | t" (onClick)="refreshAfterConflict()">
          {{ 'announcements.obnovit_spisok' | t }}
        </ui-button>
      </div>

      <!-- Toolbar: Tabs for status filtering & Search box -->
      <div class="toolbar" *ngIf="announcements().length > 0">
        <div class="status-tabs" role="tablist" [attr.aria-label]="'announcements.vse_statusy' | t">
          <button
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="statusFilter() === 'ALL'"
            [attr.aria-selected]="statusFilter() === 'ALL'"
            (click)="setStatusFilter('ALL')"
          >
            <span>{{ 'announcements.vse_statusy' | t }}</span>
            <span class="tab-count">{{ announcements().length }}</span>
          </button>
          <button
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="statusFilter() === 'PUBLISHED'"
            [attr.aria-selected]="statusFilter() === 'PUBLISHED'"
            (click)="setStatusFilter('PUBLISHED')"
          >
            <span>{{ 'announcements.status_published' | t }}</span>
            <span class="tab-count count-published">{{ publishedCount() }}</span>
          </button>
          <button
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="statusFilter() === 'DRAFT'"
            [attr.aria-selected]="statusFilter() === 'DRAFT'"
            (click)="setStatusFilter('DRAFT')"
          >
            <span>{{ 'announcements.status_draft' | t }}</span>
            <span class="tab-count count-draft">{{ draftCount() }}</span>
          </button>
          <button
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="statusFilter() === 'ARCHIVED'"
            [attr.aria-selected]="statusFilter() === 'ARCHIVED'"
            (click)="setStatusFilter('ARCHIVED')"
          >
            <span>{{ 'announcements.status_archived' | t }}</span>
            <span class="tab-count count-archived">{{ archivedCount() }}</span>
          </button>
        </div>

        <div class="search-box">
          <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
          <input
            type="search"
            class="search-input"
            [placeholder]="'announcements.poisk' | t"
            [attr.aria-label]="'announcements.poisk' | t"
            [value]="searchQuery()"
            (input)="onSearchInput($event)"
          />
          <button
            *ngIf="searchQuery().length > 0"
            type="button"
            class="clear-search-btn"
            (click)="searchQuery.set('')"
            [attr.aria-label]="'announcements.sbrosit_filtry' | t"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      </div>

      <div *ngIf="isLoading() && announcements().length === 0" class="state-panel" aria-busy="true" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <span>{{ 'announcements.zagruzhaem_obyavleniya' | t }}</span>
      </div>

      <div *ngIf="loadError() && !isLoading()" class="state-panel error-state" role="alert" data-testid="announcements-load-error">
        <span class="material-symbols-outlined" aria-hidden="true">cloud_off</span>
        <div>
          <h2>{{ 'announcements.ne_udalos_zagruzit_obyavleniya' | t }}</h2>
          <p>{{ 'announcements.proverte_soedinenie_s_serverom_i_povtorite_zapro' | t }}</p>
        </div>
        <ui-button variant="secondary" [ariaLabel]="'announcements.povtorit_zagruzku_obyavleniy' | t" (onClick)="loadAnnouncements()">{{ 'announcements.povtorit' | t }}</ui-button>
      </div>

      <div *ngIf="!isLoading() && !loadError() && announcements().length === 0" class="state-panel empty-state" data-testid="announcements-empty">
        <span class="material-symbols-outlined" aria-hidden="true">campaign</span>
        <div>
          <h2>{{ 'announcements.obyavleniy_poka_net' | t }}</h2>
          <p>{{ 'announcements.sozdayte_chernovik_proverte_tekst_i_opublikuyte_' | t }}</p>
        </div>
        <ui-button *ngIf="canCreate()" variant="secondary" icon="add" (onClick)="openCreate()">{{ 'announcements.sozdat_chernovik' | t }}</ui-button>
      </div>

      <!-- Empty state when search or tab filter matches nothing -->
      <div *ngIf="!isLoading() && !loadError() && announcements().length > 0 && filteredAnnouncements().length === 0" class="state-panel empty-state" role="status">
        <span class="material-symbols-outlined" aria-hidden="true">filter_list_off</span>
        <div>
          <h2>{{ 'announcements.po_filtram_nichego_ne_naydeno' | t }}</h2>
        </div>
        <ui-button variant="secondary" size="sm" (onClick)="resetFilters()">
          {{ 'announcements.sbrosit_filtry' | t }}
        </ui-button>
      </div>

      <div *ngIf="filteredAnnouncements().length > 0" class="announcement-list" aria-live="polite">
        <article *ngFor="let item of filteredAnnouncements(); trackBy: trackById" class="announcement-card" [attr.data-state]="item.state">
          <div class="card-marker" [class]="'card-marker marker-' + item.bannerType.toLowerCase()" aria-hidden="true"></div>
          <div class="card-main">
            <div class="card-heading">
              <div>
                <div class="card-meta">
                  <span class="state-badge" [class]="'state-badge state-' + item.state.toLowerCase()">
                    <span class="material-symbols-outlined badge-icon" aria-hidden="true">
                      {{ item.state === 'PUBLISHED' ? 'check_circle' : item.state === 'DRAFT' ? 'edit_note' : 'archive' }}
                    </span>
                    {{ stateLabel(item.state) }}
                  </span>
                  <span class="type-badge" [class]="'type-badge type-' + item.bannerType.toLowerCase()">
                    <span class="material-symbols-outlined badge-icon" aria-hidden="true">
                      {{ item.bannerType === 'CRITICAL' ? 'error' : item.bannerType === 'WARNING' ? 'warning' : 'info' }}
                    </span>
                    {{ bannerLabel(item.bannerType) }}
                  </span>
                  <span class="active-badge" *ngIf="item.id === activeAnnouncementId()">
                    <span class="material-symbols-outlined badge-icon" aria-hidden="true">sensors</span>
                    {{ 'announcements.aktivno_dlya_polzovateley' | t }}
                  </span>
                  <span class="id-tag">№{{ item.id }}</span>
                </div>
                <h2>{{ localizedValue(item.titleJson) || ('announcements.without_title' | t) }}</h2>
              </div>
              <div class="card-timestamps">
                <span *ngIf="item.publishedAt" class="meta-time">
                  {{ 'announcements.opublikovano_v' | t }} {{ item.publishedAt | date:'dd.MM.yyyy, HH:mm' }}
                </span>
                <span *ngIf="item.archivedAt" class="meta-time">
                  {{ 'announcements.arhivirovano_v' | t }} {{ item.archivedAt | date:'dd.MM.yyyy, HH:mm' }}
                </span>
                <time [attr.datetime]="item.modifiedAt">{{ item.modifiedAt | date:'dd.MM.yyyy, HH:mm' }}</time>
              </div>
            </div>
            <p class="announcement-body">{{ localizedValue(item.bodyJson) || ('announcements.empty_body' | t) }}</p>
            <div class="card-actions">
              <button
                *ngIf="item.state === 'DRAFT' && canUpdate()"
                type="button"
                class="text-action edit-action"
                (click)="openEdit(item)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">edit</span>
                {{ 'common.edit' | t }}
              </button>
              <button
                *ngIf="item.state === 'DRAFT' && canPublish()"
                type="button"
                class="text-action publish-action"
                [disabled]="!hasPublishableContent(item)"
                [attr.aria-describedby]="!hasPublishableContent(item) ? 'invalid-draft-' + item.id : null"
                (click)="requestConfirmation('publish', item)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">publish</span>
                {{ 'announcements.opublikovat' | t }}
              </button>
              <span *ngIf="item.state === 'DRAFT' && !hasPublishableContent(item)" class="invalid-hint" [id]="'invalid-draft-' + item.id">
                {{ 'announcements.zapolnite_ru_zagolovok_i_tekst' | t }}
              </span>
              <button
                *ngIf="item.state === 'PUBLISHED' && canArchive()"
                type="button"
                class="text-action archive-action"
                (click)="requestConfirmation('archive', item)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">archive</span>
                {{ 'announcements.arhivirovat' | t }}
              </button>
            </div>
          </div>
        </article>
      </div>

      <ui-modal
        [isOpen]="isEditorOpen()"
        [title]="(editingId === null ? 'announcements.new_announcement' : 'announcements.edit_announcement') | t"
        size="lg"
        [hasFooter]="false"
        (close)="closeEditor()"
      >
        <form body id="announcement-editor" class="editor-form" (ngSubmit)="saveDraft()" novalidate>
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
                <span class="char-count">{{ (draftTitles[selectedLang()] || '').length }} / 10 000</span>
              </div>
              <input
                id="announcement-title-other"
                name="announcementTitleOther"
                type="text"
                maxlength="10000"
                [(ngModel)]="draftTitles[selectedLang()]"
              />
            </div>
            <div class="field-group">
              <div class="field-header">
                <label for="announcement-body-other">{{ 'announcements.empty_body' | t }} ({{ selectedLang().toUpperCase() }})</label>
                <span class="char-count">{{ (draftBodies[selectedLang()] || '').length }} / 10 000</span>
              </div>
              <textarea
                id="announcement-body-other"
                name="announcementBodyOther"
                rows="7"
                maxlength="10000"
                [(ngModel)]="draftBodies[selectedLang()]"
              ></textarea>
            </div>
          </ng-container>

          <div class="field-group">
            <label for="announcement-banner-type">{{ 'announcements.uroven_soobscheniya' | t }}</label>
            <select id="announcement-banner-type" name="announcementBannerType" [(ngModel)]="bannerType">
              <option value="INFO">{{ 'announcements.informaciya' | t }}</option>
              <option value="WARNING">{{ 'announcements.preduprezhdenie' | t }}</option>
              <option value="CRITICAL">{{ 'announcements.kriticheskoe' | t }}</option>
            </select>
          </div>
          <div class="form-actions">
            <ui-button variant="secondary" (onClick)="closeEditor()">{{ 'common.cancel' | t }}</ui-button>
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
        (close)="confirmation.set(null)"
      >
        <div body *ngIf="confirmation() as pending" class="confirmation-copy">
          <p class="confirmation-target">
            <strong>«{{ localizedValue(pending.announcement.titleJson) }}»</strong>
          </p>
          <p *ngIf="pending.action === 'publish'">{{ 'announcements.posle_publikacii_obyavlenie_uvidyat_polzovateli_' | t }}</p>
          <p *ngIf="pending.action === 'archive'">{{ 'announcements.obyavlenie_ischeznet_u_polzovateley_i_ostanetsya' | t }}</p>
        </div>
        <div footer class="modal-actions">
          <ui-button variant="secondary" [disabled]="isSaving()" (onClick)="confirmation.set(null)">{{ 'common.cancel' | t }}</ui-button>
          <ui-button
            [variant]="confirmation()?.action === 'archive' ? 'danger' : 'primary'"
            [loading]="isSaving()"
            (onClick)="executeConfirmedAction()"
          >{{ (confirmation()?.action === 'archive' ? 'announcements.arhivirovat' : 'announcements.opublikovat') | t }}</ui-button>
        </div>
      </ui-modal>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .announcements-page { display: flex; flex-direction: column; gap: 18px; max-width: 1180px; margin: 0 auto; }
    .view-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
    .eyebrow { margin: 0 0 4px; color: var(--primary); font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; color: var(--text-main); font-size: 26px; line-height: 1.2; }
    .subtitle { margin: 8px 0 0; color: var(--text-muted); font-size: 13px; line-height: 1.5; }
    .header-actions { display: flex; gap: 8px; }

    /* Toolbar styling */
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      padding: 6px 0;
    }

    .status-tabs {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
    }

    .status-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      background: transparent;
      border: 0;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .status-tab:hover {
      background: var(--bg-hover);
      color: var(--text-main);
    }

    .status-tab.active {
      background: var(--primary-subtle);
      color: var(--primary);
      font-weight: 600;
    }

    .tab-count {
      font-size: 11px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--bg-hover);
      color: var(--text-muted);
    }

    .status-tab.active .tab-count {
      background: var(--primary);
      color: #ffffff;
    }

    .search-box {
      position: relative;
      display: flex;
      align-items: center;
      min-width: 240px;
    }

    .search-icon {
      position: absolute;
      left: 10px;
      font-size: 18px;
      color: var(--text-muted);
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      height: 34px;
      padding: 6px 30px 6px 32px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      background: var(--bg-surface);
      color: var(--text-main);
      font-size: 13px;
      box-sizing: border-box;
      transition: border-color 0.15s ease;
    }

    .search-input:focus {
      outline: none;
      border-color: var(--primary);
    }

    .clear-search-btn {
      position: absolute;
      right: 6px;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      border-radius: 50%;
    }

    .clear-search-btn:hover {
      background: var(--bg-hover);
      color: var(--text-main);
    }

    .clear-search-btn .material-symbols-outlined {
      font-size: 16px;
    }

    .announcement-list { display: flex; flex-direction: column; gap: 10px; }
    .announcement-card { position: relative; display: flex; overflow: hidden; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-lg); transition: border-color 0.15s ease, box-shadow 0.15s ease; }
    .announcement-card:hover { border-color: rgba(99, 102, 241, 0.3); }
    .card-marker { flex: 0 0 4px; background: var(--info, #3b82f6); }
    .marker-warning { background: var(--warning, #f59e0b); }
    .marker-critical { background: var(--danger, #ef4444); }
    .card-main { flex: 1; min-width: 0; padding: 16px 18px; }
    .card-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .card-heading h2 { margin: 7px 0 0; color: var(--text-main); font-size: 16px; }
    .card-timestamps { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex: 0 0 auto; color: var(--text-muted); font-size: 11px; }
    .meta-time { font-size: 11px; }
    .card-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--text-muted); font-size: 11px; }

    .state-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-weight: 600; font-size: 11px; }
    .state-draft { color: var(--warning, #d97706); background: var(--warning-bg, rgba(245, 158, 11, 0.12)); }
    .state-published { color: var(--success, #10b981); background: var(--success-bg, rgba(16, 185, 129, 0.12)); }
    .state-archived { color: var(--text-muted); background: var(--bg-hover); }

    .type-badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .type-info { color: var(--info, #2563eb); background: rgba(37, 99, 235, 0.1); }
    .type-warning { color: var(--warning, #d97706); background: rgba(217, 119, 6, 0.12); }
    .type-critical { color: var(--danger, #dc2626); background: rgba(220, 38, 38, 0.12); }

    .active-badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; color: #059669; background: rgba(16, 185, 129, 0.15); }
    .id-tag { font-size: 11px; color: var(--text-muted); }
    .badge-icon { font-size: 14px; }

    .announcement-body { margin: 10px 0 14px; color: var(--text-muted); font-size: 13px; line-height: 1.55; white-space: pre-line; }
    .card-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding-top: 12px; border-top: 1px solid var(--border-color); }
    .text-action { display: inline-flex; align-items: center; gap: 5px; padding: 4px 7px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--primary); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    .text-action:hover:not(:disabled) { background: var(--bg-hover); }
    .text-action:focus-visible, .primary-button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid var(--focus-ring, var(--primary)); outline-offset: 2px; }
    .text-action:disabled { color: var(--text-muted); cursor: not-allowed; opacity: .6; }
    .text-action .material-symbols-outlined { font-size: 17px; }
    .archive-action { color: var(--danger); }
    .invalid-hint { color: var(--text-muted); font-size: 11px; }
    .state-panel, .inline-alert { display: flex; align-items: center; gap: 14px; padding: 22px; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-lg); color: var(--text-muted); }
    .state-panel { justify-content: center; min-height: 180px; text-align: left; }
    .state-panel h2, .inline-alert strong { margin: 0; color: var(--text-main); font-size: 15px; }
    .state-panel p, .inline-alert p { margin: 4px 0 0; font-size: 12px; line-height: 1.45; }
    .empty-state { flex-direction: column; text-align: center; }
    .empty-state > .material-symbols-outlined { color: var(--primary); font-size: 38px; }
    .error-state > .material-symbols-outlined, .inline-alert > .material-symbols-outlined { color: var(--danger); font-size: 28px; }
    .error-state ui-button, .inline-alert ui-button { margin-left: auto; }
    .inline-alert { padding: 14px 16px; border-color: color-mix(in srgb, var(--danger) 35%, var(--border-color)); }
    .spinner { width: 20px; height: 20px; border: 2px solid var(--border-color); border-top-color: var(--primary); border-radius: 50%; animation: spin .7s linear infinite; }

    /* Modal Form */
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
    .primary-button:disabled { cursor: not-allowed; opacity: .5; }
    .confirmation-copy { color: var(--text-muted); font-size: 13px; line-height: 1.5; }
    .confirmation-copy p { margin: 0 0 8px 0; }
    .confirmation-target { margin-bottom: 12px !important; color: var(--text-main); font-size: 14px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 680px) {
      .view-header { flex-direction: column; }
      .header-actions { width: 100%; }
      .toolbar { flex-direction: column; align-items: stretch; }
      .search-box { width: 100%; }
      .card-heading { flex-direction: column; gap: 6px; }
      .card-timestamps { align-items: flex-start; }
      .card-main { padding: 14px; }
      .state-panel, .inline-alert { align-items: flex-start; flex-wrap: wrap; }
      .error-state ui-button, .inline-alert ui-button { margin-left: 42px; }
    }
    @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 1.5s; } }
  `]
})
export class AnnouncementsComponent implements OnInit {
  private readonly uiI18n = inject(I18nService);
  readonly announcements = signal<AnnouncementAdminRecord[]>([]);
  readonly isLoading = signal(true);
  readonly loadError = signal(false);
  readonly operationError = signal<string | null>(null);
  readonly isSaving = signal(false);
  readonly isEditorOpen = signal(false);
  readonly confirmation = signal<Confirmation | null>(null);

  readonly statusFilter = signal<'ALL' | 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'>('ALL');
  readonly searchQuery = signal('');
  readonly selectedLang = signal('ru');

  editingId: number | null = null;
  editingLockVersion: number | null = null;
  bannerType: AnnouncementBannerType = 'INFO';

  draftTitles: Record<string, string> = { ru: '' };
  draftBodies: Record<string, string> = { ru: '' };

  get titleRu(): string {
    return this.draftTitles['ru'] || '';
  }
  set titleRu(val: string) {
    this.draftTitles['ru'] = val;
  }

  get bodyRu(): string {
    return this.draftBodies['ru'] || '';
  }
  set bodyRu(val: string) {
    this.draftBodies['ru'] = val;
  }

  readonly draftCount = computed(() =>
    this.announcements().filter(a => a.state === 'DRAFT').length
  );

  readonly publishedCount = computed(() =>
    this.announcements().filter(a => a.state === 'PUBLISHED').length
  );

  readonly archivedCount = computed(() =>
    this.announcements().filter(a => a.state === 'ARCHIVED').length
  );

  readonly activeAnnouncementId = computed(() => {
    const published = this.announcements().filter(a => a.state === 'PUBLISHED');
    return published.length > 0 ? published[0].id : null;
  });

  readonly availableLanguages = computed(() => {
    return this.uiI18n.languages().filter(l => l.active);
  });

  readonly filteredAnnouncements = computed(() => {
    let list = this.announcements();
    const filter = this.statusFilter();
    if (filter !== 'ALL') {
      list = list.filter(a => a.state === filter);
    }
    const q = this.searchQuery().trim().toLowerCase();
    if (q) {
      list = list.filter(a => {
        const title = this.localizedValue(a.titleJson).toLowerCase();
        const body = this.localizedValue(a.bodyJson).toLowerCase();
        const idStr = String(a.id);
        return title.includes(q) || body.includes(q) || idStr.includes(q);
      });
    }
    return list;
  });

  constructor(
    private readonly api: ApiService,
    private readonly permissions: PermissionService,
    private readonly toast: ToastService
  ) {}

  ngOnInit(): void {
    this.loadAnnouncements();
  }

  setStatusFilter(filter: 'ALL' | 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'): void {
    this.statusFilter.set(filter);
  }

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  resetFilters(): void {
    this.statusFilter.set('ALL');
    this.searchQuery.set('');
  }

  loadAnnouncements(): void {
    this.isLoading.set(true);
    this.loadError.set(false);
    this.api.get<AnnouncementAdminRecord[]>('/announcements/manage').subscribe({
      next: records => {
        this.announcements.set(records ?? []);
        this.isLoading.set(false);
      },
      error: () => {
        this.loadError.set(true);
        this.isLoading.set(false);
      }
    });
  }

  canCreate(): boolean {
    return this.permissions.canCreate('platform.announcements');
  }

  canUpdate(): boolean {
    return this.permissions.canUpdate('platform.announcements');
  }

  canPublish(): boolean {
    return this.permissions.hasPermission('platform.announcements', 'publish');
  }

  canArchive(): boolean {
    return this.permissions.hasPermission('platform.announcements', 'archive');
  }

  openCreate(): void {
    this.editingId = null;
    this.editingLockVersion = null;
    this.draftTitles = { ru: '' };
    this.draftBodies = { ru: '' };
    this.selectedLang.set('ru');
    this.bannerType = 'INFO';
    this.operationError.set(null);
    this.isEditorOpen.set(true);
  }

  openEdit(item: AnnouncementAdminRecord): void {
    this.editingId = item.id;
    this.editingLockVersion = item.lockVersion;
    this.draftTitles = { ...item.titleJson };
    this.draftBodies = { ...item.bodyJson };
    if (!this.draftTitles['ru']) this.draftTitles['ru'] = '';
    if (!this.draftBodies['ru']) this.draftBodies['ru'] = '';
    this.selectedLang.set('ru');
    this.bannerType = item.bannerType;
    this.operationError.set(null);
    this.isEditorOpen.set(true);
  }

  closeEditor(): void {
    if (!this.isSaving()) {
      this.isEditorOpen.set(false);
    }
  }

  isDraftValid(): boolean {
    return this.titleRu.trim().length > 0
      && this.titleRu.length <= 10_000
      && this.bodyRu.trim().length > 0
      && this.bodyRu.length <= 10_000;
  }

  hasPublishableContent(item: AnnouncementAdminRecord): boolean {
    return this.localizedValue(item.titleJson).trim().length > 0
      && this.localizedValue(item.bodyJson).trim().length > 0;
  }

  saveDraft(): void {
    if (!this.isDraftValid() || this.isSaving()) {
      return;
    }
    const titleJson: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.draftTitles)) {
      if (v && v.trim()) titleJson[k] = v.trim();
    }
    titleJson['ru'] = this.titleRu.trim();

    const bodyJson: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.draftBodies)) {
      if (v && v.trim()) bodyJson[k] = v.trim();
    }
    bodyJson['ru'] = this.bodyRu.trim();

    const payload: AnnouncementDraftPayload = {
      titleJson,
      bodyJson,
      bannerType: this.bannerType,
      lockVersion: this.editingLockVersion
    };
    this.isSaving.set(true);
    this.operationError.set(null);
    const request = this.editingId === null
      ? this.api.post<AnnouncementAdminRecord>('/announcements', payload)
      : this.api.put<AnnouncementAdminRecord>(`/announcements/${this.editingId}`, payload);
    request.subscribe({
      next: saved => {
        this.upsert(saved);
        this.isSaving.set(false);
        this.isEditorOpen.set(false);
        this.toast.success(this.editingId === null ? this.uiI18n.translate('announcements.chernovik_sozdan') : this.uiI18n.translate('announcements.chernovik_sohranen'));
      },
      error: (problem: ApiProblem) => {
        this.isSaving.set(false);
        this.handleMutationError(problem);
      }
    });
  }

  requestConfirmation(action: Confirmation['action'], announcement: AnnouncementAdminRecord): void {
    if (action === 'publish' && !this.hasPublishableContent(announcement)) {
      return;
    }
    this.operationError.set(null);
    this.confirmation.set({ action, announcement });
  }

  confirmationTitle(): string {
    return this.confirmation()?.action === 'archive'
      ? this.uiI18n.translate('announcements.arhivirovat_obyavlenie')
      : this.uiI18n.translate('announcements.opublikovat_obyavlenie');
  }

  executeConfirmedAction(): void {
    const pending = this.confirmation();
    if (!pending || this.isSaving()) {
      return;
    }
    this.isSaving.set(true);
    const path = `/announcements/${pending.announcement.id}/${pending.action}`;
    this.api.post<AnnouncementAdminRecord>(path, { lockVersion: pending.announcement.lockVersion }).subscribe({
      next: saved => {
        this.upsert(saved);
        this.isSaving.set(false);
        this.confirmation.set(null);
        this.toast.success(pending.action === 'publish' ? this.uiI18n.translate('announcements.obyavlenie_opublikovano') : this.uiI18n.translate('announcements.obyavlenie_arhivirovano'));
      },
      error: (problem: ApiProblem) => {
        this.isSaving.set(false);
        this.confirmation.set(null);
        this.handleMutationError(problem);
      }
    });
  }

  refreshAfterConflict(): void {
    this.operationError.set(null);
    this.isEditorOpen.set(false);
    this.confirmation.set(null);
    this.loadAnnouncements();
  }

  localizedValue(values: Record<string, string> | null | undefined): string {
    if (!values) {
      return '';
    }
    const current = this.uiI18n.currentLang();
    return values[current] ?? values['ru'] ?? Object.values(values).find(value => value?.trim().length > 0) ?? '';
  }

  stateLabel(state: AnnouncementState): string {
    return ({ DRAFT: this.uiI18n.translate('announcements.chernovik'), PUBLISHED: this.uiI18n.translate('announcements.opublikovano'), ARCHIVED: this.uiI18n.translate('projects.arhiv') } as const)[state];
  }

  bannerLabel(type: AnnouncementBannerType): string {
    return ({ INFO: this.uiI18n.translate('announcements.informaciya'), WARNING: this.uiI18n.translate('announcements.preduprezhdenie'), CRITICAL: this.uiI18n.translate('announcements.kriticheskoe') } as const)[type];
  }

  trackById(_index: number, item: AnnouncementAdminRecord): number {
    return item.id;
  }

  private upsert(saved: AnnouncementAdminRecord): void {
    const records = this.announcements();
    const exists = records.some(item => item.id === saved.id);
    this.announcements.set(exists
      ? records.map(item => item.id === saved.id ? saved : item)
      : [saved, ...records]);
  }

  private handleMutationError(problem: ApiProblem): void {
    if (problem?.status === 409 || problem?.code === 'CONFLICT') {
      this.operationError.set(this.uiI18n.translate('announcements.eto_obyavlenie_uzhe_izmeneno_drugim_polzovatelem'));
      return;
    }
    this.operationError.set(problem?.detail || this.uiI18n.translate('announcements.ne_udalos_sohranit_izmenenie_povtorite_popytku'));
  }
}
