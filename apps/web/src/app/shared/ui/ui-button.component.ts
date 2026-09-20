import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../core/services/i18n.service';

@Component({
  selector: 'ui-button',
  standalone: true,
  imports: [
    TranslatePipe,CommonModule],
  template: `
    <button
      [type]="type"
      [attr.form]="form || null"
      [disabled]="disabled || loading"
      [class]="'btn btn-' + variant + ' btn-' + size"
      [class.btn-full-width]="fullWidth"
      [attr.aria-busy]="loading ? 'true' : null"
      [attr.aria-label]="ariaLabel || null"
      (click)="onClick.emit($event)"
    >
      <span *ngIf="loading" class="spinner" aria-hidden="true"></span>
      <span *ngIf="loading" class="sr-only">{{ 'ui.button.vypolnyaetsya' | t }}</span>
      <span *ngIf="icon && !loading" class="material-symbols-outlined icon" aria-hidden="true">{{ icon }}</span>
      <ng-content></ng-content>
    </button>
  `,
  styles: [`
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-family: inherit;
      font-weight: 500;
      border-radius: var(--radius-sm);
      border: 1px solid transparent;
      cursor: pointer;
      transition: all 0.15s ease-in-out;
      white-space: nowrap;
      user-select: none;
    }

    button:focus-visible {
      outline: 2px solid var(--focus-ring, var(--primary));
      outline-offset: 2px;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Sizes */
    .btn-sm {
      padding: 4px 8px;
      font-size: 12px;
      height: 28px;
    }

    .btn-md {
      padding: 6px 14px;
      font-size: 13px;
      height: var(--control-height);
    }

    .btn-lg {
      padding: 8px 18px;
      font-size: 14px;
      height: 40px;
    }

    .btn-full-width {
      width: 100%;
    }

    /* Variants */
    .btn-primary {
      background-color: var(--primary);
      color: var(--on-primary);
    }
    .btn-primary:hover:not(:disabled) {
      background-color: var(--primary-hover);
    }

    .btn-secondary {
      background-color: var(--bg-surface);
      border-color: var(--border-color);
      color: var(--text-main);
    }
    .btn-secondary:hover:not(:disabled) {
      background-color: var(--bg-hover);
    }

    .btn-danger {
      background-color: var(--danger);
      color: var(--text-inverse);
    }
    .btn-danger:hover:not(:disabled) {
      background-color: var(--danger-hover, #b91c1c);
    }

    .btn-ghost {
      background-color: transparent;
      color: var(--text-muted);
    }
    .btn-ghost:hover:not(:disabled) {
      background-color: var(--bg-hover);
      color: var(--text-main);
    }

    .icon {
      font-size: 18px;
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: currentColor;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 767px) {
      .btn-md { min-height: var(--control-touch-height); }
    }
  `]
})
export class UiButtonComponent {
  @Input() variant: 'primary' | 'secondary' | 'danger' | 'ghost' = 'primary';
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() form?: string;
  @Input() disabled: boolean = false;
  @Input() loading: boolean = false;
  @Input() icon?: string;
  @Input() fullWidth: boolean = false;
  @Input() ariaLabel?: string;

  @Output() onClick = new EventEmitter<MouseEvent>();
}
