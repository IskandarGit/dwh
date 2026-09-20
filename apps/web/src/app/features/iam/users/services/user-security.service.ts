import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { I18nService } from '../../../../core/services/i18n.service';
import { UserSecuritySummary } from '../../../../core/models/auth.models';
import { SecurityConfirmConfig } from '../users.models';

@Injectable({
  providedIn: 'root'
})
export class UserSecurityService {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly uiI18n = inject(I18nService);

  readonly userSecurity = signal<UserSecuritySummary | null>(null);
  readonly isLoadingSecurity = signal<boolean>(false);
  readonly isSecurityActionPending = signal<boolean>(false);
  readonly isSecConfirmModalOpen = signal<boolean>(false);
  secConfirmConfig: SecurityConfirmConfig | null = null;

  loadUserSecurity(userId: number): void {
    this.isLoadingSecurity.set(true);
    this.api.get<UserSecuritySummary>(`/iam/users/${userId}/security`).subscribe({
      next: (res) => {
        this.userSecurity.set(res);
        this.isLoadingSecurity.set(false);
      },
      error: () => {
        this.isLoadingSecurity.set(false);
      }
    });
  }

  terminateUserSessions(userId: number): void {
    this.secConfirmConfig = {
      title: this.uiI18n.translate('iam.zavershit_vse_sessii'),
      message: this.uiI18n.translate('iam.podtverdit_zavershenie_vseh_sessiy'),
      confirmBtnText: this.uiI18n.translate('iam.vypolnit'),
      confirmBtnVariant: 'danger',
      action: () => {
        this.isSecurityActionPending.set(true);
        this.api.delete(`/iam/users/${userId}/sessions`).subscribe({
          next: () => {
            this.isSecurityActionPending.set(false);
            this.isSecConfirmModalOpen.set(false);
            this.toast.success(this.uiI18n.translate('iam.vse_sessii_zaversheny'));
            this.loadUserSecurity(userId);
          },
          error: () => this.isSecurityActionPending.set(false)
        });
      }
    };
    this.isSecConfirmModalOpen.set(true);
  }

  terminateSingleSession(sessionId: number, userId: number): void {
    this.isSecurityActionPending.set(true);
    this.api.delete(`/iam/sessions/${sessionId}`).subscribe({
      next: () => {
        this.isSecurityActionPending.set(false);
        this.toast.success(this.uiI18n.translate('iam.sessiya_zavershena'));
        this.loadUserSecurity(userId);
      },
      error: () => this.isSecurityActionPending.set(false)
    });
  }

  forcePasswordChange(userId: number, onComplete?: () => void): void {
    this.secConfirmConfig = {
      title: this.uiI18n.translate('iam.trebovanie_smeny_parolya'),
      message: this.uiI18n.translate('iam.podtverdit_trebovanie_smeny_parolya'),
      confirmBtnText: this.uiI18n.translate('iam.vypolnit'),
      confirmBtnVariant: 'primary',
      action: () => {
        this.isSecurityActionPending.set(true);
        this.api.post(`/iam/users/${userId}/force-password-change`).subscribe({
          next: () => {
            this.isSecurityActionPending.set(false);
            this.isSecConfirmModalOpen.set(false);
            this.toast.success(this.uiI18n.translate('iam.smena_parolya_potrebovana'));
            this.loadUserSecurity(userId);
            onComplete?.();
          },
          error: () => this.isSecurityActionPending.set(false)
        });
      }
    };
    this.isSecConfirmModalOpen.set(true);
  }

  resetUser2fa(userId: number, onComplete?: () => void): void {
    this.secConfirmConfig = {
      title: this.uiI18n.translate('iam.sbrosit_2fa'),
      message: this.uiI18n.translate('iam.podtverdit_sbros_2fa'),
      confirmBtnText: this.uiI18n.translate('iam.vypolnit'),
      confirmBtnVariant: 'danger',
      action: () => {
        this.isSecurityActionPending.set(true);
        this.api.post(`/iam/users/${userId}/reset-2fa`).subscribe({
          next: () => {
            this.isSecurityActionPending.set(false);
            this.isSecConfirmModalOpen.set(false);
            this.toast.success(this.uiI18n.translate('iam.2fa_sbroshena'));
            this.loadUserSecurity(userId);
            onComplete?.();
          },
          error: () => this.isSecurityActionPending.set(false)
        });
      }
    };
    this.isSecConfirmModalOpen.set(true);
  }

  confirmSecurityAction(): void {
    if (this.secConfirmConfig?.action) {
      this.secConfirmConfig.action();
    }
  }
}
