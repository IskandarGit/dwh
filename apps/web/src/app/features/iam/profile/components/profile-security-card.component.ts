import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { User } from '../profile.models';

@Component({
  selector: 'app-profile-security-card',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe
  ],
  template: `
    <div class="card section-card">
      <div class="section-header">
        <div class="section-title-box">
          <span class="material-symbols-outlined section-icon" aria-hidden="true">security</span>
          <h4 class="section-title">{{ 'iam.bezopasnost_i_2fa' | t }}</h4>
        </div>
      </div>

      <div class="security-info-box">
        <div class="twofa-status-banner" [class.enabled]="user?.is2faEnabled">
          <span class="material-symbols-outlined twofa-big-icon" aria-hidden="true">
            {{ user?.is2faEnabled ? 'verified_user' : 'gpp_maybe' }}
          </span>
          <div class="twofa-status-text">
            <div class="twofa-status-title">
              {{ (user?.is2faEnabled ? 'iam.two_factor_active' : 'iam.two_factor_disabled') | t }}
            </div>
            <div class="twofa-status-desc">
              {{ user?.is2faEnabled
                ? ('iam.two_factor_active_description' | t)
                : ('iam.two_factor_disabled_description' | t) }}
            </div>
          </div>
        </div>

        <div class="security-tips">
          <div class="tip-item">
            <span class="material-symbols-outlined tip-icon" aria-hidden="true">check_circle</span>
            <span>{{ 'iam.zaschita_ot_podbora_paroley_5_nevernyh_popytok_b' | t }}</span>
          </div>
          <div class="tip-item">
            <span class="material-symbols-outlined tip-icon" aria-hidden="true">check_circle</span>
            <span>{{ 'iam.sessii_avtomaticheski_zakryvayutsya_pri_bezdeyst' | t }}</span>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .card {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 18px 22px;
    }

    .section-card {
      min-width: 0;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-color);
    }

    .section-title-box {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-main);
    }

    .section-icon {
      font-size: 20px;
      color: var(--primary);
    }

    .section-title {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
    }

    .security-info-box {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .twofa-status-banner {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      border-radius: var(--radius-md);
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      transition: all 0.2s ease;
    }

    .twofa-status-banner.enabled {
      background-color: rgba(16, 185, 129, 0.08);
      border-color: rgba(16, 185, 129, 0.3);
    }

    .twofa-big-icon {
      font-size: 32px;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .twofa-status-banner.enabled .twofa-big-icon {
      color: var(--success);
    }

    .twofa-status-text {
      flex: 1;
      min-width: 0;
    }

    .twofa-status-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-main);
      margin-bottom: 2px;
    }

    .twofa-status-desc {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.4;
    }

    .security-tips {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 4px;
    }

    .tip-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.4;
    }

    .tip-icon {
      font-size: 16px;
      color: var(--success);
      flex-shrink: 0;
      margin-top: 1px;
    }
  `]
})
export class ProfileSecurityCardComponent {
  @Input() user: User | null = null;
}
