import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { AuditRecord, SecurityEventRecord } from '../audit.models';

@Component({
  selector: 'app-audit-modals',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    UiButtonComponent,
    UiModalComponent
  ],
  template: `
    <!-- MODAL: AUDIT DIFF VIEWER -->
    <ui-modal
      [isOpen]="selectedAudit !== null"
      [title]="'audit.detali_izmeneniya_zapisi_visual_diff' | t"
      size="lg"
      (close)="closeAuditModal.emit()"
    >
      <div body *ngIf="selectedAudit as audit" class="diff-modal-body">
        <div class="diff-meta-grid">
          <div class="meta-item">
            <span class="meta-label">{{ 'audit.tablica.6f39b76' | t }}</span>
            <span class="meta-val font-mono">{{ audit.tableName }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">PK:</span>
            <span class="meta-val font-mono">{{ audit.rowPk }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">{{ 'audit.deystvie.7b79e9f' | t }}</span>
            <span class="event-badge" [ngClass]="getEventBadgeClass(audit.event)">{{ getEventName(audit.event) }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">{{ 'audit.avtor' | t }}</span>
            <span class="meta-val">{{ audit.changedByName ? audit.changedByName + ' (@' + audit.changedByLogin + ')' : ('common.system' | t) }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">{{ 'audit.data' | t }}</span>
            <span class="meta-val">{{ audit.changedAt | date:'dd.MM.yyyy HH:mm:ss' }}</span>
          </div>
        </div>

        <!-- Diff Table -->
        <div class="diff-section-title">{{ 'audit.sravnenie_poley_diff' | t }}</div>
        <div class="diff-table-box" role="region" [attr.aria-label]="'audit.sravnenie_izmenennyh_poley' | t" tabindex="0" *ngIf="getDiffKeys(audit).length > 0; else noDiff">
          <table class="diff-table" [attr.aria-label]="'audit.sravnenie_znacheniy_do_i_posle_izmeneniya' | t">
            <thead>
              <tr>
                <th style="width: 25%;">{{ 'audit.pole' | t }}</th>
                <th style="width: 37.5%;">{{ 'audit.predyduschee_znachenie' | t }}</th>
                <th style="width: 37.5%;">{{ 'audit.novoe_znachenie' | t }}</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let key of getDiffKeys(audit)">
                <td class="font-mono field-name">{{ key }}</td>
                <td class="diff-cell old-cell">
                  <pre class="diff-val">{{ formatValue(audit.oldRow?.[key]) }}</pre>
                </td>
                <td class="diff-cell new-cell">
                  <pre class="diff-val">{{ formatValue(audit.newRow?.[key]) }}</pre>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <ng-template #noDiff>
          <div class="no-diff-msg">{{ 'audit.net_podrobnyh_dannyh_diff_dlya_etoy_operacii' | t }}</div>
        </ng-template>
      </div>
      <div footer class="modal-footer-actions">
        <ui-button variant="secondary" (onClick)="closeAuditModal.emit()">{{ 'audit.zakryt' | t }}</ui-button>
      </div>
    </ui-modal>

    <!-- MODAL: SECURITY EVENT DETAILS -->
    <ui-modal
      [isOpen]="selectedSecEvent !== null"
      [title]="'audit.sobytie_bezopasnosti' | t"
      size="md"
      (close)="closeSecModal.emit()"
    >
      <div body *ngIf="selectedSecEvent as ev" class="sec-modal-body">
        <div class="diff-meta-grid">
          <div class="meta-item">
            <span class="meta-label">{{ 'audit.tip_sobytiya' | t }}</span>
            <span class="sec-event-badge" [ngClass]="getSecurityEventBadgeClass(ev.eventType)">
              {{ ev.eventType }}
            </span>
          </div>
          <div class="meta-item">
            <span class="meta-label">IP:</span>
            <span class="meta-val font-mono">{{ ev.ip }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">{{ 'audit.polzovatel.a7d134d' | t }}</span>
            <span class="meta-val">{{ ev.userName ? ev.userName + ' (@' + ev.userLogin + ')' : (ev.details['login'] || '—') }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">{{ 'audit.data' | t }}</span>
            <span class="meta-val">{{ ev.createdAt | date:'dd.MM.yyyy HH:mm:ss' }}</span>
          </div>
          <div class="meta-item full-width" *ngIf="ev.userAgent">
            <span class="meta-label">User-Agent:</span>
            <span class="meta-val text-xs font-mono">{{ ev.userAgent }}</span>
          </div>
        </div>

        <div class="diff-section-title">{{ 'audit.parametry_sobytiya_json' | t }}</div>
        <pre class="json-details-viewer">{{ ev.details | json }}</pre>
      </div>
      <div footer class="modal-footer-actions">
        <ui-button variant="secondary" (onClick)="closeSecModal.emit()">{{ 'audit.zakryt' | t }}</ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    :host {
      display: contents;
    }

    .diff-modal-body, .sec-modal-body {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .diff-meta-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      background: var(--bg-hover);
      padding: 14px;
      border-radius: 8px;
    }

    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .meta-item.full-width {
      grid-column: 1 / -1;
    }

    .meta-label {
      font-size: 11px;
      color: var(--text-light);
      font-weight: 600;
      text-transform: uppercase;
    }

    .meta-val {
      font-size: 13px;
      color: var(--text-main);
      word-break: break-all;
    }

    .font-mono {
      font-family: monospace;
    }

    .text-xs {
      font-size: 11px;
    }

    .event-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      width: fit-content;
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

    .sec-event-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.3px;
      width: fit-content;
    }

    .sec-event-badge.success {
      background: var(--success-bg);
      color: var(--success);
    }

    .sec-event-badge.danger {
      background: var(--danger-bg);
      color: var(--danger);
    }

    .sec-event-badge.warning {
      background: var(--warning-bg);
      color: var(--warning);
    }

    .sec-event-badge.info {
      background: var(--info-bg);
      color: var(--info);
    }

    .diff-section-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-main);
      margin-top: 4px;
    }

    .diff-table-box {
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
      max-height: 400px;
      overflow-y: auto;
    }
    .diff-table-box:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }

    .diff-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    .diff-table th {
      padding: 8px 12px;
      background: var(--bg-hover);
      color: var(--text-muted);
      font-weight: 600;
      border-bottom: 1px solid var(--border-color);
      text-align: left;
    }

    .diff-table td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-subtle);
      vertical-align: top;
    }

    .field-name {
      color: var(--primary-text);
      font-weight: 500;
    }

    .diff-cell.old-cell {
      background: var(--danger-bg);
      color: var(--danger);
    }

    .diff-cell.new-cell {
      background: var(--success-bg);
      color: var(--success);
    }

    .diff-val {
      margin: 0;
      font-family: inherit;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .no-diff-msg {
      padding: 24px;
      text-align: center;
      color: var(--text-light);
      font-size: 13px;
    }

    .json-details-viewer {
      background: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 12px;
      font-size: 12px;
      color: var(--text-main);
      overflow-x: auto;
      max-height: 250px;
      margin: 0;
    }

    .modal-footer-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }
  `]
})
export class AuditModalsComponent {
  @Input() selectedAudit: AuditRecord | null = null;
  @Input() selectedSecEvent: SecurityEventRecord | null = null;

  @Output() closeAuditModal = new EventEmitter<void>();
  @Output() closeSecModal = new EventEmitter<void>();

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

  getSecurityEventBadgeClass(type: string): string {
    if (type.includes('SUCCESS')) return 'success';
    if (type.includes('LOCKED') || type.includes('FAILED') || type.includes('RATE_LIMITED')) return 'danger';
    if (type.includes('CHANGED') || type.includes('RESET')) return 'warning';
    return 'info';
  }

  getDiffKeys(record: AuditRecord): string[] {
    const oldKeys = Object.keys(record.oldRow || {});
    const newKeys = Object.keys(record.newRow || {});
    return Array.from(new Set([...oldKeys, ...newKeys, ...(record.changedColumns || [])]));
  }

  formatValue(val: any): string {
    if (val === undefined || val === null) return '—';
    if (typeof val === 'object') return JSON.stringify(val, null, 2);
    return String(val);
  }
}
