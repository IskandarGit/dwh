import { afterNextRender, Component, DestroyRef, ElementRef, Injector, signal, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import { ApiService } from '../../../core/services/api.service';
import { TranslatePipe, I18nService } from '../../../core/services/i18n.service';
import { ThemeService } from '../../../core/services/theme.service';

type LoginStep = 'credentials' | 'otp' | 'must_change_password';
type PasswordField = 'password' | 'new-password' | 'confirm-new-password';


@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    TranslatePipe,CommonModule, FormsModule, UiButtonComponent, UiModalComponent],
  template: `
    <main class="login-wrapper">
      <div class="login-top-bar">
        <div class="lang-selector-login">
          <span class="material-symbols-outlined lang-icon" aria-hidden="true">language</span>
          <select
            id="login-language-select"
            class="lang-select-login"
            [attr.aria-label]="'settings.yazyk_interfeysa' | t"
            [value]="i18n.currentLang()"
            (change)="onLanguageChange($event)"
          >
            <option *ngFor="let lang of i18n.languages()" [value]="lang.code">
              {{ lang.code.toUpperCase() }} — {{ lang.name }}
            </option>
          </select>
        </div>
      </div>
      <div class="login-card">
        <div class="login-header">
          <div class="brand-lockup" role="img" aria-label="SmartupCMS">
            <span class="brand-mark" aria-hidden="true">S</span>
            <span class="brand-name" aria-hidden="true">SmartupCMS</span>
          </div>
          <h1 class="login-title">{{ 'auth.korporativnyy_vhod' | t }}</h1>
          <p class="login-subtitle">{{ 'auth.platforma_upravleniya_dannymi_i_zadachami' | t }}</p>
        </div>

        <!-- Step 1: Login & Password Form -->
        <form *ngIf="step() === 'credentials'" (ngSubmit)="onLoginSubmit()" class="login-form" [attr.aria-busy]="isLoading()">
          <div class="form-group">
            <label class="form-label" for="login">{{ 'auth.username' | t }}</label>
            <input
              id="login"
              type="text"
              class="form-input"
              [(ngModel)]="login"
              (ngModelChange)="formError.set('')"
              name="login"
              required
              autocomplete="username"
              autocapitalize="none"
              [spellcheck]="false"
              placeholder="user@company.com"
              aria-required="true"
              [attr.aria-invalid]="formError() ? 'true' : null"
              [attr.aria-describedby]="formError() ? 'login-error' : null"
              [disabled]="isLoading()"
            />
          </div>

          <div class="form-group">
            <div class="password-label-row">
              <label class="form-label" for="password">{{ 'auth.password' | t }}</label>
            </div>
            <div class="password-input">
            <input
              id="password"
              [type]="passwordVisibility()['password'] ? 'text' : 'password'"
              class="form-input"
              [(ngModel)]="password"
              (ngModelChange)="formError.set('')"
              (keydown)="checkCapsLock($event, 'password')"
              (keyup)="checkCapsLock($event, 'password')"
              (blur)="capsLockField.set(null)"
              name="password"
              required
              autocomplete="current-password"
              [spellcheck]="false"
              aria-required="true"
              [attr.aria-invalid]="formError() ? 'true' : null"
              [attr.aria-describedby]="passwordDescription('password')"
              [disabled]="isLoading()"
            />
              <button type="button" class="password-toggle" aria-controls="password"
                [attr.aria-label]="(passwordVisibility()['password'] ? 'auth.hide_password' : 'auth.show_password') | t"
                [disabled]="isLoading()" (click)="togglePasswordVisibility('password')">
                <span class="material-symbols-outlined" aria-hidden="true">{{ passwordVisibility()['password'] ? 'visibility_off' : 'visibility' }}</span>
              </button>
            </div>
            <p id="password-caps-lock" class="caps-lock-hint" role="status">{{ capsLockField() === 'password' ? ('auth.caps_lock_on' | t) : '' }}</p>
            <button type="button" class="forgot-link" [disabled]="isLoading()" (click)="openResetModal()">{{ 'auth.zabyli_parol' | t }}</button>
          </div>

          <p *ngIf="formError()" id="login-error" class="form-error" role="alert">{{ formError() }}</p>

          <ui-button
            type="submit"
            variant="primary"
            size="lg"
            [loading]="isLoading()"
            [fullWidth]="true"
            class="submit-btn"
          >
            {{ 'auth.voyti_v_sistemu' | t }}
          </ui-button>

        </form>

        <!-- Step 2: 2FA OTP Code Verification -->
        <form *ngIf="step() === 'otp'" (ngSubmit)="onOtpSubmit()" class="login-form" [attr.aria-busy]="isLoading()">
          <div class="otp-banner">
            <span class="material-symbols-outlined" aria-hidden="true">shield_person</span>
            <div>
              <strong>{{ 'auth.otp_title' | t }}</strong>
              <p id="otp-hint">{{ 'auth.vvedite_6_znachnyy_kod_podtverzhdeniya_otpravlen' | t }}</p>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="otp-code">{{ 'auth.kod_podtverzhdeniya_otp' | t }}</label>
            <input
              id="otp-code"
              type="text"
              class="form-input otp-input tabular-nums"
              [(ngModel)]="otpCode"
              (ngModelChange)="formError.set('')"
              name="otpCode"
              required
              maxlength="6"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]{6}"
              aria-required="true"
              [attr.aria-describedby]="formError() ? 'otp-hint otp-error' : 'otp-hint'"
              [attr.aria-invalid]="formError() ? 'true' : null"
              [disabled]="isLoading()"
            />
          </div>

          <p *ngIf="formError()" id="otp-error" class="form-error" role="alert">{{ formError() }}</p>

          <div class="otp-actions">
            <ui-button
              type="submit"
              variant="primary"
              size="lg"
              [loading]="isLoading()"
              [fullWidth]="true"
              class="submit-btn"
            >
              {{ 'auth.podtverdit_vhod' | t }}
            </ui-button>

            <ui-button
              type="button"
              variant="ghost"
              size="md"
              [disabled]="isLoading()"
              (onClick)="backToCredentials()"
            >
              {{ 'auth.vernutsya_nazad' | t }}
            </ui-button>
          </div>
        </form>

        <!-- Step 3: Mandatory Password Change on First Login -->
        <form *ngIf="step() === 'must_change_password'" (ngSubmit)="onChangePasswordSubmit()" class="login-form" [attr.aria-busy]="isLoading()">
          <div class="otp-banner" style="background-color: var(--warning-bg); color: var(--warning);">
            <span class="material-symbols-outlined" aria-hidden="true">lock_reset</span>
            <div>
              <strong>{{ 'auth.smena_vremennogo_parolya' | t }}</strong>
              <p id="password-policy-hint">{{ 'auth.ustanovite_postoyannyy_parol_ot_10_simvolov_dlya' | t }}</p>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="new-password">{{ 'auth.novyy_parol' | t }}</label>
            <div class="password-input">
            <input
              id="new-password"
              [type]="passwordVisibility()['new-password'] ? 'text' : 'password'"
              class="form-input"
              [(ngModel)]="newPassword"
              (ngModelChange)="formError.set('')"
              (keydown)="checkCapsLock($event, 'new-password')"
              (keyup)="checkCapsLock($event, 'new-password')"
              (blur)="capsLockField.set(null)"
              name="newPassword"
              required
              minlength="10"
              autocomplete="new-password"
              [spellcheck]="false"
              [attr.aria-invalid]="formError() ? 'true' : null"
              [attr.aria-describedby]="passwordDescription('new-password')"
              [disabled]="isLoading()"
            />
              <button type="button" class="password-toggle" aria-controls="new-password"
                [attr.aria-label]="(passwordVisibility()['new-password'] ? 'auth.hide_password' : 'auth.show_password') | t"
                [disabled]="isLoading()" (click)="togglePasswordVisibility('new-password')">
                <span class="material-symbols-outlined" aria-hidden="true">{{ passwordVisibility()['new-password'] ? 'visibility_off' : 'visibility' }}</span>
              </button>
            </div>
            <p id="new-password-caps-lock" class="caps-lock-hint" role="status">{{ capsLockField() === 'new-password' ? ('auth.caps_lock_on' | t) : '' }}</p>
          </div>

          <div class="form-group">
            <label class="form-label" for="confirm-new-password">{{ 'auth.povtorite_novyy_parol' | t }}</label>
            <div class="password-input">
            <input
              id="confirm-new-password"
              [type]="passwordVisibility()['confirm-new-password'] ? 'text' : 'password'"
              class="form-input"
              [(ngModel)]="confirmNewPassword"
              (ngModelChange)="formError.set('')"
              (keydown)="checkCapsLock($event, 'confirm-new-password')"
              (keyup)="checkCapsLock($event, 'confirm-new-password')"
              (blur)="capsLockField.set(null)"
              name="confirmNewPassword"
              required
              minlength="10"
              autocomplete="new-password"
              [spellcheck]="false"
              [attr.aria-invalid]="formError() ? 'true' : null"
              [attr.aria-describedby]="passwordDescription('confirm-new-password')"
              [disabled]="isLoading()"
            />
              <button type="button" class="password-toggle" aria-controls="confirm-new-password"
                [attr.aria-label]="(passwordVisibility()['confirm-new-password'] ? 'auth.hide_password' : 'auth.show_password') | t"
                [disabled]="isLoading()" (click)="togglePasswordVisibility('confirm-new-password')">
                <span class="material-symbols-outlined" aria-hidden="true">{{ passwordVisibility()['confirm-new-password'] ? 'visibility_off' : 'visibility' }}</span>
              </button>
            </div>
            <p id="confirm-new-password-caps-lock" class="caps-lock-hint" role="status">{{ capsLockField() === 'confirm-new-password' ? ('auth.caps_lock_on' | t) : '' }}</p>
          </div>

          <p *ngIf="formError()" id="password-change-error" class="form-error" role="alert">{{ formError() }}</p>

          <div class="otp-actions">
            <ui-button
              type="submit"
              variant="primary"
              size="lg"
              [loading]="isLoading()"
              [fullWidth]="true"
              class="submit-btn"
            >
              {{ 'auth.change_password' | t }}
            </ui-button>

            <ui-button
              type="button"
              variant="ghost"
              size="md"
              [disabled]="isLoading()"
              (onClick)="backToCredentials()"
            >
              {{ 'common.cancel' | t }}
            </ui-button>
          </div>
        </form>
      </div>
    </main>

    <!-- Password Reset Modal -->
    <ui-modal
      [isOpen]="isResetModalOpen()"
      [title]="'auth.vosstanovlenie_parolya' | t"
      size="sm"
      (close)="isResetModalOpen.set(false)"
    >
      <div body class="reset-body">
        <p id="reset-hint" class="reset-hint">{{ 'auth.vvedite_email_vashey_uchetnoy_zapisi_my_otpravim' | t }}</p>
        <div class="form-group">
          <label class="form-label" for="reset-email">Email</label>
          <input
            id="reset-email"
            name="resetEmail"
            type="email"
            class="form-input"
            [(ngModel)]="resetEmail"
            placeholder="user@company.com"
            autocomplete="email"
            aria-describedby="reset-hint"
            [attr.aria-invalid]="resetError() ? 'true' : null"
          />
        </div>
        <p *ngIf="resetError()" class="form-error" role="alert">{{ resetError() }}</p>
      </div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="isResetModalOpen.set(false)">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="primary" size="md" [loading]="isResetLoading()" (onClick)="sendResetRequest()">{{ 'auth.otpravit_kod' | t }}</ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    .login-wrapper {
      min-height: 100vh;
      min-height: 100dvh;
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background-color: var(--bg-app);
      padding: 16px;
      position: relative;
    }

    .login-top-bar {
      position: absolute;
      top: 20px;
      right: 24px;
      display: flex;
      align-items: center;
      z-index: 10;
    }

    .lang-selector-login {
      display: flex;
      align-items: center;
      gap: 6px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 4px 10px;
      box-shadow: var(--shadow-sm);
    }

    .lang-selector-login .lang-icon {
      font-size: 18px;
      color: var(--text-muted);
    }

    .lang-select-login {
      border: none;
      background: transparent;
      color: var(--text-main);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      outline: none;
      font-family: inherit;
    }

    .login-card {
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-overlay);
      padding: 32px 28px;
    }

    :host-context([data-theme="dark"]) .login-card {
      --text-inverse: var(--bg-app);
    }

    .login-header {
      text-align: center;
      margin-bottom: 24px;
    }

    .brand-lockup {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }

    .brand-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      flex: 0 0 44px;
      border-radius: var(--radius-md);
      background-color: var(--primary);
      color: #ffffff;
      font-weight: 700;
      font-size: 16px;
    }

    .brand-name {
      color: var(--text-main);
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.2px;
    }

    .login-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-main);
      margin-bottom: 4px;
    }

    .login-subtitle {
      font-size: 12px;
      color: var(--text-muted);
    }

    .login-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .form-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-main);
    }

    .password-label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .forgot-link {
      align-self: flex-end;
      font-size: 11px;
      color: var(--primary);
      cursor: pointer;
      text-decoration: none;
      border: 0;
      padding: 5px 2px;
      background: transparent;
      font-family: inherit;
    }
    .forgot-link:hover {
      text-decoration: underline;
    }

    .form-input {
      height: 36px;
      padding: 6px 12px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-size: 13px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .form-input:focus {
      border-color: var(--primary);
      outline: 2px solid var(--focus-ring, var(--primary));
      outline-offset: 2px;
    }

    .form-input[aria-invalid="true"] {
      border-color: var(--danger);
    }

    .password-input {
      position: relative;
      display: flex;
      min-width: 0;
    }

    .password-input .form-input {
      width: 100%;
      min-width: 0;
      padding-right: 44px;
    }

    .password-toggle {
      position: absolute;
      inset: 0 0 0 auto;
      width: 40px;
      display: grid;
      place-items: center;
      padding: 0;
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }

    .password-toggle .material-symbols-outlined { font-size: 20px; }
    .password-toggle:hover:not(:disabled) { color: var(--text-main); }
    .password-toggle:focus-visible, .forgot-link:focus-visible {
      outline: 2px solid var(--focus-ring, var(--primary));
      outline-offset: 2px;
    }
    .password-toggle:disabled, .forgot-link:disabled { opacity: 0.5; cursor: not-allowed; }
    /* Keep pointer targets still when a password blur clears the hint. */
    .caps-lock-hint { min-height: 1.4em; color: var(--warning); font-size: 12px; line-height: 1.4; }

    @media (max-width: 480px) {
      .login-card { padding: 24px 20px; }
      .form-input { height: 44px; font-size: 16px; }
      .password-toggle { width: 44px; }
      .password-input .form-input { padding-right: 48px; }
    }

    .submit-btn {
      width: 100%;
      margin-top: 6px;
    }

    .otp-banner {
      background-color: var(--info-bg);
      color: var(--info);
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      display: flex;
      gap: 10px;
      font-size: 12px;
      line-height: 1.4;
    }

    .otp-input {
      font-size: 18px;
      letter-spacing: 4px;
      text-align: center;
      font-weight: 600;
    }

    .otp-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .form-error {
      color: var(--danger);
      font-size: 12px;
      line-height: 1.4;
    }

    .reset-hint {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 12px;
      line-height: 1.4;
    }

  `]
})
export class LoginComponent {
  readonly i18n = inject(I18nService);
  private readonly uiI18n = this.i18n;
  private readonly injector = inject(Injector);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  onLanguageChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (select?.value && select.value !== this.i18n.currentLang()) {
      this.i18n.setLanguage(select.value, false).subscribe();
    }
  }
  login = '';
  password = '';
  otpCode = '';
  otpToken = '';
  newPassword = '';
  confirmNewPassword = '';
  tempOldPassword = '';

  readonly step = signal<LoginStep>('credentials');
  readonly passwordVisibility = signal<Record<PasswordField, boolean>>({
    password: false, 'new-password': false, 'confirm-new-password': false
  });
  readonly capsLockField = signal<PasswordField | null>(null);
  readonly isLoading = signal<boolean>(false);
  readonly isResetModalOpen = signal<boolean>(false);
  readonly isResetLoading = signal<boolean>(false);
  readonly formError = signal<string>('');
  readonly resetError = signal<string>('');
  resetEmail = '';

  constructor(
    private authService: AuthService,
    private api: ApiService,
    private toast: ToastService
  ) {
    // Apply the saved theme on this public route before the app shell exists.
    inject(ThemeService);
    this.focusInput('login');
  }

  onLoginSubmit() {
    if (this.isLoading() || this.step() !== 'credentials' || this.isResetModalOpen()) return;
    if (!this.login || !this.password) {
      this.formError.set(this.uiI18n.translate('auth.enter_login_and_password'));
      this.focusInput(!this.login ? 'login' : 'password');
      return;
    }

    this.formError.set('');
    this.maskPasswords();
    this.isLoading.set(true);
    this.authService.login(this.login, this.password, navigator.userAgent)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        this.isLoading.set(false);
        if (res.step === 'otp') {
          this.otpToken = res.otp_token || '';
          this.otpCode = '';
          this.changeStep('otp');
        } else if (res.step === 'success' && res.user?.forcePasswordChange) {
          this.tempOldPassword = this.password;
          this.newPassword = '';
          this.confirmNewPassword = '';
          this.changeStep('must_change_password');
        }
      },
      error: err => {
        this.isLoading.set(false);
        this.formError.set(this.errorMessage(err, this.uiI18n.translate('auth.ne_udalos_vypolnit_vhod_proverte_dannye_i_povtor')));
        this.focusInput('password');
      }
    });
  }

  onOtpSubmit() {
    if (this.isLoading() || this.step() !== 'otp' || !this.otpToken) return;
    if (!/^[0-9]{6}$/.test(this.otpCode)) {
      this.formError.set(this.uiI18n.translate('auth.enter_six_digit_code'));
      this.focusInput('otp-code');
      return;
    }

    this.formError.set('');
    this.isLoading.set(true);
    this.authService.verifyOtp(this.otpToken, this.otpCode, navigator.userAgent)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        this.isLoading.set(false);
        if (res.step === 'success' && res.user?.forcePasswordChange) {
          this.tempOldPassword = this.password;
          this.newPassword = '';
          this.confirmNewPassword = '';
          this.changeStep('must_change_password');
        }
      },
      error: err => {
        this.isLoading.set(false);
        this.formError.set(this.errorMessage(err, this.uiI18n.translate('auth.kod_ne_podtverzhden_proverte_kod_i_povtorite_pop')));
        this.focusInput('otp-code');
      }
    });
  }

  onChangePasswordSubmit() {
    if (this.isLoading() || this.step() !== 'must_change_password') return;
    if (!this.newPassword || !this.confirmNewPassword) {
      this.formError.set(this.uiI18n.translate('auth.enter_and_confirm_new_password'));
      this.focusInput(!this.newPassword ? 'new-password' : 'confirm-new-password');
      return;
    }
    if (this.newPassword.length < 10) {
      this.formError.set(this.uiI18n.translate('auth.dlina_novogo_parolya_dolzhna_byt_ne_menee_10_sim'));
      this.focusInput('new-password');
      return;
    }
    if (this.newPassword !== this.confirmNewPassword) {
      this.formError.set(this.uiI18n.translate('auth.vvedennye_paroli_ne_sovpadayut'));
      this.focusInput('confirm-new-password');
      return;
    }

    this.formError.set('');
    this.maskPasswords();
    this.isLoading.set(true);
    // A committed password change must clear global authentication even if
    // navigation destroys this view before the response arrives.
    this.api.post('/auth/password', {
      oldPassword: this.tempOldPassword || this.password,
      newPassword: this.newPassword
    }, { notifyError: false }).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.password = '';
        this.tempOldPassword = '';
        this.newPassword = '';
        this.confirmNewPassword = '';
        this.otpToken = '';
        this.otpCode = '';
        this.changeStep('credentials');
        this.authService.onPasswordChanged();
      },
      error: err => {
        this.isLoading.set(false);
        this.formError.set(this.errorMessage(err, this.uiI18n.translate('auth.ne_udalos_izmenit_parol_proverte_slozhnost_parol')));
        this.focusInput('new-password');
      }
    });
  }

  openResetModal() {
    if (this.isLoading()) return;
    this.maskPasswords();
    this.resetEmail = '';
    this.resetError.set('');
    this.isResetModalOpen.set(true);
  }

  sendResetRequest() {
    if (!this.resetEmail) return;
    this.resetError.set('');
    this.isResetLoading.set(true);
    this.api.post('/auth/password-reset/request', { email: this.resetEmail }).subscribe({
      next: () => {
        this.isResetLoading.set(false);
        this.isResetModalOpen.set(false);
        this.toast.success(this.uiI18n.translate('auth.instrukciya_po_sbrosu_parolya_otpravlena_na_ukaz'));
      },
      error: err => {
        this.isResetLoading.set(false);
        this.resetError.set(this.errorMessage(err, this.uiI18n.translate('auth.ne_udalos_otpravit_instrukciyu_povtorite_popytku')));
      }
    });
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object') {
      const value = error as { detail?: unknown; message?: unknown };
      if (typeof value.detail === 'string' && value.detail.trim()) return value.detail;
      if (typeof value.message === 'string' && value.message.trim()) return value.message;
    }
    return fallback;
  }

  togglePasswordVisibility(field: PasswordField): void {
    if (this.isLoading()) return;
    this.passwordVisibility.update(current => ({ ...current, [field]: !current[field] }));
  }

  checkCapsLock(event: KeyboardEvent, field: PasswordField): void {
    this.capsLockField.set(event.getModifierState('CapsLock') ? field : null);
  }

  passwordDescription(field: PasswordField): string | null {
    const descriptions: string[] = [];
    if (field !== 'password') descriptions.push('password-policy-hint');
    if (this.formError()) descriptions.push(field === 'password' ? 'login-error' : 'password-change-error');
    if (this.capsLockField() === field) descriptions.push(`${field}-caps-lock`);
    return descriptions.join(' ') || null;
  }

  backToCredentials(): void {
    if (this.isLoading()) return;
    this.password = '';
    this.tempOldPassword = '';
    this.otpToken = '';
    this.otpCode = '';
    this.newPassword = '';
    this.confirmNewPassword = '';
    this.changeStep('credentials');
  }

  private changeStep(step: LoginStep): void {
    this.formError.set('');
    this.maskPasswords();
    this.step.set(step);
    this.focusInput(step === 'credentials' ? 'login' : step === 'otp' ? 'otp-code' : 'new-password');
  }

  private maskPasswords(): void {
    this.passwordVisibility.set({ password: false, 'new-password': false, 'confirm-new-password': false });
    this.capsLockField.set(null);
  }

  private focusInput(id: string): void {
    if (this.destroyRef.destroyed) return;
    afterNextRender(() => {
      // NgModel applies its disabled state in a microtask after rendering.
      // Wait for that update so an error can focus a re-enabled input.
      queueMicrotask(() => {
        if (!this.destroyRef.destroyed && !this.isResetModalOpen()) {
          this.element.nativeElement.querySelector<HTMLInputElement>(`#${id}`)?.focus();
        }
      });
    }, { injector: this.injector });
  }
}
