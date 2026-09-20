import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/services/api.service';
import { PermissionService } from '../../core/services/permission.service';
import { ToastService } from '../../core/services/toast.service';
import { UiButtonComponent } from '../../shared/ui/ui-button.component';
import { TranslatePipe, I18nService } from '../../core/services/i18n.service';

import {
  AnnouncementState,
  AnnouncementBannerType,
  AnnouncementAdminRecord,
  AnnouncementDraftPayload,
  Confirmation,
  ApiProblem
} from './announcements.models';

import { AnnouncementsToolbarComponent } from './components/announcements-toolbar.component';
import { AnnouncementsListComponent } from './components/announcements-list.component';
import { AnnouncementsModalsComponent } from './components/announcements-modals.component';

export type {
  AnnouncementState,
  AnnouncementBannerType,
  AnnouncementAdminRecord,
  AnnouncementDraftPayload,
  Confirmation,
  ApiProblem
};

@Component({
  selector: 'app-announcements',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    UiButtonComponent,
    AnnouncementsToolbarComponent,
    AnnouncementsListComponent,
    AnnouncementsModalsComponent
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
      <app-announcements-toolbar
        *ngIf="announcements().length > 0"
        [totalCount]="announcements().length"
        [publishedCount]="publishedCount()"
        [draftCount]="draftCount()"
        [archivedCount]="archivedCount()"
        [statusFilter]="statusFilter()"
        [searchQuery]="searchQuery()"
        (filterChange)="setStatusFilter($event)"
        (searchChange)="searchQuery.set($event)"
        (searchClear)="searchQuery.set('')"
      />

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

      <!-- Announcement Cards List -->
      <app-announcements-list
        *ngIf="filteredAnnouncements().length > 0"
        [items]="filteredAnnouncements()"
        [activeId]="activeAnnouncementId()"
        [canUpdate]="canUpdate()"
        [canPublish]="canPublish()"
        [canArchive]="canArchive()"
        (edit)="openEdit($event)"
        (publish)="requestConfirmation('publish', $event)"
        (archive)="requestConfirmation('archive', $event)"
      />

      <!-- Modals (Editor + Confirmation) -->
      <app-announcements-modals
        [isEditorOpen]="isEditorOpen()"
        [editingId]="editingId"
        [isSaving]="isSaving()"
        [draftTitles]="draftTitles()"
        (draftTitlesChange)="draftTitles.set($event)"
        [draftBodies]="draftBodies()"
        (draftBodiesChange)="draftBodies.set($event)"
        [bannerType]="bannerType()"
        (bannerTypeChange)="bannerType.set($event)"
        [confirmation]="confirmation()"
        (closeEditor)="closeEditor()"
        (saveDraft)="saveDraft()"
        (confirmAction)="executeConfirmedAction()"
        (cancelConfirmation)="confirmation.set(null)"
      />
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

    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 680px) {
      .view-header { flex-direction: column; }
      .header-actions { width: 100%; }
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

  editingId: number | null = null;
  editingLockVersion: number | null = null;
  readonly bannerType = signal<AnnouncementBannerType>('INFO');

  readonly draftTitles = signal<Record<string, string>>({ ru: '' });
  readonly draftBodies = signal<Record<string, string>>({ ru: '' });

  get titleRu(): string {
    return this.draftTitles()['ru'] || '';
  }
  set titleRu(val: string) {
    this.draftTitles.set({ ...this.draftTitles(), ru: val });
  }

  get bodyRu(): string {
    return this.draftBodies()['ru'] || '';
  }
  set bodyRu(val: string) {
    this.draftBodies.set({ ...this.draftBodies(), ru: val });
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
    this.draftTitles.set({ ru: '' });
    this.draftBodies.set({ ru: '' });
    this.bannerType.set('INFO');
    this.operationError.set(null);
    this.isEditorOpen.set(true);
  }

  openEdit(item: AnnouncementAdminRecord): void {
    this.editingId = item.id;
    this.editingLockVersion = item.lockVersion;
    const titles = { ...item.titleJson };
    const bodies = { ...item.bodyJson };
    if (!titles['ru']) titles['ru'] = '';
    if (!bodies['ru']) bodies['ru'] = '';
    this.draftTitles.set(titles);
    this.draftBodies.set(bodies);
    this.bannerType.set(item.bannerType);
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
    for (const [k, v] of Object.entries(this.draftTitles())) {
      if (v && v.trim()) titleJson[k] = v.trim();
    }
    titleJson['ru'] = this.titleRu.trim();

    const bodyJson: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.draftBodies())) {
      if (v && v.trim()) bodyJson[k] = v.trim();
    }
    bodyJson['ru'] = this.bodyRu.trim();

    const payload: AnnouncementDraftPayload = {
      titleJson,
      bodyJson,
      bannerType: this.bannerType(),
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
