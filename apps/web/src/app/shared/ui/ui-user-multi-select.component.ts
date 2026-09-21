import { Component, Input, Output, EventEmitter, signal, ElementRef, HostListener, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { User } from '../../core/models/auth.models';
import { TranslatePipe } from '../../core/services/i18n.service';

@Component({
  selector: 'ui-user-multi-select',
  standalone: true,
  imports: [
    TranslatePipe,CommonModule, FormsModule],
  template: `
    <div class="user-multi-select-container">
      <!-- Selected Users Tag List -->
      <div class="selected-tags-box">
        <div *ngFor="let u of getSelectedUsers()" class="user-tag">
          <span class="user-avatar-mini">{{ getInitials(u.name) }}</span>
          <span class="user-name">{{ u.name }}</span>
          <button type="button" class="tag-remove-btn" (click)="removeUser(u.id)" [attr.aria-label]="'ui.user_multi_select.remove_user' | t:{name: u.name}" [title]="'common.delete' | t">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <button
          #trigger
          type="button"
          class="add-user-btn"
          [attr.aria-label]="ariaLabel || ('ui.user_multi_select.vybrat_polzovateley' | t)"
          aria-haspopup="listbox"
          [attr.aria-expanded]="isOpen()"
          [attr.aria-controls]="listboxId"
          (click)="toggleDropdown($event)"
        >
          <span class="material-symbols-outlined ico" aria-hidden="true">person_add</span>
          <span>{{ selectedUserIds.length === 0 ? (placeholder || ('ui.user_multi_select.dobavit_nablyudateley' | t)) : ('ui.user_multi_select.add_more' | t) }}</span>
        </button>
      </div>

      <!-- Autocomplete Dropdown Panel -->
      <div class="dropdown-panel" *ngIf="isOpen()">
        <div class="search-row">
          <span class="material-symbols-outlined search-ico" aria-hidden="true">search</span>
          <input
            #searchInput
            type="text"
            class="search-input"
            [placeholder]="searchPlaceholder || ('tasks.poisk_sotrudnika' | t)"
            [attr.aria-label]="'ui.user_multi_select.poisk_sotrudnikov' | t"
            [(ngModel)]="searchQuery"
            (ngModelChange)="onSearchChange($event)"
            (click)="$event.stopPropagation()"
          />
          <button *ngIf="searchQuery" type="button" class="clear-btn" [attr.aria-label]="'ui.searchable_select.ochistit_poisk' | t" (click)="clearSearch()">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div class="users-options-list" [id]="listboxId" role="listbox" [attr.aria-label]="'nav.users' | t" aria-multiselectable="true">
          <button
            *ngFor="let u of filteredUsers()"
            type="button"
            role="option"
            class="user-option"
            [class.selected]="isSelected(u.id)"
            [attr.aria-selected]="isSelected(u.id)"
            (click)="toggleUser(u.id)"
          >
            <div class="user-info-left">
              <span class="user-avatar">{{ getInitials(u.name) }}</span>
              <div class="user-texts">
                <span class="u-name">{{ u.name }}</span>
                <span class="u-login text-muted">&#64;{{ u.login }}</span>
              </div>
            </div>

            <span class="material-symbols-outlined check-ico" *ngIf="isSelected(u.id)" aria-hidden="true">check</span>
          </button>

          <div *ngIf="filteredUsers().length === 0 && (!remoteSearch || (!loading && !loadError))" class="no-options">
            {{ 'ui.user_multi_select.sotrudniki_ne_naydeny' | t }}
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

    .user-multi-select-container {
      position: relative;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
    }

    .selected-tags-box {
      min-height: 36px;
      padding: 4px 6px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      transition: border-color 0.15s ease;
    }
    .selected-tags-box:hover { border-color: var(--primary); }

    .user-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1px 6px 1px 2px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-main);
    }
    .user-avatar-mini {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: var(--primary);
      color: #fff;
      font-size: 9px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .user-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .tag-remove-btn {
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      padding: 0;
      margin-left: 2px;
    }
    .tag-remove-btn:hover { color: var(--danger); }
    .tag-remove-btn .material-symbols-outlined { font-size: 13px; }

    .add-user-btn {
      border: none;
      background: transparent;
      color: var(--primary);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 6px;
      border-radius: var(--radius-xs);
    }
    .add-user-btn:hover { background-color: var(--primary-subtle); }
    .add-user-btn .ico { font-size: 14px; }

    /* Dropdown Panel */
    .dropdown-panel {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-overlay);
      z-index: 1050;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .search-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      background-color: var(--bg-hover);
      border-bottom: 1px solid var(--border-color);
    }
    .search-ico { font-size: 16px; color: var(--text-muted); }
    .search-input {
      flex: 1;
      border: none;
      background: transparent;
      font-size: 12px;
      color: var(--text-main);
    }
    .clear-btn { border: none; background: transparent; color: var(--text-muted); cursor: pointer; display: flex; }
    .clear-btn .material-symbols-outlined { font-size: 14px; }

    .users-options-list {
      max-height: 180px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }

    .user-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      cursor: pointer;
      transition: background 0.1s ease;
      width: 100%;
      border: 0;
      background: transparent;
      color: inherit;
      font-family: inherit;
      text-align: left;
    }
    .user-option:hover { background-color: var(--bg-hover); }
    .user-option.selected { background-color: rgba(99,102,241,0.08); }

    .user-info-left { display: flex; align-items: center; gap: 8px; }
    .user-avatar {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background-color: var(--primary);
      color: #fff;
      font-size: 10px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .user-texts { display: flex; flex-direction: column; }
    .u-name { font-size: 12px; font-weight: 500; color: var(--text-main); }
    .u-login { font-size: 10px; }

    .check-ico { font-size: 16px; color: var(--primary); }
    .no-options { padding: 12px; text-align: center; color: var(--text-muted); font-size: 12px; }
    .remote-state { padding: 6px 8px; border-top: 1px solid var(--border-color); text-align: center; }
    .remote-loading { color: var(--text-muted); font-size: 12px; }
    .remote-error { display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--danger); font-size: 12px; }
    .remote-retry, .remote-load-more { border: 0; background: transparent; color: var(--primary); cursor: pointer; font: inherit; font-size: 12px; }
    .text-muted { color: var(--text-muted); }
  `]
})
export class UiUserMultiSelectComponent {
  private static nextId = 0;

  @Input() users: User[] = [];
  @Input() selectedUserIds: number[] = [];
  @Input() placeholder = '';
  @Input() searchPlaceholder = '';
  @Input() ariaLabel = '';
  @Input() remoteSearch = false;
  @Input() loading = false;
  @Input() loadError = false;
  @Input() hasMore = false;
  @Output() selectedUserIdsChange = new EventEmitter<number[]>();
  @Output() searchChange = new EventEmitter<string>();
  @Output() loadMore = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>();

  isOpen = signal<boolean>(false);
  readonly listboxId = `ui-user-multi-select-${UiUserMultiSelectComponent.nextId++}`;
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

  toggleDropdown(event: MouseEvent) {
    event.stopPropagation();
    this.isOpen.update(v => !v);
    if (this.isOpen()) {
      this.searchQuery = '';
      if (this.remoteSearch) this.searchChange.emit('');
    }
  }

  getSelectedUsers(): User[] {
    const idSet = new Set(this.selectedUserIds);
    return this.users.filter(u => idSet.has(u.id));
  }

  filteredUsers(): User[] {
    // Only active users
    const activeUsers = this.users.filter(u => u.state !== 'P' && !u.name.toLowerCase().includes('deleted user'));
    const q = this.searchQuery.trim().toLowerCase();
    if (!q || this.remoteSearch) return activeUsers;

    return activeUsers.filter(u =>
      u.name.toLowerCase().includes(q) ||
      u.login.toLowerCase().includes(q)
    );
  }

  onSearchChange(query: string) {
    if (this.remoteSearch) this.searchChange.emit(query);
  }

  clearSearch() {
    this.searchQuery = '';
    if (this.remoteSearch) this.searchChange.emit('');
  }

  isSelected(userId: number): boolean {
    return this.selectedUserIds.includes(userId);
  }

  toggleUser(userId: number) {
    const list = [...this.selectedUserIds];
    const idx = list.indexOf(userId);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push(userId);
    }
    this.selectedUserIds = list;
    this.selectedUserIdsChange.emit(list);
  }

  removeUser(userId: number) {
    const list = this.selectedUserIds.filter(id => id !== userId);
    this.selectedUserIds = list;
    this.selectedUserIdsChange.emit(list);
  }

  getInitials(name: string): string {
    if (!name) return 'U';
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
