import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination.component';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { AuditRecord } from '../audit.models';

@Component({
  selector: 'app-audit-logs-table',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    UiButtonComponent,
    UiPaginationComponent
  ],
  template: `
    <div id="audit-log-panel" class="tab-content" role="tabpanel" aria-labelledby="audit-log-tab">
      <!-- Filter Toolbar -->
      <div class="filter-toolbar">
        <div class="filter-group">
          <label class="sr-only" for="audit-table-filter">{{ 'audit.filtr_zhurnala_po_tablice' | t }}</label>
          <select id="audit-table-filter" name="auditTableFilter" class="filter-select"
            [ngModel]="tableFilter" (ngModelChange)="tableFilterChange.emit($event); applyFilters.emit()">
            <option value="">{{ 'audit.vse_tablicy' | t }}</option>
            <option value="md_users">{{ 'audit.polzovateli_md_users' | t }}</option>
            <option value="ms_tasks">{{ 'audit.zadachi_ms_tasks' | t }}</option>
            <option value="ms_projects">{{ 'audit.proekty_ms_projects' | t }}</option>
            <option value="md_roles">{{ 'audit.roli_i_prava_md_roles' | t }}</option>
            <option value="md_custom_fields">{{ 'audit.dinamicheskie_polya_md_custom_fields' | t }}</option>
          </select>

          <label class="sr-only" for="audit-event-filter">{{ 'audit.filtr_zhurnala_po_deystviyu' | t }}</label>
          <select id="audit-event-filter" name="auditEventFilter" class="filter-select"
            [ngModel]="eventFilter" (ngModelChange)="eventFilterChange.emit($event); applyFilters.emit()">
            <option value="">{{ 'audit.vse_deystviya' | t }}</option>
            <option value="I">{{ 'audit.sozdanie_insert' | t }}</option>
            <option value="U">{{ 'audit.izmenenie_update' | t }}</option>
            <option value="D">{{ 'audit.udalenie_delete' | t }}</option>
          </select>

          <div class="compact-filter">
            <label for="audit-row-pk-filter">{{ 'audit.row_pk' | t }}</label>
            <input id="audit-row-pk-filter" name="auditRowPkFilter" class="filter-input" type="text"
              [ngModel]="rowPkFilter" (ngModelChange)="rowPkFilterChange.emit($event)" (keyup.enter)="applyFilters.emit()" />
          </div>

          <div class="compact-filter compact-filter-narrow">
            <label for="audit-user-filter">{{ 'audit.user_id' | t }}</label>
            <input id="audit-user-filter" name="auditUserFilter" class="filter-input" type="text" inputmode="numeric"
              pattern="[0-9]*" [ngModel]="auditUserFilter" (ngModelChange)="auditUserFilterChange.emit($event)" (keyup.enter)="applyFilters.emit()" />
          </div>

          <div class="compact-filter">
            <label for="audit-from-filter">{{ 'audit.date_from_utc' | t }}</label>
            <input id="audit-from-filter" name="auditFromFilter" class="filter-input" type="date"
              [ngModel]="auditFromFilter" (ngModelChange)="auditFromFilterChange.emit($event)" />
          </div>

          <div class="compact-filter">
            <label for="audit-to-filter">{{ 'audit.date_to_utc' | t }}</label>
            <input id="audit-to-filter" name="auditToFilter" class="filter-input" type="date"
              [ngModel]="auditToFilter" (ngModelChange)="auditToFilterChange.emit($event)" />
          </div>

          <ui-button id="audit-apply-filters" variant="primary" size="sm" icon="filter_alt"
            (onClick)="applyFilters.emit()">{{ 'audit.apply_filters' | t }}</ui-button>
          <ui-button id="audit-reset-filters" variant="ghost" size="sm" icon="filter_alt_off"
            (onClick)="resetFilters.emit()">{{ 'audit.reset_filters' | t }}</ui-button>
        </div>
      </div>

      <div id="audit-load-error" class="inline-feedback" role="alert" *ngIf="auditError">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        <span>{{ 'audit.load_log_error' | t }}</span>
        <ui-button variant="secondary" size="sm" icon="refresh" (onClick)="retryLoad.emit()">
          {{ 'audit.retry' | t }}
        </ui-button>
      </div>

      <!-- Audit Table -->
      <div class="table-container" role="region" [attr.aria-label]="'audit.tablica_zhurnala_izmeneniy' | t" tabindex="0" [attr.aria-busy]="isLoading">
        <table class="data-table" [attr.aria-label]="'audit.zhurnal_izmeneniy_dannyh' | t">
          <thead>
            <tr>
              <th style="width: 70px;">ID</th>
              <th>{{ 'audit.tablica' | t }}</th>
              <th>PK</th>
              <th>{{ 'audit.deystvie' | t }}</th>
              <th>{{ 'audit.kto_izmenil' | t }}</th>
              <th>{{ 'audit.kanal' | t }}</th>
              <th>{{ 'audit.data_i_vremya' | t }}</th>
              <th style="width: 80px; text-align: right;">Diff</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngIf="isLoading && auditLogs.length === 0">
              <td colspan="8" class="loading-state-cell" role="status">{{ 'audit.loading_log' | t }}</td>
            </tr>
            <tr *ngFor="let item of auditLogs">
              <td class="tabular-nums font-mono text-muted">#{{ item.id }}</td>
              <td>
                <span class="table-tag font-mono">{{ item.tableName }}</span>
              </td>
              <td>
                <span class="pk-pill font-mono">{{ item.rowPk }}</span>
              </td>
              <td>
                <span class="event-badge" [ngClass]="getEventBadgeClass(item.event)">
                  {{ getEventName(item.event) }}
                </span>
              </td>
              <td>
                <div class="user-cell" *ngIf="item.changedByName">
                  <span class="user-name">{{ item.changedByName }}</span>
                  <span class="user-sub text-muted text-xs">&#64;{{ item.changedByLogin }}</span>
                </div>
                <span *ngIf="!item.changedByName" class="text-muted">{{ 'audit.sistema' | t }}</span>
              </td>
              <td>
                <span class="channel-pill" [class.api-pill]="item.isApi">
                  <span class="material-symbols-outlined" aria-hidden="true">{{ item.isApi ? 'terminal' : 'web' }}</span>
                  {{ item.isApi ? 'REST API' : 'Web UI' }}
                </span>
              </td>
              <td>
                <span class="date-cell tabular-nums">{{ item.changedAt | date:'dd.MM.yyyy HH:mm:ss' }}</span>
              </td>
              <td style="text-align: right;">
                <button type="button" class="diff-btn" [attr.aria-label]="'audit.view_change_number' | t:{id: item.id}" [title]="'audit.prosmotr_izmeneniy' | t" (click)="selectRecord.emit(item)">
                  <span class="material-symbols-outlined" aria-hidden="true">difference</span>
                </button>
              </td>
            </tr>

            <tr *ngIf="auditLogs.length === 0 && !isLoading && !auditError">
              <td colspan="8" class="empty-state-cell">
                <div class="empty-state-box">
                  <span class="material-symbols-outlined empty-icon" aria-hidden="true">history_toggle_off</span>
                  <h3>{{ 'audit.zapisey_audita_ne_naydeno' | t }}</h3>
                  <p>{{ 'audit.poprobuyte_sbrosit_vybrannye_filtry' | t }}</p>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <ui-pagination
        *ngIf="auditTotal > 0"
        [totalItems]="auditTotal"
        [pageSize]="auditPageSize"
        [currentPage]="auditCurrentPage"
        [cursorMode]="true"
        [hasNextPage]="auditHasMore"
        (pageChange)="pageChange.emit($event)"
        (pageSizeChange)="pageSizeChange.emit($event)"
      ></ui-pagination>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .tab-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .filter-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 4px;
      flex-wrap: wrap;
    }

    .filter-group {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .filter-select {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 7px 12px;
      color: var(--text-main);
      font-size: 13px;
      outline: none;
    }

    .filter-select option {
      background: var(--bg-surface);
      color: var(--text-main);
    }

    .compact-filter {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 142px;
    }

    .compact-filter-narrow {
      min-width: 92px;
      width: 110px;
    }

    .compact-filter label {
      color: var(--text-light);
      font-size: 11px;
      font-weight: 600;
    }

    .filter-input {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 6px 10px;
      color: var(--text-main);
      font-size: 13px;
      outline: none;
    }

    .filter-input:focus, .filter-select:focus {
      border-color: var(--primary);
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      border: 0;
    }

    .inline-feedback {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      background: var(--danger-bg);
      color: var(--danger);
      border: 1px solid var(--danger);
      margin-top: 4px;
    }

    .table-container {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      overflow-x: auto;
    }

    .table-container:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }

    .data-table th {
      padding: 12px 16px;
      background: var(--bg-hover);
      color: var(--text-muted);
      font-weight: 600;
      font-size: 12px;
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
    }

    .data-table td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-subtle);
      color: var(--text-main);
      vertical-align: middle;
    }

    .data-table tr:last-child td {
      border-bottom: none;
    }

    .tabular-nums {
      font-variant-numeric: tabular-nums;
    }

    .font-mono {
      font-family: monospace;
    }

    .text-muted {
      color: var(--text-light);
    }

    .text-xs {
      font-size: 11px;
    }

    .table-tag {
      background: var(--bg-hover);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
      color: var(--text-main);
      border: 1px solid var(--border-color);
    }

    .pk-pill {
      font-weight: 600;
      color: var(--text-main);
    }

    .event-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }

    .event-badge.insert {
      background: var(--success-bg);
      color: var(--success);
    }

    .event-badge.update {
      background: var(--info-bg);
      color: var(--info);
    }

    .event-badge.delete {
      background: var(--danger-bg);
      color: var(--danger);
    }

    .user-cell {
      display: flex;
      flex-direction: column;
    }

    .user-name {
      font-weight: 500;
    }

    .channel-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--text-light);
    }

    .channel-pill .material-symbols-outlined {
      font-size: 14px;
    }

    .api-pill {
      color: var(--primary-text);
    }

    .date-cell {
      white-space: nowrap;
      color: var(--text-light);
    }

    .diff-btn {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-light);
      width: 32px;
      height: 32px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .diff-btn:hover {
      background: var(--bg-hover);
      color: var(--primary-text);
      border-color: var(--primary);
    }

    .diff-btn .material-symbols-outlined {
      font-size: 18px;
    }

    .loading-state-cell, .empty-state-cell {
      padding: 48px !important;
      text-align: center;
      color: var(--text-light);
    }

    .empty-state-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .empty-state-box .empty-icon {
      font-size: 48px;
      color: var(--text-light);
      opacity: 0.5;
    }

    .empty-state-box h3 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-main);
      margin: 0;
    }

    .empty-state-box p {
      font-size: 13px;
      margin: 0;
    }
  `]
})
export class AuditLogsTableComponent {
  @Input() auditLogs: AuditRecord[] = [];
  @Input() auditTotal = 0;
  @Input() auditHasMore = false;
  @Input() auditPageSize = 20;
  @Input() auditCurrentPage = 1;
  @Input() isLoading = false;
  @Input() auditError = false;

  @Input() tableFilter = '';
  @Input() eventFilter = '';
  @Input() rowPkFilter = '';
  @Input() auditUserFilter = '';
  @Input() auditFromFilter = '';
  @Input() auditToFilter = '';

  @Output() tableFilterChange = new EventEmitter<string>();
  @Output() eventFilterChange = new EventEmitter<string>();
  @Output() rowPkFilterChange = new EventEmitter<string>();
  @Output() auditUserFilterChange = new EventEmitter<string>();
  @Output() auditFromFilterChange = new EventEmitter<string>();
  @Output() auditToFilterChange = new EventEmitter<string>();

  @Output() applyFilters = new EventEmitter<void>();
  @Output() resetFilters = new EventEmitter<void>();
  @Output() retryLoad = new EventEmitter<void>();
  @Output() selectRecord = new EventEmitter<AuditRecord>();
  @Output() pageChange = new EventEmitter<number>();
  @Output() pageSizeChange = new EventEmitter<number>();

  getEventName(event: string): string {
    switch (event) {
      case 'I': return 'INSERT';
      case 'U': return 'UPDATE';
      case 'D': return 'DELETE';
      default: return event;
    }
  }

  getEventBadgeClass(event: string): string {
    switch (event) {
      case 'I': return 'insert';
      case 'U': return 'update';
      case 'D': return 'delete';
      default: return '';
    }
  }
}
