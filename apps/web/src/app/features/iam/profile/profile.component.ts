import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { TranslatePipe, I18nService } from '../../../core/services/i18n.service';

import {
  User,
  UserSession,
  ApiToken,
  CreatedTokenResponse,
  PasswordForm,
  PasswordStrength,
  TokenExpirationOption
} from './profile.models';

import { UserProfileCardComponent } from './components/user-profile-card.component';
import { ProfilePasswordCardComponent } from './components/profile-password-card.component';
import { ProfileSecurityCardComponent } from './components/profile-security-card.component';
import { ProfileSessionsCardComponent } from './components/profile-sessions-card.component';
import { ProfileTokensCardComponent } from './components/profile-tokens-card.component';

export * from './profile.models';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    UserProfileCardComponent,
    ProfilePasswordCardComponent,
    ProfileSecurityCardComponent,
    ProfileSessionsCardComponent,
    ProfileTokensCardComponent
  ],
  template: `
    <div class="profile-container">
      <div class="view-header">
        <div class="header-left">
          <h1 class="view-title">{{ 'nav.profile' | t }}</h1>
          <span class="count-badge">{{ 'iam.bezopasnost_i_nastroyki' | t }}</span>
        </div>
      </div>

      <!-- User Info Card -->
      <app-user-profile-card [user]="authService.currentUser()"></app-user-profile-card>

      <!-- Main Grid Sections -->
      <div class="sections-grid">
        <!-- Change Password Card -->
        <app-profile-password-card
          [passwordForm]="passwordForm"
          [showOldPassword]="showOldPassword()"
          [showNewPassword]="showNewPassword()"
          [showConfirmPassword]="showConfirmPassword()"
          [isPasswordSubmitted]="isPasswordSubmitted"
          [isChangingPassword]="isChangingPassword()"
          [passwordStrength]="passwordStrength()"
          [hasMinLength]="hasMinLength()"
          [hasLettersAndNumbers]="hasLettersAndNumbers()"
          [hasMixedCase]="hasMixedCase()"
          [passwordsMatch]="passwordsMatch()"
          (toggleOldPassword)="showOldPassword.update(v => !v)"
          (toggleNewPassword)="showNewPassword.update(v => !v)"
          (toggleConfirmPassword)="showConfirmPassword.update(v => !v)"
          (submitPassword)="submitChangePassword($event)"
        ></app-profile-password-card>

        <!-- Security & 2FA Info Card -->
        <app-profile-security-card [user]="authService.currentUser()"></app-profile-security-card>

        <!-- Active Sessions Card -->
        <app-profile-sessions-card
          [sessions]="sessions()"
          [isLoadingSessions]="isLoadingSessions()"
          [isTerminatingSession]="isTerminatingSession()"
          [sessionToTerminate]="sessionToTerminate"
          (loadSessions)="loadSessions()"
          (terminateSession)="requestTerminateSession($event)"
          (terminateOtherSessions)="requestTerminateOtherSessions()"
          (confirmTerminate)="confirmTerminateSession()"
          (cancelTerminate)="sessionToTerminate = null"
        ></app-profile-sessions-card>

        <!-- API Tokens Card -->
        <app-profile-tokens-card
          [tokens]="tokens()"
          [isLoadingTokens]="isLoadingTokens()"
          [isCreatingToken]="isCreatingToken()"
          [isRevokingToken]="isRevokingToken()"
          [isCreateTokenModalOpen]="isCreateTokenModalOpen()"
          [isTokenSecretModalOpen]="isTokenSecretModalOpen()"
          [isTokenSubmitted]="isTokenSubmitted"
          [newTokenName]="newTokenName"
          [selectedTokenExpiration]="selectedTokenExpiration"
          [createdTokenSecret]="createdTokenSecret"
          [copiedSecret]="copiedSecret()"
          [tokenToRevoke]="tokenToRevoke"
          [tokenExpirationOptions]="tokenExpirationOptions"
          (openCreateTokenModal)="openCreateTokenModal()"
          (closeCreateTokenModal)="isCreateTokenModalOpen.set(false)"
          (createTokenSubmit)="createTokenSubmit()"
          (nameChange)="newTokenName = $event"
          (expirationChange)="selectedTokenExpiration = $event"
          (closeSecretModal)="isTokenSecretModalOpen.set(false)"
          (copySecret)="copySecret()"
          (requestRevoke)="requestRevokeToken($event)"
          (confirmRevoke)="confirmRevokeToken()"
          (cancelRevoke)="tokenToRevoke = null"
        ></app-profile-tokens-card>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .profile-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 1400px;
      min-width: 0;
    }

    .view-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 4px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .view-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-main);
      margin: 0;
    }

    .count-badge {
      background-color: var(--bg-hover);
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
      padding: 3px 10px;
      border-radius: 12px;
      border: 1px solid var(--border-color);
    }

    .sections-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 16px;
    }

    @media (max-width: 1024px) {
      .sections-grid {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `]
})
export class ProfileComponent implements OnInit {
  private readonly uiI18n = inject(I18nService);
  readonly sessions = signal<UserSession[]>([]);
  readonly tokens = signal<ApiToken[]>([]);

  readonly isLoadingSessions = signal<boolean>(false);
  readonly isLoadingTokens = signal<boolean>(false);
  readonly isCreatingToken = signal<boolean>(false);
  readonly isRevokingToken = signal<boolean>(false);
  readonly isTerminatingSession = signal<boolean>(false);
  readonly copiedSecret = signal<boolean>(false);

  readonly isCreateTokenModalOpen = signal<boolean>(false);
  readonly isTokenSecretModalOpen = signal<boolean>(false);

  readonly showOldPassword = signal<boolean>(false);
  readonly showNewPassword = signal<boolean>(false);
  readonly showConfirmPassword = signal<boolean>(false);
  readonly isChangingPassword = signal<boolean>(false);

  isPasswordSubmitted = false;
  isTokenSubmitted = false;

  newTokenName = '';
  selectedTokenExpiration = '90';
  createdTokenSecret = '';
  sessionToTerminate: UserSession | 'others' | null = null;
  tokenToRevoke: ApiToken | null = null;

  tokenExpirationOptions: TokenExpirationOption[] = [
    { value: '30', labelKey: 'iam.srok_30_dney' },
    { value: '90', labelKey: 'iam.srok_90_dney' },
    { value: '365', labelKey: 'iam.srok_1_god' },
    { value: 'never', labelKey: 'iam.bessrochno' }
  ];

  passwordForm: PasswordForm = {
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  };

  passwordStrength(): PasswordStrength {
    const pwd = this.passwordForm.newPassword;
    if (!pwd) return { score: 0, label: '', percent: 0, colorClass: '' };
    let score = 0;
    if (pwd.length >= 10) score++;
    if (/[a-z\u0430-\u044f]/.test(pwd) && /[A-Z\u0410-\u042f]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[^a-zA-Z\u0400-\u04FF0-9]/.test(pwd)) score++;

    let label = 'iam.parol_slabyy';
    let colorClass = 'strength-weak';
    let percent = 25;

    if (score === 2) {
      label = 'iam.parol_sredniy';
      colorClass = 'strength-medium';
      percent = 50;
    } else if (score === 3) {
      label = 'iam.parol_horoshiy';
      colorClass = 'strength-good';
      percent = 75;
    } else if (score >= 4) {
      label = 'iam.parol_otlichnyy';
      colorClass = 'strength-strong';
      percent = 100;
    }

    return { score, label, percent, colorClass };
  }

  hasMinLength(): boolean {
    return (this.passwordForm.newPassword?.length || 0) >= 10;
  }

  hasLettersAndNumbers(): boolean {
    const pwd = this.passwordForm.newPassword || '';
    return /[a-zA-Z\u0400-\u04FF]/.test(pwd) && /\d/.test(pwd);
  }

  hasMixedCase(): boolean {
    const pwd = this.passwordForm.newPassword || '';
    return /[a-z\u0430-\u044f]/.test(pwd) && /[A-Z\u0410-\u042f]/.test(pwd);
  }

  passwordsMatch(): boolean {
    const p1 = this.passwordForm.newPassword;
    const p2 = this.passwordForm.confirmPassword;
    return !!p1 && !!p2 && p1 === p2;
  }

  constructor(
    public authService: AuthService,
    private api: ApiService,
    private toast: ToastService
  ) {}

  ngOnInit() {
    this.loadSessions();
    this.loadTokens();
  }

  loadSessions() {
    this.isLoadingSessions.set(true);
    this.api.get<UserSession[]>('/iam/profile/sessions').subscribe({
      next: res => {
        this.sessions.set(res || []);
        this.isLoadingSessions.set(false);
      },
      error: () => {
        this.isLoadingSessions.set(false);
      }
    });
  }

  requestTerminateSession(session: UserSession) {
    this.sessionToTerminate = session;
  }

  requestTerminateOtherSessions() {
    this.sessionToTerminate = 'others';
  }

  confirmTerminateSession() {
    const target = this.sessionToTerminate;
    if (!target) return;

    this.isTerminatingSession.set(true);
    if (target === 'others') {
      this.api.delete('/iam/profile/sessions/others').subscribe({
        next: () => {
          this.isTerminatingSession.set(false);
          this.sessionToTerminate = null;
          this.toast.success(this.uiI18n.translate('iam.vse_ostalnye_sessii_uspeshno_zaversheny'));
          this.loadSessions();
        },
        error: (err: any) => {
          this.isTerminatingSession.set(false);
          this.toast.error(err?.error?.detail || this.uiI18n.translate('iam.oshibka_pri_zavershenii_sessiy'));
        }
      });
      return;
    }

    this.api.delete(`/iam/profile/sessions/${target.id}`).subscribe({
      next: () => {
        this.isTerminatingSession.set(false);
        this.sessionToTerminate = null;
        this.toast.success(this.uiI18n.translate('iam.sessiya_uspeshno_zavershena'));
        this.loadSessions();
      },
      error: (err: any) => {
        this.isTerminatingSession.set(false);
        this.toast.error(err?.error?.detail || this.uiI18n.translate('iam.oshibka_pri_zavershenii_sessii'));
      }
    });
  }

  submitChangePassword(event: Event) {
    event.preventDefault();
    this.isPasswordSubmitted = true;

    if (!this.passwordForm.oldPassword || !this.passwordForm.newPassword || !this.passwordForm.confirmPassword) {
      this.toast.warning(this.uiI18n.translate('iam.zapolnite_vse_polya_smeny_parolya'));
      return;
    }

    if (this.passwordForm.newPassword.length < 10) {
      this.toast.warning(this.uiI18n.translate('iam.novyy_parol_dolzhen_soderzhat_minimum_10_simvolo'));
      return;
    }

    if (this.passwordForm.newPassword !== this.passwordForm.confirmPassword) {
      this.toast.warning(this.uiI18n.translate('iam.novyy_parol_i_podtverzhdenie_ne_sovpadayut'));
      return;
    }

    this.isChangingPassword.set(true);
    this.api.post('/iam/users/me/password', {
      oldPassword: this.passwordForm.oldPassword,
      newPassword: this.passwordForm.newPassword
    }).subscribe({
      next: () => {
        this.isChangingPassword.set(false);
        this.passwordForm = { oldPassword: '', newPassword: '', confirmPassword: '' };
        this.isPasswordSubmitted = false;
        this.authService.onPasswordChanged();
      },
      error: () => {
        this.isChangingPassword.set(false);
      }
    });
  }

  loadTokens() {
    this.isLoadingTokens.set(true);
    this.api.get<ApiToken[]>('/iam/profile/tokens').subscribe({
      next: res => {
        this.tokens.set(res || []);
        this.isLoadingTokens.set(false);
      },
      error: () => {
        this.isLoadingTokens.set(false);
      }
    });
  }

  openCreateTokenModal() {
    this.newTokenName = '';
    this.selectedTokenExpiration = '90';
    this.isTokenSubmitted = false;
    this.isCreateTokenModalOpen.set(true);
  }

  createTokenSubmit() {
    this.isTokenSubmitted = true;
    if (!this.newTokenName.trim()) {
      this.toast.warning(this.uiI18n.translate('iam.vvedite_nazvanie_api_tokena.bfec35d'));
      return;
    }

    let expiresAt: string | null = null;
    const now = new Date();
    if (this.selectedTokenExpiration === '30') {
      expiresAt = new Date(now.getTime() + 30 * 86400000).toISOString();
    } else if (this.selectedTokenExpiration === '90') {
      expiresAt = new Date(now.getTime() + 90 * 86400000).toISOString();
    } else if (this.selectedTokenExpiration === '365') {
      expiresAt = new Date(now.getTime() + 365 * 86400000).toISOString();
    }

    this.isCreatingToken.set(true);
    this.api.post<CreatedTokenResponse>('/iam/profile/tokens', {
      name: this.newTokenName.trim(),
      expiresAt
    }).subscribe({
      next: res => {
        this.isCreatingToken.set(false);
        this.isCreateTokenModalOpen.set(false);
        this.isTokenSubmitted = false;
        this.createdTokenSecret = res.rawSecretToken;
        this.copiedSecret.set(false);
        this.isTokenSecretModalOpen.set(true);
        this.loadTokens();
      },
      error: (err: any) => {
        this.isCreatingToken.set(false);
        this.toast.error(err?.error?.detail || this.uiI18n.translate('iam.oshibka_pri_sozdanii_api_tokena'));
      }
    });
  }

  requestRevokeToken(token: ApiToken) {
    this.tokenToRevoke = token;
  }

  confirmRevokeToken() {
    if (!this.tokenToRevoke) return;
    const token = this.tokenToRevoke;
    this.isRevokingToken.set(true);
    this.api.delete(`/iam/profile/tokens/${token.id}`).subscribe({
      next: () => {
        this.isRevokingToken.set(false);
        this.tokenToRevoke = null;
        this.toast.success(this.uiI18n.translate('iam.token_uspeshno_otozvan'));
        this.loadTokens();
      },
      error: (err: any) => {
        this.isRevokingToken.set(false);
        this.toast.error(err?.error?.detail || this.uiI18n.translate('iam.oshibka_pri_otzyve_tokena'));
      }
    });
  }

  copySecret() {
    if (!this.createdTokenSecret) return;
    navigator.clipboard.writeText(this.createdTokenSecret);
    this.copiedSecret.set(true);
    this.toast.success(this.uiI18n.translate('iam.token_skopirovan_v_bufer_obmena'));
    setTimeout(() => this.copiedSecret.set(false), 2000);
  }
}
