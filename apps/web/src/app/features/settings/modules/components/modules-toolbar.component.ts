import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { ModuleFilterTab } from '../modules.models';

@Component({
  selector: 'app-modules-toolbar',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toolbar">
      <div class="search-box">
        <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
        <input
          type="search"
          class="form-input search-input"
          [placeholder]="'modules.search_placeholder' | t"
          [value]="searchQuery()"
          (input)="onSearchInput($event)"
          [attr.aria-label]="'modules.search_placeholder' | t"
        />
        <button
          *ngIf="searchQuery()"
          type="button"
          class="search-clear-btn"
          [attr.aria-label]="'search.clear_query' | t"
          (click)="clearSearch.emit()"
        >
          <span class="material-symbols-outlined" aria-hidden="true">cancel</span>
        </button>
      </div>

      <div class="status-tabs" role="tablist" [attr.aria-label]="'modules.filter_tabs' | t">
        <button
          type="button"
          role="tab"
          class="status-tab"
          [class.active]="filterTab() === 'all'"
          [attr.aria-selected]="filterTab() === 'all'"
          (click)="filterTabChange.emit('all')"
        >
          {{ 'modules.tab.all' | t }} ({{ totalCount() }})
        </button>
        <button
          type="button"
          role="tab"
          class="status-tab"
          [class.active]="filterTab() === 'active'"
          [attr.aria-selected]="filterTab() === 'active'"
          (click)="filterTabChange.emit('active')"
        >
          {{ 'modules.tab.active' | t }} ({{ activeCount() }})
        </button>
        <button
          type="button"
          role="tab"
          class="status-tab"
          [class.active]="filterTab() === 'system'"
          [attr.aria-selected]="filterTab() === 'system'"
          (click)="filterTabChange.emit('system')"
        >
          {{ 'modules.tab.system' | t }} ({{ systemCount() }})
        </button>
        <button
          type="button"
          role="tab"
          class="status-tab"
          [class.active]="filterTab() === 'custom'"
          [attr.aria-selected]="filterTab() === 'custom'"
          (click)="filterTabChange.emit('custom')"
        >
          {{ 'modules.tab.custom' | t }} ({{ customCount() }})
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
      gap: 16px;
      flex-wrap: wrap;
    }
    .search-box {
      position: relative;
      flex: 1;
      max-width: 320px;
      min-width: 200px;
    }
    .search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 18px;
      color: var(--text-muted);
      pointer-events: none;
    }
    .search-input {
      width: 100%;
      padding-left: 34px;
      padding-right: 32px;
      height: 36px;
      font-size: 13px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-main);
      box-sizing: border-box;
    }
    .search-clear-btn {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      padding: 0;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
    }
    .search-clear-btn .material-symbols-outlined {
      font-size: 16px;
    }
    .status-tabs {
      display: flex;
      gap: 4px;
      background: var(--bg-hover);
      padding: 3px;
      border-radius: var(--radius-md);
      border: 1px solid var(--border-color);
    }
    .status-tab {
      padding: 6px 14px;
      border: none;
      background: transparent;
      border-radius: var(--radius-sm);
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .status-tab:hover {
      color: var(--text-main);
    }
    .status-tab.active {
      background: var(--bg-surface);
      color: var(--primary);
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(0,0,0,0.06);
    }
  `]
})
export class ModulesToolbarComponent {
  readonly searchQuery = input.required<string>();
  readonly filterTab = input.required<ModuleFilterTab>();
  readonly totalCount = input.required<number>();
  readonly activeCount = input.required<number>();
  readonly systemCount = input.required<number>();
  readonly customCount = input.required<number>();

  readonly searchChange = output<string>();
  readonly clearSearch = output<void>();
  readonly filterTabChange = output<ModuleFilterTab>();

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchChange.emit(input.value);
  }
}
