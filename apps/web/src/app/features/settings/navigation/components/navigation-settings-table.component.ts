import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CustomNavigationItem, NavigationTargetType } from '../../../../core/models/navigation.models';
import { TranslatePipe, I18nService } from '../../../../core/services/i18n.service';

@Component({
  selector: 'app-navigation-settings-table',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe
  ],
  template: `
    <!-- Search & Filter Bar -->
    <div class="filter-bar">
      <div class="search-box">
        <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
        <input
          type="text"
          class="search-input"
          [ngModel]="searchQuery"
          (ngModelChange)="searchQueryChange.emit($event)"
          [placeholder]="'nav.settings.search_placeholder' | t"
        />
        <button
          *ngIf="searchQuery"
          type="button"
          class="clear-search-btn"
          (click)="clearSearch.emit()"
          aria-label="Clear search"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    </div>

    <!-- Items Table -->
    <div class="table-container">
      <div *ngIf="isLoading" class="loading-box">
        <div class="spinner"></div>
        <span>{{ 'common.loading' | t }}</span>
      </div>

      <table *ngIf="!isLoading" class="nav-table">
        <thead>
          <tr>
            <th style="width: 48px">{{ 'nav.settings.th_icon' | t }}</th>
            <th>{{ 'nav.settings.th_title' | t }}</th>
            <th style="width: 130px">{{ 'nav.settings.th_type' | t }}</th>
            <th style="width: 140px">{{ 'nav.settings.th_section' | t }}</th>
            <th>{{ 'nav.settings.th_target' | t }}</th>
            <th style="width: 70px; text-align: center">{{ 'nav.settings.th_order' | t }}</th>
            <th style="width: 90px; text-align: center">{{ 'common.status' | t }}</th>
            <th style="width: 140px; text-align: right">{{ 'common.actions' | t }}</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let item of items">
            <td class="icon-cell">
              <span class="material-symbols-outlined table-icon" aria-hidden="true">{{ item.icon }}</span>
            </td>
            <td>
              <div class="title-main">{{ item.title }}</div>
              <div class="code-sub">{{ item.code }}</div>
            </td>
            <td>
              <span class="badge badge-type" [ngClass]="item.targetType.toLowerCase()">
                {{ targetTypeLabel(item.targetType) }}
              </span>
            </td>
            <td>
              <span class="badge badge-section">
                {{ sectionLabel(item.sectionId) }}
              </span>
            </td>
            <td class="url-cell" [title]="item.url">
              <span class="url-text">{{ item.url }}</span>
            </td>
            <td style="text-align: center">{{ item.sortOrder }}</td>
            <td style="text-align: center">
              <button
                type="button"
                class="status-toggle-btn"
                [class.active]="item.state === 'A'"
                (click)="toggleItem.emit(item)"
                [title]="item.state === 'A' ? ('common.block' | t) : ('common.unblock' | t)"
              >
                {{ item.state === 'A' ? ('common.active' | t) : ('common.passive' | t) }}
              </button>
            </td>
            <td class="actions-cell">
              <button
                type="button"
                class="action-icon-btn preview-btn"
                (click)="previewItem.emit(item)"
                [title]="'nav.settings.open' | t"
                [attr.aria-label]="'nav.settings.open' | t"
              >
                <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
              </button>
              <button
                type="button"
                class="action-icon-btn"
                (click)="editItem.emit(item)"
                [title]="'common.edit' | t"
                [attr.aria-label]="'common.edit' | t"
              >
                <span class="material-symbols-outlined" aria-hidden="true">edit</span>
              </button>
              <button
                type="button"
                class="action-icon-btn danger"
                (click)="deleteItem.emit(item)"
                [title]="'common.delete' | t"
                [attr.aria-label]="'common.delete' | t"
              >
                <span class="material-symbols-outlined" aria-hidden="true">delete</span>
              </button>
            </td>
          </tr>
          <tr *ngIf="items.length === 0">
            <td colspan="8" class="empty-cell">
              {{ 'common.no_data' | t }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    /* Filter Bar */
    .filter-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .search-box {
      position: relative;
      flex: 1;
      max-width: 400px;
      display: flex;
      align-items: center;
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
      padding: 8px 32px 8px 34px;
      font-size: 13px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background-color: var(--bg-surface);
      color: var(--text-main);
      outline: none;
      transition: border-color 0.15s ease;
    }

    .search-input:focus {
      border-color: var(--primary);
    }

    .clear-search-btn {
      position: absolute;
      right: 8px;
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      padding: 2px;
    }

    .clear-search-btn .material-symbols-outlined {
      font-size: 16px;
    }

    /* Table */
    .table-container {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      overflow-x: auto;
      box-shadow: var(--shadow-sm);
    }

    .nav-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }

    .nav-table th {
      padding: 12px 16px;
      font-weight: 600;
      color: var(--text-muted);
      background-color: var(--bg-hover);
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
    }

    .nav-table td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-subtle);
      color: var(--text-main);
      vertical-align: middle;
    }

    .nav-table tr:hover td {
      background-color: var(--bg-hover);
    }

    .nav-table tr:last-child td {
      border-bottom: none;
    }

    .icon-cell {
      text-align: center;
    }

    .table-icon {
      font-size: 20px;
      color: var(--primary);
    }

    .title-main {
      font-weight: 600;
      color: var(--text-main);
    }

    .code-sub {
      font-size: 11px;
      color: var(--text-muted);
      font-family: monospace;
      margin-top: 2px;
    }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }

    .badge-type.embedded_iframe { background: #dbeafe; color: #1d4ed8; }
    .badge-type.external_link { background: #ede9fe; color: #6d28d9; }
    .badge-type.internal_route { background: #e0e7ff; color: #4338ca; }

    .badge-section {
      background: var(--bg-hover);
      color: var(--text-muted);
      border: 1px solid var(--border-color);
    }

    .url-cell {
      max-width: 220px;
    }

    .url-text {
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: monospace;
      font-size: 12px;
      color: var(--text-muted);
    }

    .status-toggle-btn {
      padding: 3px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background: var(--bg-hover);
      color: var(--text-muted);
      font-size: 12px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s ease;
    }

    .status-toggle-btn.active {
      background: #d1fae5;
      color: #065f46;
      border-color: #a7f3d0;
    }

    .actions-cell {
      text-align: right;
      white-space: nowrap;
    }

    .action-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: var(--radius-sm);
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.12s ease;
    }

    .action-icon-btn:hover {
      background: var(--bg-hover);
      color: var(--text-main);
    }

    .action-icon-btn.preview-btn:hover {
      color: var(--primary);
    }

    .action-icon-btn.danger:hover {
      color: #ef4444;
      background: #fee2e2;
    }

    .action-icon-btn .material-symbols-outlined {
      font-size: 17px;
    }

    .loading-box {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 48px 0;
      color: var(--text-muted);
    }

    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid var(--border-color);
      border-top-color: var(--primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    .empty-cell {
      text-align: center;
      padding: 48px !important;
      color: var(--text-muted);
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `]
})
export class NavigationSettingsTableComponent {
  private readonly uiI18n = inject(I18nService);

  @Input() items: CustomNavigationItem[] = [];
  @Input() isLoading = false;
  @Input() searchQuery = '';

  @Output() searchQueryChange = new EventEmitter<string>();
  @Output() clearSearch = new EventEmitter<void>();
  @Output() toggleItem = new EventEmitter<CustomNavigationItem>();
  @Output() previewItem = new EventEmitter<CustomNavigationItem>();
  @Output() editItem = new EventEmitter<CustomNavigationItem>();
  @Output() deleteItem = new EventEmitter<CustomNavigationItem>();

  targetTypeLabel(type: NavigationTargetType): string {
    switch (type) {
      case 'EMBEDDED_IFRAME': return this.uiI18n.translate('nav.settings.type_embedded');
      case 'EXTERNAL_LINK': return this.uiI18n.translate('nav.settings.type_external');
      case 'INTERNAL_ROUTE': return this.uiI18n.translate('nav.settings.type_internal');
      default: return type;
    }
  }

  sectionLabel(sectionId: string): string {
    switch (sectionId) {
      case 'workspace': return this.uiI18n.translate('nav.section.workspace');
      case 'iam': return this.uiI18n.translate('nav.section.iam');
      case 'administration': return this.uiI18n.translate('nav.section.administration');
      case 'custom': return this.uiI18n.translate('nav.settings.section_custom');
      default: return sectionId;
    }
  }
}
