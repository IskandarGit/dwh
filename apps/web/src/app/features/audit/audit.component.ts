import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { TranslatePipe } from '../../core/services/i18n.service';

import {
  AuditRecord,
  SecurityEventRecord,
  AuditStats,
  AuditPage
} from './audit.models';

import { AuditStatsTilesComponent } from './components/audit-stats-tiles.component';
import { AuditLogsTableComponent } from './components/audit-logs-table.component';
import { AuditSecurityTableComponent } from './components/audit-security-table.component';
import { AuditModalsComponent } from './components/audit-modals.component';

export * from './audit.models';

@Component({
  selector: 'app-audit',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    AuditStatsTilesComponent,
    AuditLogsTableComponent,
    AuditSecurityTableComponent,
    AuditModalsComponent
  ],
  template: `
    <div class="audit-page">
      <!-- Page Header -->
      <div class="view-header">
        <div class="header-left">
          <h1 class="view-title">{{ 'nav.audit' | t }}</h1>
          <span class="count-badge">WORM Log</span>
        </div>
        <div class="header-right">
          <button type="button" class="btn btn-secondary" [attr.aria-label]="'audit.obnovit_zhurnal_audita' | t" (click)="refreshAll()" [title]="'audit.obnovit_zhurnal' | t">
            <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
            <span>{{ 'common.refresh' | t }}</span>
          </button>
        </div>
      </div>

      <!-- Stats Cards -->
      <app-audit-stats-tiles
        [stats]="stats()"
        [statsError]="statsError()"
        (retryStats)="loadStats()"
      ></app-audit-stats-tiles>

      <!-- Tabs Navigation -->
      <div class="toolbar">
        <div class="status-tabs" role="tablist" [attr.aria-label]="'audit.razdely_audita' | t">
          <button
            id="audit-log-tab"
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="activeTab === 'audit'"
            [attr.aria-selected]="activeTab === 'audit'"
            aria-controls="audit-log-panel"
            (click)="setTab('audit')"
          >
            <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">database</span>
            <span>{{ 'audit.change_log_count' | t:{count: auditTotal()} }}</span>
          </button>
          <button
            id="security-events-tab"
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="activeTab === 'security'"
            [attr.aria-selected]="activeTab === 'security'"
            aria-controls="security-events-panel"
            (click)="setTab('security')"
          >
            <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">shield</span>
            <span>{{ 'audit.security_events_count' | t:{count: securityTotal()} }}</span>
          </button>
        </div>
      </div>

      <!-- TAB 1: AUDIT LOGS -->
      <app-audit-logs-table
        *ngIf="activeTab === 'audit'"
        [auditLogs]="auditLogs()"
        [auditTotal]="auditTotal()"
        [auditHasMore]="auditHasMore()"
        [auditPageSize]="auditPageSize"
        [auditCurrentPage]="auditCurrentPage"
        [isLoading]="isLoading()"
        [auditError]="auditError()"
        [tableFilter]="tableFilter"
        [eventFilter]="eventFilter"
        [rowPkFilter]="rowPkFilter"
        [auditUserFilter]="auditUserFilter"
        [auditFromFilter]="auditFromFilter"
        [auditToFilter]="auditToFilter"
        (tableFilterChange)="tableFilter = $event"
        (eventFilterChange)="eventFilter = $event"
        (rowPkFilterChange)="rowPkFilter = $event"
        (auditUserFilterChange)="auditUserFilter = $event"
        (auditFromFilterChange)="auditFromFilter = $event"
        (auditToFilterChange)="auditToFilter = $event"
        (applyFilters)="loadAuditLogs(true)"
        (resetFilters)="resetAuditFilters()"
        (retryLoad)="loadAuditLogs()"
        (selectRecord)="selectAuditRecord($event)"
        (pageChange)="onAuditPageChange($event)"
        (pageSizeChange)="onAuditPageSizeChange($event)"
      ></app-audit-logs-table>

      <!-- TAB 2: SECURITY EVENTS -->
      <app-audit-security-table
        *ngIf="activeTab === 'security'"
        [securityEvents]="securityEvents()"
        [securityTotal]="securityTotal()"
        [securityHasMore]="securityHasMore()"
        [secPageSize]="secPageSize"
        [secCurrentPage]="secCurrentPage"
        [isLoading]="isLoading()"
        [securityError]="securityError()"
        [secEventTypeFilter]="secEventTypeFilter"
        [secIpFilter]="secIpFilter"
        [securityUserFilter]="securityUserFilter"
        [securityFromFilter]="securityFromFilter"
        [securityToFilter]="securityToFilter"
        (secEventTypeFilterChange)="secEventTypeFilter = $event"
        (secIpFilterChange)="secIpFilter = $event"
        (securityUserFilterChange)="securityUserFilter = $event"
        (securityFromFilterChange)="securityFromFilter = $event"
        (securityToFilterChange)="securityToFilter = $event"
        (applyFilters)="loadSecurityEvents(true)"
        (resetFilters)="resetSecurityFilters()"
        (retryLoad)="loadSecurityEvents()"
        (selectEvent)="selectSecurityEvent($event)"
        (pageChange)="onSecurityPageChange($event)"
        (pageSizeChange)="onSecurityPageSizeChange($event)"
      ></app-audit-security-table>

      <!-- MODALS -->
      <app-audit-modals
        [selectedAudit]="selectedAudit"
        [selectedSecEvent]="selectedSecEvent"
        (closeAuditModal)="selectedAudit = null"
        (closeSecModal)="selectedSecEvent = null"
      ></app-audit-modals>
    </div>
  `,
  styleUrl: './audit.component.css'
})
export class AuditComponent implements OnInit {
  readonly auditLogs = signal<AuditRecord[]>([]);
  readonly securityEvents = signal<SecurityEventRecord[]>([]);
  readonly auditTotal = signal<number>(0);
  readonly securityTotal = signal<number>(0);
  readonly auditHasMore = signal<boolean>(false);
  readonly securityHasMore = signal<boolean>(false);
  readonly stats = signal<AuditStats | null>(null);
  readonly isLoading = signal<boolean>(false);
  readonly statsError = signal<boolean>(false);
  readonly auditError = signal<boolean>(false);
  readonly securityError = signal<boolean>(false);

  activeTab: 'audit' | 'security' = 'audit';

  // Audit Filters & Pagination
  tableFilter = '';
  eventFilter = '';
  rowPkFilter = '';
  auditUserFilter = '';
  auditFromFilter = '';
  auditToFilter = '';
  auditCurrentPage = 1;
  auditPageSize = 20;
  private auditNextCursor: string | null = null;
  private auditPageCursors: Array<string | null> = [null];
  selectedAudit: AuditRecord | null = null;

  // Security Events Filters & Pagination
  secEventTypeFilter = '';
  secIpFilter = '';
  securityUserFilter = '';
  securityFromFilter = '';
  securityToFilter = '';
  secCurrentPage = 1;
  secPageSize = 20;
  private securityNextCursor: string | null = null;
  private securityPageCursors: Array<string | null> = [null];
  selectedSecEvent: SecurityEventRecord | null = null;

  constructor(
    private api: ApiService,
    private toast: ToastService
  ) {}

  ngOnInit() {
    this.refreshAll();
  }

  refreshAll() {
    this.loadStats();
    if (this.activeTab === 'audit') {
      this.loadAuditLogs(true);
    } else {
      this.loadSecurityEvents(true);
    }
  }

  setTab(tab: 'audit' | 'security') {
    this.activeTab = tab;
    if (tab === 'audit' && this.auditLogs().length === 0) {
      this.loadAuditLogs();
    } else if (tab === 'security' && this.securityEvents().length === 0) {
      this.loadSecurityEvents();
    }
  }

  loadStats() {
    this.statsError.set(false);
    this.api.get<AuditStats>('/audit/stats').subscribe({
      next: res => {
        this.stats.set(res);
        this.statsError.set(false);
      },
      error: () => this.statsError.set(true)
    });
  }

  loadAuditLogs(resetPagination = false) {
    if (resetPagination) this.resetAuditPagination();
    const cursor = this.auditPageCursors[this.auditCurrentPage - 1] ?? undefined;
    this.auditError.set(false);
    this.isLoading.set(true);
    this.api.get<AuditPage<AuditRecord>>('/audit/logs', {
      table_name: this.tableFilter || undefined,
      row_pk: this.rowPkFilter.trim() || undefined,
      event: this.eventFilter || undefined,
      user_id: this.auditUserFilter.trim() || undefined,
      from: this.startOfUtcDay(this.auditFromFilter),
      to: this.endOfUtcDay(this.auditToFilter),
      limit: this.auditPageSize,
      cursor
    }).subscribe({
      next: res => {
        this.auditLogs.set(res?.items || []);
        this.auditTotal.set(res?.totalEstimated || 0);
        this.auditNextCursor = res?.nextCursor || null;
        this.auditHasMore.set(Boolean(res?.hasMore));
        this.auditError.set(false);
        this.isLoading.set(false);
      },
      error: () => {
        this.auditError.set(true);
        this.isLoading.set(false);
      }
    });
  }

  loadSecurityEvents(resetPagination = false) {
    if (resetPagination) this.resetSecurityPagination();
    const cursor = this.securityPageCursors[this.secCurrentPage - 1] ?? undefined;
    this.securityError.set(false);
    this.isLoading.set(true);
    this.api.get<AuditPage<SecurityEventRecord>>('/audit/security-events', {
      event_type: this.secEventTypeFilter || undefined,
      user_id: this.securityUserFilter.trim() || undefined,
      ip: this.secIpFilter || undefined,
      from: this.startOfUtcDay(this.securityFromFilter),
      to: this.endOfUtcDay(this.securityToFilter),
      limit: this.secPageSize,
      cursor
    }).subscribe({
      next: res => {
        this.securityEvents.set(res?.items || []);
        this.securityTotal.set(res?.totalEstimated || 0);
        this.securityNextCursor = res?.nextCursor || null;
        this.securityHasMore.set(Boolean(res?.hasMore));
        this.securityError.set(false);
        this.isLoading.set(false);
      },
      error: () => {
        this.securityError.set(true);
        this.isLoading.set(false);
      }
    });
  }

  resetAuditFilters() {
    this.tableFilter = '';
    this.eventFilter = '';
    this.rowPkFilter = '';
    this.auditUserFilter = '';
    this.auditFromFilter = '';
    this.auditToFilter = '';
    this.loadAuditLogs(true);
  }

  resetSecurityFilters() {
    this.secEventTypeFilter = '';
    this.secIpFilter = '';
    this.securityUserFilter = '';
    this.securityFromFilter = '';
    this.securityToFilter = '';
    this.loadSecurityEvents(true);
  }

  paginatedAuditLogs(): AuditRecord[] {
    return this.auditLogs();
  }

  paginatedSecurityEvents(): SecurityEventRecord[] {
    return this.securityEvents();
  }

  onAuditPageChange(page: number) {
    if (page === this.auditCurrentPage + 1) {
      if (!this.auditHasMore() || !this.auditNextCursor) return;
      this.auditPageCursors[page - 1] = this.auditNextCursor;
    } else if (page !== this.auditCurrentPage - 1 || page < 1) {
      return;
    }
    this.auditCurrentPage = page;
    this.loadAuditLogs();
  }

  onAuditPageSizeChange(pageSize: number) {
    this.auditPageSize = pageSize;
    this.loadAuditLogs(true);
  }

  onSecurityPageChange(page: number) {
    if (page === this.secCurrentPage + 1) {
      if (!this.securityHasMore() || !this.securityNextCursor) return;
      this.securityPageCursors[page - 1] = this.securityNextCursor;
    } else if (page !== this.secCurrentPage - 1 || page < 1) {
      return;
    }
    this.secCurrentPage = page;
    this.loadSecurityEvents();
  }

  onSecurityPageSizeChange(pageSize: number) {
    this.secPageSize = pageSize;
    this.loadSecurityEvents(true);
  }

  private resetAuditPagination() {
    this.auditCurrentPage = 1;
    this.auditPageCursors = [null];
    this.auditNextCursor = null;
    this.auditHasMore.set(false);
  }

  private resetSecurityPagination() {
    this.secCurrentPage = 1;
    this.securityPageCursors = [null];
    this.securityNextCursor = null;
    this.securityHasMore.set(false);
  }

  private startOfUtcDay(value: string): string | undefined {
    return value ? `${value}T00:00:00.000Z` : undefined;
  }

  private endOfUtcDay(value: string): string | undefined {
    return value ? `${value}T23:59:59.999Z` : undefined;
  }

  selectAuditRecord(record: AuditRecord) {
    this.selectedAudit = record;
  }

  selectSecurityEvent(ev: SecurityEventRecord) {
    this.selectedSecEvent = ev;
  }

  getDiffKeys(record: AuditRecord): string[] {
    const oldKeys = Object.keys(record.oldRow || {});
    const newKeys = Object.keys(record.newRow || {});
    return Array.from(new Set([...oldKeys, ...newKeys, ...(record.changedColumns || [])]));
  }
}
