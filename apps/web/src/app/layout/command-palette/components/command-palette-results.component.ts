import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SearchHit, SearchResult } from '../../../core/models/search.models';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';

@Component({
  selector: 'app-command-palette-results',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="palette-results">
      <div *ngIf="isLoading()" class="palette-loading" role="status" aria-live="polite">
        {{ 'layout.app_shell.poisk' | t }}
      </div>

      <div *ngIf="!isLoading() && errorMessage()" class="palette-error" role="alert">
        <span>{{ errorMessage() }}</span>
        <span *ngIf="retrySeconds() > 0">{{ 'search.retry_countdown' | t:{seconds: retrySeconds()} }}</span>
        <button type="button" class="palette-retry" [disabled]="retrySeconds() > 0 || !validQuery()" (click)="retry.emit()">
          {{ 'announcements.povtorit' | t }}
        </button>
      </div>

      <div *ngIf="metadata()?.degraded" class="palette-degraded" role="status">{{ 'search.degraded' | t }}</div>

      <div *ngIf="metadata() as meta" class="palette-count" role="status">
        {{ (meta.foundHits === null ? 'search.returned' : 'search.returned_found') | t:{returned: results().length, found: meta.foundHits ?? 0} }}
        <span *ngIf="meta.hasMore">{{ 'search.has_more' | t }}</span>
      </div>

      <div *ngIf="!isLoading() && !errorMessage() && metadata() && results().length === 0" class="palette-empty" role="status">
        {{ 'layout.command_palette.nothing_found_for' | t:{query: searchQuery()} }}
      </div>

      <!-- Hint & Recent Searches -->
      <div *ngIf="!isLoading() && queryLength(searchQuery()) < 2" class="palette-hint">
        <div class="hint-text">
          <span class="material-symbols-outlined hint-icon" aria-hidden="true">info</span>
          <span>{{ 'layout.command_palette.vvedite_minimum_2_simvola_dlya_mgnovennogo_poisk' | t }}</span>
        </div>

        <div *ngIf="recentSearches().length > 0" class="recent-searches">
          <div class="recent-header">
            <span class="recent-title">{{ 'search.recent_searches' | t }}</span>
            <button type="button" class="recent-clear-btn" (click)="clearRecent.emit()">
              {{ 'search.clear_recent' | t }}
            </button>
          </div>
          <div class="recent-chips">
            <button
              *ngFor="let item of recentSearches()"
              type="button"
              class="recent-chip"
              (click)="selectRecent.emit(item)"
            >
              <span class="material-symbols-outlined chip-icon" aria-hidden="true">history</span>
              <span>{{ item }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Results List -->
      <div
        *ngIf="results().length > 0"
        class="results-list"
        role="listbox"
        [id]="listboxId()"
        [attr.aria-label]="'search.results' | t"
      >
        <button
          *ngFor="let hit of results(); let i = index"
          type="button"
          class="result-item"
          role="option"
          [id]="optionId(i)"
          [attr.aria-selected]="i === selectedIndex()"
          [class.active]="i === selectedIndex()"
          (click)="selectHit.emit(hit)"
        >
          <div class="result-icon-box" [ngClass]="'icon-' + hit.entityType.toLowerCase()">
            <span class="material-symbols-outlined" aria-hidden="true">{{ getIcon(hit.entityType) }}</span>
          </div>
          <div class="result-info">
            <div class="result-title">{{ hit.title }}</div>
            <div *ngIf="hit.description" class="result-desc">{{ hit.description }}</div>
          </div>
          <span class="result-badge">{{ getEntityBadge(hit.entityType) }}</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .palette-results {
      padding: 8px 10px;
      overflow-y: auto;
      flex: 1;
      min-height: 120px;
    }

    .palette-loading, .palette-empty, .palette-hint, .palette-error {
      padding: 24px 16px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
    }
    .palette-count, .palette-degraded {
      padding: 4px 12px 8px;
      font-size: 11px;
      color: var(--text-muted);
      letter-spacing: 0.02em;
    }
    .palette-degraded { color: var(--warning, #d97706); }
    .palette-retry:disabled { opacity: .6; cursor: default; }

    .palette-hint .hint-text {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 16px;
      color: var(--text-muted);
      font-size: 13px;
    }
    .palette-hint .hint-icon {
      font-size: 20px;
      opacity: 0.7;
    }

    .recent-searches {
      margin-top: 14px;
      padding-top: 16px;
      border-top: 1px solid var(--border-color);
      text-align: left;
    }
    .recent-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding: 0 4px;
    }
    .recent-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
    }
    .recent-clear-btn {
      background: none;
      border: none;
      font-size: 11px;
      color: var(--text-muted);
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
      padding: 0;
      transition: color 0.15s;
    }
    .recent-clear-btn:hover {
      color: var(--text-main);
    }
    .recent-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .recent-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 8px;
      font-size: 12px;
      background: var(--bg-surface-alt, var(--bg-page));
      border: 1px solid var(--border-color);
      color: var(--text-main);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .recent-chip:hover {
      background: var(--bg-hover);
      border-color: var(--primary, #0284c7);
      color: var(--primary, #0284c7);
    }
    .recent-chip .chip-icon {
      font-size: 14px;
      color: var(--text-muted);
    }

    .palette-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      color: var(--danger, #ef4444);
    }

    .palette-retry {
      min-height: 30px;
      padding: 4px 14px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background: var(--bg-surface);
      color: var(--text-main);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .palette-retry:hover { border-color: var(--primary); color: var(--primary); }
    .palette-retry:focus-visible,
    .result-item:focus-visible {
      outline: 2px solid var(--focus-ring, var(--primary));
      outline-offset: -2px;
    }

    .results-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .result-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 9px 12px;
      border-radius: 10px;
      cursor: pointer;
      transition: background-color 0.12s ease;
      width: 100%;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
    }

    .result-item:hover,
    .result-item.active {
      background-color: var(--bg-hover);
    }

    .result-icon-box {
      width: 36px;
      height: 36px;
      border-radius: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .result-icon-box .material-symbols-outlined {
      font-size: 19px;
    }

    .icon-user { background-color: var(--info-bg, rgba(14, 165, 233, 0.12)); color: var(--info, #0ea5e9); }
    .icon-task { background-color: var(--success-bg, rgba(34, 197, 94, 0.12)); color: var(--success, #22c55e); }
    .icon-project { background-color: var(--warning-bg, rgba(245, 158, 11, 0.12)); color: var(--warning, #f59e0b); }
    .icon-note { background-color: rgba(168, 85, 247, 0.12); color: #a855f7; }

    .result-info {
      flex: 1;
      min-width: 0;
    }

    .result-title {
      font-size: 13.5px;
      font-weight: 500;
      color: var(--text-main);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.3;
    }

    .result-desc {
      font-size: 12px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 1px;
    }

    .result-badge {
      font-size: 11px;
      font-weight: 500;
      padding: 3px 8px;
      border-radius: 6px;
      background-color: var(--bg-hover);
      color: var(--text-muted);
      border: 1px solid var(--border-color);
      flex-shrink: 0;
    }

    @media (max-width: 767px) {
      .result-badge { display: none; }
    }
  `]
})
export class CommandPaletteResultsComponent {
  private readonly uiI18n = inject(I18nService);

  readonly isLoading = input.required<boolean>();
  readonly errorMessage = input.required<string>();
  readonly retrySeconds = input.required<number>();
  readonly searchQuery = input.required<string>();
  readonly metadata = input<SearchResult | null>(null);
  readonly results = input.required<SearchHit[]>();
  readonly recentSearches = input.required<string[]>();
  readonly selectedIndex = input.required<number>();
  readonly listboxId = input.required<string>();
  readonly validQuery = input.required<boolean>();

  readonly retry = output<void>();
  readonly selectRecent = output<string>();
  readonly clearRecent = output<void>();
  readonly selectHit = output<SearchHit>();

  optionId(index: number): string {
    return `${this.listboxId()}-option-${index}`;
  }

  queryLength(query: string): number {
    return Array.from(query.trim()).length;
  }

  getIcon(type: string): string {
    switch (type) {
      case 'USER': return 'person';
      case 'TASK': return 'task_alt';
      case 'PROJECT': return 'folder';
      case 'NOTE': return 'description';
      default: return 'search';
    }
  }

  getEntityBadge(type: string): string {
    switch (type) {
      case 'TASK': return this.uiI18n.translate('tasks.zadacha');
      case 'PROJECT': return this.uiI18n.translate('projects.proekt');
      case 'USER': return this.uiI18n.translate('analytics.sotrudnik');
      case 'NOTE': return this.uiI18n.translate('search.entity.note');
      default: return type;
    }
  }
}
