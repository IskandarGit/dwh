import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProblemDetail } from '../../../core/models/common.models';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { UiBadgeComponent } from '../../../shared/ui/ui-badge.component';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UplSourceItem } from '../upl-api';
import { PackageCardComponent } from './package-card.component';
import { UplPackageItem, UplPackagesApiService } from './packages-api';
import { UplPackageFormErrors, UplTranslate, mapUplUploadProblem } from './packages-errors';
import {
  UPL_PACKAGE_STATUS_KEY,
  UPL_PACKAGE_STATUS_VARIANT,
  formatUplDateTime,
  formatUplPeriod,
  uplPackageRowsText
} from './packages-labels';

/** Поля формы «Новая загрузка»: обычный объект, чтобы работал `[(ngModel)]`. */
interface PackageUploadForm {
  sourceId: number | null;
  periodFrom: string;
  periodTo: string;
  file: File | null;
}

const PAGE_SIZE = 50;

function emptyForm(): PackageUploadForm {
  return { sourceId: null, periodFrom: '', periodTo: '', file: null };
}

function emptyFormErrors(): UplPackageFormErrors {
  return { source: [], period: [], file: [], form: [] };
}

@Component({
  selector: 'app-upl-packages',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, TranslatePipe, UiBadgeComponent, UiButtonComponent, PackageCardComponent],
  template: `
    @if (selected(); as current) {
      <app-upl-package-card
        [item]="current"
        [canApply]="canApply()"
        (back)="closeCard()"
        (refresh)="load()"
        (applied)="onApplied($event)"
      ></app-upl-package-card>
    } @else {
      <div class="upl-page">
        <div class="toolbar upl-toolbar">
          <h1 class="upl-title">{{ 'upl.pkg.title' | t }}</h1>
          <ui-button variant="secondary" icon="refresh" data-testid="upl-pkg-refresh" (onClick)="load()">
            {{ 'upl.pkg.refresh' | t }}
          </ui-button>
        </div>

        @if (canUpload()) {
          <form class="upl-pkg-form" data-testid="upl-pkg-form" (ngSubmit)="submit()" novalidate>
            <h2 class="upl-pkg-form-title">{{ 'upl.pkg.form.title' | t }}</h2>

            @if (sourcesError()) {
              <div class="alert alert-error upl-alert" role="alert" data-testid="upl-pkg-sources-error">
                <span>{{ 'upl.pkg.load_error' | t }}</span>
                <ui-button variant="secondary" data-testid="upl-pkg-sources-retry" (onClick)="loadSources()">
                  {{ 'upl.common.retry' | t }}
                </ui-button>
              </div>
            }

            @if (formErrors().form.length > 0) {
              <div class="alert alert-error upl-pkg-err-form" role="alert" data-testid="upl-pkg-err-form">
                @for (message of formErrors().form; track $index) {
                  <span class="upl-pkg-err-line">{{ message }}</span>
                }
              </div>
            }

            <div class="upl-pkg-fields">
              <div class="form-group">
                <label class="form-label" for="upl-pkg-source-field">{{ 'upl.pkg.form.source' | t }}</label>
                <select
                  class="form-select"
                  id="upl-pkg-source-field"
                  name="sourceId"
                  data-testid="upl-pkg-source"
                  [disabled]="isSending()"
                  [(ngModel)]="form.sourceId"
                >
                  <option [ngValue]="null">{{ 'upl.pkg.form.source_placeholder' | t }}</option>
                  @for (source of sources(); track source.id) {
                    <option [ngValue]="source.id">{{ source.code }} — {{ source.name }}</option>
                  }
                </select>
                @if (formErrors().source.length > 0) {
                  <span class="upl-field-error" data-testid="upl-pkg-err-source">
                    @for (message of formErrors().source; track $index) {
                      <span class="upl-pkg-err-line">{{ message }}</span>
                    }
                  </span>
                }
              </div>

              <div class="form-group">
                <label class="form-label" for="upl-pkg-period-from-field">{{ 'upl.pkg.form.period_from' | t }}</label>
                <input
                  class="form-input"
                  id="upl-pkg-period-from-field"
                  name="periodFrom"
                  type="date"
                  data-testid="upl-pkg-period-from"
                  [disabled]="isSending()"
                  [(ngModel)]="form.periodFrom"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="upl-pkg-period-to-field">{{ 'upl.pkg.form.period_to' | t }}</label>
                <input
                  class="form-input"
                  id="upl-pkg-period-to-field"
                  name="periodTo"
                  type="date"
                  data-testid="upl-pkg-period-to"
                  [disabled]="isSending()"
                  [(ngModel)]="form.periodTo"
                />
                @if (formErrors().period.length > 0) {
                  <span class="upl-field-error" data-testid="upl-pkg-err-period">
                    @for (message of formErrors().period; track $index) {
                      <span class="upl-pkg-err-line">{{ message }}</span>
                    }
                  </span>
                }
              </div>

              <div class="form-group">
                <label class="form-label" for="upl-pkg-file-field">{{ 'upl.pkg.form.file' | t }}</label>
                <input
                  #fileInput
                  class="form-input"
                  id="upl-pkg-file-field"
                  type="file"
                  accept=".xlsx"
                  data-testid="upl-pkg-file"
                  [disabled]="isSending()"
                  (change)="pickFile($event)"
                />
                @if (formErrors().file.length > 0) {
                  <span class="upl-field-error" data-testid="upl-pkg-err-file">
                    @for (message of formErrors().file; track $index) {
                      <span class="upl-pkg-err-line">{{ message }}</span>
                    }
                  </span>
                }
              </div>
            </div>

            <div class="upl-pkg-form-actions">
              <ui-button
                variant="primary"
                [disabled]="!isReady()"
                [loading]="isSending()"
                data-testid="upl-pkg-submit"
                (onClick)="submit()"
              >{{ 'upl.pkg.form.submit' | t }}</ui-button>
            </div>
          </form>
        }

        @if (loadError()) {
          <div class="alert alert-error upl-alert" role="alert" data-testid="upl-pkg-load-error">
            <span>{{ 'upl.pkg.load_error' | t }}</span>
            <ui-button variant="secondary" data-testid="upl-pkg-retry" (onClick)="load()">
              {{ 'upl.common.retry' | t }}
            </ui-button>
          </div>
        } @else if (isLoading()) {
          <div class="table-card">
            <div class="table-scroll">
              <table>
                <tbody>
                  @for (row of skeletonRows; track row) {
                    <tr data-testid="upl-pkg-skeleton">
                      <td><span class="upl-pkg-skeleton-bar"></span></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        } @else if (items().length === 0) {
          <div class="upl-empty" data-testid="upl-pkg-empty">
            <span class="material-symbols-outlined upl-empty-icon" aria-hidden="true">upload_file</span>
            <p class="upl-empty-text">{{ (canUpload() ? 'upl.pkg.empty_hint' : 'upl.pkg.empty') | t }}</p>
          </div>
        } @else {
          <div class="table-card">
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{{ 'upl.pkg.col.uploaded_at' | t }}</th>
                    <th>{{ 'upl.pkg.col.source' | t }}</th>
                    <th>{{ 'upl.pkg.col.period' | t }}</th>
                    <th>{{ 'upl.pkg.col.file' | t }}</th>
                    <th>{{ 'upl.pkg.col.status' | t }}</th>
                    <th>{{ 'upl.pkg.col.rows' | t }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of items(); track item.id) {
                    <tr
                      class="upl-pkg-row"
                      data-testid="upl-pkg-row"
                      tabindex="0"
                      (click)="openCard(item)"
                      (keydown.enter)="openCard(item)"
                    >
                      <td>{{ dateTime(item.uploadedAt) }}</td>
                      <td>{{ item.sourceName }}</td>
                      <td>{{ period(item) }}</td>
                      <td>{{ item.fileName }}</td>
                      <td>
                        <ui-badge
                          [variant]="statusVariant[item.status]"
                          [attr.title]="item.status === 'received' ? ('upl.pkg.status.received_hint' | t) : null"
                        >{{ statusKey[item.status] | t }}</ui-badge>
                      </td>
                      <td>{{ rowsText(item) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
          @if (hasMore() && nextCursor() !== null) {
            <div class="upl-more">
              <ui-button
                variant="secondary"
                [loading]="isLoadingMore()"
                data-testid="upl-pkg-more"
                (onClick)="loadMore()"
              >{{ 'upl.pkg.more' | t }}</ui-button>
            </div>
          }
        }
      </div>
    }
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
      margin: 0;
      font-family: var(--font-family);
      font-size: 1.25rem;
      color: var(--text-main);
    }

    .upl-pkg-form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      background: var(--bg-surface);
    }

    .upl-pkg-form-title {
      margin: 0;
      font-family: var(--font-family);
      font-size: 1rem;
      color: var(--text-main);
    }

    .upl-pkg-fields {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .upl-pkg-fields .form-group {
      flex: 1 1 12rem;
      min-width: 12rem;
    }

    .upl-pkg-form-actions {
      display: flex;
      justify-content: flex-end;
    }

    .upl-pkg-err-form {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .upl-pkg-err-line {
      display: block;
    }

    .upl-field-error {
      display: block;
      margin-top: 0.25rem;
      color: var(--danger);
      font-size: 0.8125rem;
    }

    .upl-alert {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .upl-pkg-row {
      cursor: pointer;
    }

    .upl-pkg-row:hover {
      background: var(--bg-hover);
    }

    .upl-pkg-row:focus-visible {
      outline: 2px solid var(--focus-ring, var(--primary));
      outline-offset: -2px;
    }

    .upl-pkg-skeleton-bar {
      display: block;
      height: 1rem;
      border-radius: var(--radius-sm);
      background: var(--bg-hover);
      animation: upl-pkg-skeleton-pulse 1.2s ease-in-out infinite;
    }

    @keyframes upl-pkg-skeleton-pulse {
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
  `]
})
export class PackagesComponent implements OnInit {
  private readonly api = inject(UplPackagesApiService);
  private readonly permissions = inject(PermissionService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  readonly items = signal<UplPackageItem[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly hasMore = signal(false);
  readonly isLoading = signal(true);
  readonly isLoadingMore = signal(false);
  readonly loadError = signal(false);
  readonly selected = signal<UplPackageItem | null>(null);

  readonly sources = signal<UplSourceItem[]>([]);
  readonly sourcesError = signal(false);
  readonly isSending = signal(false);
  readonly formErrors = signal<UplPackageFormErrors>(emptyFormErrors());

  readonly skeletonRows = [1, 2, 3, 4, 5];
  readonly statusKey = UPL_PACKAGE_STATUS_KEY;
  readonly statusVariant = UPL_PACKAGE_STATUS_VARIANT;

  form: PackageUploadForm = emptyForm();

  private readonly translate: UplTranslate = (key, params) => this.i18n.translate(key, params);

  ngOnInit(): void {
    this.load();
    if (this.canUpload()) {
      this.loadSources();
    }
  }

  canUpload(): boolean {
    return this.permissions.hasPermission('upl.packages', 'upload');
  }

  canApply(): boolean {
    return this.permissions.hasPermission('upl.packages', 'apply');
  }

  /** Ответ «Применить» сразу показывается в карточке; список перечитывается, чтобы статус совпал и там. */
  onApplied(result: UplPackageItem): void {
    this.selected.set(result);
    this.load();
  }

  dateTime(value: string): string {
    return formatUplDateTime(value);
  }

  period(item: UplPackageItem): string {
    return formatUplPeriod(item.periodFrom, item.periodTo);
  }

  rowsText(item: UplPackageItem): string {
    return uplPackageRowsText(item);
  }

  /** Источники формы: весь список одним запросом-цепочкой, без него выбрать нечего. */
  loadSources(): void {
    this.sourcesError.set(false);
    this.api.allSources().subscribe({
      next: list => this.sources.set(list ?? []),
      error: () => {
        this.sources.set([]);
        this.sourcesError.set(true);
      }
    });
  }

  load(): void {
    this.isLoading.set(true);
    this.loadError.set(false);
    this.items.set([]);
    this.nextCursor.set(null);
    this.hasMore.set(false);
    this.api.list(PAGE_SIZE).subscribe({
      next: page => {
        const loaded = page?.items ?? [];
        this.items.set(loaded);
        this.nextCursor.set(page?.nextCursor ?? null);
        this.hasMore.set(page?.hasMore === true);
        this.isLoading.set(false);
        this.syncSelected(loaded);
      },
      error: () => {
        this.loadError.set(true);
        this.isLoading.set(false);
      }
    });
  }

  loadMore(): void {
    if (this.isLoadingMore() || !this.hasMore() || this.nextCursor() === null) {
      return;
    }
    this.isLoadingMore.set(true);
    this.api.list(PAGE_SIZE, this.nextCursor()).subscribe({
      next: page => {
        this.items.update(current => [...current, ...(page?.items ?? [])]);
        this.nextCursor.set(page?.nextCursor ?? null);
        this.hasMore.set(page?.hasMore === true);
        this.isLoadingMore.set(false);
      },
      error: () => {
        this.isLoadingMore.set(false);
        this.toast.error(this.i18n.translate('upl.pkg.load_error'));
      }
    });
  }

  pickFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.form.file = input.files && input.files.length > 0 ? input.files[0] : null;
  }

  /** Кнопка «Загрузить» оживает, только когда заполнены все четыре поля. */
  isReady(): boolean {
    return (
      !this.isSending() &&
      this.form.sourceId !== null &&
      this.form.periodFrom.length > 0 &&
      this.form.periodTo.length > 0 &&
      this.form.file !== null
    );
  }

  submit(): void {
    if (!this.isReady()) {
      return;
    }
    const file = this.form.file as File;
    this.isSending.set(true);
    this.formErrors.set(emptyFormErrors());
    this.api
      .upload({
        sourceId: Number(this.form.sourceId),
        periodFrom: this.form.periodFrom,
        periodTo: this.form.periodTo,
        file
      })
      .subscribe({
        next: () => {
          this.isSending.set(false);
          this.clearFile();
          this.toast.success(this.i18n.translate('upl.pkg.toast.accepted'));
          this.load();
        },
        error: (problem: ProblemDetail) => {
          this.isSending.set(false);
          this.formErrors.set(mapUplUploadProblem(problem, this.translate));
        }
      });
  }

  openCard(item: UplPackageItem): void {
    this.selected.set(item);
  }

  closeCard(): void {
    this.selected.set(null);
  }

  /** После успеха чистим только файл: источник и период нужны для следующего файла. */
  private clearFile(): void {
    this.form.file = null;
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  /** Открытая карточка подхватывает свежие данные списка; пропала из порции — остаётся как была. */
  private syncSelected(loaded: UplPackageItem[]): void {
    const current = this.selected();
    if (current === null) {
      return;
    }
    const fresh = loaded.find(item => item.id === current.id);
    if (fresh) {
      this.selected.set(fresh);
    }
  }
}
