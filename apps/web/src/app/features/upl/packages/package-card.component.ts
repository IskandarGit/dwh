import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal
} from '@angular/core';
import { ProblemDetail } from '../../../core/models/common.models';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { UiBadgeComponent } from '../../../shared/ui/ui-badge.component';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { uplErrorKey } from '../upl-labels';
import { UplPackageErrorItem, UplPackageErrors, UplPackageItem, UplPackagesApiService } from './packages-api';
import { UplTranslate, uplPackageCodeText } from './packages-errors';
import {
  UPL_PACKAGE_STATUS_KEY,
  UPL_PACKAGE_STATUS_VARIANT,
  formatUplDateTime,
  formatUplPeriod
} from './packages-labels';

/** Подкод ответа, при котором показываем «Загрузка не найдена», а не общий текст сбоя. */
const NOT_FOUND = 'UPL_PKG_NOT_FOUND';

@Component({
  selector: 'app-upl-package-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, TranslatePipe, UiBadgeComponent, UiButtonComponent],
  template: `
    <div class="upl-pkg-card">
      <div class="upl-pkg-card-head">
        <ui-button variant="ghost" data-testid="upl-pkg-back" (onClick)="back.emit()">
          {{ 'upl.pkg.card.back' | t }}
        </ui-button>
        <ui-button variant="secondary" icon="refresh" data-testid="upl-pkg-card-refresh" (onClick)="refresh.emit()">
          {{ 'upl.pkg.refresh' | t }}
        </ui-button>
        @if (item.status === 'verified' && canApply && (item.rowsAccepted ?? 0) > 0) {
          <ui-button variant="primary" data-testid="upl-pkg-apply" [disabled]="applying()" (onClick)="apply()">
            {{ 'upl.pkg.card.apply' | t }}
          </ui-button>
        }
      </div>

      <div class="upl-pkg-card-title">
        <span class="upl-pkg-file">{{ item.fileName }}</span>
        <ui-badge [variant]="statusVariant[item.status]">{{ statusKey[item.status] | t }}</ui-badge>
      </div>
      <div class="upl-pkg-card-meta" data-testid="upl-pkg-card-meta">{{ metaText() }}</div>
      @if (applyError(); as message) {
        <div class="alert alert-error upl-pkg-alert" data-testid="upl-pkg-apply-error">{{ message }}</div>
      }

      @if (item.status === 'received') {
        <p class="upl-pkg-checking" data-testid="upl-pkg-checking">{{ 'upl.pkg.card.checking' | t }}</p>
      } @else {
        @if (item.status === 'rejected') {
          <div class="alert alert-error upl-pkg-rejected" role="alert" data-testid="upl-pkg-rejected">
            <strong>{{ 'upl.pkg.card.rejected' | t }}</strong>
            <span class="upl-pkg-reject-reason">{{ rejectText() }}</span>
            @for (row of structRows(); track $index) {
              <span class="upl-pkg-struct-row" data-testid="upl-pkg-struct-row">{{ codeText(row) }}</span>
            }
            <span class="upl-pkg-hint">{{ 'upl.pkg.card.rejected_hint' | t }}</span>
          </div>
        } @else {
          <div class="upl-pkg-counters" data-testid="upl-pkg-counters">
            <span class="upl-pkg-counter">
              <span class="upl-pkg-counter-label">{{ 'upl.pkg.card.rows_total' | t }}</span>
              <span class="upl-pkg-counter-value">{{ item.rowsTotal ?? '—' }}</span>
            </span>
            <span class="upl-pkg-counter">
              <span class="upl-pkg-counter-label">{{ 'upl.pkg.card.rows_accepted' | t }}</span>
              <span class="upl-pkg-counter-value">{{ item.rowsAccepted ?? '—' }}</span>
            </span>
            <span class="upl-pkg-counter">
              <span class="upl-pkg-counter-label">{{ 'upl.pkg.card.rows_rejected' | t }}</span>
              <span class="upl-pkg-counter-value">{{ item.rowsRejected ?? '—' }}</span>
            </span>
          </div>
          @if (reconciliationText(); as line) {
            <div class="alert alert-success upl-pkg-reconciliation" data-testid="upl-pkg-reconciliation">{{ line }}</div>
          }
        }

        @if (loadError()) {
          <div class="alert alert-error upl-pkg-alert" role="alert" data-testid="upl-pkg-errors-load-error">
            <span>{{ loadError() }}</span>
            <ui-button variant="secondary" data-testid="upl-pkg-errors-retry" (onClick)="reloadErrors()">
              {{ 'upl.common.retry' | t }}
            </ui-button>
          </div>
        } @else if (isLoading()) {
          <div class="table-card">
            <div class="table-scroll">
              <table>
                <tbody>
                  @for (row of skeletonRows; track row) {
                    <tr data-testid="upl-pkg-errors-skeleton">
                      <td><span class="upl-pkg-skeleton-bar"></span></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        } @else if (item.status !== 'rejected') {
          @if (errors(); as loaded) {
            @if (loaded.total === 0) {
              <p class="upl-pkg-no-errors" data-testid="upl-pkg-no-errors">{{ 'upl.pkg.card.no_errors' | t }}</p>
            } @else {
              @if (loaded.total > loaded.shown) {
                <p class="upl-pkg-shown" data-testid="upl-pkg-errors-shown">
                  {{ 'upl.pkg.errors.shown_first' | t: { shown: loaded.shown, n: loaded.total } }}
                </p>
              }
              <div class="table-card">
                <div class="table-scroll">
                  <table data-testid="upl-pkg-errors-table">
                    <thead>
                      <tr>
                        <th>{{ 'upl.pkg.errors.col.sheet' | t }}</th>
                        <th>{{ 'upl.pkg.errors.col.row' | t }}</th>
                        <th>{{ 'upl.pkg.errors.col.column' | t }}</th>
                        <th>{{ 'upl.pkg.errors.col.value' | t }}</th>
                        <th>{{ 'upl.pkg.errors.col.what' | t }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of cellRows(); track $index) {
                        <tr data-testid="upl-pkg-error-row">
                          <td>{{ row.sheet ?? '—' }}</td>
                          <td>{{ row.rowNo }}</td>
                          <td>{{ row.columnName ?? '—' }}</td>
                          <td><code class="upl-pkg-value" [title]="row.value ?? ''">{{ row.value ?? '—' }}</code></td>
                          <td>{{ codeText(row) }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }
          }
        }
      }
    </div>
  `,
  styles: [`
    .upl-pkg-card {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .upl-pkg-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .upl-pkg-card-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .upl-pkg-file {
      font-family: var(--font-family);
      font-size: 1.25rem;
      color: var(--text-main);
    }

    .upl-pkg-card-meta {
      color: var(--text-muted);
      font-size: 0.875rem;
    }

    .upl-pkg-checking {
      margin: 0;
      color: var(--text-muted);
    }

    .upl-pkg-counters {
      display: flex;
      gap: 2rem;
    }

    .upl-pkg-counter {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .upl-pkg-counter-label {
      color: var(--text-muted);
      font-size: 0.8125rem;
    }

    .upl-pkg-counter-value {
      font-size: 1.25rem;
      color: var(--text-main);
    }

    .upl-pkg-rejected {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .upl-pkg-hint {
      color: var(--text-muted);
      font-size: 0.8125rem;
    }

    .upl-pkg-alert {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .upl-pkg-no-errors,
    .upl-pkg-shown {
      margin: 0;
      color: var(--text-muted);
    }

    .upl-pkg-value {
      display: inline-block;
      max-width: 14rem;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      vertical-align: bottom;
      font-family: monospace;
      color: var(--text-main);
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
  `]
})
export class PackageCardComponent implements OnChanges {
  private readonly api = inject(UplPackagesApiService);
  private readonly i18n = inject(I18nService);

  @Input({ required: true }) item!: UplPackageItem;
  @Output() back = new EventEmitter<void>();
  @Output() refresh = new EventEmitter<void>();
  @Input() canApply = false;
  @Output() applied = new EventEmitter<UplPackageItem>();

  readonly errors = signal<UplPackageErrors | null>(null);
  readonly isLoading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly applying = signal(false);
  readonly applyError = signal<string | null>(null);

  readonly skeletonRows = [1, 2, 3, 4, 5];
  readonly statusKey = UPL_PACKAGE_STATUS_KEY;
  readonly statusVariant = UPL_PACKAGE_STATUS_VARIANT;

  private readonly translate: UplTranslate = (key, params) => this.i18n.translate(key, params);

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['item']) {
      return;
    }
    this.errors.set(null);
    this.loadError.set(null);
    this.applyError.set(null);
    this.isLoading.set(false);
    if (this.item.status === 'received') {
      return;
    }
    this.reloadErrors();
  }

  /** Строка шапки: источник · период · версия анкеты · кто загрузил · когда. */
  metaText(): string {
    return [
      this.item.sourceName,
      formatUplPeriod(this.item.periodFrom, this.item.periodTo),
      this.i18n.translate('upl.pkg.card.format_version', { v: this.item.formatVersion }),
      this.i18n.translate('upl.pkg.card.uploaded_by', { who: this.item.uploadedBy }),
      formatUplDateTime(this.item.uploadedAt)
    ].join(' · ');
  }

  /** Причина отклонения словами; кода отклонения нет — оставляем пусто. */
  rejectText(): string {
    return this.item.rejectCode ? uplPackageCodeText(this.item.rejectCode, this.item.rejectParams, this.translate) : '';
  }

  /** Строка сверки: только у применённой загрузки и только когда сервер отдал оба числа — экран чисел не выдумывает. */
  reconciliationText(): string {
    const { status, rowsTotal, rawRows } = this.item;
    if (status !== 'applied' || rowsTotal == null || rawRows == null) {
      return '';
    }
    return this.i18n.translate('upl.pkg.card.reconciliation', { n: rowsTotal, m: rawRows });
  }

  apply(): void {
    this.applying.set(true);
    this.applyError.set(null);
    this.api.apply(this.item.id).subscribe({
      next: result => {
        this.applying.set(false);
        this.applied.emit(result);
      },
      error: (problem: ProblemDetail) => {
        this.applying.set(false);
        this.applyError.set(this.applyErrorText(problem));
      }
    });
  }

  codeText(row: UplPackageErrorItem): string {
    return uplPackageCodeText(row.code, row.params, this.translate);
  }

  /** Расхождения с анкетой: записи без номера строки (сервер пустые поля не передаёт вовсе). */
  structRows(): UplPackageErrorItem[] {
    return (this.errors()?.items ?? []).filter(row => (row.rowNo ?? null) === null);
  }

  /** Ошибки ячеек: записи с адресом строки — они и идут в таблицу. */
  cellRows(): UplPackageErrorItem[] {
    return (this.errors()?.items ?? []).filter(row => (row.rowNo ?? null) !== null);
  }

  reloadErrors(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.errors.set(null);
    this.api.errors(this.item.id).subscribe({
      next: loaded => {
        this.errors.set(loaded ?? null);
        this.isLoading.set(false);
      },
      error: (problem: ProblemDetail) => {
        this.loadError.set(this.loadErrorText(problem));
        this.isLoading.set(false);
      }
    });
  }

  /** Отказ сервера: код загрузки — текстом словаря, прочее (нет права, сбой сети) — общим текстом. */
  private applyErrorText(problem: ProblemDetail | null | undefined): string {
    const detail = problem?.detail;
    return detail && detail.startsWith('UPL_')
      ? uplPackageCodeText(detail, null, this.translate)
      : this.i18n.translate('upl.pkg.card.apply_failed');
  }

  private loadErrorText(problem: ProblemDetail | null | undefined): string {
    const key = problem?.detail === NOT_FOUND ? uplErrorKey(NOT_FOUND) : 'upl.pkg.load_error';
    return this.i18n.translate(key);
  }
}
