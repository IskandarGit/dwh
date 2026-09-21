import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../../../shared/ui/ui-modal.component';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { ApiToken, TokenExpirationOption } from '../profile.models';

@Component({
  selector: 'app-profile-tokens-card',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    UiButtonComponent,
    UiModalComponent
  ],
  template: `
    <div class="card section-card full-width">
      <div class="section-header">
        <div class="section-title-box">
          <span class="material-symbols-outlined section-icon" aria-hidden="true">key</span>
          <h4 class="section-title">{{ 'iam.api_tokeny_dostupa_bearer_tokens' | t }}</h4>
          <span class="badge-count">{{ tokens.length }}</span>
        </div>
        <ui-button variant="primary" size="sm" icon="add" (onClick)="openCreateTokenModal.emit()">
          {{ 'iam.vypustit_token' | t }}
        </ui-button>
      </div>

      <div class="table-wrapper" role="region" [attr.aria-label]="'iam.tablica_api_tokenov' | t" tabindex="0">
        <table class="data-table" [attr.aria-label]="'nav.tokens' | t">
          <thead>
            <tr>
              <th>{{ 'iam.nazvanie_tokena' | t }}</th>
              <th>{{ 'iam.prefiks_tokena' | t }}</th>
              <th>{{ 'iam.sozdan' | t }}</th>
              <th>{{ 'iam.srok_deystviya' | t }}</th>
              <th class="text-right">{{ 'audit.deystvie' | t }}</th>
            </tr>
          </thead>
          <tbody>
            <!-- Skeleton rows when loading -->
            <ng-container *ngIf="isLoadingTokens">
              <tr class="skeleton-row" *ngFor="let item of [1, 2]">
                <td><div class="skeleton-pill w-36"></div></td>
                <td><div class="skeleton-pill w-24"></div></td>
                <td><div class="skeleton-pill w-28"></div></td>
                <td><div class="skeleton-pill w-32"></div></td>
                <td class="text-right"><div class="skeleton-pill w-20 ml-auto"></div></td>
              </tr>
            </ng-container>

            <!-- Real token rows -->
            <ng-container *ngIf="!isLoadingTokens">
              <tr *ngFor="let t of tokens">
                <td class="font-medium">{{ t.name }}</td>
                <td class="tabular-nums font-mono token-prefix-cell">{{ t.tokenPrefix }}...</td>
                <td class="tabular-nums text-muted">{{ t.createdAt | date:'dd.MM.yyyy' }}</td>
                <td class="tabular-nums">{{ t.expiresAt ? (t.expiresAt | date:'dd.MM.yyyy') : ('common.never_expires' | t) }}</td>
                <td class="text-right">
                  <ui-button
                    variant="danger"
                    size="sm"
                    icon="delete"
                    [ariaLabel]="'iam.revoke_api_token_named' | t:{name: t.name}"
                    (onClick)="requestRevoke.emit(t)"
                  >
                    {{ 'iam.otozvat' | t }}
                  </ui-button>
                </td>
              </tr>
              <tr *ngIf="tokens.length === 0">
                <td colspan="5" class="empty-cell">{{ 'iam.net_sozdannyh_api_tokenov' | t }}</td>
              </tr>
            </ng-container>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Create Token Modal -->
    <ui-modal
      [isOpen]="isCreateTokenModalOpen"
      [title]="'iam.vypusk_novogo_api_tokena' | t"
      size="sm"
      (close)="closeCreateTokenModal.emit()"
    >
      <div body class="token-form">
        <div class="form-group">
          <label class="form-label" for="profile-token-name">{{ 'iam.nazvanie_tokena' | t }} <span class="req">*</span></label>
          <input
            id="profile-token-name"
            name="profileTokenName"
            type="text"
            class="form-input"
            required
            [attr.aria-invalid]="isTokenSubmitted && !newTokenName.trim()"
            [attr.aria-describedby]="isTokenSubmitted && !newTokenName.trim() ? 'profile-token-name-error' : null"
            [ngModel]="newTokenName"
            (ngModelChange)="nameChange.emit($event)"
            [placeholder]="'iam.naprimer_ci_cd_deployer_kafka_sync' | t"
          />
          <span id="profile-token-name-error" class="field-error" *ngIf="isTokenSubmitted && !newTokenName.trim()">
            {{ 'iam.vvedite_nazvanie_api_tokena' | t }}
          </span>
        </div>

        <div class="form-group mt-3">
          <label class="form-label">{{ 'iam.srok_deystviya_tokena' | t }}</label>
          <div class="expiration-options">
            <label
              *ngFor="let opt of tokenExpirationOptions"
              class="expiration-pill"
              [class.selected]="selectedTokenExpiration === opt.value"
            >
              <input
                type="radio"
                name="tokenExpiration"
                [value]="opt.value"
                [ngModel]="selectedTokenExpiration"
                (ngModelChange)="expirationChange.emit($event)"
                class="sr-only"
              />
              <span>{{ opt.labelKey | t }}</span>
            </label>
          </div>
        </div>
      </div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="closeCreateTokenModal.emit()">
          {{ 'common.cancel' | t }}
        </ui-button>
        <ui-button variant="primary" size="md" [loading]="isCreatingToken" (onClick)="createTokenSubmit.emit()">
          {{ 'iam.sgenerirovat' | t }}
        </ui-button>
      </div>
    </ui-modal>

    <!-- Token Secret Reveal Modal -->
    <ui-modal
      [isOpen]="isTokenSecretModalOpen"
      [title]="'iam.api_token_uspeshno_sozdan' | t"
      size="md"
      [hasFooter]="false"
      (close)="closeSecretModal.emit()"
    >
      <div body class="secret-reveal-body">
        <div class="warning-box">
          <span class="material-symbols-outlined" aria-hidden="true">warning</span>
          <p>{{ 'iam.skopiruyte_i_sohranite_token_seychas_v_celyah_be' | t }}</p>
        </div>
        <div class="token-secret-box">
          <code>{{ createdTokenSecret }}</code>
          <ui-button
            [variant]="copiedSecret ? 'primary' : 'secondary'"
            size="sm"
            [icon]="copiedSecret ? 'check' : 'content_copy'"
            (onClick)="copySecret.emit()"
          >
            {{ (copiedSecret ? 'iam.skopirovano' : 'iam.skopirovat') | t }}
          </ui-button>
        </div>
        <ui-button variant="primary" size="md" class="mt-4" (onClick)="closeSecretModal.emit()">
          {{ 'iam.ya_sohranil_token' | t }}
        </ui-button>
      </div>
    </ui-modal>

    <!-- Token Revocation Confirmation -->
    <ui-modal
      [isOpen]="tokenToRevoke !== null"
      [title]="'iam.otzyv_api_tokena' | t"
      size="sm"
      (close)="cancelRevoke.emit()"
    >
      <div body class="confirmation-body" *ngIf="tokenToRevoke as token">
        <p>{{ 'iam.otozvat_api_token' | t }} <strong>{{ token.name }}</strong>?</p>
        <span class="confirmation-hint">{{ 'iam.integracii_s_etim_tokenom_nemedlenno_poteryayut_' | t }}</span>
      </div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="cancelRevoke.emit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="danger" size="md" [loading]="isRevokingToken" (onClick)="confirmRevoke.emit()">
          {{ 'iam.otozvat' | t }}
        </ui-button>
      </div>
    </ui-modal>
  `,
  styleUrl: './profile-tokens-card.component.css'
})
export class ProfileTokensCardComponent {
  @Input() tokens: ApiToken[] = [];
  @Input() isLoadingTokens = false;
  @Input() isCreatingToken = false;
  @Input() isRevokingToken = false;
  @Input() isCreateTokenModalOpen = false;
  @Input() isTokenSecretModalOpen = false;
  @Input() isTokenSubmitted = false;
  @Input() newTokenName = '';
  @Input() selectedTokenExpiration = '90';
  @Input() createdTokenSecret = '';
  @Input() copiedSecret = false;
  @Input() tokenToRevoke: ApiToken | null = null;
  @Input() tokenExpirationOptions: TokenExpirationOption[] = [];

  @Output() openCreateTokenModal = new EventEmitter<void>();
  @Output() closeCreateTokenModal = new EventEmitter<void>();
  @Output() createTokenSubmit = new EventEmitter<void>();
  @Output() nameChange = new EventEmitter<string>();
  @Output() expirationChange = new EventEmitter<string>();
  @Output() closeSecretModal = new EventEmitter<void>();
  @Output() copySecret = new EventEmitter<void>();
  @Output() requestRevoke = new EventEmitter<ApiToken>();
  @Output() confirmRevoke = new EventEmitter<void>();
  @Output() cancelRevoke = new EventEmitter<void>();
}
