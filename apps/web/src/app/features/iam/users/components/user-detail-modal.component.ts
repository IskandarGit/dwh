import { Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { UiModalComponent } from '../../../../shared/ui/ui-modal.component';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { User, UserSecuritySummary } from '../../../../core/models/auth.models';
import { UserOrgUnitsPanelComponent } from '../../org-units/public-api';

export interface SecurityConfirmConfig {
  title: string;
  message: string;
  confirmBtnText: string;
  confirmBtnVariant: 'primary' | 'secondary' | 'danger' | 'ghost';
  action: () => void;
}

@Component({
  selector: 'app-user-detail-modal',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    UiModalComponent,
    UiButtonComponent,
    UserOrgUnitsPanelComponent
  ],
  template: `
    <!-- User View / Profile Modal -->
    <ui-modal
      [isOpen]="isOpen"
      [title]="'iam.profil_polzovatelya' | t"
      [size]="activeViewTab === 'security' || (canViewOrgUnits && viewingUser && safeRecordId(viewingUser.id)) ? 'xl' : 'sm'"
      (close)="closeRecordView.emit()"
    >
      <div body *ngIf="recordLoading" role="status">{{ 'search.record_loading' | t }}</div>
      <div body *ngIf="recordError" role="alert">
        <p>{{ (recordNotFound ? 'search.record_not_found' : 'search.record_load_error') | t }}</p>
        <ui-button *ngIf="!recordNotFound" variant="secondary" (onClick)="retryRecordView.emit(routeRecordId)">{{ 'audit.retry' | t }}</ui-button>
      </div>
      <div body class="view-body" [attr.data-record-id]="routeRecordId || (viewingUser ? viewingUser.id : '')" *ngIf="viewingUser as u">
        <p *ngIf="routeRecordId">#{{ routeRecordId }}</p>
        <p *ngIf="!safeRecordId(u.id)" role="status">{{ 'search.record_readonly_id' | t }}</p>
        <div class="view-header-card">
          <div class="avatar lg" [style.background-color]="getAvatarBgColor(u.name)">
            {{ getUserInitial(u) }}
          </div>
          <div class="info">
            <h3 class="name">{{ u.name }}</h3>
            <span class="handle font-mono">&#64;{{ u.login }}</span>
          </div>
        </div>

        <!-- Segmented Tab Bar -->
        <div class="modal-tab-bar" role="tablist">
          <button
            type="button"
            role="tab"
            class="modal-tab-btn"
            [class.active]="activeViewTab === 'info'"
            [attr.aria-selected]="activeViewTab === 'info'"
            (click)="switchTab.emit({ tab: 'info', userId: u.id })"
          >
            <span class="material-symbols-outlined tab-icon">badge</span>
            {{ 'iam.osnovnoe' | t }}
          </button>
          <button
            type="button"
            role="tab"
            class="modal-tab-btn"
            [class.active]="activeViewTab === 'security'"
            [attr.aria-selected]="activeViewTab === 'security'"
            (click)="switchTab.emit({ tab: 'security', userId: u.id })"
          >
            <span class="material-symbols-outlined tab-icon">shield</span>
            {{ 'iam.bezopasnost_i_sessii' | t }}
          </button>
          <button
            *ngIf="canViewOrgUnits && safeRecordId(u.id)"
            type="button"
            role="tab"
            class="modal-tab-btn"
            [class.active]="activeViewTab === 'orgUnits'"
            [attr.aria-selected]="activeViewTab === 'orgUnits'"
            (click)="switchTab.emit({ tab: 'orgUnits', userId: u.id })"
          >
            <span class="material-symbols-outlined tab-icon">account_tree</span>
            {{ 'iam.org_struktura' | t }}
          </button>
        </div>

        <!-- Info Tab -->
        <div class="info-list" *ngIf="activeViewTab === 'info'">
          <div class="info-row">
            <span class="lbl">Email</span>
            <span class="val font-mono">{{ u.email }}</span>
          </div>
          <div class="info-row">
            <span class="lbl">{{ 'iam.telefon.822f9fd' | t }}</span>
            <span class="val font-mono">{{ u.phone || '—' }}</span>
          </div>
          <div class="info-row">
            <span class="lbl">{{ 'iam.rukovoditel' | t }}</span>
            <span class="val">{{ getManagerName(u) || '—' }}</span>
          </div>
          <div class="info-row">
            <span class="lbl">{{ 'iam.roli' | t }}</span>
            <span class="val">{{ getUserRoleNames(u).join(', ') || '—' }}</span>
          </div>
          <div class="info-row">
            <span class="lbl">{{ 'iam.2fa_zaschita' | t }}</span>
            <span class="val">{{ (u.is2faEnabled ? 'common.enabled_feminine' : 'common.disabled_feminine') | t }}</span>
          </div>
          <div class="info-row">
            <span class="lbl">{{ 'common.status' | t }}</span>
            <span class="val">{{ (u.state === 'A' ? 'common.active_masculine' : 'common.blocked_masculine') | t }}</span>
          </div>
          <div class="info-row">
            <span class="lbl">{{ 'iam.sozdan' | t }}</span>
            <span class="val font-mono">{{ u.createdAt | date:'dd.MM.yyyy' }}</span>
          </div>
        </div>

        <!-- Security & Sessions Tab -->
        <div class="security-tab-content" *ngIf="activeViewTab === 'security'">
          <div *ngIf="isLoadingSecurity" class="security-loading">
            <span class="material-symbols-outlined spin-icon">sync</span>
            <span>{{ 'common.loading' | t }}</span>
          </div>

          <div *ngIf="!isLoadingSecurity && userSecurity as sec" class="security-details">
            <!-- Security Overview Cards -->
            <div class="sec-metrics-grid">
              <div class="sec-metric-card">
                <span class="sec-metric-lbl">{{ 'iam.status_2fa' | t }}</span>
                <span class="sec-metric-badge" [class.success]="sec.is2faEnabled" [class.muted]="!sec.is2faEnabled">
                  <span class="material-symbols-outlined metric-icon">{{ sec.is2faEnabled ? 'lock' : 'lock_open' }}</span>
                  {{ (sec.is2faEnabled ? 'iam.vklyuchena' : 'iam.otklyuchena') | t }}
                </span>
              </div>
              <div class="sec-metric-card">
                <span class="sec-metric-lbl">{{ 'iam.trebovanie_smeny_parolya' | t }}</span>
                <span class="sec-metric-badge" [class.warning]="sec.forcePasswordChange" [class.success]="!sec.forcePasswordChange">
                  <span class="material-symbols-outlined metric-icon">{{ sec.forcePasswordChange ? 'priority_high' : 'check' }}</span>
                  {{ (sec.forcePasswordChange ? 'iam.trebuetsya' : 'iam.ne_trebuetsya') | t }}
                </span>
              </div>
              <div class="sec-metric-card">
                <span class="sec-metric-lbl">{{ 'iam.aktivnyh_sessiy' | t }}</span>
                <span class="sec-metric-val">{{ sec.activeSessionsCount }}</span>
              </div>
              <div class="sec-metric-card">
                <span class="sec-metric-lbl">{{ 'iam.versiya_bezopasnosti' | t }}</span>
                <span class="sec-metric-val font-mono">v{{ sec.authVersion }}</span>
              </div>
            </div>

            <!-- Quick Security Actions Toolbar -->
            <div class="sec-actions-bar" *ngIf="canUpdateUser">
              <button
                type="button"
                class="sec-action-btn warning"
                [disabled]="isSecurityActionPending || sec.forcePasswordChange"
                (click)="forcePasswordChange.emit(u.id)"
              >
                <span class="material-symbols-outlined">password</span>
                <span>{{ 'iam.potrebovat_smenu_parolya' | t }}</span>
              </button>

              <button
                type="button"
                class="sec-action-btn danger"
                [disabled]="isSecurityActionPending || !sec.is2faEnabled"
                (click)="reset2fa.emit(u.id)"
              >
                <span class="material-symbols-outlined">key_off</span>
                <span>{{ 'iam.sbrosit_2fa' | t }}</span>
              </button>

              <button
                type="button"
                class="sec-action-btn secondary"
                [disabled]="isSecurityActionPending || sec.activeSessionsCount === 0"
                (click)="terminateAllSessions.emit(u.id)"
              >
                <span class="material-symbols-outlined">logout</span>
                <span>{{ 'iam.zavershit_vse_sessii' | t }}</span>
              </button>
            </div>

            <!-- Active Sessions List -->
            <div class="sec-section">
              <div class="sec-section-title">
                <span class="material-symbols-outlined sec-title-icon">devices</span>
                <h4>{{ 'iam.aktivnye_sessii' | t }}</h4>
                <span class="count-pill">{{ sec.activeSessions.length }}</span>
              </div>

              <div *ngIf="sec.activeSessions.length === 0" class="sec-empty-state">
                <p>{{ 'iam.net_aktivnyh_sessiy' | t }}</p>
              </div>

              <div *ngIf="sec.activeSessions.length > 0" class="sec-table-scroll">
                <table class="clean-table compact">
                  <thead>
                    <tr>
                      <th>IP</th>
                      <th>{{ 'iam.ustroystvo_i_brauzer' | t }}</th>
                      <th>{{ 'iam.sozdana' | t }}</th>
                      <th>{{ 'iam.poslednyaya_aktivnost' | t }}</th>
                      <th style="width: 50px;"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let s of sec.activeSessions">
                      <td class="font-mono text-xs">{{ s.ip }}</td>
                      <td class="text-xs text-truncate" [title]="s.userAgent">{{ s.userAgent || '—' }}</td>
                      <td class="font-mono text-xs text-muted">{{ s.createdAt | date:'dd.MM.yyyy HH:mm' }}</td>
                      <td class="font-mono text-xs text-muted">{{ s.lastSeenAt | date:'dd.MM.yyyy HH:mm' }}</td>
                      <td class="text-right">
                        <button
                          type="button"
                          class="btn-icon danger"
                          [title]="'iam.zavershit_sessiyu' | t"
                          [disabled]="isSecurityActionPending"
                          (click)="terminateSingleSession.emit({ sessionId: s.id, userId: u.id })"
                        >
                          <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Recent Login Attempts History Section -->
            <div class="sec-section">
              <div class="sec-section-title">
                <span class="material-symbols-outlined sec-title-icon">history</span>
                <h4>{{ 'iam.istoriya_popytok_vhoda' | t }}</h4>
                <span class="count-pill">{{ sec.recentLoginAttempts.length }}</span>
              </div>

              <div *ngIf="sec.recentLoginAttempts.length === 0" class="sec-empty-state">
                <p>{{ 'iam.net_zapisan_popytok_vhoda' | t }}</p>
              </div>

              <div *ngIf="sec.recentLoginAttempts.length > 0" class="sec-table-scroll">
                <table class="clean-table compact">
                  <thead>
                    <tr>
                      <th>{{ 'iam.vremya' | t }}</th>
                      <th>IP</th>
                      <th>{{ 'common.status' | t }}</th>
                      <th>{{ 'iam.prichina_otkaza' | t }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let att of sec.recentLoginAttempts">
                      <td class="font-mono text-xs text-muted">{{ att.attemptAt | date:'dd.MM.yyyy HH:mm:ss' }}</td>
                      <td class="font-mono text-xs">{{ att.ip }}</td>
                      <td>
                        <span class="status-indicator" [class.active]="att.isSuccess" [class.danger-dot]="!att.isSuccess">
                          <span class="dot"></span>
                          {{ (att.isSuccess ? 'iam.uspeshno' : 'iam.oshibka') | t }}
                        </span>
                      </td>
                      <td class="text-xs text-muted">{{ att.failureReason || '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- Org Units Tab (use [hidden] to keep directive in DOM for spec tests) -->
        <div [hidden]="activeViewTab !== 'orgUnits'">
          <app-user-org-units-panel
            *ngIf="isOpen && canViewOrgUnits && safeRecordId(u.id)"
            [userId]="u.id"
            (busyChange)="orgPanelBusy.emit($event)"
          ></app-user-org-units-panel>
        </div>
      </div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="closeRecordView.emit()">{{ (routeRecordId ? 'search.back_to_list' : 'audit.zakryt') | t }}</ui-button>
        <ui-button *ngIf="canUpdateUser && viewingUser && safeRecordId(viewingUser.id)" variant="primary" size="md" (onClick)="openEdit.emit()">{{ 'common.edit' | t }}</ui-button>
      </div>
    </ui-modal>

    <!-- Delete Confirmation Modal -->
    <ui-modal
      [isOpen]="isDeleteModalOpen"
      [title]="'iam.udalenie_polzovatelya' | t"
      size="sm"
      (close)="closeDeleteModal.emit()"
    >
      <div body class="delete-body" *ngIf="deletingUser as u">
        <p class="delete-msg">
          {{ 'iam.vy_uvereny_chto_hotite_udalit_i_anonimizirovat_p' | t }} <strong>{{ u.name }}</strong> (&#64;{{ u.login }})?
        </p>
        <span class="delete-sub">{{ 'iam.personalnye_dannye_budut_sterty_a_aktivnye_sessi' | t }}</span>
      </div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="closeDeleteModal.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="danger" size="md" [loading]="isSubmitting" (onClick)="confirmDelete.emit()">{{ 'common.delete' | t }}</ui-button>
      </div>
    </ui-modal>

    <!-- Security Action Confirmation Modal -->
    <ui-modal
      [isOpen]="isSecConfirmModalOpen"
      [title]="secConfirmConfig?.title || ('iam.podtverzhdenie_deystviya' | t)"
      size="sm"
      (close)="closeSecConfirmModal.emit()"
    >
      <div body class="delete-body" *ngIf="secConfirmConfig as cfg">
        <p class="delete-msg">{{ cfg.message }}</p>
      </div>
      <div footer *ngIf="secConfirmConfig as cfg">
        <ui-button variant="secondary" size="md" (onClick)="closeSecConfirmModal.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button [variant]="cfg.confirmBtnVariant" size="md" [loading]="isSecurityActionPending" (onClick)="confirmSecurityAction.emit()">{{ cfg.confirmBtnText }}</ui-button>
      </div>
    </ui-modal>
  `,
  styleUrl: './user-detail-modal.component.css'
})
export class UserDetailModalComponent {
  @Input() isOpen = false;
  @Input() viewingUser: User | null = null;
  @Input() routeRecordId: string | null = null;
  @Input() recordLoading = false;
  @Input() recordError = false;
  @Input() recordNotFound = false;
  @Input() activeViewTab: 'info' | 'security' | 'orgUnits' = 'info';
  @Input() isLoadingSecurity = false;
  @Input() userSecurity: UserSecuritySummary | null = null;
  @Input() isSecurityActionPending = false;
  @Input() canUpdateUser = false;
  @Input() canViewOrgUnits = false;
  @Input() safeRecordId!: (id: any) => boolean;
  @Input() getUserInitial!: (u: User) => string;
  @Input() getAvatarBgColor!: (name: string) => string;
  @Input() getUserRoleNames!: (u: User) => string[];
  @Input() getManagerName!: (u: User) => string | null;

  @Input() isDeleteModalOpen = false;
  @Input() deletingUser: User | null = null;
  @Input() isSubmitting = false;

  @Input() isSecConfirmModalOpen = false;
  @Input() secConfirmConfig: SecurityConfirmConfig | null = null;

  @Output() closeRecordView = new EventEmitter<void>();
  @Output() retryRecordView = new EventEmitter<string | null>();
  @Output() switchTab = new EventEmitter<{ tab: 'info' | 'security' | 'orgUnits', userId: number }>();
  @Output() openEdit = new EventEmitter<void>();
  @Output() forcePasswordChange = new EventEmitter<number>();
  @Output() reset2fa = new EventEmitter<number>();
  @Output() terminateAllSessions = new EventEmitter<number>();
  @Output() terminateSingleSession = new EventEmitter<{ sessionId: number, userId: number }>();
  @Output() orgPanelBusy = new EventEmitter<boolean>();

  @Output() closeDeleteModal = new EventEmitter<void>();
  @Output() confirmDelete = new EventEmitter<void>();

  @Output() closeSecConfirmModal = new EventEmitter<void>();
  @Output() confirmSecurityAction = new EventEmitter<void>();

  @ViewChild(UserOrgUnitsPanelComponent) orgUnitsPanel?: UserOrgUnitsPanelComponent;

  canLeave(): boolean | Observable<boolean> {
    return this.orgUnitsPanel?.canLeave() ?? true;
  }
}
