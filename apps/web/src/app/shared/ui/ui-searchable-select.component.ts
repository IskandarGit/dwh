import { Component, Input, Output, EventEmitter, ElementRef, HostListener, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../core/services/i18n.service';

export interface SelectOption {
  id: any;
  label: string;
  subLabel?: string;
  icon?: string;
  color?: string;
}

@Component({
  selector: 'ui-searchable-select',
  standalone: true,
  imports: [
    TranslatePipe,CommonModule, FormsModule],
  template: `
    <div class="searchable-select-container" [class.disabled]="disabled">
      <!-- Select Button / Trigger -->
      <div class="select-control">
        <button
          #trigger
          type="button"
          class="select-trigger"
          [class.is-open]="isOpen()"
          [class.has-value]="selectedOption() !== null"
          [disabled]="disabled"
          [attr.aria-label]="ariaLabel || ('ui.searchable_select.vybor_znacheniya' | t)"
          [attr.aria-expanded]="isOpen()"
          aria-haspopup="listbox"
          [attr.aria-controls]="listboxId"
          (click)="toggleDropdown()"
        >
          <span class="trigger-content">
            <span *ngIf="selectedOption()?.icon" class="material-symbols-outlined trigger-icon" [style.color]="selectedOption()?.color" aria-hidden="true">
              {{ selectedOption()?.icon }}
            </span>
            <span class="trigger-label">
              {{ selectedOption() ? selectedOption()?.label : (placeholder || ('ui.searchable_select.vyberite_iz_spiska' | t)) }}
            </span>
            <span *ngIf="selectedOption()?.subLabel" class="trigger-sublabel text-muted">
              {{ selectedOption()?.subLabel }}
            </span>
          </span>

          <span class="material-symbols-outlined arrow-icon" aria-hidden="true">
            {{ isOpen() ? 'expand_less' : 'expand_more' }}
          </span>
        </button>
        <button
          *ngIf="allowClear && selectedOption() !== null && !disabled"
          type="button"
          class="clear-btn"
          [attr.aria-label]="'ui.searchable_select.ochistit_vybor' | t"
          [title]="'ui.searchable_select.ochistit_vybor' | t"
          (click)="clearSelection($event)"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>

      <!-- Dropdown Popover -->
      <div class="dropdown-popover" *ngIf="isOpen()">
        <!-- Search Input -->
        <div class="search-box">
          <span class="material-symbols-outlined search-ico" aria-hidden="true">search</span>
          <input
            #searchInput
            type="text"
            class="search-input"
            [placeholder]="searchPlaceholder || ('layout.app_shell.poisk' | t)"
            [attr.aria-label]="'ui.searchable_select.poisk_po_variantam' | t"
            [(ngModel)]="searchQuery"
            (ngModelChange)="onSearchChange($event)"
            (click)="$event.stopPropagation()"
          />
          <button *ngIf="searchQuery" type="button" class="mini-clear-btn" [attr.aria-label]="'ui.searchable_select.ochistit_poisk' | t" (click)="clearSearch()">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <!-- Options List -->
        <div class="options-list" [id]="listboxId" role="listbox" [attr.aria-label]="ariaLabel || ('ui.searchable_select.vybor_znacheniya' | t)">
          <!-- Clear / None Option -->
          <button
            *ngIf="allowClear"
            type="button"
            role="option"
            class="option-item none-option"
            [class.selected]="selectedId === null || selectedId === undefined"
            [attr.aria-selected]="selectedId === null || selectedId === undefined"
            (click)="selectOption(null)"
          >
            <span class="option-label text-muted">{{ emptyLabel || ('ui.searchable_select.ne_vybrano_snyat_vybor' | t) }}</span>
          </button>

          <!-- Filtered Options -->
          <button
            *ngFor="let opt of filteredOptions()"
            type="button"
            role="option"
            class="option-item"
            [class.selected]="opt.id === selectedId"
            [attr.aria-selected]="opt.id === selectedId"
            (click)="selectOption(opt.id)"
          >
            <div class="opt-left">
              <span *ngIf="opt.icon" class="material-symbols-outlined opt-icon" [style.color]="opt.color" aria-hidden="true">
                {{ opt.icon }}
              </span>
              <span class="opt-avatar" *ngIf="!opt.icon">
                {{ getInitials(opt.label) }}
              </span>
              <span class="opt-label">{{ opt.label }}</span>
              <span *ngIf="opt.subLabel" class="opt-sublabel text-muted">{{ opt.subLabel }}</span>
            </div>
            <span *ngIf="opt.id === selectedId" class="material-symbols-outlined check-ico" aria-hidden="true">check</span>
          </button>

          <!-- Empty Result Hint -->
          <div *ngIf="filteredOptions().length === 0 && (!remoteSearch || (!loading && !loadError))" class="no-results-hint">
            {{ 'ui.searchable_select.nichego_ne_naydeno' | t }}
          </div>
        </div>
        <div *ngIf="remoteSearch" class="remote-state">
          <div *ngIf="loading" class="remote-loading" role="status">{{ 'common.loading' | t }}</div>
          <div *ngIf="loadError && !loading" class="remote-error" role="alert">
            <span>{{ 'ui.remote_lookup.failed' | t }}</span>
            <button type="button" class="remote-retry" (click)="retry.emit()">{{ 'audit.retry' | t }}</button>
          </div>
          <button *ngIf="hasMore && !loading && !loadError" type="button" class="remote-load-more" (click)="loadMore.emit()">{{ 'common.load_more' | t }}</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      min-width: 0;
      max-width: 100%;
    }

    .searchable-select-container {
      position: relative;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
    }
    .searchable-select-container.disabled {
      opacity: 0.6;
      pointer-events: none;
    }

    .select-control {
      position: relative;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
    }

    .select-trigger {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      height: 34px;
      padding: 0 10px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-main);
      font-size: 13px;
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: left;
    }
    .select-trigger:hover:not(:disabled) {
      border-color: var(--text-muted);
    }
    .select-trigger.is-open {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px var(--primary-subtle);
    }

    .trigger-content {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .trigger-icon { font-size: 16px; flex-shrink: 0; }
    .trigger-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 400;
    }
    .select-trigger.has-value .trigger-label {
      font-weight: 500;
    }
    .trigger-sublabel { font-size: 11px; flex-shrink: 0; }

    .clear-btn {
      position: absolute;
      top: 50%;
      right: 28px;
      transform: translateY(-50%);
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      padding: 2px;
      display: flex;
      border-radius: 3px;
    }
    .clear-btn:hover { color: var(--danger); background-color: var(--danger-bg); }
    .clear-btn .material-symbols-outlined { font-size: 14px; }
    .arrow-icon { font-size: 18px; color: var(--text-muted); }
    .select-trigger.has-value { padding-right: 50px; }

    /* Popover */
    .dropdown-popover {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-overlay);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: fadeIn 0.12s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .search-box {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--border-color);
      background-color: var(--bg-hover);
    }
    .search-ico { font-size: 16px; color: var(--text-muted); }
    .search-input {
      border: none;
      background: transparent;
      outline: none;
      font-size: 12px;
      color: var(--text-main);
      width: 100%;
      padding: 2px 0;
    }
    .mini-clear-btn {
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0;
      display: flex;
    }
    .mini-clear-btn .material-symbols-outlined { font-size: 13px; }

    .options-list {
      max-height: 200px;
      overflow-y: auto;
      padding: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .option-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      border-radius: var(--radius-xs);
      cursor: pointer;
      font-size: 12px;
      transition: background 0.1s ease;
      width: 100%;
      border: 0;
      background: transparent;
      color: inherit;
      font-family: inherit;
      text-align: left;
    }
    .option-item:hover {
      background-color: var(--bg-hover);
    }
    .option-item.selected {
      background-color: rgba(99, 102, 241, 0.1);
      color: var(--primary);
      font-weight: 500;
    }
    .option-item.none-option {
      border-bottom: 1px dashed var(--border-color);
      margin-bottom: 2px;
    }

    .opt-left {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow: hidden;
    }
    .opt-icon { font-size: 16px; flex-shrink: 0; }
    .opt-avatar {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background-color: var(--border-color);
      color: var(--text-main);
      font-size: 10px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .opt-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .opt-sublabel { font-size: 11px; flex-shrink: 0; }
    .check-ico { font-size: 16px; color: var(--primary); }

    .no-results-hint {
      padding: 16px 8px;
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
    }

    .remote-state { padding: 6px 8px; border-top: 1px solid var(--border-color); text-align: center; }
    .remote-loading { color: var(--text-muted); font-size: 12px; }
    .remote-error { display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--danger); font-size: 12px; }
    .remote-retry, .remote-load-more { border: 0; background: transparent; color: var(--primary); cursor: pointer; font: inherit; font-size: 12px; }

    .text-muted { color: var(--text-muted); }
  `]
})
export class UiSearchableSelectComponent {
  private static nextId = 0;

  @Input() options: SelectOption[] = [];
  @Input() selectedId: any = null;
  @Input() placeholder = '';
  @Input() searchPlaceholder = '';
  @Input() emptyLabel = '';
  @Input() allowClear: boolean = true;
  @Input() disabled: boolean = false;
  @Input() ariaLabel = '';
  @Input() remoteSearch = false;
  @Input() loading = false;
  @Input() loadError = false;
  @Input() hasMore = false;

  @Output() selectedIdChange = new EventEmitter<any>();
  @Output() searchChange = new EventEmitter<string>();
  @Output() loadMore = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>();

  readonly isOpen = signal<boolean>(false);
  readonly listboxId = `ui-searchable-select-${UiSearchableSelectComponent.nextId++}`;
  searchQuery = '';

  @ViewChild('trigger') private trigger?: ElementRef<HTMLButtonElement>;

  constructor(private elementRef: ElementRef) {}

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event) {
    if (!this.isOpen()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.closeAndFocusTrigger();
  }

  toggleDropdown() {
    if (this.disabled) return;
    this.isOpen.update(v => !v);
    if (this.isOpen()) {
      this.searchQuery = '';
      if (this.remoteSearch) this.searchChange.emit('');
    }
  }

  selectedOption(): SelectOption | null {
    if (this.selectedId === null || this.selectedId === undefined) return null;
    return this.options.find(o => String(o.id) === String(this.selectedId)) || null;
  }

  filteredOptions(): SelectOption[] {
    if (this.remoteSearch) return this.options;
    if (!this.searchQuery.trim()) {
      return this.options;
    }
    const q = this.searchQuery.trim().toLowerCase();
    return this.options.filter(o =>
      o.label.toLowerCase().includes(q) ||
      (o.subLabel && o.subLabel.toLowerCase().includes(q))
    );
  }

  onSearchChange(query: string) {
    if (this.remoteSearch) this.searchChange.emit(query);
  }

  clearSearch() {
    this.searchQuery = '';
    if (this.remoteSearch) this.searchChange.emit('');
  }

  selectOption(id: any) {
    this.selectedId = id;
    this.selectedIdChange.emit(id);
    this.closeAndFocusTrigger();
  }

  clearSelection(event: MouseEvent) {
    event.stopPropagation();
    this.selectOption(null);
  }

  getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  private closeAndFocusTrigger() {
    this.isOpen.set(false);
    queueMicrotask(() => this.trigger?.nativeElement.focus());
  }
}
