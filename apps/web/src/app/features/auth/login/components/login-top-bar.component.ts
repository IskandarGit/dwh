import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService, TranslatePipe } from '../../../../core/services/i18n.service';

@Component({
  selector: 'app-login-top-bar',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
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
  `,
  styles: [`
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
  `]
})
export class LoginTopBarComponent {
  readonly i18n = inject(I18nService);

  onLanguageChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (select?.value && select.value !== this.i18n.currentLang()) {
      this.i18n.setLanguage(select.value, false).subscribe();
    }
  }
}
