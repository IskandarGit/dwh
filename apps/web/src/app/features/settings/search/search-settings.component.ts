import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, exhaustMap, timer } from 'rxjs';
import { ProblemDetail } from '../../../core/models/common.models';
import {
  SearchEntityType,
  SearchFieldPolicy,
  SearchJobAction,
  SearchJobStatus,
  SearchManagementStatus,
  SearchPreviewResult,
  SearchQueryPolicy,
  SearchRetryJobRequest,
  SearchSettingsSnapshot,
  SearchStartJobRequest
} from '../../../core/models/search-management.models';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { PermissionService } from '../../../core/services/permission.service';
import { SearchManagementService } from '../../../core/services/search-management.service';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';

import {
  PendingMutation,
  MaintenanceConfirmation,
  validateSearchPolicy,
  cloneSearchSnapshot,
  cloneSearchPolicy,
  toProblemDetail,
  formatBytes,
  formatJobError
} from './search-settings.models';

@Component({
  selector: 'app-search-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, UiModalComponent],
  templateUrl: './search-settings.component.html',
  styleUrl: './search-settings.component.scss'
})
export class SearchSettingsComponent implements OnInit, OnDestroy {
  private readonly management = inject(SearchManagementService);
  private readonly permissions = inject(PermissionService);
  private readonly i18n = inject(I18nService);

  readonly entities: SearchEntityType[] = ['TASK', 'PROJECT', 'USER', 'NOTE'];

  get displayedEntities(): SearchEntityType[] {
    const draft = this.draft();
    return this.entities.filter(e => e !== 'NOTE' || (draft && draft.fields['NOTE'] && draft.fields['NOTE'].length > 0));
  }
  readonly status = signal<SearchManagementStatus | null>(null);
  readonly statusLoading = signal(false);
  readonly statusError = signal<ProblemDetail | null>(null);
  readonly statusAuthorized = signal(false);
  readonly settingsLoading = signal(false);
  readonly settingsError = signal<ProblemDetail | null>(null);
  readonly savedSettings = signal<SearchSettingsSnapshot | null>(null);
  readonly draft = signal<SearchQueryPolicy | null>(null);
  readonly savePending = signal(false);
  readonly saveError = signal<ProblemDetail | null>(null);
  readonly saveAttempted = signal(false);
  readonly history = signal<SearchJobStatus[]>([]);
  readonly historyLoading = signal(false);
  readonly historyError = signal<ProblemDetail | null>(null);
  readonly historyCursor = signal<string | null>(null);
  readonly historyHasMore = signal(false);
  readonly previewPending = signal(false);
  readonly previewResult = signal<SearchPreviewResult | null>(null);
  readonly previewError = signal<ProblemDetail | null>(null);
  readonly previewCooldownSeconds = signal(0);
  readonly mutationPending = signal(false);
  readonly mutationError = signal<ProblemDetail | null>(null);
  readonly uncertainMutation = signal<PendingMutation | null>(null);
  readonly activeJob = signal<SearchJobStatus | null>(null);
  readonly activeJobId = signal<string | null>(null);
  readonly activeOperation = computed(() => this.activeJobId() !== null);
  readonly pollError = signal<ProblemDetail | null>(null);
  readonly confirmation = signal<MaintenanceConfirmation | null>(null);
  readonly historyRetryNextPage = signal(false);

  previewQuery = '';
  previewEntity: SearchEntityType | '' = '';

  readonly policyErrors = computed(() => validateSearchPolicy(this.draft(), this.entities));
  readonly dirty = computed(() => {
    const saved = this.savedSettings();
    const draft = this.draft();
    return Boolean(saved && draft && JSON.stringify(saved.policy) !== JSON.stringify(draft));
  });
  readonly rebuildRequired = computed(() => {
    const current = this.status();
    const saved = this.savedSettings();
    return current?.rebuildRequired === true
      || Boolean(saved && current?.activeProfile && saved.policy.schemaProfile !== current.activeProfile);
  });
  readonly atCapacity = computed(() => (this.status()?.generations.length ?? 0) >= 4);
  readonly displayedJobs = computed(() => this.history().length ? this.history() : (this.status()?.jobs ?? []));

  private statusRequest?: Subscription;
  private settingsRequest?: Subscription;
  private historyRequest?: Subscription;
  private saveRequest?: Subscription;
  private previewRequest?: Subscription;
  private mutationRequest?: Subscription;
  private pollRequest?: Subscription;
  private cooldownRequest?: Subscription;

  ngOnInit(): void {
    if (!this.canSearch()) return;
    this.refreshStatus();
    this.refreshHistory();
    if (this.canReadSettings()) this.loadSettings();
  }

  ngOnDestroy(): void {
    this.statusRequest?.unsubscribe();
    this.settingsRequest?.unsubscribe();
    this.historyRequest?.unsubscribe();
    this.saveRequest?.unsubscribe();
    this.previewRequest?.unsubscribe();
    this.mutationRequest?.unsubscribe();
    this.pollRequest?.unsubscribe();
    this.cooldownRequest?.unsubscribe();
  }

  canSearch(): boolean {
    return this.permissions.hasPermission('platform.search', 'view');
  }

  canReadSettings(): boolean {
    return this.permissions.hasPermission('platform.settings', 'view');
  }

  canMaintain(): boolean {
    return this.statusAuthorized() && this.permissions.hasPermission('platform.settings', 'update');
  }

  canSave(): boolean {
    return this.canMaintain() && this.canReadSettings() && this.savedSettings() !== null
      && this.dirty() && this.policyErrors().length === 0 && !this.savePending()
      && !this.mutationPending() && !this.activeOperation();
  }

  fields(entity: SearchEntityType): SearchFieldPolicy[] {
    return this.draft()?.fields[entity] ?? [];
  }

  refreshOperationalData(): void {
    this.refreshStatus();
    this.refreshHistory();
  }

  refreshStatus(): void {
    if (!this.canSearch()) return;
    this.statusRequest?.unsubscribe();
    this.statusLoading.set(true);
    this.statusError.set(null);
    this.statusRequest = this.management.status().subscribe({
      next: value => {
        this.status.set(value);
        this.statusAuthorized.set(true);
        this.statusLoading.set(false);
        this.restoreActiveOperation(value);
      },
      error: error => {
        this.statusError.set(this.problem(error));
        this.statusAuthorized.set(false);
        this.statusLoading.set(false);
      }
    });
  }

  refreshHistory(): void {
    if (!this.canSearch()) return;
    this.historyRequest?.unsubscribe();
    this.historyLoading.set(true);
    this.historyError.set(null);
    this.historyRetryNextPage.set(false);
    this.historyRequest = this.management.jobs(20).subscribe({
      next: page => {
        this.history.set(page.items);
        this.historyCursor.set(page.nextCursor ?? null);
        this.historyHasMore.set(page.hasMore);
        this.historyLoading.set(false);
      },
      error: error => {
        this.historyError.set(this.problem(error));
        this.historyLoading.set(false);
      }
    });
  }

  loadMoreHistory(): void {
    const cursor = this.historyCursor();
    if (!cursor || !this.historyHasMore() || this.historyLoading()) return;
    this.historyRequest?.unsubscribe();
    this.historyLoading.set(true);
    this.historyError.set(null);
    this.historyRetryNextPage.set(true);
    this.historyRequest = this.management.jobs(20, cursor).subscribe({
      next: page => {
        const known = new Set(this.history().map(job => job.id));
        this.history.update(current => [...current, ...page.items.filter(job => !known.has(job.id))]);
        this.historyCursor.set(page.nextCursor ?? null);
        this.historyHasMore.set(page.hasMore);
        this.historyLoading.set(false);
        this.historyRetryNextPage.set(false);
      },
      error: error => {
        this.historyError.set(this.problem(error));
        this.historyLoading.set(false);
      }
    });
  }

  retryHistory(): void {
    if (this.historyRetryNextPage()) this.loadMoreHistory();
    else this.refreshHistory();
  }

  loadSettings(): void {
    if (!this.canReadSettings()) return;
    this.settingsRequest?.unsubscribe();
    this.settingsLoading.set(true);
    this.settingsError.set(null);
    this.settingsRequest = this.management.settings().subscribe({
      next: snapshot => {
        this.savedSettings.set(this.cloneSnapshot(snapshot));
        this.draft.set(this.clonePolicy(snapshot.policy));
        this.saveError.set(null);
        this.saveAttempted.set(false);
        this.settingsLoading.set(false);
      },
      error: error => {
        this.settingsError.set(this.problem(error));
        this.settingsLoading.set(false);
      }
    });
  }

  updatePolicyNumber(key: 'globalLimit' | 'requestsPerMinute' | 'burst', value: string | number): void {
    const parsed = typeof value === 'number' ? value : Number(value);
    this.draft.update(current => current ? { ...current, [key]: parsed } : current);
  }

  updateSchemaProfile(value: string): void {
    if (value !== 'MIXED' && value !== 'RU') return;
    this.draft.update(current => current ? { ...current, schemaProfile: value } : current);
  }

  updateFieldNumber(entity: SearchEntityType, index: number, key: 'weight' | 'numTypos', value: string | number): void {
    const parsed = typeof value === 'number' ? value : Number(value);
    this.updateField(entity, index, field => ({ ...field, [key]: parsed }));
  }

  updateFieldPrefix(entity: SearchEntityType, index: number, enabled: boolean): void {
    this.updateField(entity, index, field => ({ ...field, prefix: enabled }));
  }

  save(): void {
    this.saveAttempted.set(true);
    if (this.savePending() || !this.canSave()) return;
    const baseline = this.savedSettings();
    const policy = this.draft();
    if (!baseline || !policy) return;
    this.savePending.set(true);
    this.saveError.set(null);
    this.saveRequest = this.management.save({ version: baseline.version, policy: this.clonePolicy(policy) }).subscribe({
      next: saved => {
        this.savedSettings.set(this.cloneSnapshot(saved));
        this.draft.set(this.clonePolicy(saved.policy));
        this.savePending.set(false);
        this.saveAttempted.set(false);
      },
      error: error => {
        this.saveError.set(this.problem(error));
        this.savePending.set(false);
      }
    });
  }

  preview(): void {
    const policy = this.draft();
    const query = this.previewQuery.trim();
    if (!this.statusAuthorized() || !query || (policy !== null && this.policyErrors().length > 0)
      || this.previewCooldownSeconds() > 0) return;
    this.previewRequest?.unsubscribe();
    this.previewPending.set(true);
    this.previewError.set(null);
    this.previewResult.set(null);
    this.previewRequest = this.management.preview({
      q: query,
      ...(this.previewEntity ? { entity: this.previewEntity } : {}),
      ...(policy ? { policy: this.clonePolicy(policy) } : {})
    }).subscribe({
      next: result => {
        this.previewResult.set(result);
        this.previewPending.set(false);
      },
      error: error => {
        const failure = this.problem(error);
        this.previewError.set(failure);
        this.previewPending.set(false);
        if (failure.retryAfterSeconds !== undefined) this.startCooldown(failure.retryAfterSeconds);
      }
    });
  }

  requestMaintenance(action: SearchJobAction, generationId?: string): void {
    if (!this.canMaintain() || this.mutationPending() || this.savePending() || this.activeOperation()) return;
    if (action === 'REBUILD') {
      if (this.atCapacity()) return;
      this.confirmation.set({ action });
      return;
    }
    if (action === 'ROLLBACK') {
      if (!generationId || !this.status()?.rollbackTargets.some(target => target.id === generationId)) return;
      this.confirmation.set({ action, generationId });
      return;
    }
    this.executeMutation({ kind: 'start', request: { requestId: this.newRequestId(), action, ...(generationId ? { generationId } : {}) } });
  }

  confirmMaintenance(): void {
    const confirmation = this.confirmation();
    this.confirmation.set(null);
    if (!confirmation || this.activeOperation()) return;
    this.executeMutation({
      kind: 'start',
      request: {
        requestId: this.newRequestId(),
        action: confirmation.action,
        ...(confirmation.generationId ? { generationId: confirmation.generationId } : {})
      }
    });
  }

  retryJob(job: SearchJobStatus): void {
    if (!this.canMaintain() || this.mutationPending() || this.savePending() || this.activeOperation()
      || !['FAILED', 'CANCELLED'].includes(job.state)) return;
    this.executeMutation({ kind: 'retry', jobId: job.id, request: { requestId: this.newRequestId() } });
  }

  cancelJob(job: SearchJobStatus): void {
    if (!this.canMaintain() || this.mutationPending() || this.savePending() || !this.canCancel(job)) return;
    this.executeMutation({ kind: 'cancel', jobId: job.id });
  }

  retryUncertainMutation(): void {
    const pending = this.uncertainMutation();
    if (pending && !this.mutationPending() && (!this.activeOperation() || pending.kind === 'cancel'))
      this.executeMutation(pending);
  }

  resumePolling(): void {
    const id = this.activeJobId();
    if (id && !this.pollRequest) this.startPolling(id);
  }

  canCancel(job: SearchJobStatus): boolean {
    return ['QUEUED', 'RUNNING', 'VERIFYING'].includes(job.state);
  }

  isTerminal(job: SearchJobStatus): boolean {
    return ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job.state);
  }

  jobErrorMessage(code?: string | null): string {
    return formatJobError(code, key => this.i18n.translate(key));
  }

  displayNumber(value: number | null | undefined): string {
    return value === null || value === undefined ? this.i18n.translate('settings.search.unknown') : String(value);
  }

  displayBytes(value: number | null | undefined): string {
    return formatBytes(value, this.i18n.translate('settings.search.unknown'));
  }

  trackField(_index: number, field: SearchFieldPolicy): string {
    return field.field;
  }

  trackJob(_index: number, job: SearchJobStatus): string {
    return job.id;
  }

  private updateField(entity: SearchEntityType, index: number, update: (field: SearchFieldPolicy) => SearchFieldPolicy): void {
    this.draft.update(current => {
      if (!current || !current.fields[entity] || !current.fields[entity][index]) return current;
      const rows = current.fields[entity].map((field, row) => row === index ? update(field) : field);
      return { ...current, fields: { ...current.fields, [entity]: rows } };
    });
  }

  private executeMutation(action: PendingMutation): void {
    if (this.mutationPending() || this.savePending() || (action.kind !== 'cancel' && this.activeOperation())) return;
    this.mutationPending.set(true);
    this.mutationError.set(null);
    this.uncertainMutation.set(null);
    const request = action.kind === 'start'
      ? this.management.startJob(action.request)
      : action.kind === 'retry'
        ? this.management.retry(action.jobId, action.request)
        : this.management.cancel(action.jobId);
    this.mutationRequest = request.subscribe({
      next: receipt => {
        this.mutationPending.set(false);
        this.activeJobId.set(receipt.id);
        if (receipt.state === 'CANCELLED') {
          const current = this.activeJob();
          if (current?.id === receipt.id) this.activeJob.set({ ...current, state: 'CANCELLED' });
          this.finishPolling();
        } else {
          this.startPolling(receipt.id);
        }
      },
      error: error => {
        const failure = this.problem(error);
        this.mutationPending.set(false);
        this.mutationError.set(failure);
        if (failure.status === 0 || failure.status >= 500) this.uncertainMutation.set(action);
      }
    });
  }

  private startPolling(jobId: string): void {
    if (this.activeJobId() === jobId && this.pollRequest) return;
    this.pollRequest?.unsubscribe();
    this.pollRequest = undefined;
    this.activeJobId.set(jobId);
    this.pollError.set(null);
    this.pollRequest = timer(0, 10_000).pipe(exhaustMap(() => this.management.job(jobId))).subscribe({
      next: job => {
        this.activeJob.set(job);
        if (this.isTerminal(job)) this.finishPolling();
      },
      error: error => {
        this.pollError.set(this.problem(error));
        this.pollRequest?.unsubscribe();
        this.pollRequest = undefined;
      }
    });
  }

  private finishPolling(): void {
    this.pollRequest?.unsubscribe();
    this.pollRequest = undefined;
    this.activeJobId.set(null);
    this.refreshOperationalData();
  }

  private restoreActiveOperation(current: SearchManagementStatus): void {
    const running = current.jobs.find(job => !this.isTerminal(job));
    if (!running || (this.activeJobId() !== null && this.activeJobId() !== running.id)) return;
    this.activeJob.set(running);
    this.activeJobId.set(running.id);
    if (!this.pollRequest) this.startPolling(running.id);
  }

  private startCooldown(seconds: number): void {
    this.cooldownRequest?.unsubscribe();
    this.previewCooldownSeconds.set(seconds);
    if (seconds === 0) return;
    this.cooldownRequest = timer(1000, 1000).subscribe(() => {
      const remaining = Math.max(0, this.previewCooldownSeconds() - 1);
      this.previewCooldownSeconds.set(remaining);
      if (remaining === 0) {
        this.cooldownRequest?.unsubscribe();
        this.cooldownRequest = undefined;
      }
    });
  }

  private cloneSnapshot(snapshot: SearchSettingsSnapshot): SearchSettingsSnapshot {
    return cloneSearchSnapshot(snapshot);
  }

  private clonePolicy(policy: SearchQueryPolicy): SearchQueryPolicy {
    return cloneSearchPolicy(policy);
  }

  private newRequestId(): string {
    return globalThis.crypto.randomUUID();
  }

  private problem(error: unknown): ProblemDetail {
    return toProblemDetail(error, this.i18n.translate('common.error'), this.i18n.translate('settings.search.error.request_failed'));
  }
}
