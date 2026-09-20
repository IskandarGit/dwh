import {
  Component,
  Input,
  Output,
  EventEmitter,
  ElementRef,
  HostListener,
  OnChanges,
  OnDestroy,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { TranslatePipe } from '../../core/services/i18n.service';

@Component({
  selector: 'ui-modal',
  standalone: true,
  imports: [CommonModule, A11yModule, TranslatePipe],
  template: `
    <div *ngIf="isOpen" class="modal-backdrop" (click)="onBackdropClick($event)">
      <div
        [class]="'modal-dialog modal-' + size"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        [attr.aria-label]="ariaLabel || null"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
      >
        <div class="modal-header">
          <h3 class="modal-title" [id]="titleId">{{ title }}</h3>
          <button
            *ngIf="dismissible"
            type="button"
            class="modal-close"
            (click)="close.emit()"
            [attr.aria-label]="'ui.modal.close_named_dialog' | t:{title: title}"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <div class="modal-body">
          <ng-content select="[body]"></ng-content>
          <ng-content></ng-content>
        </div>
        <div class="modal-footer" *ngIf="hasFooter">
          <ng-content select="[footer], [modal-footer], [slot=footer]"></ng-content>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 16px;
    }

    .modal-dialog {
      background-color: var(--bg-surface);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-overlay);
      border: 1px solid var(--border-color);
      width: 100%;
      min-width: 0;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
    }

    .modal-sm { max-width: 400px; }
    .modal-md { max-width: 580px; }
    .modal-lg { max-width: 800px; }
    .modal-xl { max-width: 1100px; }

    .modal-header {
      padding: 14px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border-color);
    }

    .modal-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-main);
    }

    .modal-close {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      border-radius: var(--radius-sm);
    }
    .modal-close:hover {
      background-color: var(--bg-hover);
      color: var(--text-main);
    }

    .modal-body {
      padding: 18px;
      overflow-y: auto;
      overflow-x: hidden;
      flex: 1;
      min-width: 0;
    }

    .modal-footer {
      padding: 12px 18px;
      border-top: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      background-color: var(--bg-surface);
      border-bottom-left-radius: var(--radius-lg);
      border-bottom-right-radius: var(--radius-lg);
    }

  `]
})
export class UiModalComponent implements OnChanges, OnDestroy {
  private static nextId = 0;
  private static readonly openModals: UiModalComponent[] = [];

  readonly titleId = `ui-modal-title-${UiModalComponent.nextId++}`;
  private bodyLocked = false;

  @Input() isOpen: boolean = false;
  @Input() title: string = '';
  @Input() ariaLabel?: string;
  @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  @Input() hasFooter: boolean = true;
  @Input() dismissible: boolean = true;

  @Output() close = new EventEmitter<void>();

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event) {
    if (event.defaultPrevented || this.host.nativeElement.querySelector('[aria-haspopup="listbox"][aria-expanded="true"]')) return;
    if (this.isOpen && this.dismissible && UiModalComponent.openModals.at(-1) === this) {
      event.preventDefault();
      this.close.emit();
    }
  }

  onBackdropClick(event: MouseEvent) {
    if (this.dismissible && (event.target as HTMLElement).classList.contains('modal-backdrop')) {
      this.close.emit();
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['isOpen']) {
      this.syncBodyLock(this.isOpen);
    }
  }

  ngOnDestroy() {
    this.syncBodyLock(false);
  }

  private syncBodyLock(shouldLock: boolean) {
    if (shouldLock === this.bodyLocked) return;

    this.bodyLocked = shouldLock;
    const existingIndex = UiModalComponent.openModals.indexOf(this);
    if (shouldLock && existingIndex === -1) {
      UiModalComponent.openModals.push(this);
    } else if (!shouldLock && existingIndex !== -1) {
      UiModalComponent.openModals.splice(existingIndex, 1);
    }
    document.body.classList.toggle('modal-open', UiModalComponent.openModals.length > 0);
  }
}
