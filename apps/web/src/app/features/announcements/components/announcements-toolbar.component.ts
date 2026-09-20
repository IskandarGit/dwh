import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../core/services/i18n.service';

@Component({
  selector: 'app-announcements-toolbar',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toolbar">
      <div class="status-tabs" role="tablist" [attr.aria-label]="'announcements.vse_statusy' | t">
        <button
          type="button"
          role="tab"
          class="status-tab"
          [class.active]="statusFilter() === 'ALL'"
          [attr.aria-selected]="statusFilter() === 'ALL'"
          (click)="filterChange.emit('ALL')"
        >
          <span>{{ 'announcements.vse_statusy' | t }}</span>
          <span class="tab-count">{{ totalCount() }}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="status-tab"
          [class.active]="statusFilter() === 'PUBLISHED'"
          [attr.aria-selected]="statusFilter() === 'PUBLISHED'"
          (click)="filterChange.emit('PUBLISHED')"
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
          (click)="filterChange.emit('DRAFT')"
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
          (click)="filterChange.emit('ARCHIVED')"
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
          (input)="onInput($event)"
        />
        <button
          *ngIf="searchQuery().length > 0"
          type="button"
          class="clear-search-btn"
          (click)="searchClear.emit()"
          [attr.aria-label]="'announcements.sbrosit_filtry' | t"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
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

    @media (max-width: 680px) {
      .toolbar { flex-direction: column; align-items: stretch; }
      .search-box { width: 100%; }
    }
  `]
})
export class AnnouncementsToolbarComponent {
  readonly totalCount = input.required<number>();
  readonly publishedCount = input.required<number>();
  readonly draftCount = input.required<number>();
  readonly archivedCount = input.required<number>();
  readonly statusFilter = input.required<'ALL' | 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'>();
  readonly searchQuery = input.required<string>();

  readonly filterChange = output<'ALL' | 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'>();
  readonly searchChange = output<string>();
  readonly searchClear = output<void>();

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchChange.emit(input.value);
  }
}
