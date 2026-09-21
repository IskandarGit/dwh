import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { UiBadgeComponent } from '../../../../shared/ui/ui-badge.component';
import { UiModalComponent } from '../../../../shared/ui/ui-modal.component';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { UserChannel } from '../profile.models';

@Component({
  selector: 'app-profile-channels-card',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    UiButtonComponent,
    UiBadgeComponent,
    UiModalComponent
  ],
  template: `
    <div class="card section-card full-width">
      <div class="section-header">
        <div class="section-title-box">
          <span class="material-symbols-outlined section-icon" aria-hidden="true">alternate_email</span>
          <div class="title-with-desc">
            <div class="title-row">
              <h4 class="section-title">{{ 'iam.kanaly_svyazi' | t }}</h4>
              <span class="badge-count">{{ channels.length }}</span>
            </div>
            <p class="section-subtitle">{{ 'iam.kanaly_svyazi_opisanie' | t }}</p>
          </div>
        </div>
        <ui-button
          *ngIf="canManageChannels"
          variant="primary"
          size="sm"
          icon="add"
          (onClick)="openBindModal()"
        >
          {{ 'iam.privyazat_kanal' | t }}
        </ui-button>
      </div>

      <div class="table-wrapper" role="region" [attr.aria-label]="'iam.tablica_kanalov_svyazi' | t" tabindex="0">
        <table class="data-table" [attr.aria-label]="'iam.kanaly_svyazi' | t">
          <thead>
            <tr>
              <th>{{ 'iam.tip_kanala' | t }}</th>
              <th>{{ 'iam.adres_ili_login' | t }}</th>
              <th>{{ 'iam.sozdan' | t }}</th>
              <th>{{ 'common.status' | t }}</th>
              <th class="text-right">{{ 'audit.deystvie' | t }}</th>
            </tr>
          </thead>
          <tbody>
            <!-- Skeleton rows when loading -->
            <ng-container *ngIf="isLoadingChannels">
              <tr class="skeleton-row" *ngFor="let item of [1, 2]">
                <td><div class="skeleton-pill w-28"></div></td>
                <td><div class="skeleton-pill w-48"></div></td>
                <td><div class="skeleton-pill w-32"></div></td>
                <td><div class="skeleton-pill w-24"></div></td>
                <td class="text-right"><div class="skeleton-pill w-20 ml-auto"></div></td>
              </tr>
            </ng-container>

            <!-- Real channel rows -->
            <ng-container *ngIf="!isLoadingChannels">
              <tr *ngFor="let c of channels">
                <td>
                  <div class="channel-type-cell">
                    <span class="material-symbols-outlined channel-icon" aria-hidden="true">
                      {{ getChannelIcon(c.channel) }}
                    </span>
                    <span class="font-medium">{{ getChannelLabelKey(c.channel) | t }}</span>
                  </div>
                </td>
                <td class="tabular-nums font-mono">{{ c.address }}</td>
                <td class="tabular-nums text-muted">{{ c.createdAt | date:'dd.MM.yyyy HH:mm' }}</td>
                <td>
                  <ui-badge *ngIf="c.isVerified" variant="success" [dot]="true">
                    {{ 'iam.kanal_podtverzhden' | t }}
                  </ui-badge>
                  <ui-badge *ngIf="!c.isVerified" variant="warning" [dot]="true">
                    {{ 'iam.ozhidaet_podtverzhdeniya' | t }}
                  </ui-badge>
                </td>
                <td class="text-right">
                  <div class="row-actions">
                    <ui-button
                      *ngIf="!c.isVerified && canManageChannels"
                      variant="secondary"
                      size="sm"
                      icon="verified"
                      [loading]="isConfirmingChannel"
                      (onClick)="requestConfirm(c)"
                    >
                      {{ 'iam.podtverdit_kodom' | t }}
                    </ui-button>
                    <ui-button
                      *ngIf="canManageChannels"
                      variant="danger"
                      size="sm"
                      icon="delete"
                      [attr.aria-label]="'iam.otvyazat_kanal' | t"
                      (onClick)="requestUnbind(c)"
                    >
                      {{ 'iam.otvyazat_kanal' | t }}
                    </ui-button>
                  </div>
                </td>
              </tr>
              <tr *ngIf="channels.length === 0">
                <td colspan="5" class="empty-cell">{{ 'iam.net_privyazannyh_kanalov' | t }}</td>
              </tr>
            </ng-container>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Bind Channel Modal -->
    <ui-modal
      [isOpen]="isBindModalOpen"
      [title]="'iam.privyazka_kanala_svyazi' | t"
      size="sm"
      (close)="closeBindModal()"
    >
      <div body class="channel-form">
        <div class="form-group">
          <label class="form-label" for="profile-channel-type">
            {{ 'iam.tip_kanala' | t }} <span class="req">*</span>
          </label>
          <select
            id="profile-channel-type"
            name="channelType"
            class="form-input form-select"
            [(ngModel)]="selectedChannelType"
          >
            <option value="email">{{ 'iam.kanal_email' | t }}</option>
            <option value="telegram">{{ 'iam.kanal_telegram' | t }}</option>
            <option value="sms">{{ 'iam.kanal_sms' | t }}</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="profile-channel-address">
            {{ 'iam.adres_ili_login' | t }} <span class="req">*</span>
          </label>
          <input
            id="profile-channel-address"
            name="channelAddress"
            type="text"
            class="form-input"
            required
            [placeholder]="getChannelPlaceholder()"
            [(ngModel)]="newAddress"
            [attr.aria-invalid]="isBindSubmitted && !newAddress.trim()"
            [attr.aria-describedby]="isBindSubmitted && !newAddress.trim() ? 'profile-channel-address-error' : null"
            (keydown.enter)="submitBind()"
          />
          <span id="profile-channel-address-error" class="field-error" *ngIf="isBindSubmitted && !newAddress.trim()">
            {{ 'iam.adres_kanala_obyazatelen' | t }}
          </span>
        </div>
      </div>
      <div footer class="modal-actions">
        <ui-button variant="secondary" size="md" (onClick)="closeBindModal()">
          {{ 'common.cancel' | t }}
        </ui-button>
        <ui-button
          variant="primary"
          size="md"
          icon="send"
          [loading]="isBindingChannel"
          (onClick)="submitBind()"
        >
          {{ 'iam.otpravit_kod' | t }}
        </ui-button>
      </div>
    </ui-modal>

    <!-- Confirm OTP Modal -->
    <ui-modal
      [isOpen]="isConfirmModalOpen"
      [title]="'iam.podtverzhdenie_kanala' | t"
      size="sm"
      (close)="closeConfirmModal()"
    >
      <div body class="channel-form">
        <p class="confirm-info-text">
          {{ 'iam.kod_podtverzhdeniya_otpravlen' | t:{address: activeVerifyAddress} }}
        </p>

        <div class="form-group">
          <label class="form-label" for="profile-channel-code">
            {{ 'iam.vvedite_6_znachnyy_kod' | t }} <span class="req">*</span>
          </label>
          <input
            id="profile-channel-code"
            name="confirmCode"
            type="text"
            class="form-input font-mono otp-input"
            maxlength="6"
            inputmode="numeric"
            pattern="[0-9]*"
            placeholder="000000"
            [(ngModel)]="verificationCode"
            [attr.aria-invalid]="isConfirmSubmitted && verificationCode.trim().length !== 6"
            [attr.aria-describedby]="isConfirmSubmitted && verificationCode.trim().length !== 6 ? 'profile-channel-code-error' : null"
            (keydown.enter)="submitConfirm()"
          />
          <span id="profile-channel-code-error" class="field-error" *ngIf="isConfirmSubmitted && verificationCode.trim().length !== 6">
            {{ 'iam.kod_dolzhen_soderzhat_6_cifr' | t }}
          </span>
        </div>
      </div>
      <div footer class="modal-actions">
        <ui-button variant="secondary" size="md" (onClick)="closeConfirmModal()">
          {{ 'common.cancel' | t }}
        </ui-button>
        <ui-button
          variant="primary"
          size="md"
          icon="check"
          [loading]="isConfirmingChannel"
          (onClick)="submitConfirm()"
        >
          {{ 'common.confirm' | t }}
        </ui-button>
      </div>
    </ui-modal>

    <!-- Unbind Confirmation Modal -->
    <ui-modal
      [isOpen]="channelToUnbind !== null"
      [title]="'iam.otvyazat_kanal' | t"
      size="sm"
      (close)="channelToUnbind = null"
    >
      <div body *ngIf="channelToUnbind" class="unbind-confirm-body">
        <p class="confirm-prompt">
          {{ 'iam.vy_uvereny_chto_hotite_otvyazat_kanal' | t:{channel: (getChannelLabelKey(channelToUnbind.channel) | t), address: channelToUnbind.address} }}
        </p>
        <p class="confirm-warning text-muted">
          {{ 'iam.otvyazat_kanal_preduprezhdenie' | t }}
        </p>
      </div>
      <div footer class="modal-actions">
        <ui-button variant="secondary" size="md" (onClick)="channelToUnbind = null">
          {{ 'common.cancel' | t }}
        </ui-button>
        <ui-button
          variant="danger"
          size="md"
          icon="delete"
          [loading]="isUnbindingChannel"
          (onClick)="submitUnbind()"
        >
          {{ 'iam.otvyazat_kanal' | t }}
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
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-color);
    }

    .section-title-box {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      color: var(--text-main);
    }

    .section-icon {
      font-size: 22px;
      color: var(--primary);
      margin-top: 2px;
    }

    .title-with-desc {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .section-title {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
    }

    .section-subtitle {
      font-size: 13px;
      color: var(--text-muted);
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

    .table-wrapper {
      overflow-x: auto;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      background-color: var(--bg-surface);
    }

    .table-wrapper:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }

    .data-table th {
      background-color: var(--bg-table-header, var(--bg-hover));
      color: var(--text-muted);
      font-weight: 600;
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

    .channel-type-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .channel-icon {
      font-size: 18px;
      color: var(--primary);
    }

    .row-actions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .tabular-nums {
      font-variant-numeric: tabular-nums;
    }

    .font-mono {
      font-family: var(--font-mono, monospace);
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
      padding: 24px 14px;
      font-style: italic;
    }

    /* Skeleton Loading */
    .skeleton-row td {
      padding: 12px 14px;
    }

    .skeleton-pill {
      height: 14px;
      background: linear-gradient(90deg, var(--bg-hover) 25%, var(--border-color) 50%, var(--bg-hover) 75%);
      background-size: 200% 100%;
      animation: skeleton-shimmer 1.5s infinite;
      border-radius: 4px;
    }

    .w-20 { width: 80px; }
    .w-24 { width: 96px; }
    .w-28 { width: 112px; }
    .w-32 { width: 128px; }
    .w-48 { width: 192px; }
    .ml-auto { margin-left: auto; }

    @keyframes skeleton-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* Modal Form Styles */
    .channel-form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-main);
    }

    .req {
      color: var(--danger);
    }

    .form-input {
      padding: 8px 12px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s;
    }

    .form-select {
      cursor: pointer;
    }

    .form-input:focus {
      border-color: var(--primary);
    }

    .form-input[aria-invalid="true"] {
      border-color: var(--danger);
    }

    .field-error {
      font-size: 11px;
      color: var(--danger);
    }

    .otp-input {
      font-size: 20px;
      letter-spacing: 6px;
      text-align: center;
      padding: 10px;
    }

    .confirm-info-text {
      font-size: 13px;
      color: var(--text-main);
      margin: 0;
      line-height: 1.5;
    }

    .unbind-confirm-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .confirm-prompt {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-main);
      margin: 0;
    }

    .confirm-warning {
      font-size: 12px;
      margin: 0;
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      width: 100%;
    }
  `]
})
export class ProfileChannelsCardComponent {
  @Input() channels: UserChannel[] = [];
  @Input() isLoadingChannels = false;
  @Input() isBindingChannel = false;
  @Input() isConfirmingChannel = false;
  @Input() isUnbindingChannel = false;
  @Input() canManageChannels = true;

  @Output() bindChannel = new EventEmitter<{ channel: string; address: string }>();
  @Output() confirmChannel = new EventEmitter<{ verifyToken: string; code: string }>();
  @Output() unbindChannel = new EventEmitter<string>();

  isBindModalOpen = false;
  isConfirmModalOpen = false;
  isBindSubmitted = false;
  isConfirmSubmitted = false;

  selectedChannelType = 'email';
  newAddress = '';

  activeVerifyToken = '';
  activeVerifyAddress = '';
  verificationCode = '';

  channelToUnbind: UserChannel | null = null;

  getChannelIcon(channel: string): string {
    const norm = (channel || '').toLowerCase();
    if (norm === 'email') return 'mail';
    if (norm === 'telegram') return 'send';
    if (norm === 'sms') return 'sms';
    return 'alternate_email';
  }

  getChannelLabelKey(channel: string): string {
    const norm = (channel || '').toLowerCase();
    if (norm === 'email') return 'iam.kanal_email';
    if (norm === 'telegram') return 'iam.kanal_telegram';
    if (norm === 'sms') return 'iam.kanal_sms';
    return channel;
  }

  getChannelPlaceholder(): string {
    if (this.selectedChannelType === 'email') return 'user@example.com';
    if (this.selectedChannelType === 'telegram') return '@username / Chat ID';
    return '+998901234567';
  }

  openBindModal(): void {
    this.selectedChannelType = 'email';
    this.newAddress = '';
    this.isBindSubmitted = false;
    this.isBindModalOpen = true;
  }

  closeBindModal(): void {
    this.isBindModalOpen = false;
    this.isBindSubmitted = false;
  }

  submitBind(): void {
    this.isBindSubmitted = true;
    if (!this.newAddress.trim()) return;

    this.activeVerifyAddress = this.newAddress.trim();
    this.bindChannel.emit({
      channel: this.selectedChannelType,
      address: this.newAddress.trim()
    });
  }

  openConfirmModal(verifyToken: string, address: string): void {
    this.activeVerifyToken = verifyToken;
    this.activeVerifyAddress = address;
    this.verificationCode = '';
    this.isConfirmSubmitted = false;
    this.isBindModalOpen = false;
    this.isConfirmModalOpen = true;
  }

  closeConfirmModal(): void {
    this.isConfirmModalOpen = false;
    this.verificationCode = '';
    this.isConfirmSubmitted = false;
  }

  requestConfirm(channel: UserChannel): void {
    this.selectedChannelType = channel.channel;
    this.newAddress = channel.address;
    this.activeVerifyAddress = channel.address;
    this.bindChannel.emit({
      channel: channel.channel,
      address: channel.address
    });
  }

  submitConfirm(): void {
    this.isConfirmSubmitted = true;
    const cleanCode = this.verificationCode.trim();
    if (cleanCode.length !== 6) return;

    this.confirmChannel.emit({
      verifyToken: this.activeVerifyToken,
      code: cleanCode
    });
  }

  requestUnbind(channel: UserChannel): void {
    this.channelToUnbind = channel;
  }

  submitUnbind(): void {
    if (!this.channelToUnbind) return;
    const channelName = this.channelToUnbind.channel;
    this.channelToUnbind = null;
    this.unbindChannel.emit(channelName);
  }
}
