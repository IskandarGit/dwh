import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { UiBadgeComponent } from '../../../../shared/ui/ui-badge.component';
import { UiModalComponent } from '../../../../shared/ui/ui-modal.component';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { UserSession } from '../profile.models';

@Component({
  selector: 'app-profile-sessions-card',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    UiButtonComponent,
    UiBadgeComponent,
    UiModalComponent
  ],
  template: `
    <div class="card section-card full-width">
      <div class="section-header">
        <div class="section-title-box">
          <span class="material-symbols-outlined section-icon" aria-hidden="true">devices</span>
          <h4 class="section-title">{{ 'iam.aktivnye_sessii' | t }}</h4>
          <span class="badge-count">{{ sessions.length }}</span>
        </div>
        <div class="sessions-header-actions">
          <ui-button
            *ngIf="sessions.length > 1"
            variant="danger"
            size="sm"
            icon="logout"
            [loading]="isTerminatingSession"
            [title]="'iam.zavershit_vse_ostalnye_sessii_krome_tekuschey' | t"
            (onClick)="terminateOtherSessions.emit()"
          >
            {{ 'iam.zavershit_drugie_sessii' | t }}
          </ui-button>
          <ui-button
            variant="secondary"
            size="sm"
            icon="refresh"
            [loading]="isLoadingSessions"
            (onClick)="loadSessions.emit()"
          >
            {{ 'common.refresh' | t }}
          </ui-button>
        </div>
      </div>

      <div class="table-wrapper" role="region" [attr.aria-label]="'iam.tablica_aktivnyh_sessiy' | t" tabindex="0">
        <table class="data-table" [attr.aria-label]="'iam.aktivnye_sessii' | t">
          <thead>
            <tr>
              <th>{{ 'iam.ip_adres' | t }}</th>
              <th>{{ 'iam.ustroystvo_brauzer' | t }}</th>
              <th>{{ 'iam.sozdana' | t }}</th>
              <th>{{ 'iam.poslednyaya_aktivnost' | t }}</th>
              <th class="text-right">{{ 'audit.deystvie' | t }}</th>
            </tr>
          </thead>
          <tbody>
            <!-- Skeleton rows when loading -->
            <ng-container *ngIf="isLoadingSessions">
              <tr class="skeleton-row" *ngFor="let item of [1, 2]">
                <td><div class="skeleton-pill w-28"></div></td>
                <td><div class="skeleton-pill w-48"></div></td>
                <td><div class="skeleton-pill w-32"></div></td>
                <td><div class="skeleton-pill w-36"></div></td>
                <td class="text-right"><div class="skeleton-pill w-20 ml-auto"></div></td>
              </tr>
            </ng-container>

            <!-- Real session rows -->
            <ng-container *ngIf="!isLoadingSessions">
              <tr *ngFor="let s of sessions" [class.highlight-row]="s.current">
                <td class="tabular-nums font-mono">
                  <div class="session-ip-cell">
                    <span>{{ s.ip }}</span>
                    <ui-badge *ngIf="s.current" variant="active" [dot]="true" size="sm">
                      {{ 'iam.tekuschaya_sessiya' | t }}
                    </ui-badge>
                  </div>
                </td>
                <td>{{ s.deviceInfo || s.userAgent || ('iam.unknown_device' | t) }}</td>
                <td class="tabular-nums text-muted">{{ s.createdAt | date:'dd.MM.yyyy HH:mm' }}</td>
                <td class="tabular-nums font-medium">{{ s.lastSeenAt | date:'dd.MM.yyyy HH:mm:ss' }}</td>
                <td class="text-right">
                  <span *ngIf="s.current" class="current-session-label text-muted">
                    {{ 'iam.tekuschaya' | t }}
                  </span>
                  <ui-button
                    *ngIf="!s.current"
                    variant="danger"
                    size="sm"
                    [ariaLabel]="'iam.terminate_session_ip' | t:{ip: s.ip}"
                    (onClick)="terminateSession.emit(s)"
                  >
                    {{ 'iam.zavershit' | t }}
                  </ui-button>
                </td>
              </tr>
              <tr *ngIf="sessions.length === 0">
                <td colspan="5" class="empty-cell">{{ 'iam.net_aktivnyh_sessiy' | t }}</td>
              </tr>
            </ng-container>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Session Termination Confirmation Modal -->
    <ui-modal
      [isOpen]="sessionToTerminate !== null"
      [title]="'iam.zavershenie_sessii' | t"
      size="sm"
      (close)="cancelTerminate.emit()"
    >
      <div body class="confirmation-body" *ngIf="sessionToTerminate as target">
        <p *ngIf="target === 'others'">{{ 'iam.zavershit_vse_ostalnye_aktivnye_sessii_krome_tek' | t }}</p>
        <p *ngIf="target !== 'others'">{{ 'iam.zavershit_sessiyu_s_ip' | t }} <strong>{{ target.ip }}</strong>?</p>
        <span class="confirmation-hint">{{ 'iam.na_zavershennyh_ustroystvah_potrebuetsya_vypolni' | t }}</span>
      </div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="cancelTerminate.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="danger" size="md" [loading]="isTerminatingSession" (onClick)="confirmTerminate.emit()">
          {{ 'iam.zavershit' | t }}
        </ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
      grid-column: 1 / -1;
    }

    .card {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 18px 22px;
    }

    .section-card {
      min-width: 0;
    }

    .full-width {
      width: 100%;
      box-sizing: border-box;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-color);
    }

    .section-title-box {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-main);
    }

    .section-icon {
      font-size: 20px;
      color: var(--primary);
    }

    .section-title {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
    }

    .badge-count {
      background-color: var(--bg-hover);
      color: var(--primary);
      font-size: 11px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 10px;
      border: 1px solid var(--border-color);
    }

    .sessions-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .table-wrapper {
      overflow-x: auto;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
    }
    .table-wrapper:focus-visible {
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
      background-color: var(--bg-hover);
      color: var(--text-muted);
      font-weight: 600;
      font-size: 12px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
    }

    .data-table td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-main);
      vertical-align: middle;
    }

    .data-table tr:last-child td {
      border-bottom: none;
    }

    .highlight-row {
      background-color: rgba(99, 102, 241, 0.04);
    }

    .session-ip-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .current-session-label {
      font-size: 12px;
      font-style: italic;
    }

    .tabular-nums {
      font-variant-numeric: tabular-nums;
    }

    .font-mono {
      font-family: monospace;
    }

    .font-medium {
      font-weight: 500;
    }

    .text-muted {
      color: var(--text-muted);
    }

    .text-right {
      text-align: right;
    }

    .empty-cell {
      text-align: center;
      color: var(--text-muted);
      padding: 24px !important;
    }

    .skeleton-row td {
      padding: 12px 14px;
    }

    .skeleton-pill {
      height: 14px;
      background-color: var(--bg-hover);
      border-radius: 4px;
      animation: pulse 1.5s infinite;
    }

    .w-20 { width: 80px; }
    .w-28 { width: 112px; }
    .w-32 { width: 128px; }
    .w-36 { width: 144px; }
    .w-48 { width: 192px; }
    .ml-auto { margin-left: auto; }

    @keyframes pulse {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 0.3; }
    }

    .confirmation-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .confirmation-body p {
      margin: 0;
      font-size: 14px;
    }
    .confirmation-hint {
      color: var(--text-muted);
      font-size: 12px;
    }

    @media (max-width: 640px) {
      .card { padding: 14px; }
      .section-header {
        align-items: flex-start;
        flex-direction: column;
        gap: 10px;
      }
      .sessions-header-actions {
        width: 100%;
        flex-wrap: wrap;
      }
    }
  `]
})
export class ProfileSessionsCardComponent {
  @Input() sessions: UserSession[] = [];
  @Input() isLoadingSessions = false;
  @Input() isTerminatingSession = false;
  @Input() sessionToTerminate: UserSession | 'others' | null = null;

  @Output() loadSessions = new EventEmitter<void>();
  @Output() terminateSession = new EventEmitter<UserSession>();
  @Output() terminateOtherSessions = new EventEmitter<void>();
  @Output() confirmTerminate = new EventEmitter<void>();
  @Output() cancelTerminate = new EventEmitter<void>();
}
