import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '../../../core/services/i18n.service';

@Component({
  selector: 'app-command-palette-footer',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="palette-footer">
      <div class="footer-shortcuts">
        <span class="shortcut-item"><kbd>↑</kbd><kbd>↓</kbd> {{ 'search.shortcuts.navigate' | t }}</span>
        <span class="shortcut-item"><kbd>↵</kbd> {{ 'search.shortcuts.select' | t }}</span>
        <span class="shortcut-item"><kbd>ESC</kbd> {{ 'search.shortcuts.close' | t }}</span>
      </div>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .palette-footer {
      padding: 9px 18px;
      border-top: 1px solid var(--border-color);
      background: var(--bg-surface-alt, var(--bg-page));
      display: flex;
      align-items: center;
      justify-content: flex-end;
    }
    .footer-shortcuts {
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 11.5px;
      color: var(--text-muted);
    }
    .shortcut-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .shortcut-item kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      padding: 2px 5px;
      font-size: 10.5px;
      font-family: inherit;
      font-weight: 500;
      line-height: 1.2;
      color: var(--text-muted);
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      box-shadow: 0 1px 1px rgba(0, 0, 0, 0.06);
    }
    @media (max-width: 767px) {
      .palette-footer { display: none; }
    }
  `]
})
export class CommandPaletteFooterComponent {}
