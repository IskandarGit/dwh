import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { TranslatePipe, I18nService } from '../../../core/services/i18n.service';
import { PermissionService } from '../../../core/services/permission.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import {
  WebhookSubscription,
  CreatedWebhookSubscription,
  CreateWebhookSubscriptionDto,
  AVAILABLE_WEBHOOK_EVENTS,
  WebhookEventOption
} from './webhooks-settings.models';

@Component({
  selector: 'app-webhooks-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, UiButtonComponent, UiModalComponent],
  template: `
    <div class="webhooks-container">
      <!-- Section Header -->
      <div class="webhooks-header">
        <div class="header-left">
          <h3 class="section-title">{{ 'settings.webhooks.title' | t }}</h3>
          <p class="section-subtitle">{{ 'settings.webhooks.subtitle' | t }}</p>
        </div>
        <div class="header-right">
          <ui-button
            variant="secondary"
            size="sm"
            icon="refresh"
            [loading]="isLoading()"
            (onClick)="loadSubscriptions()"
          >
            {{ 'common.refresh' | t }}
          </ui-button>
          <ui-button
            *ngIf="canManageWebhooks()"
            variant="primary"
            size="sm"
            icon="add"
            (onClick)="openCreateModal()"
          >
            {{ 'settings.webhooks.add' | t }}
          </ui-button>
        </div>
      </div>

      <!-- Loading State -->
      <div *ngIf="isLoading()" class="loading-state" role="status">
        <span class="material-symbols-outlined spin-icon" aria-hidden="true">sync</span>
        <span>{{ 'common.loading' | t }}</span>
      </div>

      <!-- Error State -->
      <div *ngIf="!isLoading() && loadError()" class="error-banner" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        <span>{{ 'common.error' | t }}</span>
        <ui-button variant="secondary" size="sm" (onClick)="loadSubscriptions()">
          {{ 'common.retry' | t }}
        </ui-button>
      </div>

      <!-- Subscriptions Content -->
      <div *ngIf="!isLoading() && !loadError()">
        <!-- Empty State -->
        <div *ngIf="subscriptions().length === 0" class="empty-card">
          <span class="material-symbols-outlined empty-icon" aria-hidden="true">webhook</span>
          <h4>{{ 'settings.webhooks.empty' | t }}</h4>
          <p class="empty-desc">{{ 'settings.webhooks.subtitle' | t }}</p>
          <ui-button
            *ngIf="canManageWebhooks()"
            variant="primary"
            size="sm"
            icon="add"
            (onClick)="openCreateModal()"
          >
            {{ 'settings.webhooks.add' | t }}
          </ui-button>
        </div>

        <!-- Subscriptions Table -->
        <div *ngIf="subscriptions().length > 0" class="table-card">
          <table class="clean-table" [attr.aria-label]="'settings.webhooks.title' | t">
            <thead>
              <tr>
                <th style="width: 60px;">ID</th>
                <th>{{ 'settings.webhooks.name' | t }}</th>
                <th>{{ 'settings.webhooks.target_url' | t }}</th>
                <th>{{ 'settings.webhooks.events' | t }}</th>
                <th style="width: 120px;">{{ 'settings.webhooks.status' | t }}</th>
                <th style="width: 130px;" *ngIf="canManageWebhooks()">{{ 'common.actions' | t }}</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let sub of subscriptions()">
                <td class="font-mono text-muted text-xs">#{{ sub.id }}</td>
                <td class="sub-name-cell">
                  <strong>{{ sub.name }}</strong>
                  <span class="text-xs text-muted">{{ sub.createdAt | date:'dd.MM.yyyy HH:mm' }}</span>
                </td>
                <td class="url-cell">
                  <span class="url-text font-mono text-xs" [title]="sub.targetUrl">{{ sub.targetUrl }}</span>
                </td>
                <td>
                  <div class="events-wrap">
                    <span *ngFor="let ev of sub.subscribedEvents" class="event-pill">
                      {{ ev }}
                    </span>
                  </div>
                </td>
                <td>
                  <span class="status-badge" [class.active]="sub.state === 'A'" [class.paused]="sub.state !== 'A'">
                    <span class="status-dot"></span>
                    {{ (sub.state === 'A' ? 'settings.webhooks.active' : 'settings.webhooks.paused') | t }}
                  </span>
                </td>
                <td *ngIf="canManageWebhooks()">
                  <div class="actions-cell">
                    <button
                      type="button"
                      class="btn-icon"
                      [title]="(sub.state === 'A' ? 'settings.webhooks.paused' : 'settings.webhooks.active') | t"
                      [attr.aria-label]="(sub.state === 'A' ? 'settings.webhooks.paused' : 'settings.webhooks.active') | t"
                      (click)="toggleState(sub)"
                    >
                      <span class="material-symbols-outlined" style="font-size: 18px;">
                        {{ sub.state === 'A' ? 'pause_circle' : 'play_circle' }}
                      </span>
                    </button>
                    <button
                      type="button"
                      class="btn-icon danger"
                      [title]="'common.delete' | t"
                      [attr.aria-label]="'common.delete' | t"
                      (click)="confirmDelete(sub)"
                    >
                      <span class="material-symbols-outlined" style="font-size: 18px;">delete</span>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Create Modal -->
      <ui-modal
        [isOpen]="isCreateModalOpen()"
        [title]="'settings.webhooks.add' | t"
        size="md"
        (close)="closeCreateModal()"
      >
        <div body class="create-form-body">
          <div class="form-row">
            <label for="webhook-name" class="form-lbl">{{ 'settings.webhooks.name' | t }} *</label>
            <input
              id="webhook-name"
              type="text"
              class="form-input"
              [placeholder]="'settings.webhooks.name_placeholder' | t"
              [(ngModel)]="createName"
              maxlength="100"
              required
            />
          </div>

          <div class="form-row">
            <label for="webhook-url" class="form-lbl">{{ 'settings.webhooks.target_url' | t }} *</label>
            <input
              id="webhook-url"
              type="url"
              class="form-input font-mono"
              [placeholder]="'settings.webhooks.url_placeholder' | t"
              [(ngModel)]="createTargetUrl"
              maxlength="500"
              required
            />
          </div>

          <div class="form-row">
            <div class="events-header">
              <label class="form-lbl">{{ 'settings.webhooks.events' | t }} *</label>
              <button type="button" class="link-btn text-xs" (click)="toggleAllEvents()">
                {{ isAllEventsSelected() ? ('iam.snyat_vse' | t) : ('iam.vybrat_vse' | t) }}
              </button>
            </div>
            <div class="events-grid">
              <label *ngFor="let opt of availableEvents" class="event-checkbox-label">
                <input
                  type="checkbox"
                  [checked]="selectedEvents.has(opt.code)"
                  (change)="onEventCheck(opt.code, $event)"
                />
                <span class="event-opt-info">
                  <strong class="event-opt-code font-mono text-xs">{{ opt.code }}</strong>
                  <span class="event-opt-desc text-xs text-muted">{{ opt.descKey | t }}</span>
                </span>
              </label>
            </div>
          </div>
        </div>
        <div footer>
          <ui-button variant="secondary" size="md" (onClick)="closeCreateModal()">
            {{ 'common.cancel' | t }}
          </ui-button>
          <ui-button
            variant="primary"
            size="md"
            [disabled]="!isCreateValid()"
            [loading]="isSaving()"
            (onClick)="submitCreate()"
          >
            {{ 'common.save' | t }}
          </ui-button>
        </div>
      </ui-modal>

      <!-- Secret Key Reveal Modal (Shown once after creation) -->
      <ui-modal
        [isOpen]="createdSecretModalOpen()"
        [title]="'settings.webhooks.secret_modal_title' | t"
        size="md"
        (close)="closeSecretModal()"
      >
        <div body class="secret-modal-body" *ngIf="recentlyCreatedSubscription() as sub">
          <div class="warning-callout">
            <span class="material-symbols-outlined callout-icon" aria-hidden="true">warning</span>
            <p>{{ 'settings.webhooks.secret_modal_warning' | t }}</p>
          </div>

          <div class="secret-field-box">
            <label class="form-lbl">{{ 'settings.webhooks.secret_modal_title' | t }}</label>
            <div class="secret-input-row">
              <input
                type="text"
                class="form-input font-mono secret-input"
                [value]="sub.secretToken"
                readonly
                aria-label="Secret token"
              />
              <ui-button
                variant="secondary"
                size="sm"
                icon="content_copy"
                (onClick)="copySecret(sub.secretToken)"
              >
                {{ 'settings.webhooks.copy_secret' | t }}
              </ui-button>
            </div>
          </div>

          <div class="hmac-info-box">
            <span class="text-xs text-muted">
              {{ 'settings.webhooks.request_headers' | t }}: <code>X-Hub-Signature-256: sha256=&lt;hmac-hex&gt;</code>, <code>X-Webhook-Event: &lt;event_type&gt;</code>.
            </span>
          </div>
        </div>
        <div footer>
          <ui-button variant="primary" size="md" (onClick)="closeSecretModal()">
            {{ 'common.confirm' | t }}
          </ui-button>
        </div>
      </ui-modal>

      <!-- Delete Confirmation Modal -->
      <ui-modal
        [isOpen]="isDeleteModalOpen()"
        [title]="'common.confirm' | t"
        size="sm"
        (close)="isDeleteModalOpen.set(false)"
      >
        <div body class="delete-body" *ngIf="deletingSubscription() as sub">
          <p>{{ 'settings.webhooks.delete_confirm' | t:{name: sub.name} }}</p>
        </div>
        <div footer *ngIf="deletingSubscription() as sub">
          <ui-button variant="secondary" size="md" (onClick)="isDeleteModalOpen.set(false)">
            {{ 'common.cancel' | t }}
          </ui-button>
          <ui-button variant="danger" size="md" [loading]="isSaving()" (onClick)="doDelete(sub.id)">
            {{ 'common.delete' | t }}
          </ui-button>
        </div>
      </ui-modal>
    </div>
  `,
  styles: [`
    .webhooks-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .webhooks-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--border-color);
    }
    .section-title {
      margin: 0 0 4px 0;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .section-subtitle {
      margin: 0;
      font-size: 0.82rem;
      color: var(--text-muted);
    }
    .header-right {
      display: flex;
      gap: 8px;
    }

    .loading-state {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      gap: 10px;
      color: var(--text-muted);
    }
    .spin-icon {
      font-size: 24px;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .error-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: var(--radius-sm, 6px);
      color: var(--danger, #ef4444);
    }

    .empty-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 24px;
      background: var(--bg-surface);
      border: 1px dashed var(--border-color);
      border-radius: var(--radius-md, 8px);
      text-align: center;
      gap: 10px;
    }
    .empty-icon {
      font-size: 48px;
      color: var(--text-muted);
    }
    .empty-desc {
      max-width: 450px;
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-bottom: 10px;
    }

    .table-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md, 8px);
      overflow-x: auto;
    }

    .clean-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.84rem;
    }
    .clean-table th, .clean-table td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }
    .clean-table th {
      background: var(--bg-hover, rgba(0, 0, 0, 0.02));
      font-weight: 600;
      color: var(--text-secondary, #64748b);
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .sub-name-cell {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .url-cell {
      max-width: 250px;
    }
    .url-text {
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--primary, #0284c7);
    }

    .events-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .event-pill {
      font-family: var(--font-mono, monospace);
      font-size: 0.72rem;
      padding: 2px 6px;
      background: rgba(0, 0, 0, 0.05);
      border-radius: 4px;
      color: var(--text-secondary);
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .status-badge.active {
      background: rgba(34, 197, 94, 0.12);
      color: #16a34a;
    }
    .status-badge.paused {
      background: rgba(245, 158, 11, 0.12);
      color: #d97706;
    }
    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .actions-cell {
      display: flex;
      gap: 4px;
    }
    .btn-icon {
      background: transparent;
      border: none;
      padding: 4px;
      cursor: pointer;
      color: var(--text-secondary);
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn-icon:hover {
      background: var(--bg-hover, rgba(0, 0, 0, 0.05));
      color: var(--text-primary);
    }
    .btn-icon.danger:hover {
      color: var(--danger, #ef4444);
      background: rgba(239, 68, 68, 0.1);
    }

    .create-form-body {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .form-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-lbl {
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--text-secondary, #475569);
    }
    .form-input {
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      font-size: 0.85rem;
    }
    .form-input:focus {
      outline: none;
      border-color: var(--primary);
    }

    .events-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .link-btn {
      background: transparent;
      border: none;
      color: var(--primary);
      cursor: pointer;
      font-weight: 500;
      padding: 0;
    }
    .events-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      max-height: 200px;
      overflow-y: auto;
      padding: 8px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm, 6px);
      background: var(--bg-hover, rgba(0, 0, 0, 0.01));
    }
    .event-checkbox-label {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 0.8rem;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
    }
    .event-checkbox-label:hover {
      background: rgba(0, 0, 0, 0.03);
    }
    .event-opt-info {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .warning-callout {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.3);
      border-radius: var(--radius-sm, 6px);
      color: #b45309;
      font-size: 0.84rem;
    }
    .callout-icon {
      font-size: 24px;
      color: #f59e0b;
    }

    .secret-field-box {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 14px;
    }
    .secret-input-row {
      display: flex;
      gap: 8px;
    }
    .secret-input {
      flex: 1;
      font-weight: 600;
      color: #1e293b;
      background: rgba(0, 0, 0, 0.03);
    }
    .hmac-info-box {
      margin-top: 12px;
      padding: 8px 12px;
      background: var(--bg-hover, rgba(0, 0, 0, 0.02));
      border-radius: var(--radius-sm, 6px);
      border: 1px solid var(--border-color);
    }
    .hmac-info-box code {
      font-size: 0.75rem;
      color: var(--primary);
    }
  `]
})
export class WebhooksSettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly uiI18n = inject(I18nService);
  private readonly permService = inject(PermissionService);

  readonly subscriptions = signal<WebhookSubscription[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly isSaving = signal<boolean>(false);
  readonly loadError = signal<boolean>(false);

  readonly isCreateModalOpen = signal<boolean>(false);
  readonly createdSecretModalOpen = signal<boolean>(false);
  readonly recentlyCreatedSubscription = signal<CreatedWebhookSubscription | null>(null);

  readonly isDeleteModalOpen = signal<boolean>(false);
  readonly deletingSubscription = signal<WebhookSubscription | null>(null);

  createName = '';
  createTargetUrl = '';
  selectedEvents = new Set<string>(['*']);

  readonly availableEvents: WebhookEventOption[] = AVAILABLE_WEBHOOK_EVENTS;

  readonly canManageWebhooks = computed(() =>
    this.permService.hasPermission('platform.webhooks', 'manage')
  );

  ngOnInit(): void {
    this.loadSubscriptions();
  }

  loadSubscriptions(): void {
    this.isLoading.set(true);
    this.loadError.set(false);
    this.api.get<WebhookSubscription[]>('/webhooks/subscriptions').subscribe({
      next: (subs) => {
        this.subscriptions.set(Array.isArray(subs) ? subs : []);
        this.isLoading.set(false);
      },
      error: () => {
        this.loadError.set(true);
        this.isLoading.set(false);
      }
    });
  }

  openCreateModal(): void {
    this.createName = '';
    this.createTargetUrl = '';
    this.selectedEvents = new Set(['*']);
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  onEventCheck(code: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      this.selectedEvents.add(code);
    } else {
      this.selectedEvents.delete(code);
    }
  }

  isAllEventsSelected(): boolean {
    return this.selectedEvents.size === this.availableEvents.length;
  }

  toggleAllEvents(): void {
    if (this.isAllEventsSelected()) {
      this.selectedEvents.clear();
    } else {
      for (const ev of this.availableEvents) {
        this.selectedEvents.add(ev.code);
      }
    }
  }

  isCreateValid(): boolean {
    return this.createName.trim().length > 0 &&
           this.createTargetUrl.trim().length > 0 &&
           this.selectedEvents.size > 0;
  }

  submitCreate(): void {
    if (!this.isCreateValid()) return;
    this.isSaving.set(true);

    const body: CreateWebhookSubscriptionDto = {
      name: this.createName.trim(),
      targetUrl: this.createTargetUrl.trim(),
      subscribedEvents: Array.from(this.selectedEvents)
    };

    this.api.post<CreatedWebhookSubscription>('/webhooks/subscriptions', body).subscribe({
      next: (created) => {
        this.isSaving.set(false);
        this.isCreateModalOpen.set(false);
        this.toast.success(this.uiI18n.translate('settings.webhooks.created_success'));
        this.recentlyCreatedSubscription.set(created);
        this.createdSecretModalOpen.set(true);
        this.loadSubscriptions();
      },
      error: (err: any) => {
        this.isSaving.set(false);
        this.toast.error(err?.error?.detail || err?.message || 'Error creating subscription');
      }
    });
  }

  closeSecretModal(): void {
    this.createdSecretModalOpen.set(false);
    this.recentlyCreatedSubscription.set(null);
  }

  copySecret(secret: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(secret);
      this.toast.success(this.uiI18n.translate('settings.webhooks.secret_copied'));
    }
  }

  toggleState(sub: WebhookSubscription): void {
    const nextState = sub.state === 'A' ? 'P' : 'A';
    this.api.patch<void>(`/webhooks/subscriptions/${sub.id}`, { state: nextState }).subscribe({
      next: () => {
        this.toast.success(this.uiI18n.translate('settings.webhooks.updated_success'));
        this.loadSubscriptions();
      },
      error: () => {}
    });
  }

  confirmDelete(sub: WebhookSubscription): void {
    this.deletingSubscription.set(sub);
    this.isDeleteModalOpen.set(true);
  }

  doDelete(id: number): void {
    this.isSaving.set(true);
    this.api.delete<void>(`/webhooks/subscriptions/${id}`).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.isDeleteModalOpen.set(false);
        this.deletingSubscription.set(null);
        this.toast.success(this.uiI18n.translate('settings.webhooks.deleted_success'));
        this.loadSubscriptions();
      },
      error: () => {
        this.isSaving.set(false);
      }
    });
  }
}

