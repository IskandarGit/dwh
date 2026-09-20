import { afterNextRender, Component, DestroyRef, ElementRef, Injector, signal, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { ApiService } from '../../../core/services/api.service';
import { TranslatePipe, I18nService } from '../../../core/services/i18n.service';
import { ThemeService } from '../../../core/services/theme.service';
import { LoginStep, PasswordField } from './login.models';
import { LoginTopBarComponent } from './components/login-top-bar.component';
import { LoginHeaderComponent } from './components/login-header.component';
import { LoginResetModalComponent } from './components/login-reset-modal.component';

export * from './login.models';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    FormsModule,
    UiButtonComponent,
    LoginTopBarComponent,
    LoginHeaderComponent,
    LoginResetModalComponent
  ],
  template: `
    <main class="login-wrapper">
      <app-login-top-bar></app-login-top-bar>
      <div class="login-card">
        <app-login-header></app-login-header>

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
    <app-login-reset-modal
      [isOpen]="isResetModalOpen()"
      (close)="isResetModalOpen.set(false)"
    ></app-login-reset-modal>
  `,
  styleUrl: './login.component.css'
})
export class LoginComponent {
  readonly i18n = inject(I18nService);
  private readonly uiI18n = this.i18n;
  private readonly injector = inject(Injector);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

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
  readonly formError = signal<string>('');

  constructor(
    private authService: AuthService,
    private api: ApiService
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
    this.isResetModalOpen.set(true);
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
