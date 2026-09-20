import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { NavigationService } from '../../../core/services/navigation.service';
import {
  CustomNavigationItem,
  CreateNavigationItemPayload,
  UpdateNavigationItemPayload,
  NavigationTargetType
} from '../../../core/models/navigation.models';
import { ToastService } from '../../../core/services/toast.service';
import { TranslatePipe, I18nService } from '../../../core/services/i18n.service';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { transliterateToCode } from '../../../core/utils/transliteration';

@Component({
  selector: 'app-navigation-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, TranslatePipe, UiModalComponent, UiButtonComponent],
  template: `
    <div class="nav-settings-page">
      <!-- Header -->
      <div class="page-header">
        <div class="header-titles">
          <h1 class="page-title">{{ 'nav.settings.navigation_title' | t }}</h1>
          <p class="page-subtitle">{{ 'nav.settings.navigation_subtitle' | t }}</p>
        </div>
        <div class="header-actions">
          <ui-button
            variant="primary"
            icon="add"
            (onClick)="openCreateModal()"
          >
            {{ 'nav.settings.add_item' | t }}
          </ui-button>
        </div>
      </div>

      <!-- Stats Summary -->
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-value">{{ items().length }}</span>
          <span class="stat-label">{{ 'nav.settings.stat_total' | t }}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value stat-active">{{ activeCount() }}</span>
          <span class="stat-label">{{ 'nav.settings.stat_active' | t }}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value stat-embedded">{{ embeddedCount() }}</span>
          <span class="stat-label">{{ 'nav.settings.stat_embedded' | t }}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value stat-external">{{ externalCount() }}</span>
          <span class="stat-label">{{ 'nav.settings.stat_external' | t }}</span>
        </div>
      </div>

      <!-- Search & Filter Bar -->
      <div class="filter-bar">
        <div class="search-box">
          <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
          <input
            type="text"
            class="search-input"
            [(ngModel)]="searchQuery"
            [placeholder]="'nav.settings.search_placeholder' | t"
          />
          <button
            *ngIf="searchQuery"
            type="button"
            class="clear-search-btn"
            (click)="searchQuery = ''"
            aria-label="Clear search"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      </div>

      <!-- Items Table -->
      <div class="table-container">
        <div *ngIf="isLoading()" class="loading-box">
          <div class="spinner"></div>
          <span>{{ 'common.loading' | t }}</span>
        </div>

        <table *ngIf="!isLoading()" class="nav-table">
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
            <tr *ngFor="let item of filteredItems()">
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
                  (click)="toggleItem(item)"
                  [title]="item.state === 'A' ? ('common.block' | t) : ('common.unblock' | t)"
                >
                  {{ item.state === 'A' ? ('common.active' | t) : ('common.passive' | t) }}
                </button>
              </td>
              <td class="actions-cell">
                <button
                  type="button"
                  class="action-icon-btn preview-btn"
                  (click)="previewItem(item)"
                  [title]="'nav.settings.open' | t"
                  [attr.aria-label]="'nav.settings.open' | t"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
                </button>
                <button
                  type="button"
                  class="action-icon-btn"
                  (click)="openEditModal(item)"
                  [title]="'common.edit' | t"
                  [attr.aria-label]="'common.edit' | t"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">edit</span>
                </button>
                <button
                  type="button"
                  class="action-icon-btn danger"
                  (click)="confirmDelete(item)"
                  [title]="'common.delete' | t"
                  [attr.aria-label]="'common.delete' | t"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">delete</span>
                </button>
              </td>
            </tr>
            <tr *ngIf="filteredItems().length === 0">
              <td colspan="8" class="empty-cell">
                {{ 'common.no_data' | t }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Create/Edit Modal -->
      <ui-modal
        *ngIf="isModalOpen()"
        [isOpen]="isModalOpen()"
        [title]="editingItem() ? ('nav.settings.edit_modal_title' | t) : ('nav.settings.create_modal_title' | t)"
        (close)="closeModal()"
      >
        <div class="modal-form">
          <div class="form-row">
            <div class="form-group flex-2">
              <label class="form-label" for="nav-title">{{ 'nav.settings.field_title' | t }} *</label>
              <input
                id="nav-title"
                type="text"
                class="form-input"
                [(ngModel)]="formTitle"
                (ngModelChange)="onTitleChange()"
                [placeholder]="'nav.settings.title_placeholder' | t"
              />
            </div>
            <div class="form-group flex-1">
              <label class="form-label" for="nav-code">{{ 'nav.settings.field_code' | t }} *</label>
              <input
                id="nav-code"
                type="text"
                class="form-input"
                [(ngModel)]="formCode"
                placeholder="superset-sales"
              />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label" for="nav-type">{{ 'nav.settings.field_type' | t }}</label>
              <select id="nav-type" class="form-input" [(ngModel)]="formTargetType">
                <option value="EMBEDDED_IFRAME">{{ 'nav.settings.type_embedded' | t }}</option>
                <option value="EXTERNAL_LINK">{{ 'nav.settings.type_external' | t }}</option>
                <option value="INTERNAL_ROUTE">{{ 'nav.settings.type_internal' | t }}</option>
              </select>
            </div>
            <div class="form-group flex-1">
              <label class="form-label" for="nav-section">{{ 'nav.settings.field_section' | t }}</label>
              <select id="nav-section" class="form-input" [(ngModel)]="formSectionId">
                <option value="custom">{{ 'nav.settings.section_custom' | t }}</option>
                <option value="workspace">{{ 'nav.section.workspace' | t }}</option>
                <option value="iam">{{ 'nav.section.iam' | t }}</option>
                <option value="administration">{{ 'nav.section.administration' | t }}</option>
              </select>
            </div>
            <div class="form-group flex-1">
              <label class="form-label" for="nav-order">{{ 'nav.settings.field_order' | t }}</label>
              <input
                id="nav-order"
                type="number"
                class="form-input"
                [(ngModel)]="formSortOrder"
              />
            </div>
          </div>

          <div *ngIf="formTargetType === 'EMBEDDED_IFRAME'" class="type-hint-box">
            <span class="material-symbols-outlined hint-icon" aria-hidden="true">info</span>
            <span>{{ 'nav.settings.iframe_type_hint' | t }}</span>
          </div>

          <div class="form-group">
            <label class="form-label" for="nav-url">{{ 'nav.settings.field_url' | t }} *</label>
            <input
              id="nav-url"
              type="text"
              class="form-input"
              [(ngModel)]="formUrl"
              (blur)="onUrlBlur()"
              placeholder="https://bi.company.uz/superset/dashboard/123/"
            />
            <span class="form-hint">{{ 'nav.settings.url_hint' | t }}</span>
          </div>

          <div class="form-group">
            <label class="form-label">{{ 'nav.settings.field_icon' | t }}</label>
            <div class="icon-selector-row">
              <input
                type="text"
                class="form-input icon-input"
                [(ngModel)]="formIcon"
                placeholder="analytics"
              />
              <span class="material-symbols-outlined icon-preview" aria-hidden="true">{{ formIcon || 'bar_chart' }}</span>
            </div>
            <div class="icon-quick-chips">
              <button
                *ngFor="let ic of popularIcons"
                type="button"
                class="chip-btn"
                [class.active]="formIcon === ic"
                (click)="formIcon = ic"
              >
                <span class="material-symbols-outlined" aria-hidden="true">{{ ic }}</span>
              </button>
            </div>
          </div>
        </div>

        <div footer class="modal-footer-btns">
          <ui-button variant="secondary" (onClick)="closeModal()">{{ 'common.cancel' | t }}</ui-button>
          <ui-button variant="primary" [loading]="isSubmitting()" (onClick)="saveItem()" [disabled]="!isFormValid()">
            {{ 'common.save' | t }}
          </ui-button>
        </div>
      </ui-modal>

      <!-- Delete Confirmation Modal -->
      <ui-modal
        *ngIf="deleteTarget()"
        [isOpen]="deleteTarget() !== null"
        [title]="'nav.settings.delete_modal_title' | t"
        (close)="deleteTarget.set(null)"
      >
        <p>{{ 'nav.settings.delete_confirm' | t: { title: deleteTarget()?.title ?? '' } }}</p>
        <div footer class="modal-footer-btns">
          <ui-button variant="secondary" (onClick)="deleteTarget.set(null)">{{ 'common.cancel' | t }}</ui-button>
          <ui-button variant="danger" (onClick)="executeDelete()">{{ 'common.delete' | t }}</ui-button>
        </div>
      </ui-modal>
    </div>
  `,
  styles: [`
    .nav-settings-page {
      padding: 24px;
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .page-title {
      font-size: 22px;
      font-weight: 700;
      color: var(--text-main);
      margin: 0 0 4px 0;
    }

    .page-subtitle {
      font-size: 13px;
      color: var(--text-muted);
      margin: 0;
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
    }

    .stat-card {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      box-shadow: var(--shadow-sm);
    }

    .stat-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-main);
      line-height: 1.2;
    }

    .stat-value.stat-active { color: #059669; }
    .stat-value.stat-embedded { color: #2563eb; }
    .stat-value.stat-external { color: #7c3aed; }

    .stat-label {
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 500;
    }

    /* Filter Bar */
    .filter-bar {
      display: flex;
      align-items: center;
      gap: 12px;
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
      border-bottom: 1px solid var(--border-color);
      color: var(--text-main);
      vertical-align: middle;
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
    }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
    }

    .badge.embedded_iframe {
      background-color: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
    }

    .badge.external_link {
      background-color: #f0fdf4;
      color: #15803d;
      border: 1px solid #bbf7d0;
    }

    .badge.internal_route {
      background-color: #f5f3ff;
      color: #6d28d9;
      border: 1px solid #ddd6fe;
    }

    .badge-section {
      background-color: var(--bg-hover);
      color: var(--text-muted);
      border: 1px solid var(--border-color);
    }

    .url-cell {
      max-width: 240px;
    }

    .url-text {
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: monospace;
      font-size: 12px;
      color: var(--text-muted);
    }

    .status-toggle-btn {
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid var(--border-color);
      background-color: var(--bg-hover);
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .status-toggle-btn.active {
      background-color: #ecfdf5;
      color: #047857;
      border-color: #a7f3d0;
    }

    .actions-cell {
      text-align: right;
      white-space: nowrap;
    }

    .action-icon-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm);
      transition: all 0.15s ease;
      vertical-align: middle;
      margin-left: 2px;
    }

    .action-icon-btn:hover {
      background-color: var(--bg-hover);
      color: var(--text-main);
    }

    .action-icon-btn.preview-btn:hover {
      color: var(--primary);
    }

    .action-icon-btn.danger:hover {
      color: var(--danger, #ef4444);
    }

    .action-icon-btn .material-symbols-outlined {
      font-size: 18px;
    }

    .empty-cell {
      text-align: center;
      padding: 32px 16px;
      color: var(--text-muted);
    }

    .loading-box {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      gap: 12px;
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

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Modal Form */
    .modal-form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .form-row {
      display: flex;
      gap: 12px;
    }

    .flex-1 { flex: 1; }
    .flex-2 { flex: 2; }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .form-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-main);
    }

    .form-input {
      padding: 8px 12px;
      font-size: 13px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background-color: var(--bg-surface);
      color: var(--text-main);
    }

    .form-hint {
      font-size: 11px;
      color: var(--text-muted);
    }

    .icon-selector-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .icon-input {
      flex: 1;
    }

    .icon-preview {
      font-size: 24px;
      color: var(--primary);
      width: 32px;
      text-align: center;
    }

    .icon-quick-chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 6px;
    }

    .chip-btn {
      padding: 4px 8px;
      border: 1px solid var(--border-color);
      background-color: var(--bg-hover);
      border-radius: var(--radius-sm);
      cursor: pointer;
      display: flex;
      align-items: center;
      color: var(--text-muted);
      transition: all 0.15s ease;
    }

    .chip-btn:hover, .chip-btn.active {
      border-color: var(--primary);
      color: var(--primary);
      background-color: var(--bg-surface);
    }

    .chip-btn .material-symbols-outlined {
      font-size: 18px;
    }

    .type-hint-box {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      background-color: #f0f9ff;
      border: 1px solid #bae6fd;
      color: #0369a1;
      font-size: 12px;
      line-height: 1.4;
    }

    .hint-icon {
      font-size: 16px;
      color: #0284c7;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .modal-footer-btns {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
    }
  `]
})
export class NavigationSettingsComponent implements OnInit {
  private readonly navService = inject(NavigationService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  readonly items = signal<CustomNavigationItem[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly isSubmitting = signal<boolean>(false);
  readonly isModalOpen = signal<boolean>(false);
  readonly editingItem = signal<CustomNavigationItem | null>(null);
  readonly deleteTarget = signal<CustomNavigationItem | null>(null);

  searchQuery = '';

  readonly popularIcons = [
    'analytics', 'bar_chart', 'pie_chart', 'table_view', 'dashboard',
    'insights', 'monitoring', 'database', 'language', 'open_in_new'
  ];

  formCode = '';
  formTitle = '';
  formTargetType: NavigationTargetType = 'EMBEDDED_IFRAME';
  formSectionId = 'custom';
  formUrl = '';
  formIcon = 'analytics';
  formSortOrder = 100;

  readonly activeCount = computed(() => this.items().filter(i => i.state === 'A').length);
  readonly embeddedCount = computed(() => this.items().filter(i => i.targetType === 'EMBEDDED_IFRAME').length);
  readonly externalCount = computed(() => this.items().filter(i => i.targetType === 'EXTERNAL_LINK').length);

  ngOnInit(): void {
    this.loadItems();
  }

  loadItems(): void {
    this.isLoading.set(true);
    this.navService.loadAllItems().subscribe({
      next: data => {
        this.items.set(data || []);
        this.isLoading.set(false);
      },
      error: (err: any) => {
        const msg = err?.error?.detail || err?.error?.message || this.i18n.translate('common.error');
        this.toast.error(msg);
        this.isLoading.set(false);
      }
    });
  }

  filteredItems(): CustomNavigationItem[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return this.items();
    return this.items().filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.code.toLowerCase().includes(q) ||
      item.url.toLowerCase().includes(q) ||
      item.sectionId.toLowerCase().includes(q)
    );
  }

  targetTypeLabel(type: NavigationTargetType): string {
    switch (type) {
      case 'EMBEDDED_IFRAME': return this.i18n.translate('nav.settings.type_embedded');
      case 'EXTERNAL_LINK': return this.i18n.translate('nav.settings.type_external');
      case 'INTERNAL_ROUTE': return this.i18n.translate('nav.settings.type_internal');
    }
  }

  sectionLabel(sectionId: string): string {
    switch (sectionId) {
      case 'custom': return this.i18n.translate('nav.settings.section_custom');
      case 'workspace': return this.i18n.translate('nav.section.workspace');
      case 'iam': return this.i18n.translate('nav.section.iam');
      case 'administration': return this.i18n.translate('nav.section.administration');
      default: return sectionId;
    }
  }

  onTitleChange(): void {
    if (!this.editingItem() && this.formTitle) {
      this.formCode = transliterateToCode(this.formTitle);
    }
  }

  normalizeUrl(url: string, targetType: NavigationTargetType): string {
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (targetType === 'INTERNAL_ROUTE') {
      return trimmed.startsWith('/') ? trimmed : '/' + trimmed;
    }
    if (!trimmed.match(/^(https?:\/\/|\/)/i)) {
      return 'https://' + trimmed;
    }
    return trimmed;
  }

  onUrlBlur(): void {
    if (this.formUrl) {
      this.formUrl = this.normalizeUrl(this.formUrl, this.formTargetType);
    }
  }

  isFormValid(): boolean {
    return !!(this.formTitle.trim() && this.formCode.trim() && this.formUrl.trim());
  }

  openCreateModal(): void {
    this.editingItem.set(null);
    this.formCode = '';
    this.formTitle = '';
    this.formTargetType = 'EMBEDDED_IFRAME';
    this.formSectionId = 'custom';
    this.formUrl = '';
    this.formIcon = 'analytics';
    this.formSortOrder = (this.items().length + 1) * 10;
    this.isModalOpen.set(true);
  }

  openEditModal(item: CustomNavigationItem): void {
    this.editingItem.set(item);
    this.formCode = item.code;
    this.formTitle = item.title;
    this.formTargetType = item.targetType;
    this.formSectionId = item.sectionId;
    this.formUrl = item.url;
    this.formIcon = item.icon;
    this.formSortOrder = item.sortOrder;
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.editingItem.set(null);
  }

  previewItem(item: CustomNavigationItem): void {
    if (item.targetType === 'EMBEDDED_IFRAME') {
      window.open(`/embed/${item.code}`, '_blank');
    } else if (item.targetType === 'EXTERNAL_LINK') {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    } else {
      window.open(item.url, '_blank');
    }
  }

  saveItem(): void {
    if (!this.isFormValid()) return;
    this.isSubmitting.set(true);

    const finalUrl = this.normalizeUrl(this.formUrl, this.formTargetType);
    const finalCode = transliterateToCode(this.formCode.trim()) || this.formCode.trim().toLowerCase();

    const editing = this.editingItem();
    if (editing) {
      const payload: UpdateNavigationItemPayload = {
        code: finalCode,
        title: this.formTitle.trim(),
        targetType: this.formTargetType,
        sectionId: this.formSectionId,
        url: finalUrl,
        icon: this.formIcon.trim() || 'bar_chart',
        sortOrder: this.formSortOrder,
        openInIframe: this.formTargetType === 'EMBEDDED_IFRAME',
        state: editing.state
      };
      this.navService.updateItem(editing.id, payload).subscribe({
        next: () => {
          this.toast.success(this.i18n.translate('common.saved'));
          this.isSubmitting.set(false);
          this.closeModal();
          this.loadItems();
        },
        error: (err: any) => {
          const msg = err?.error?.detail || err?.error?.message || this.i18n.translate('common.error');
          this.toast.error(msg);
          this.isSubmitting.set(false);
        }
      });
    } else {
      const payload: CreateNavigationItemPayload = {
        code: finalCode,
        title: this.formTitle.trim(),
        targetType: this.formTargetType,
        sectionId: this.formSectionId,
        url: finalUrl,
        icon: this.formIcon.trim() || 'bar_chart',
        sortOrder: this.formSortOrder,
        openInIframe: this.formTargetType === 'EMBEDDED_IFRAME'
      };
      this.navService.createItem(payload).subscribe({
        next: () => {
          this.toast.success(this.i18n.translate('common.saved'));
          this.isSubmitting.set(false);
          this.closeModal();
          this.loadItems();
        },
        error: (err: any) => {
          const msg = err?.error?.detail || err?.error?.message || this.i18n.translate('common.error');
          this.toast.error(msg);
          this.isSubmitting.set(false);
        }
      });
    }
  }

  toggleItem(item: CustomNavigationItem): void {
    this.navService.toggleItem(item.id).subscribe({
      next: () => this.loadItems(),
      error: (err: any) => {
        const msg = err?.error?.detail || err?.error?.message || this.i18n.translate('common.error');
        this.toast.error(msg);
      }
    });
  }

  confirmDelete(item: CustomNavigationItem): void {
    this.deleteTarget.set(item);
  }

  executeDelete(): void {
    const target = this.deleteTarget();
    if (!target) return;
    this.navService.deleteItem(target.id).subscribe({
      next: () => {
        this.toast.success(this.i18n.translate('common.saved'));
        this.deleteTarget.set(null);
        this.loadItems();
      },
      error: (err: any) => {
        const msg = err?.error?.detail || err?.error?.message || this.i18n.translate('common.error');
        this.toast.error(msg);
      }
    });
  }
}
