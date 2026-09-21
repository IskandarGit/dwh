import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination.component';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { SecurityEventRecord } from '../audit.models';

@Component({
  selector: 'app-audit-security-table',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    UiButtonComponent,
    UiPaginationComponent
  ],
  template: `
    <div id="security-events-panel" class="tab-content" role="tabpanel" aria-labelledby="security-events-tab">
      <!-- Filter Toolbar -->
      <div class="filter-toolbar">
        <div class="filter-group">
          <label class="sr-only" for="security-event-filter">{{ 'audit.filtr_sobytiy_bezopasnosti' | t }}</label>
          <select id="security-event-filter" name="securityEventFilter" class="filter-select"
            [ngModel]="secEventTypeFilter" (ngModelChange)="secEventTypeFilterChange.emit($event); applyFilters.emit()">
            <option value="">{{ 'audit.vse_sobytiya' | t }}</option>
            <option value="LOGIN_SUCCESS">{{ 'audit.uspeshnyy_vhod_login_success' | t }}</option>
            <option value="LOGIN_FAILED">{{ 'audit.oshibka_vhoda_login_failed' | t }}</option>
            <option value="LOGIN_LOCKED">{{ 'audit.blokirovka_brute_force_login_locked' | t }}</option>
            <option value="IP_RATE_LIMITED">Rate Limit IP (IP_RATE_LIMITED)</option>
            <option value="PASSWORD_CHANGED">{{ 'audit.smena_parolya_password_changed' | t }}</option>
            <option value="API_TOKEN_CREATED">{{ 'audit.vypusk_api_tokena' | t }}</option>
          </select>

          <div class="search-box">
            <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
            <label class="sr-only" for="security-ip-search">{{ 'audit.poisk_sobytiy_po_ip_adresu' | t }}</label>
            <input
              id="security-ip-search"
              name="securityIpSearch"
              type="text"
              class="search-input"
              [placeholder]="'audit.poisk_po_ip' | t"
              [ngModel]="secIpFilter"
              (ngModelChange)="secIpFilterChange.emit($event)"
              (keyup.enter)="applyFilters.emit()"
            />
          </div>

          <div class="compact-filter compact-filter-narrow">
            <label for="security-user-filter">{{ 'audit.user_id' | t }}</label>
            <input id="security-user-filter" name="securityUserFilter" class="filter-input" type="text" inputmode="numeric"
              pattern="[0-9]*" [ngModel]="securityUserFilter" (ngModelChange)="securityUserFilterChange.emit($event)" (keyup.enter)="applyFilters.emit()" />
          </div>

          <div class="compact-filter">
            <label for="security-from-filter">{{ 'audit.date_from_utc' | t }}</label>
            <input id="security-from-filter" name="securityFromFilter" class="filter-input" type="date"
              [ngModel]="securityFromFilter" (ngModelChange)="securityFromFilterChange.emit($event)" />
          </div>

          <div class="compact-filter">
            <label for="security-to-filter">{{ 'audit.date_to_utc' | t }}</label>
            <input id="security-to-filter" name="securityToFilter" class="filter-input" type="date"
              [ngModel]="securityToFilter" (ngModelChange)="securityToFilterChange.emit($event)" />
          </div>

          <ui-button id="security-apply-filters" variant="primary" size="sm" icon="filter_alt"
            (onClick)="applyFilters.emit()">{{ 'audit.apply_filters' | t }}</ui-button>
          <ui-button id="security-reset-filters" variant="ghost" size="sm" icon="filter_alt_off"
            (onClick)="resetFilters.emit()">{{ 'audit.reset_filters' | t }}</ui-button>
        </div>
      </div>

      <div id="security-load-error" class="inline-feedback" role="alert" *ngIf="securityError">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        <span>{{ 'audit.load_security_error' | t }}</span>
        <ui-button variant="secondary" size="sm" icon="refresh" (onClick)="retryLoad.emit()">
          {{ 'audit.retry' | t }}
        </ui-button>
      </div>

      <!-- Security Events Table -->
      <div class="table-container" role="region" [attr.aria-label]="'audit.tablica_sobytiy_bezopasnosti' | t" tabindex="0" [attr.aria-busy]="isLoading">
        <table class="data-table" [attr.aria-label]="'audit.sobytiya_bezopasnosti' | t">
          <thead>
            <tr>
              <th style="width: 70px;">ID</th>
              <th>{{ 'audit.sobytie' | t }}</th>
              <th>{{ 'audit.polzovatel' | t }}</th>
              <th>{{ 'audit.ip_adres' | t }}</th>
              <th>{{ 'audit.user_agent_ustroystvo' | t }}</th>
              <th>{{ 'audit.data_i_vremya' | t }}</th>
              <th style="width: 80px; text-align: right;">{{ 'audit.detali' | t }}</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngIf="isLoading && securityEvents.length === 0">
              <td colspan="7" class="loading-state-cell" role="status">{{ 'audit.loading_security' | t }}</td>
            </tr>
            <tr *ngFor="let item of securityEvents">
              <td class="tabular-nums font-mono text-muted">#{{ item.id }}</td>
              <td>
                <span class="sec-event-badge" [ngClass]="getSecurityEventBadgeClass(item.eventType)">
                  <span class="material-symbols-outlined" aria-hidden="true">{{ getSecurityEventIcon(item.eventType) }}</span>
                  {{ item.eventType }}
                </span>
              </td>
              <td>
                <div class="user-cell" *ngIf="item.userName">
                  <span class="user-name">{{ item.userName }}</span>
                  <span class="user-sub text-muted text-xs">&#64;{{ item.userLogin }}</span>
                </div>
                <span *ngIf="!item.userName" class="text-muted">{{ item.details['login'] || ('common.guest' | t) }}</span>
              </td>
              <td>
                <span class="ip-pill font-mono">{{ item.ip }}</span>
              </td>
              <td>
                <span class="ua-cell text-muted text-xs" [title]="item.userAgent || ''">
                  {{ formatUserAgent(item.userAgent) }}
                </span>
              </td>
              <td>
                <span class="date-cell tabular-nums">{{ item.createdAt | date:'dd.MM.yyyy HH:mm:ss' }}</span>
              </td>
              <td style="text-align: right;">
                <button type="button" class="diff-btn" [attr.aria-label]="'audit.view_security_event_number' | t:{id: item.id}" [title]="'audit.prosmotr_detaley' | t" (click)="selectEvent.emit(item)">
                  <span class="material-symbols-outlined" aria-hidden="true">info</span>
                </button>
              </td>
            </tr>

            <tr *ngIf="securityEvents.length === 0 && !isLoading && !securityError">
              <td colspan="7" class="empty-state-cell">
                <div class="empty-state-box">
                  <span class="material-symbols-outlined empty-icon" aria-hidden="true">verified_user</span>
                  <h3>{{ 'audit.sobytiy_bezopasnosti_ne_naydeno' | t }}</h3>
                  <p>{{ 'audit.vse_podozritelnye_sobytiya_i_vhody_fiksiruyutsya' | t }}</p>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <ui-pagination
        *ngIf="securityTotal > 0"
        [totalItems]="securityTotal"
        [pageSize]="secPageSize"
        [currentPage]="secCurrentPage"
        [cursorMode]="true"
        [hasNextPage]="securityHasMore"
        (pageChange)="pageChange.emit($event)"
        (pageSizeChange)="pageSizeChange.emit($event)"
      ></ui-pagination>
    </div>
  `,
  styleUrl: './audit-security-table.component.css'
})
export class AuditSecurityTableComponent {
  @Input() securityEvents: SecurityEventRecord[] = [];
  @Input() securityTotal = 0;
  @Input() securityHasMore = false;
  @Input() secPageSize = 20;
  @Input() secCurrentPage = 1;
  @Input() isLoading = false;
  @Input() securityError = false;

  @Input() secEventTypeFilter = '';
  @Input() secIpFilter = '';
  @Input() securityUserFilter = '';
  @Input() securityFromFilter = '';
  @Input() securityToFilter = '';

  @Output() secEventTypeFilterChange = new EventEmitter<string>();
  @Output() secIpFilterChange = new EventEmitter<string>();
  @Output() securityUserFilterChange = new EventEmitter<string>();
  @Output() securityFromFilterChange = new EventEmitter<string>();
  @Output() securityToFilterChange = new EventEmitter<string>();

  @Output() applyFilters = new EventEmitter<void>();
  @Output() resetFilters = new EventEmitter<void>();
  @Output() retryLoad = new EventEmitter<void>();
  @Output() selectEvent = new EventEmitter<SecurityEventRecord>();
  @Output() pageChange = new EventEmitter<number>();
  @Output() pageSizeChange = new EventEmitter<number>();

  getSecurityEventBadgeClass(type: string): string {
    if (type.includes('SUCCESS')) return 'success';
    if (type.includes('LOCKED') || type.includes('FAILED') || type.includes('RATE_LIMITED')) return 'danger';
    if (type.includes('CHANGED') || type.includes('RESET')) return 'warning';
    return 'info';
  }

  getSecurityEventIcon(type: string): string {
    if (type.includes('SUCCESS')) return 'check_circle';
    if (type.includes('LOCKED') || type.includes('RATE_LIMITED')) return 'block';
    if (type.includes('FAILED')) return 'error';
    if (type.includes('PASSWORD')) return 'key';
    if (type.includes('TOKEN')) return 'token';
    return 'info';
  }

  formatUserAgent(ua?: string): string {
    if (!ua) return '—';
    if (ua.includes('Postman')) return 'Postman API Client';
    if (ua.includes('PowerShell') || ua.includes('curl')) return ua;
    if (ua.includes('Chrome')) return 'Google Chrome';
    if (ua.includes('Firefox')) return 'Mozilla Firefox';
    if (ua.includes('Safari')) return 'Apple Safari';
    return ua.length > 30 ? ua.substring(0, 30) + '...' : ua;
  }
}
