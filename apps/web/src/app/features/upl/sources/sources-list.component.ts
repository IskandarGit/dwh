import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ProblemDetail } from '../../../core/models/common.models';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { UiBadgeComponent } from '../../../shared/ui/ui-badge.component';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import {
  UPL_PERIODICITIES,
  UPL_STRICTNESSES,
  UplApiService,
  UplPeriodicity,
  UplSourceItem,
  UplSourceRequest,
  UplStrictness
} from '../upl-api';
import { UPL_PERIODICITY_KEY, UPL_STRICTNESS_KEY, uplErrorKey } from '../upl-labels';

/** Модель окна «Новый источник»: обычный объект, чтобы работал `[(ngModel)]`. */
interface SourceCreateForm {
  code: string;
  name: string;
  ownerOrg: string;
  ownerContact: string;
  periodicity: UplPeriodicity;
  slaDays: number | null;
  reconciliationStrictness: UplStrictness;
}

const PAGE_SIZE = 50;
const CODE_PATTERN = /^[a-z][a-z0-9._-]{1,62}$/;
const NAME_MAX_LENGTH = 200;
const SLA_MIN = 0;
const SLA_MAX = 366;

function emptyForm(): SourceCreateForm {
  return {
    code: '',
    name: '',
    ownerOrg: '',
    ownerContact: '',
    periodicity: 'month',
    slaDays: 0,
    reconciliationStrictness: 'error'
  };
}

@Component({
  selector: 'app-upl-sources-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TranslatePipe,
    UiButtonComponent,
    UiModalComponent,
    UiBadgeComponent
  ],
  template: `
    <div class="upl-page">
      <div class="toolbar upl-toolbar">
        <h1 class="upl-title">
          {{ 'upl.list.title' | t }}
          @if (!isLoading() && !loadError()) {
            <span class="upl-count">{{ items().length }}</span>
          }
        </h1>
        @if (canCreate()) {
          <ui-button variant="primary" icon="add" data-testid="upl-new-source" (onClick)="openCreate()">
            {{ 'upl.list.new' | t }}
          </ui-button>
        }
      </div>

      @if (loadError()) {
        <div class="alert alert-error upl-alert" role="alert" data-testid="upl-load-error">
          <span>{{ 'upl.list.load_error' | t }}</span>
          <ui-button variant="secondary" data-testid="upl-retry" (onClick)="load()">
            {{ 'upl.common.retry' | t }}
          </ui-button>
        </div>
      } @else if (isLoading()) {
        <div class="table-card">
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{{ 'upl.list.col.code' | t }}</th>
                  <th>{{ 'upl.list.col.name' | t }}</th>
                  <th>{{ 'upl.list.col.periodicity' | t }}</th>
                  <th>{{ 'upl.list.col.published_version' | t }}</th>
                  <th>{{ 'upl.list.col.draft' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (row of skeletonRows; track row) {
                  <tr data-testid="upl-skeleton">
                    <td colspan="5"><span class="upl-skeleton-bar"></span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      } @else if (items().length === 0) {
        <div class="upl-empty" data-testid="upl-empty">
          <span class="material-symbols-outlined upl-empty-icon" aria-hidden="true">table_view</span>
          <p class="upl-empty-text">{{ 'upl.list.empty' | t }}</p>
          @if (canCreate()) {
            <ui-button variant="primary" data-testid="upl-empty-new" (onClick)="openCreate()">
              {{ 'upl.list.new' | t }}
            </ui-button>
          }
        </div>
      } @else {
        <div class="table-card">
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{{ 'upl.list.col.code' | t }}</th>
                  <th>{{ 'upl.list.col.name' | t }}</th>
                  <th>{{ 'upl.list.col.periodicity' | t }}</th>
                  <th>{{ 'upl.list.col.published_version' | t }}</th>
                  <th>{{ 'upl.list.col.draft' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (item of items(); track item.id) {
                  <tr data-testid="upl-source-row">
                    <td><code class="upl-code">{{ item.code }}</code></td>
                    <td><a class="upl-link" [routerLink]="['/upl/sources', item.id]">{{ item.name }}</a></td>
                    <td>{{ periodicityKey[item.periodicity] | t }}</td>
                    <td>{{ item.lastPublishedVersion ?? '—' }}</td>
                    <td>
                      @if (item.hasDraft) {
                        <ui-badge variant="info">{{ 'upl.list.has_draft' | t }}</ui-badge>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
        @if (hasMore()) {
          <div class="upl-more">
            <ui-button
              variant="secondary"
              [loading]="isLoadingMore()"
              data-testid="upl-more"
              (onClick)="loadMore()"
            >{{ 'upl.list.more' | t }}</ui-button>
          </div>
        }
      }
    </div>

    <ui-modal
      [isOpen]="isCreateOpen()"
      [title]="'upl.source.new_title' | t"
      size="md"
      [hasFooter]="true"
      (close)="closeCreate()"
    >
      <form body id="upl-source-create" class="upl-form" (ngSubmit)="submitCreate()" novalidate>
        @if (createError()) {
          <div class="alert alert-error upl-alert" role="alert" data-testid="upl-create-error">
            {{ createError()! | t }}
          </div>
        }

        <div class="form-group">
          <label class="form-label" for="upl-source-code">{{ 'upl.source.field.code' | t }}</label>
          <input
            class="form-input"
            id="upl-source-code"
            name="code"
            type="text"
            maxlength="63"
            [(ngModel)]="form.code"
          />
          <span class="upl-hint">{{ 'upl.source.hint.code' | t }}</span>
          @if (fieldErrors()['code']) {
            <span class="upl-field-error" data-testid="upl-err-code">{{ fieldErrors()['code'] | t }}</span>
          }
        </div>

        <div class="form-group">
          <label class="form-label" for="upl-source-name">{{ 'upl.source.field.name' | t }}</label>
          <input
            class="form-input"
            id="upl-source-name"
            name="name"
            type="text"
            maxlength="200"
            [(ngModel)]="form.name"
          />
          <span class="upl-hint">{{ 'upl.source.hint.name' | t }}</span>
          @if (fieldErrors()['name']) {
            <span class="upl-field-error" data-testid="upl-err-name">{{ fieldErrors()['name'] | t }}</span>
          }
        </div>

        <div class="form-group">
          <label class="form-label" for="upl-source-owner-org">{{ 'upl.source.field.owner_org' | t }}</label>
          <input
            class="form-input"
            id="upl-source-owner-org"
            name="ownerOrg"
            type="text"
            maxlength="200"
            [(ngModel)]="form.ownerOrg"
          />
          <span class="upl-hint">{{ 'upl.source.hint.owner_org' | t }}</span>
          @if (fieldErrors()['ownerOrg']) {
            <span class="upl-field-error" data-testid="upl-err-owner-org">{{ fieldErrors()['ownerOrg'] | t }}</span>
          }
        </div>

        <div class="form-group">
          <label class="form-label" for="upl-source-owner-contact">{{ 'upl.source.field.owner_contact' | t }}</label>
          <input
            class="form-input"
            id="upl-source-owner-contact"
            name="ownerContact"
            type="text"
            maxlength="200"
            [(ngModel)]="form.ownerContact"
          />
          <span class="upl-hint">{{ 'upl.source.hint.owner_contact' | t }}</span>
          @if (fieldErrors()['ownerContact']) {
            <span class="upl-field-error" data-testid="upl-err-owner-contact">{{ fieldErrors()['ownerContact'] | t }}</span>
          }
        </div>

        <div class="form-group">
          <label class="form-label" for="upl-source-periodicity">{{ 'upl.source.field.periodicity' | t }}</label>
          <select
            class="form-select"
            id="upl-source-periodicity"
            name="periodicity"
            [(ngModel)]="form.periodicity"
          >
            @for (option of periodicities; track option) {
              <option [value]="option">{{ periodicityKey[option] | t }}</option>
            }
          </select>
          <span class="upl-hint">{{ 'upl.source.hint.periodicity' | t }}</span>
        </div>

        <div class="form-group">
          <label class="form-label" for="upl-source-sla-days">{{ 'upl.source.field.sla_days' | t }}</label>
          <input
            class="form-input"
            id="upl-source-sla-days"
            name="slaDays"
            type="number"
            min="0"
            max="366"
            step="1"
            [(ngModel)]="form.slaDays"
          />
          <span class="upl-hint">{{ 'upl.source.hint.sla_days' | t }}</span>
          @if (fieldErrors()['slaDays']) {
            <span class="upl-field-error" data-testid="upl-err-sla-days">{{ fieldErrors()['slaDays'] | t }}</span>
          }
        </div>

        <div class="form-group">
          <label class="form-label" for="upl-source-strictness">{{ 'upl.source.field.strictness' | t }}</label>
          <select
            class="form-select"
            id="upl-source-strictness"
            name="reconciliationStrictness"
            [(ngModel)]="form.reconciliationStrictness"
          >
            @for (option of strictnesses; track option) {
              <option [value]="option">{{ strictnessKey[option] | t }}</option>
            }
          </select>
          <span class="upl-hint">{{ 'upl.source.hint.strictness' | t }}</span>
        </div>
      </form>

      <div footer class="upl-modal-footer">
        <ui-button variant="secondary" data-testid="upl-create-cancel" (onClick)="closeCreate()">
          {{ 'upl.common.cancel' | t }}
        </ui-button>
        <ui-button
          variant="primary"
          type="submit"
          form="upl-source-create"
          [loading]="isSaving()"
          data-testid="upl-create-submit"
        >{{ 'upl.source.create' | t }}</ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    .upl-page {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .upl-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .upl-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0;
      font-family: var(--font-family);
      font-size: 1.25rem;
      color: var(--text-main);
    }

    .upl-count {
      padding: 0.125rem 0.5rem;
      border-radius: var(--radius-sm);
      background: var(--bg-hover);
      color: var(--text-muted);
      font-size: 0.875rem;
    }

    .upl-alert {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .upl-code {
      font-family: monospace;
      color: var(--text-main);
    }

    .upl-link {
      color: var(--primary);
      text-decoration: none;
    }

    .upl-link:hover {
      text-decoration: underline;
    }

    .upl-skeleton-bar {
      display: block;
      height: 1rem;
      border-radius: var(--radius-sm);
      background: var(--bg-hover);
      animation: upl-skeleton-pulse 1.2s ease-in-out infinite;
    }

    @keyframes upl-skeleton-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .upl-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      padding: 3rem 1rem;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      background: var(--bg-surface);
    }

    .upl-empty-icon {
      font-size: 2.5rem;
      color: var(--text-light);
    }

    .upl-empty-text {
      margin: 0;
      color: var(--text-muted);
    }

    .upl-more {
      display: flex;
      justify-content: center;
    }

    .upl-form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .upl-hint {
      display: block;
      margin-top: 0.25rem;
      color: var(--text-muted);
      font-size: 0.8125rem;
    }

    .upl-field-error {
      display: block;
      margin-top: 0.25rem;
      color: var(--danger);
      font-size: 0.8125rem;
    }

    .upl-modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }
  `]
})
export class SourcesListComponent implements OnInit {
  private readonly api = inject(UplApiService);
  private readonly permissions = inject(PermissionService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);

  readonly items = signal<UplSourceItem[]>([]);
  readonly isLoading = signal(true);
  readonly isLoadingMore = signal(false);
  readonly loadError = signal(false);
  readonly nextCursor = signal<string | null>(null);
  readonly hasMore = signal(false);
  readonly isCreateOpen = signal(false);
  readonly isSaving = signal(false);
  /** Значение — ключ i18n либо готовый текст сервера; в шаблоне всё равно идёт через `| t`. */
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly createError = signal<string | null>(null);

  readonly skeletonRows = [1, 2, 3, 4, 5];
  readonly periodicities = UPL_PERIODICITIES;
  readonly strictnesses = UPL_STRICTNESSES;
  readonly periodicityKey = UPL_PERIODICITY_KEY;
  readonly strictnessKey = UPL_STRICTNESS_KEY;

  form: SourceCreateForm = emptyForm();

  ngOnInit(): void {
    this.load();
  }

  canCreate(): boolean {
    return this.permissions.hasPermission('upl.sources', 'create');
  }

  load(): void {
    this.isLoading.set(true);
    this.loadError.set(false);
    this.items.set([]);
    this.nextCursor.set(null);
    this.hasMore.set(false);
    this.api.listSources(PAGE_SIZE).subscribe({
      next: page => {
        this.items.set(page?.items ?? []);
        this.nextCursor.set(page?.nextCursor ?? null);
        this.hasMore.set(page?.hasMore === true);
        this.isLoading.set(false);
      },
      error: () => {
        this.loadError.set(true);
        this.isLoading.set(false);
      }
    });
  }

  loadMore(): void {
    if (this.isLoadingMore() || !this.hasMore()) {
      return;
    }
    this.isLoadingMore.set(true);
    this.api.listSources(PAGE_SIZE, this.nextCursor()).subscribe({
      next: page => {
        this.items.update(current => [...current, ...(page?.items ?? [])]);
        this.nextCursor.set(page?.nextCursor ?? null);
        this.hasMore.set(page?.hasMore === true);
        this.isLoadingMore.set(false);
      },
      error: () => {
        this.isLoadingMore.set(false);
        this.toast.error(this.i18n.translate('upl.list.load_error'));
      }
    });
  }

  openCreate(): void {
    this.form = emptyForm();
    this.fieldErrors.set({});
    this.createError.set(null);
    this.isSaving.set(false);
    this.isCreateOpen.set(true);
  }

  closeCreate(): void {
    this.isCreateOpen.set(false);
  }

  submitCreate(): void {
    if (this.isSaving()) {
      return;
    }
    const errors = this.validateForm();
    this.fieldErrors.set(errors);
    this.createError.set(null);
    if (Object.keys(errors).length > 0) {
      return;
    }
    const contact = this.form.ownerContact.trim();
    const body: UplSourceRequest = {
      code: this.form.code.trim(),
      name: this.form.name.trim(),
      ownerOrg: this.form.ownerOrg.trim(),
      ownerContact: contact.length > 0 ? contact : null,
      periodicity: this.form.periodicity,
      slaDays: Number(this.form.slaDays),
      sourceType: 'file',
      reconciliationStrictness: this.form.reconciliationStrictness,
      lockVersion: null
    };
    this.isSaving.set(true);
    this.api.createSource(body).subscribe({
      next: created => {
        this.isSaving.set(false);
        this.isCreateOpen.set(false);
        this.toast.success(this.i18n.translate('upl.source.created'));
        void this.router.navigate(['/upl/sources', created.id]);
      },
      error: (problem: ProblemDetail) => {
        this.isSaving.set(false);
        this.handleCreateError(problem);
      }
    });
  }

  private validateForm(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!CODE_PATTERN.test(this.form.code.trim())) {
      errors['code'] = 'upl.source.err.code_format';
    }
    const name = this.form.name.trim();
    if (name.length === 0) {
      errors['name'] = 'upl.source.err.required';
    } else if (name.length > NAME_MAX_LENGTH) {
      errors['name'] = 'upl.source.err.name_length';
    }
    if (this.form.ownerOrg.trim().length === 0) {
      errors['ownerOrg'] = 'upl.source.err.required';
    }
    const slaDays = Number(this.form.slaDays);
    if (this.form.slaDays === null || !Number.isInteger(slaDays) || slaDays < SLA_MIN || slaDays > SLA_MAX) {
      errors['slaDays'] = 'upl.source.err.sla_range';
    }
    return errors;
  }

  private handleCreateError(problem: ProblemDetail): void {
    if (problem?.status === 422) {
      const errors: Record<string, string> = {};
      for (const param of problem.invalid_params ?? []) {
        errors[param.name] = param.reason;
      }
      this.fieldErrors.set(errors);
      this.createError.set('upl.err.VALIDATION_FAILED');
      return;
    }
    if (problem?.detail === 'UPL_SOURCE_CODE_TAKEN') {
      this.fieldErrors.set({ code: 'upl.err.UPL_SOURCE_CODE_TAKEN' });
      return;
    }
    this.createError.set(this.problemText(problem));
  }

  /** Неизвестный код ошибки не прячем: показываем подкод и код каркаса. */
  private problemText(problem: ProblemDetail): string {
    const detail = problem?.detail ?? '';
    const key = uplErrorKey(detail);
    const text = this.i18n.translate(key);
    return text === key ? `${detail} (${problem?.code ?? ''})` : text;
  }
}
