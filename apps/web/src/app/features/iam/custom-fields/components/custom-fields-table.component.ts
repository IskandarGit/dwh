import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CustomField } from '../custom-fields.models';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { TranslatePipe, I18nService } from '../../../../core/services/i18n.service';

@Component({
  selector: 'app-custom-fields-table',
  standalone: true,
  imports: [
    CommonModule,
    UiButtonComponent,
    TranslatePipe
  ],
  template: `
    <div class="card">
      <div class="table-wrapper" role="region" [attr.aria-label]="'iam.tablica_dinamicheskih_atributov' | t" tabindex="0">
        <table class="data-table" [attr.aria-label]="'iam.dinamicheskie_atributy' | t">
          <thead>
            <tr>
              <th class="col-order sortable" (click)="onSort('orderNo')" [attr.aria-sort]="getAriaSort('orderNo')">
                <span class="th-content">
                  #
                  <span class="material-symbols-outlined sort-icon" aria-hidden="true">{{ getSortIcon('orderNo') }}</span>
                </span>
              </th>
              <th class="sortable" (click)="onSort('code')" [attr.aria-sort]="getAriaSort('code')">
                <span class="th-content">
                  {{ 'iam.kod_polya' | t }}
                  <span class="material-symbols-outlined sort-icon" aria-hidden="true">{{ getSortIcon('code') }}</span>
                </span>
              </th>
              <th class="sortable" (click)="onSort('name')" [attr.aria-sort]="getAriaSort('name')">
                <span class="th-content">
                  {{ 'iam.nazvanie' | t }}
                  <span class="material-symbols-outlined sort-icon" aria-hidden="true">{{ getSortIcon('name') }}</span>
                </span>
              </th>
              <th class="sortable" (click)="onSort('entityType')" [attr.aria-sort]="getAriaSort('entityType')">
                <span class="th-content">
                  {{ 'iam.suschnost' | t }}
                  <span class="material-symbols-outlined sort-icon" aria-hidden="true">{{ getSortIcon('entityType') }}</span>
                </span>
              </th>
              <th class="sortable" (click)="onSort('fieldType')" [attr.aria-sort]="getAriaSort('fieldType')">
                <span class="th-content">
                  {{ 'iam.tip_dannyh' | t }}
                  <span class="material-symbols-outlined sort-icon" aria-hidden="true">{{ getSortIcon('fieldType') }}</span>
                </span>
              </th>
              <th class="sortable" (click)="onSort('isRequired')" [attr.aria-sort]="getAriaSort('isRequired')">
                <span class="th-content">
                  {{ 'iam.obyazatelnoe' | t }}
                  <span class="material-symbols-outlined sort-icon" aria-hidden="true">{{ getSortIcon('isRequired') }}</span>
                </span>
              </th>
              <th>{{ 'iam.znachenie_po_umolchaniyu' | t }}</th>
              <th *ngIf="canManage || canEdit || canDelete" class="text-right">{{ 'common.actions' | t }}</th>
            </tr>
          </thead>
          <tbody>
            <!-- Loading Skeleton / Spinner State -->
            <tr *ngIf="isLoading" class="loading-row">
              <td [attr.colspan]="(canManage || canEdit || canDelete) ? 8 : 7" class="loading-cell">
                <div class="loading-state">
                  <span class="material-symbols-outlined spin-icon" aria-hidden="true">progress_activity</span>
                  <span>{{ 'iam.zagruzka_poley' | t }}</span>
                </div>
              </td>
            </tr>

            <!-- Data Rows -->
            <ng-container *ngIf="!isLoading">
              <tr *ngFor="let f of fields; trackBy: trackById">
                <td class="col-order order-cell font-mono">{{ f.orderNo || 0 }}</td>
                <td class="code-cell font-mono">
                  <div class="code-badge-wrap">
                    <span class="code-text">{{ f.code }}</span>
                    <button
                      type="button"
                      class="copy-code-btn"
                      (click)="copyCode.emit(f.code)"
                      [attr.aria-label]="'iam.kopirovat_kod' | t"
                      [title]="'iam.kopirovat_kod' | t"
                    >
                      <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>
                    </button>
                  </div>
                </td>
                <td class="name-cell font-medium">{{ f.name }}</td>
                <td>
                  <span class="entity-badge" [ngClass]="getEntityBadgeClass(f.entityType)">
                    <span class="material-symbols-outlined entity-icon" aria-hidden="true">{{ getEntityIcon(f.entityType) }}</span>
                    <span>{{ getEntityLabel(f.entityType) }}</span>
                  </span>
                </td>
                <td>
                  <span class="type-badge" [ngClass]="'type-' + f.fieldType">
                    <span class="material-symbols-outlined type-icon" aria-hidden="true">{{ getTypeIcon(f.fieldType) }}</span>
                    <span>{{ getTypeName(f.fieldType) }}</span>
                  </span>
                </td>
                <td>
                  <span class="status-indicator" [class.active]="f.isRequired">
                    <span class="material-symbols-outlined status-icon" aria-hidden="true">
                      {{ f.isRequired ? 'check_circle' : 'remove_circle_outline' }}
                    </span>
                    <span>{{ (f.isRequired ? 'common.yes' : 'common.no') | t }}</span>
                  </span>
                </td>
                <td class="text-muted">{{ f.defaultValue || '—' }}</td>
                <td *ngIf="canManage || canEdit || canDelete" class="text-right">
                  <button
                    *ngIf="canEdit || canManage"
                    type="button"
                    class="action-btn"
                    (click)="editField.emit(f)"
                    [attr.aria-label]="'iam.edit_named' | t:{name: f.name}"
                    [title]="'common.edit' | t"
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">edit</span>
                  </button>
                  <button
                    *ngIf="canDelete || canManage"
                    type="button"
                    class="action-btn danger"
                    (click)="deleteField.emit(f)"
                    [attr.aria-label]="'iam.delete_named' | t:{name: f.name}"
                    [title]="'common.delete' | t"
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">delete</span>
                  </button>
                </td>
              </tr>

              <!-- Empty State -->
              <tr *ngIf="fields.length === 0">
                <td [attr.colspan]="(canManage || canEdit || canDelete) ? 8 : 7" class="empty-row">
                  <div class="empty-state" *ngIf="searchQuery">
                    <span class="material-symbols-outlined empty-icon" aria-hidden="true">search_off</span>
                    <p>{{ 'iam.nichego_ne_naydeno_po_zaprosu' | t }}: «<strong>{{ searchQuery }}</strong>»</p>
                    <ui-button variant="secondary" size="sm" (onClick)="clearSearch.emit()">
                      {{ 'iam.sbrosit_poisk' | t }}
                    </ui-button>
                  </div>
                  <div class="empty-state" *ngIf="!searchQuery">
                    <span class="material-symbols-outlined empty-icon" aria-hidden="true">tune</span>
                    <p>{{ 'iam.dinamicheskie_polya_ne_naydeny' | t }}</p>
                    <ui-button *ngIf="canManage" variant="primary" size="sm" icon="add" (onClick)="createField.emit()">
                      {{ 'iam.dobavit_pole' | t }}
                    </ui-button>
                  </div>
                </td>
              </tr>
            </ng-container>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .card {
      background: var(--bg-surface);
      border-radius: 12px;
      border: 1px solid var(--border-color);
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    }

    .table-wrapper {
      overflow-x: auto;
    }

    .data-table {
      width: 100%;
      min-width: 820px;
      border-collapse: collapse;
      text-align: left;
    }

    .data-table th {
      padding: 12px 16px;
      background: var(--bg-hover);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
    }

    .data-table th.sortable {
      cursor: pointer;
      user-select: none;
      transition: background-color 0.15s;
    }

    .data-table th.sortable:hover {
      background: var(--border-color);
      color: var(--text-main);
    }

    .th-content {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .sort-icon {
      font-size: 16px;
      color: var(--text-light);
      opacity: 0.6;
    }

    th.sortable:hover .sort-icon {
      opacity: 1;
    }

    .col-order {
      width: 60px;
      text-align: center;
    }

    .order-cell {
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
    }

    .data-table td {
      padding: 13px 16px;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 14px;
      color: var(--text-main);
      vertical-align: middle;
    }

    .data-table tr:hover td {
      background: var(--bg-hover);
    }

    .code-cell {
      color: var(--primary-text, var(--primary));
      font-size: 13px;
    }

    .code-badge-wrap {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--bg-hover);
      padding: 3px 8px;
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
    }

    .code-text {
      font-weight: 600;
    }

    .copy-code-btn {
      background: transparent;
      border: none;
      padding: 1px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-light);
      cursor: pointer;
      border-radius: 4px;
      opacity: 0.7;
      transition: all 0.15s;
    }

    .copy-code-btn:hover {
      opacity: 1;
      color: var(--primary);
      background: rgba(0, 0, 0, 0.05);
    }

    .copy-code-btn .material-symbols-outlined {
      font-size: 14px;
    }

    .name-cell {
      font-weight: 500;
    }

    .entity-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 9px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .entity-icon {
      font-size: 15px;
    }

    .entity-badge.user { background: var(--primary-subtle, #e0f2fe); color: var(--primary, #0284c7); }
    .entity-badge.project { background: var(--info-bg, #e0e7ff); color: var(--info, #4f46e5); }
    .entity-badge.task { background: var(--success-bg, #dcfce7); color: var(--success, #16a34a); }
    .entity-badge.note { background: var(--warning-bg, #fef3c7); color: var(--warning, #d97706); }
    .entity-badge.custom-entity { background: var(--bg-hover); color: var(--text-main); border: 1px solid var(--border-color); }

    .type-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 6px;
      background: var(--bg-hover);
      border: 1px solid var(--border-subtle);
      font-size: 12px;
      color: var(--text-main);
      font-weight: 500;
    }

    .type-icon {
      font-size: 15px;
      color: var(--text-light);
    }

    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      background: var(--bg-hover);
      color: var(--text-muted);
    }

    .status-indicator.active {
      background: var(--success-bg, #dcfce7);
      color: var(--success, #16a34a);
    }

    .status-icon {
      font-size: 15px;
    }

    .action-btn {
      width: 32px;
      height: 32px;
      padding: 0;
      border-radius: 6px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-light);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s;
    }

    .action-btn:hover {
      background: var(--bg-hover);
      color: var(--text-main);
    }

    .action-btn.danger:hover {
      background: var(--danger-bg, #fee2e2);
      color: var(--danger, #dc2626);
    }

    .loading-cell {
      padding: 60px 16px !important;
      text-align: center;
    }

    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      color: var(--text-light);
      font-size: 14px;
    }

    .spin-icon {
      font-size: 32px;
      color: var(--primary);
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      100% { transform: rotate(360deg); }
    }

    .empty-row {
      text-align: center;
      padding: 56px 16px !important;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      color: var(--text-light);
    }

    .empty-icon {
      font-size: 48px;
      opacity: 0.4;
      color: var(--text-light);
    }

    .empty-state p {
      margin: 0;
      font-size: 14px;
    }
  `]
})
export class CustomFieldsTableComponent {
  private readonly uiI18n = inject(I18nService);

  @Input() fields: CustomField[] = [];
  @Input() isLoading = false;
  @Input() canManage = false;
  @Input() canEdit = false;
  @Input() canDelete = false;
  @Input() searchQuery = '';
  @Input() sortColumn: string = 'orderNo';
  @Input() sortDirection: 'asc' | 'desc' = 'asc';

  @Output() copyCode = new EventEmitter<string>();
  @Output() editField = new EventEmitter<CustomField>();
  @Output() deleteField = new EventEmitter<CustomField>();
  @Output() clearSearch = new EventEmitter<void>();
  @Output() createField = new EventEmitter<void>();
  @Output() sortChange = new EventEmitter<string>();

  trackById(_index: number, item: CustomField): number | string {
    return item.id ?? item.code;
  }

  onSort(column: string) {
    this.sortChange.emit(column);
  }

  getSortIcon(col: string): string {
    if (this.sortColumn !== col) return 'unfold_more';
    return this.sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  getAriaSort(col: string): 'ascending' | 'descending' | 'none' {
    if (this.sortColumn !== col) return 'none';
    return this.sortDirection === 'asc' ? 'ascending' : 'descending';
  }

  getEntityLabel(ent: string): string {
    switch ((ent || '').toUpperCase()) {
      case 'USER': return this.uiI18n.translate('nav.users');
      case 'PROJECT': return this.uiI18n.translate('nav.projects');
      case 'TASK': return this.uiI18n.translate('nav.tasks');
      case 'NOTE': return this.uiI18n.translate('iam.zametka_note');
      case 'ORGANIZATION_UNIT': return this.uiI18n.translate('nav.org_units') || ent;
      default: return ent;
    }
  }

  getEntityIcon(ent: string): string {
    switch (ent.toUpperCase()) {
      case 'ALL': return 'apps';
      case 'USER': return 'person';
      case 'PROJECT': return 'folder';
      case 'TASK': return 'task_alt';
      case 'NOTE': return 'description';
      case 'ORGANIZATION_UNIT': return 'corporate_fare';
      default: return 'data_object';
    }
  }

  getEntityBadgeClass(entity: string): string {
    const ent = (entity || '').toLowerCase();
    if (['user', 'project', 'task', 'note'].includes(ent)) {
      return ent;
    }
    return 'custom-entity';
  }

  getTypeName(type: string): string {
    switch (type) {
      case 'string': return this.uiI18n.translate('iam.tekst');
      case 'number': return this.uiI18n.translate('iam.chislo');
      case 'boolean': return this.uiI18n.translate('iam.da_net');
      case 'date': return this.uiI18n.translate('iam.data');
      case 'select': return this.uiI18n.translate('projects.spisok');
      case 'user_ref': return this.uiI18n.translate('iam.user_ref');
      default: return type;
    }
  }

  getTypeIcon(type: string): string {
    switch (type) {
      case 'string': return 'format_quote';
      case 'number': return 'tag';
      case 'boolean': return 'toggle_on';
      case 'date': return 'calendar_today';
      case 'select': return 'list';
      case 'user_ref': return 'person';
      default: return 'help';
    }
  }
}
