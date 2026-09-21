import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../../core/services/i18n.service';

@Component({
  selector: 'app-login-header',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="login-header">
      <div class="brand-lockup" role="img" aria-label="SmartupCMS">
        <span class="brand-mark" aria-hidden="true">S</span>
        <span class="brand-name" aria-hidden="true">SmartupCMS</span>
      </div>
      <h1 class="login-title">{{ 'auth.korporativnyy_vhod' | t }}</h1>
      <p class="login-subtitle">{{ 'auth.platforma_upravleniya_dannymi_i_zadachami' | t }}</p>
    </div>
  `,
  styles: [`
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
  `]
})
export class LoginHeaderComponent {}
