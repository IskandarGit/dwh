import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { AnnouncementAdminRecord, AnnouncementBannerType, AnnouncementState } from '../announcements.models';

@Component({
  selector: 'app-announcements-list',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="announcement-list" aria-live="polite">
      <article *ngFor="let item of items(); trackBy: trackById" class="announcement-card" [attr.data-state]="item.state">
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
                <span class="active-badge" *ngIf="item.id === activeId()">
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
              (click)="edit.emit(item)"
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
              (click)="publish.emit(item)"
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
              (click)="archive.emit(item)"
            >
              <span class="material-symbols-outlined" aria-hidden="true">archive</span>
              {{ 'announcements.arhivirovat' | t }}
            </button>
          </div>
        </div>
      </article>
    </div>
  `,
  styles: [`
    :host { display: block; }
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
    .text-action:focus-visible { outline: 2px solid var(--focus-ring, var(--primary)); outline-offset: 2px; }
    .text-action:disabled { color: var(--text-muted); cursor: not-allowed; opacity: .6; }
    .text-action .material-symbols-outlined { font-size: 17px; }
    .archive-action { color: var(--danger); }
    .invalid-hint { color: var(--text-muted); font-size: 11px; }

    @media (max-width: 680px) {
      .card-heading { flex-direction: column; gap: 6px; }
      .card-timestamps { align-items: flex-start; }
      .card-main { padding: 14px; }
    }
  `]
})
export class AnnouncementsListComponent {
  private readonly uiI18n = inject(I18nService);

  readonly items = input.required<AnnouncementAdminRecord[]>();
  readonly activeId = input<number | null>(null);
  readonly canUpdate = input<boolean>(false);
  readonly canPublish = input<boolean>(false);
  readonly canArchive = input<boolean>(false);

  readonly edit = output<AnnouncementAdminRecord>();
  readonly publish = output<AnnouncementAdminRecord>();
  readonly archive = output<AnnouncementAdminRecord>();

  localizedValue(values: Record<string, string> | null | undefined): string {
    if (!values) return '';
    const current = this.uiI18n.currentLang();
    return values[current] ?? values['ru'] ?? Object.values(values).find(value => value?.trim().length > 0) ?? '';
  }

  stateLabel(state: AnnouncementState): string {
    return ({
      DRAFT: this.uiI18n.translate('announcements.chernovik'),
      PUBLISHED: this.uiI18n.translate('announcements.opublikovano'),
      ARCHIVED: this.uiI18n.translate('projects.arhiv')
    } as const)[state];
  }

  bannerLabel(type: AnnouncementBannerType): string {
    return ({
      INFO: this.uiI18n.translate('announcements.informaciya'),
      WARNING: this.uiI18n.translate('announcements.preduprezhdenie'),
      CRITICAL: this.uiI18n.translate('announcements.kriticheskoe')
    } as const)[type];
  }

  hasPublishableContent(item: AnnouncementAdminRecord): boolean {
    return this.localizedValue(item.titleJson).trim().length > 0
      && this.localizedValue(item.bodyJson).trim().length > 0;
  }

  trackById(_index: number, item: AnnouncementAdminRecord): number {
    return item.id;
  }
}
