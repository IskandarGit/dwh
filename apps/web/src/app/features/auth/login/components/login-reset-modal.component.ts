import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { I18nService, TranslatePipe } from '../../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../../../shared/ui/ui-modal.component';

@Component({
  selector: 'app-login-reset-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, UiModalComponent, UiButtonComponent, TranslatePipe],
  template: `
    <ui-modal
      [isOpen]="isOpen"
      [title]="'auth.vosstanovlenie_parolya' | t"
      size="sm"
      (close)="onClose()"
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
        <ui-button variant="secondary" size="md" (onClick)="onClose()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="primary" size="md" [loading]="isResetLoading()" (onClick)="sendResetRequest()">{{ 'auth.otpravit_kod' | t }}</ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    .reset-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .reset-hint {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.4;
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

    .form-error {
      color: var(--danger);
      font-size: 12px;
      line-height: 1.4;
    }
  `]
})
export class LoginResetModalComponent {
  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  resetEmail = '';
  readonly resetError = signal<string>('');
  readonly isResetLoading = signal<boolean>(false);

  onClose(): void {
    this.resetEmail = '';
    this.resetError.set('');
    this.close.emit();
  }

  sendResetRequest(): void {
    if (!this.resetEmail) return;
    this.resetError.set('');
    this.isResetLoading.set(true);
    this.api.post('/auth/password-reset/request', { email: this.resetEmail }).subscribe({
      next: () => {
        this.isResetLoading.set(false);
        this.onClose();
        this.toast.success(this.i18n.translate('auth.instrukciya_po_sbrosu_parolya_otpravlena_na_ukaz'));
      },
      error: err => {
        this.isResetLoading.set(false);
        this.resetError.set(this.errorMessage(err, this.i18n.translate('auth.ne_udalos_otpravit_instrukciyu_povtorite_popytku')));
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
}
