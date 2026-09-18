import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, forkJoin } from 'rxjs';
import { FieldErrorItem, ProblemDetail } from '../../../core/models/common.models';
import { RecordNavigationDecision, RecordNavigationPage } from '../../../core/guards/record-navigation.guard';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { UiBadgeComponent } from '../../../shared/ui/ui-badge.component';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import {
  UPL_DATA_TYPES,
  UPL_ENCODINGS,
  UPL_FILE_KINDS,
  UPL_MATCH_BY,
  UplApiService,
  UplColumn,
  UplFileKind,
  UplFormatDraftRequest,
  UplFormatVersion,
  UplSheet,
  UplSource,
  UplUnit,
  UplVersionItem
} from '../upl-api';
import {
  UPL_DATA_TYPE_KEY,
  UPL_ENCODING_KEY,
  UPL_FILE_KIND_KEY,
  UPL_MATCH_BY_KEY,
  UPL_VERSION_STATUS_KEY,
  uplErrorKey,
  uplProblemText
} from '../upl-labels';
import {
  UplFieldError,
  parseUplFieldErrors,
  parseUplProblem,
  uplCellError,
  uplFieldErrorText,
  uplSheetError,
  uplSheetHasErrors
} from './upl-format-errors';

const TARGET_FIELD_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/** Пустая строка в необязательном поле означает «не заполнено», а не пустое значение. */
function trimToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isFilled(value: string | number | null | undefined): boolean {
  return value !== null && value !== undefined && value !== '';
}

function emptyModel(): UplFormatDraftRequest {
  return { lockVersion: 0, fileKind: 'xlsx', encoding: null, delimiter: null, matchColumnsBy: 'header', sheets: [] };
}

@Component({
  selector: 'app-upl-format-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, UiButtonComponent, UiModalComponent, UiBadgeComponent],
  template: `
    <div class="upl-editor">
      @if (isLoading()) {
        <p class="upl-muted">{{ 'upl.common.loading' | t }}</p>
      } @else if (notFound()) {
        <div class="alert alert-error" role="alert" data-testid="upl-not-found">
          <span>{{ 'upl.err.UPL_SOURCE_NOT_FOUND' | t }}</span>
          <a routerLink="/upl/sources">{{ 'upl.list.title' | t }}</a>
        </div>
      } @else if (loadError()) {
        <div class="alert alert-error" role="alert" data-testid="upl-load-error">
          <span>{{ 'upl.common.load_error' | t }}</span>
          <ui-button variant="secondary" size="sm" (onClick)="reload()">{{ 'upl.common.retry' | t }}</ui-button>
        </div>
      } @else {
        <nav class="upl-crumbs" [attr.aria-label]="'upl.format.crumbs' | t">
          <a routerLink="/upl/sources">{{ 'upl.list.title' | t }}</a>
          <span aria-hidden="true">›</span>
          <a [routerLink]="['/upl/sources', sourceId]">{{ source()?.name }}</a>
          <span aria-hidden="true">›</span>
          <span>{{ text('upl.format.crumb_version', { version: versionNumber }) }}</span>
        </nav>

        <div class="upl-head">
          <h1 class="upl-title">{{ text('upl.format.title', { name: source()?.name ?? '', version: versionNumber }) }}</h1>
          <ui-badge [variant]="statusVariant()">{{ statusKey() | t }}</ui-badge>
        </div>

        @if (version()?.status !== 'draft') {
          <p class="upl-note" data-testid="upl-readonly-note">
            <span>{{ 'upl.format.readonly_note' | t }}</span>
            @if (canEdit() && source() && !source()!.hasDraft) {
              <a [routerLink]="['/upl/sources', sourceId]" [queryParams]="{ newDraft: 1 }">{{ 'upl.version.new_draft' | t }}</a>
            }
          </p>
        }

        @if (conflict()) {
          <div class="alert alert-error" role="alert" data-testid="upl-conflict">
            <span>{{ 'upl.err.STALE_VERSION' | t }}</span>
            <ui-button variant="secondary" size="sm" (onClick)="discardAndReload()">{{ 'upl.common.refresh_discard' | t }}</ui-button>
          </div>
        }

        @if (actionError(); as problem) {
          <div class="alert alert-error" role="alert" data-testid="upl-action-error">{{ problem }}</div>
        }

        <section class="upl-block">
          <h2 class="upl-block-title">{{ 'upl.format.file' | t }}</h2>
          <div class="upl-row">
            <div class="form-group">
              <label class="form-label" for="upl-file-kind">{{ 'upl.format.field.file_kind' | t }}</label>
              <select
                id="upl-file-kind"
                class="form-select"
                data-testid="upl-file-kind"
                [disabled]="!editable()"
                [ngModel]="model.fileKind"
                [ngModelOptions]="{ standalone: true }"
                (ngModelChange)="onFileKindChange($event)"
              >
                @for (kind of fileKinds; track kind) {
                  <option [value]="kind">{{ fileKindKey[kind] | t }}</option>
                }
              </select>
            </div>
            @if (model.fileKind === 'csv') {
              <div class="form-group">
                <label class="form-label" for="upl-encoding">{{ 'upl.format.field.encoding' | t }}</label>
                <select
                  id="upl-encoding"
                  class="form-select"
                  data-testid="upl-encoding"
                  [disabled]="!editable()"
                  [(ngModel)]="model.encoding"
                  [ngModelOptions]="{ standalone: true }"
                >
                  @for (encoding of encodings; track encoding) {
                    <option [value]="encoding">{{ encodingKey[encoding] | t }}</option>
                  }
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="upl-delimiter">{{ 'upl.format.field.delimiter' | t }}</label>
                <input
                  id="upl-delimiter"
                  class="form-input upl-input-tiny"
                  type="text"
                  maxlength="1"
                  [disabled]="!editable()"
                  [(ngModel)]="model.delimiter"
                  [ngModelOptions]="{ standalone: true }"
                />
              </div>
            }
            <div class="form-group">
              <label class="form-label" for="upl-match-by">{{ 'upl.format.field.match_by' | t }}</label>
              <select
                id="upl-match-by"
                class="form-select"
                data-testid="upl-match-by"
                [disabled]="!editable()"
                [(ngModel)]="model.matchColumnsBy"
                [ngModelOptions]="{ standalone: true }"
              >
                @for (match of matchBy; track match) {
                  <option [value]="match">{{ matchByKey[match] | t }}</option>
                }
              </select>
            </div>
          </div>
        </section>

        <section class="upl-block">
          <h2 class="upl-block-title">{{ 'upl.format.sheets' | t }}</h2>
          <div class="upl-tabs" role="tablist">
            @for (sheet of model.sheets; track $index) {
              <span class="upl-tab" [class.upl-tab-active]="activeSheet() === $index">
                <button type="button" class="upl-tab-button" data-testid="upl-sheet-tab" (click)="activeSheet.set($index)">
                  <span>{{ sheet.sheetName || text('upl.format.sheet_n', { n: ($index + 1).toString() }) }}</span>
                  @if (sheetHasErrors($index)) {
                    <span class="upl-tab-dot" data-testid="upl-tab-error" aria-hidden="true"></span>
                  }
                </button>
                @if (editable()) {
                  <button
                    type="button"
                    class="upl-tab-remove"
                    data-testid="upl-remove-sheet"
                    [attr.aria-label]="'upl.format.remove_sheet' | t"
                    (click)="sheetToRemove.set($index)"
                  >×</button>
                }
              </span>
            }
            @if (editable()) {
              <button type="button" class="upl-tab-add" data-testid="upl-add-sheet" (click)="addSheet()">
                {{ 'upl.format.add_sheet' | t }}
              </button>
            }
          </div>

          @if (errors().length > 0) {
            <div class="alert alert-error" role="alert" data-testid="upl-errors-summary">
              <p class="upl-errors-title">{{ 'upl.format.errors_title' | t }}</p>
              <ul class="upl-errors-list">
                @for (problem of errors(); track $index) {
                  <li>
                    <button type="button" class="upl-error-item" (click)="focusError(problem)">
                      @if (problem.sheet !== null && problem.column !== null) {
                        <span class="upl-error-at">{{ text('upl.format.err_at_column', {
                          sheet: (problem.sheet + 1).toString(),
                          column: (problem.column + 1).toString()
                        }) }}</span>
                      } @else if (problem.sheet !== null) {
                        <span class="upl-error-at">{{ text('upl.format.err_at_sheet', { sheet: (problem.sheet + 1).toString() }) }}</span>
                      }
                      <span>{{ errorText(problem) }}</span>
                    </button>
                  </li>
                }
              </ul>
            </div>
          }

          @if (model.sheets.length === 0) {
            <p class="upl-muted" data-testid="upl-no-sheets">{{ 'upl.format.no_sheets' | t }}</p>
          } @else if (activeSheetModel(); as sheet) {
            <div class="upl-row">
              @if (model.fileKind !== 'csv') {
                <div class="form-group">
                  <label class="form-label" for="upl-sheet-name">{{ 'upl.format.field.sheet_name' | t }}</label>
                  <input
                    id="upl-sheet-name"
                    class="form-input"
                    type="text"
                    data-testid="upl-sheet-name"
                    [class.upl-cell-error]="sheetError(activeSheet(), 'sheetName')"
                    [disabled]="!editable()"
                    [(ngModel)]="sheet.sheetName"
                    [ngModelOptions]="{ standalone: true }"
                  />
                  @if (sheetError(activeSheet(), 'sheetName'); as problem) {
                    <span class="upl-field-error">{{ errorText(problem) }}</span>
                  }
                </div>
              }
              <div class="form-group">
                <label class="form-label" for="upl-header-row">{{ 'upl.format.field.header_row' | t }}</label>
                <input
                  id="upl-header-row"
                  class="form-input upl-input-small"
                  type="number"
                  min="1"
                  [class.upl-cell-error]="sheetError(activeSheet(), 'headerRow')"
                  [disabled]="!editable()"
                  [(ngModel)]="sheet.headerRow"
                  [ngModelOptions]="{ standalone: true }"
                />
                <span class="upl-hint">{{ 'upl.format.hint.header_row' | t }}</span>
                @if (sheetError(activeSheet(), 'headerRow'); as problem) {
                  <span class="upl-field-error">{{ errorText(problem) }}</span>
                }
              </div>
              <div class="form-group">
                <label class="form-label" for="upl-total-marker">{{ 'upl.format.field.total_row_marker' | t }}</label>
                <input
                  id="upl-total-marker"
                  class="form-input"
                  type="text"
                  [class.upl-cell-error]="sheetError(activeSheet(), 'totalRowMarker')"
                  [disabled]="!editable()"
                  [(ngModel)]="sheet.totalRowMarker"
                  [ngModelOptions]="{ standalone: true }"
                />
                <span class="upl-hint">{{ 'upl.format.hint.total_marker' | t }}</span>
                @if (sheetError(activeSheet(), 'totalRowMarker'); as problem) {
                  <span class="upl-field-error">{{ errorText(problem) }}</span>
                }
              </div>
            </div>

            <div class="table-card">
              <div class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{{ 'upl.format.col.name_in_file' | t }}</th>
                      <th>{{ 'upl.format.col.target_field' | t }}</th>
                      <th>{{ 'upl.format.col.type' | t }}</th>
                      <th>{{ 'upl.format.col.required' | t }}</th>
                      <th>{{ 'upl.format.col.source_unit' | t }}</th>
                      <th>{{ 'upl.format.col.base_unit' | t }}</th>
                      <th>{{ 'upl.format.col.key_mask' | t }}</th>
                      <th>{{ 'upl.format.col.key_pad' | t }}</th>
                      <th>{{ 'upl.format.col.ref_book' | t }}</th>
                      @if (model.matchColumnsBy === 'position') {
                        <th>{{ 'upl.format.col.file_position' | t }}</th>
                      }
                      @if (editable()) {
                        <th [attr.aria-label]="'upl.format.col.actions' | t"></th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (column of sheet.columns; track $index) {
                      <tr data-testid="upl-column-row">
                        <td
                          [class.upl-cell-error]="cellError(activeSheet(), $index, 'nameInFile')"
                          [attr.title]="cellTitle(activeSheet(), $index, 'nameInFile')"
                        >
                          <input
                            class="form-input"
                            type="text"
                            data-testid="upl-cell-name-in-file"
                            [attr.aria-label]="'upl.format.col.name_in_file' | t"
                            [disabled]="!editable()"
                            [(ngModel)]="column.nameInFile"
                            [ngModelOptions]="{ standalone: true }"
                          />
                        </td>
                        <td
                          [class.upl-cell-error]="cellError(activeSheet(), $index, 'targetField')"
                          [attr.title]="cellTitle(activeSheet(), $index, 'targetField') ?? text('upl.format.hint.target_field')"
                        >
                          <input
                            class="form-input"
                            type="text"
                            data-testid="upl-cell-target-field"
                            [attr.aria-label]="'upl.format.col.target_field' | t"
                            [disabled]="!editable()"
                            [(ngModel)]="column.targetField"
                            [ngModelOptions]="{ standalone: true }"
                          />
                        </td>
                        <td
                          [class.upl-cell-error]="cellError(activeSheet(), $index, 'dataType')"
                          [attr.title]="cellTitle(activeSheet(), $index, 'dataType')"
                        >
                          <select
                            class="form-select"
                            data-testid="upl-cell-type"
                            [attr.aria-label]="'upl.format.col.type' | t"
                            [disabled]="!editable()"
                            [(ngModel)]="column.dataType"
                            [ngModelOptions]="{ standalone: true }"
                            (ngModelChange)="onTypeChange(column)"
                          >
                            @for (type of dataTypes; track type) {
                              <option [value]="type">{{ dataTypeKey[type] | t }}</option>
                            }
                          </select>
                        </td>
                        <td
                          [class.upl-cell-error]="cellError(activeSheet(), $index, 'required')"
                          [attr.title]="cellTitle(activeSheet(), $index, 'required')"
                        >
                          <input
                            type="checkbox"
                            data-testid="upl-cell-required"
                            [attr.aria-label]="'upl.format.col.required' | t"
                            [disabled]="!editable()"
                            [(ngModel)]="column.required"
                            [ngModelOptions]="{ standalone: true }"
                          />
                        </td>
                        <td
                          [class.upl-cell-error]="cellError(activeSheet(), $index, 'sourceUnit')"
                          [attr.title]="cellTitle(activeSheet(), $index, 'sourceUnit')"
                        >
                          @if (isNumeric(column)) {
                            <select
                              class="form-select"
                              data-testid="upl-cell-source-unit"
                              [attr.aria-label]="'upl.format.col.source_unit' | t"
                              [disabled]="!editable()"
                              [(ngModel)]="column.sourceUnit"
                              [ngModelOptions]="{ standalone: true }"
                              (ngModelChange)="onUnitChange(column)"
                            >
                              <option [ngValue]="null">—</option>
                              @for (unit of units(); track unit.code) {
                                <option [ngValue]="unit.code">{{ unit.name }} ({{ unit.code }})</option>
                              }
                            </select>
                          }
                        </td>
                        <td
                          [class.upl-cell-error]="cellError(activeSheet(), $index, 'baseUnit')"
                          [attr.title]="cellTitle(activeSheet(), $index, 'baseUnit')"
                        >
                          @if (isNumeric(column)) {
                            <span data-testid="upl-cell-base-unit">{{ baseUnitLabel(column) }}</span>
                          }
                        </td>
                        <td
                          [class.upl-cell-error]="cellError(activeSheet(), $index, 'keyMask')"
                          [attr.title]="cellTitle(activeSheet(), $index, 'keyMask') ?? text('upl.format.hint.key_mask')"
                        >
                          @if (column.dataType === 'object_key') {
                            <input
                              class="form-input"
                              type="text"
                              data-testid="upl-cell-key-mask"
                              [attr.aria-label]="'upl.format.col.key_mask' | t"
                              [disabled]="!editable()"
                              [(ngModel)]="column.keyMask"
                              [ngModelOptions]="{ standalone: true }"
                            />
                          }
                        </td>
                        <td
                          [class.upl-cell-error]="cellError(activeSheet(), $index, 'keyPadLength') || cellError(activeSheet(), $index, 'keyPadMax')"
                          [attr.title]="cellTitle(activeSheet(), $index, 'keyPadLength') ?? cellTitle(activeSheet(), $index, 'keyPadMax')"
                        >
                          @if (column.dataType === 'object_key') {
                            <span class="upl-pad-pair">
                              <input
                                class="form-input upl-input-small"
                                type="number"
                                min="1"
                                data-testid="upl-cell-key-pad-length"
                                [attr.aria-label]="'upl.format.col.key_pad_length' | t"
                                [disabled]="!editable()"
                                [(ngModel)]="column.keyPadLength"
                                [ngModelOptions]="{ standalone: true }"
                              />
                              <input
                                class="form-input upl-input-small"
                                type="number"
                                min="1"
                                data-testid="upl-cell-key-pad-max"
                                [attr.aria-label]="'upl.format.col.key_pad_max' | t"
                                [disabled]="!editable()"
                                [(ngModel)]="column.keyPadMax"
                                [ngModelOptions]="{ standalone: true }"
                              />
                            </span>
                          }
                        </td>
                        <td
                          [class.upl-cell-error]="cellError(activeSheet(), $index, 'refBookCode')"
                          [attr.title]="cellTitle(activeSheet(), $index, 'refBookCode')"
                        >
                          @if (column.dataType === 'ref_code') {
                            <input
                              class="form-input"
                              type="text"
                              data-testid="upl-cell-ref-book"
                              [attr.aria-label]="'upl.format.col.ref_book' | t"
                              [disabled]="!editable()"
                              [(ngModel)]="column.refBookCode"
                              [ngModelOptions]="{ standalone: true }"
                            />
                          }
                        </td>
                        @if (model.matchColumnsBy === 'position') {
                          <td
                            [class.upl-cell-error]="cellError(activeSheet(), $index, 'filePosition')"
                            [attr.title]="cellTitle(activeSheet(), $index, 'filePosition')"
                          >
                            <input
                              class="form-input upl-input-small"
                              type="number"
                              min="1"
                              data-testid="upl-cell-file-position"
                              [attr.aria-label]="'upl.format.col.file_position' | t"
                              [disabled]="!editable()"
                              [(ngModel)]="column.filePosition"
                              [ngModelOptions]="{ standalone: true }"
                            />
                          </td>
                        }
                        @if (editable()) {
                          <td class="upl-row-actions">
                            <ui-button
                              variant="ghost"
                              size="sm"
                              icon="arrow_upward"
                              data-testid="upl-column-up"
                              [ariaLabel]="'upl.format.move_up' | t"
                              [disabled]="$index === 0"
                              (onClick)="moveColumn($index, -1)"
                            ></ui-button>
                            <ui-button
                              variant="ghost"
                              size="sm"
                              icon="arrow_downward"
                              data-testid="upl-column-down"
                              [ariaLabel]="'upl.format.move_down' | t"
                              [disabled]="$index === sheet.columns.length - 1"
                              (onClick)="moveColumn($index, 1)"
                            ></ui-button>
                            <ui-button
                              variant="ghost"
                              size="sm"
                              icon="close"
                              data-testid="upl-column-remove"
                              [ariaLabel]="'upl.format.remove_column' | t"
                              (onClick)="removeColumn($index)"
                            ></ui-button>
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>

            @if (editable()) {
              <ui-button variant="secondary" size="sm" data-testid="upl-add-column" (onClick)="addColumn()">
                {{ 'upl.format.add_column' | t }}
              </ui-button>
            }
          }
        </section>

        @if (version()?.status === 'draft' && (canEdit() || canPublish())) {
          <div class="upl-actions" data-testid="upl-actions">
            @if (canEdit()) {
              <ui-button
                variant="primary"
                data-testid="upl-save"
                [loading]="isSaving()"
                [disabled]="!isDirty()"
                (onClick)="save()"
              >{{ 'upl.format.save' | t }}</ui-button>
            }
            @if (canPublish()) {
              <ui-button variant="secondary" data-testid="upl-publish" (onClick)="openPublish()">
                {{ 'upl.format.publish' | t }}
              </ui-button>
            }
            @if (canEdit()) {
              <ui-button variant="ghost" data-testid="upl-revert" [disabled]="!isDirty()" (onClick)="revert()">
                {{ 'upl.format.revert' | t }}
              </ui-button>
            }
          </div>
        }

        <ui-modal
          [isOpen]="sheetToRemove() !== null"
          [title]="'upl.format.remove_sheet' | t"
          size="sm"
          (close)="sheetToRemove.set(null)"
        >
          <p body>{{ text('upl.format.remove_sheet_confirm', { count: sheetToRemoveColumns().toString() }) }}</p>
          <div footer class="upl-modal-actions">
            <ui-button variant="secondary" (onClick)="sheetToRemove.set(null)">{{ 'upl.common.cancel' | t }}</ui-button>
            <ui-button variant="danger" data-testid="upl-remove-sheet-confirm" (onClick)="confirmRemoveSheet()">
              {{ 'upl.format.remove_sheet' | t }}
            </ui-button>
          </div>
        </ui-modal>

        <ui-modal [isOpen]="isPublishOpen()" [title]="'upl.version.publish_title' | t" size="sm" (close)="closePublish()">
          <div body>
            <div class="form-group">
              <label class="form-label" for="upl-valid-from">{{ 'upl.version.valid_from' | t }}</label>
              <input
                id="upl-valid-from"
                class="form-input"
                type="date"
                data-testid="upl-valid-from"
                [ngModel]="validFrom()"
                [ngModelOptions]="{ standalone: true }"
                (ngModelChange)="validFrom.set($event)"
              />
              @if (previousValidFrom(); as previous) {
                <span class="upl-hint">{{ text('upl.version.prev_valid_from', { date: previous }) }}</span>
              }
              @if (publishDateError(); as problem) {
                <span class="upl-field-error" data-testid="upl-publish-date-error">{{ problem | t }}</span>
              }
            </div>
            <p>{{ 'upl.version.publish_note' | t }}</p>
          </div>
          <div footer class="upl-modal-actions">
            <ui-button variant="secondary" (onClick)="closePublish()">{{ 'upl.common.cancel' | t }}</ui-button>
            <ui-button
              variant="primary"
              data-testid="upl-publish-confirm"
              [loading]="isPublishing()"
              (onClick)="confirmPublish()"
            >{{ 'upl.format.publish' | t }}</ui-button>
          </div>
        </ui-modal>

        <ui-modal [isOpen]="isLeaveOpen()" [title]="'upl.format.leave_title' | t" size="sm" (close)="settleLeave(false)">
          <p body>{{ 'upl.format.leave_confirm' | t }}</p>
          <div footer class="upl-modal-actions">
            <ui-button variant="secondary" (onClick)="settleLeave(false)">{{ 'upl.format.stay' | t }}</ui-button>
            <ui-button variant="danger" data-testid="upl-leave-confirm" (onClick)="settleLeave(true)">
              {{ 'upl.format.leave' | t }}
            </ui-button>
          </div>
        </ui-modal>
      }
    </div>
  `,
  styles: [`
    .upl-editor { display: flex; flex-direction: column; gap: 1rem; padding-bottom: 5rem; }
    .upl-muted { color: var(--text-muted); }
    .upl-crumbs { display: flex; align-items: center; gap: 0.5rem; color: var(--text-muted); font-size: 0.875rem; }
    .upl-crumbs a { color: var(--primary); text-decoration: none; }
    .upl-head { display: flex; align-items: center; gap: 0.75rem; }
    .upl-title { margin: 0; color: var(--text-main); font-size: 1.25rem; }
    .upl-note { display: flex; gap: 0.5rem; color: var(--text-muted); margin: 0; }
    .upl-note a { color: var(--primary); }
    .upl-block { display: flex; flex-direction: column; gap: 0.75rem; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem; }
    .upl-block-title { margin: 0; font-size: 1rem; color: var(--text-main); }
    .upl-row { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-start; }
    .upl-input-small { max-width: 7rem; }
    .upl-input-tiny { max-width: 4rem; }
    .upl-hint { color: var(--text-light); font-size: 0.75rem; }
    .upl-field-error { color: var(--danger); font-size: 0.75rem; }
    .upl-tabs { display: flex; flex-wrap: wrap; gap: 0.25rem; border-bottom: 1px solid var(--border-color); }
    .upl-tab { display: inline-flex; align-items: center; background: var(--bg-hover); border: 1px solid var(--border-color); border-radius: var(--radius-sm) var(--radius-sm) 0 0; }
    .upl-tab-active { background: var(--bg-active); border-color: var(--primary); }
    .upl-tab-button { display: inline-flex; align-items: center; gap: 0.375rem; background: none; border: none; color: var(--text-main); padding: 0.375rem 0.625rem; cursor: pointer; }
    .upl-tab-remove { background: none; border: none; color: var(--text-muted); padding: 0 0.5rem 0 0; cursor: pointer; }
    .upl-tab-add { background: none; border: 1px dashed var(--border-color); border-radius: var(--radius-sm); color: var(--primary); padding: 0.375rem 0.625rem; cursor: pointer; }
    .upl-tab-dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--danger); }
    .upl-errors-title { margin: 0 0 0.375rem; font-weight: 600; }
    .upl-errors-list { margin: 0; padding-left: 1rem; }
    .upl-error-item { display: inline-flex; gap: 0.375rem; padding: 0; background: none; border: none; color: inherit; text-align: left; cursor: pointer; }
    .upl-error-at { color: var(--text-muted); }
    .upl-pad-pair { display: inline-flex; gap: 0.25rem; }
    .upl-row-actions { display: flex; gap: 0.25rem; white-space: nowrap; }
    .upl-cell-error { border: 1px solid var(--danger); background: var(--danger-bg); border-radius: var(--radius-sm); }
    .upl-actions { position: sticky; bottom: 0; display: flex; gap: 0.5rem; padding: 0.75rem 1rem; background: var(--bg-surface); border-top: 1px solid var(--border-color); border-radius: var(--radius-md) var(--radius-md) 0 0; }
    .upl-modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
  `]
})
export class FormatEditorComponent implements RecordNavigationPage {
  private readonly api = inject(UplApiService);
  private readonly permissions = inject(PermissionService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly navigationDecision = new RecordNavigationDecision();

  readonly fileKinds = UPL_FILE_KINDS;
  readonly encodings = UPL_ENCODINGS;
  readonly matchBy = UPL_MATCH_BY;
  readonly dataTypes = UPL_DATA_TYPES;
  readonly fileKindKey = UPL_FILE_KIND_KEY;
  readonly encodingKey = UPL_ENCODING_KEY;
  readonly matchByKey = UPL_MATCH_BY_KEY;
  readonly dataTypeKey = UPL_DATA_TYPE_KEY;

  readonly source = signal<UplSource | null>(null);
  readonly version = signal<UplFormatVersion | null>(null);
  readonly versions = signal<UplVersionItem[]>([]);
  readonly units = signal<UplUnit[]>([]);
  readonly isLoading = signal(true);
  readonly loadError = signal(false);
  readonly notFound = signal(false);
  readonly activeSheet = signal(0);
  readonly errors = signal<UplFieldError[]>([]);
  readonly isSaving = signal(false);
  readonly isPublishing = signal(false);
  readonly conflict = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly isPublishOpen = signal(false);
  readonly validFrom = signal('');
  readonly publishDateError = signal<string | null>(null);
  readonly sheetToRemove = signal<number | null>(null);
  readonly isLeaveOpen = signal(false);

  sourceId = '';
  versionNumber = '';
  model: UplFormatDraftRequest = emptyModel();
  private savedSnapshot = JSON.stringify(emptyModel());

  readonly canEdit = computed(() => this.permissions.hasPermission('upl.sources', 'edit'));
  readonly editable = computed(() => this.version()?.status === 'draft' && this.permissions.hasPermission('upl.sources', 'edit'));
  readonly canPublish = computed(() => this.version()?.status === 'draft' && this.permissions.hasPermission('upl.sources', 'publish'));
  readonly statusKey = computed(() => {
    const status = this.version()?.status;
    return status ? UPL_VERSION_STATUS_KEY[status] : '';
  });
  readonly statusVariant = computed(() => {
    const status = this.version()?.status;
    if (status === 'draft') return 'info';
    if (status === 'published') return 'success';
    return 'neutral';
  });
  readonly previousValidFrom = computed(() => {
    const published = this.versions().filter(item => item.status === 'published' && item.validFrom);
    if (published.length === 0) return null;
    return published.reduce((latest, item) => (item.version > latest.version ? item : latest)).validFrom;
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      this.sourceId = params.get('id') ?? '';
      this.versionNumber = params.get('v') ?? '';
      this.reload();
    });
  }

  text(key: string, params?: Record<string, string>): string {
    return this.i18n.translate(key, params);
  }

  reload(): void {
    this.isLoading.set(true);
    this.loadError.set(false);
    this.notFound.set(false);
    this.conflict.set(false);
    this.actionError.set(null);
    this.errors.set([]);
    forkJoin({
      source: this.api.getSource(this.sourceId),
      version: this.api.getVersion(this.sourceId, this.versionNumber),
      versions: this.api.listVersions(this.sourceId),
      units: this.api.listUnits()
    }).subscribe({
      next: loaded => {
        this.source.set(loaded.source);
        this.versions.set(loaded.versions ?? []);
        this.units.set(loaded.units ?? []);
        this.version.set(loaded.version);
        this.resetModel(loaded.version);
        this.isLoading.set(false);
        this.cdr.markForCheck();
      },
      error: (problem: ProblemDetail) => {
        this.isLoading.set(false);
        if (problem?.status === 404) {
          this.notFound.set(true);
        } else {
          this.loadError.set(true);
        }
        this.cdr.markForCheck();
      }
    });
  }

  discardAndReload(): void {
    this.conflict.set(false);
    this.reload();
  }

  buildRequest(): UplFormatDraftRequest {
    const fileKind: UplFileKind = this.model.fileKind ?? 'xlsx';
    const csv = fileKind === 'csv';
    return {
      lockVersion: this.version()?.lockVersion ?? this.model.lockVersion,
      fileKind,
      encoding: csv ? this.model.encoding : null,
      delimiter: csv ? trimToNull(this.model.delimiter) : null,
      matchColumnsBy: this.model.matchColumnsBy ?? 'header',
      sheets: this.model.sheets.map((sheet, index) => ({
        id: sheet.id,
        ordinal: index + 1,
        sheetName: csv ? null : trimToNull(sheet.sheetName),
        headerRow: sheet.headerRow,
        totalRowMarker: trimToNull(sheet.totalRowMarker),
        columns: sheet.columns.map((column, columnIndex) => ({
          id: column.id,
          ordinal: columnIndex + 1,
          filePosition: column.filePosition,
          nameInFile: (column.nameInFile ?? '').trim(),
          targetField: (column.targetField ?? '').trim(),
          dataType: column.dataType,
          required: column.required,
          sourceUnit: trimToNull(column.sourceUnit),
          baseUnit: trimToNull(column.baseUnit),
          keyMask: trimToNull(column.keyMask),
          keyPadLength: column.keyPadLength,
          keyPadMax: column.keyPadMax,
          refBookCode: trimToNull(column.refBookCode)
        }))
      }))
    };
  }

  isDirty(): boolean {
    return this.editable() && JSON.stringify(this.buildRequest()) !== this.savedSnapshot;
  }

  activeSheetModel(): UplSheet | null {
    return this.model.sheets[this.activeSheet()] ?? null;
  }

  sheetToRemoveColumns(): number {
    const index = this.sheetToRemove();
    return index === null ? 0 : this.model.sheets[index]?.columns.length ?? 0;
  }

  isNumeric(column: UplColumn): boolean {
    return column.dataType === 'integer' || column.dataType === 'number';
  }

  cellError(sheet: number, column: number, field: string): UplFieldError | null {
    return uplCellError(this.errors(), sheet, column, field);
  }

  cellTitle(sheet: number, column: number, field: string): string | null {
    const problem = this.cellError(sheet, column, field);
    return problem === null ? null : this.errorText(problem);
  }

  sheetError(sheet: number, field: string): UplFieldError | null {
    return uplSheetError(this.errors(), sheet, field);
  }

  sheetHasErrors(sheet: number): boolean {
    return uplSheetHasErrors(this.errors(), sheet);
  }

  /** Неизвестный код не прячем: показываем сообщение сервера и сам код. */
  errorText(problem: UplFieldError): string {
    return uplFieldErrorText(problem, key => this.i18n.translate(key));
  }

  /** «Имя (код)» из /upl/units; единица вне списка — только код. */
  baseUnitLabel(column: UplColumn): string {
    const code = column.baseUnit ?? '';
    const unit = this.units().find(item => item.code === code);
    return unit ? `${unit.name} (${unit.code})` : code;
  }

  focusError(problem: UplFieldError): void {
    if (problem.sheet !== null && problem.sheet < this.model.sheets.length) {
      this.activeSheet.set(problem.sheet);
    }
  }

  onFileKindChange(kind: UplFileKind): void {
    this.model.fileKind = kind;
    if (kind === 'csv') {
      if (!isFilled(this.model.encoding)) this.model.encoding = 'utf-8';
      if (!isFilled(this.model.delimiter)) this.model.delimiter = ';';
    }
  }

  addSheet(): void {
    this.model.sheets.push({ id: null, ordinal: null, sheetName: null, headerRow: 1, totalRowMarker: null, columns: [] });
    this.activeSheet.set(this.model.sheets.length - 1);
  }

  confirmRemoveSheet(): void {
    const index = this.sheetToRemove();
    if (index === null) return;
    this.model.sheets.splice(index, 1);
    this.errors.set([]);
    this.sheetToRemove.set(null);
    if (this.activeSheet() >= this.model.sheets.length) {
      this.activeSheet.set(Math.max(0, this.model.sheets.length - 1));
    }
  }

  addColumn(): void {
    const sheet = this.activeSheetModel();
    if (!sheet) return;
    sheet.columns.push({
      id: null,
      ordinal: null,
      filePosition: null,
      nameInFile: '',
      targetField: '',
      dataType: 'text',
      required: false,
      sourceUnit: null,
      baseUnit: null,
      keyMask: null,
      keyPadLength: null,
      keyPadMax: null,
      refBookCode: null
    });
  }

  moveColumn(index: number, shift: number): void {
    const sheet = this.activeSheetModel();
    if (!sheet) return;
    const target = index + shift;
    if (target < 0 || target >= sheet.columns.length) return;
    const [column] = sheet.columns.splice(index, 1);
    sheet.columns.splice(target, 0, column);
    this.errors.set([]);
  }

  removeColumn(index: number): void {
    const sheet = this.activeSheetModel();
    if (!sheet) return;
    sheet.columns.splice(index, 1);
    this.errors.set([]);
  }

  /** Поля, которых у нового типа нет, очищаются — единственная молчаливая правка, и о ней говорим тостом. */
  onTypeChange(column: UplColumn): void {
    let cleared = false;
    if (!this.isNumeric(column) && (isFilled(column.sourceUnit) || isFilled(column.baseUnit))) {
      column.sourceUnit = null;
      column.baseUnit = null;
      cleared = true;
    }
    if (column.dataType !== 'object_key'
      && (isFilled(column.keyMask) || isFilled(column.keyPadLength) || isFilled(column.keyPadMax))) {
      column.keyMask = null;
      column.keyPadLength = null;
      column.keyPadMax = null;
      cleared = true;
    }
    if (column.dataType !== 'ref_code' && isFilled(column.refBookCode)) {
      column.refBookCode = null;
      cleared = true;
    }
    if (cleared) {
      this.toast.info(this.i18n.translate('upl.format.cleared'));
    }
  }

  onUnitChange(column: UplColumn): void {
    const unit = this.units().find(item => item.code === column.sourceUnit);
    if (!unit) {
      column.sourceUnit = null;
      column.baseUnit = null;
      return;
    }
    column.baseUnit = unit.baseUnitCode;
  }

  revert(): void {
    const version = this.version();
    if (!version) return;
    this.resetModel(version);
    this.errors.set([]);
    this.actionError.set(null);
  }

  save(onSaved?: () => void): void {
    if (this.isSaving()) return;
    const local = this.localErrors();
    if (local.length > 0) {
      this.errors.set(local);
      this.activeSheet.set(local[0].sheet ?? this.activeSheet());
      return;
    }
    this.isSaving.set(true);
    this.actionError.set(null);
    this.api.saveDraft(this.sourceId, this.versionNumber, this.buildRequest()).subscribe({
      next: saved => {
        this.isSaving.set(false);
        this.version.set(saved);
        this.resetModel(saved);
        this.errors.set([]);
        this.toast.success(this.i18n.translate('upl.format.saved'));
        this.cdr.markForCheck();
        onSaved?.();
      },
      error: (problem: ProblemDetail) => {
        this.isSaving.set(false);
        this.handleProblem(problem);
        this.cdr.markForCheck();
      }
    });
  }

  openPublish(): void {
    if (this.isDirty()) {
      this.save(() => this.showPublishDialog());
      return;
    }
    this.showPublishDialog();
  }

  closePublish(): void {
    this.isPublishOpen.set(false);
  }

  confirmPublish(): void {
    if (this.isPublishing()) return;
    if (!this.validFrom()) {
      this.publishDateError.set(uplErrorKey('NotNull'));
      return;
    }
    this.isPublishing.set(true);
    this.publishDateError.set(null);
    this.actionError.set(null);
    this.api.publish(this.sourceId, this.versionNumber, this.validFrom()).subscribe({
      next: () => {
        this.isPublishing.set(false);
        this.isPublishOpen.set(false);
        this.savedSnapshot = JSON.stringify(this.buildRequest());
        this.toast.success(this.i18n.translate('upl.version.published_toast', { version: this.versionNumber }));
        this.cdr.markForCheck();
        this.router.navigate(['/upl/sources', this.sourceId]);
      },
      error: (problem: ProblemDetail) => {
        this.isPublishing.set(false);
        if (problem?.detail === 'FND_VERSION_NOT_AFTER_PREVIOUS') {
          this.publishDateError.set(uplErrorKey('FND_VERSION_NOT_AFTER_PREVIOUS'));
          this.cdr.markForCheck();
          return;
        }
        this.handleProblem(problem);
        this.cdr.markForCheck();
      }
    });
  }

  canLeaveRecordPage(): boolean | Observable<boolean> {
    if (!this.isDirty()) return true;
    return this.navigationDecision.request(
      () => { this.isLeaveOpen.set(true); this.cdr.markForCheck(); },
      () => { this.isLeaveOpen.set(false); this.cdr.markForCheck(); }
    );
  }

  settleLeave(allow: boolean): void {
    this.isLeaveOpen.set(false);
    this.navigationDecision.settle(allow);
  }

  /** Проверка до отправки — то, что сервер отверг бы кодами Bean Validation; коды те же, текст — из словаря. */
  private localErrors(): UplFieldError[] {
    const found: FieldErrorItem[] = [];
    this.model.sheets.forEach((sheet, s) => {
      const row = Number(sheet.headerRow);
      if (sheet.headerRow === null || !Number.isInteger(row) || row < 1) {
        found.push({ field: `sheets[${s}].headerRow`, code: 'Min', message: '' });
      }
      sheet.columns.forEach((column, c) => {
        if ((column.nameInFile ?? '').trim().length === 0) {
          found.push({ field: `sheets[${s}].columns[${c}].nameInFile`, code: 'NotBlank', message: '' });
        }
        const target = (column.targetField ?? '').trim();
        if (target.length === 0) {
          found.push({ field: `sheets[${s}].columns[${c}].targetField`, code: 'NotBlank', message: '' });
        } else if (!TARGET_FIELD_PATTERN.test(target)) {
          found.push({ field: `sheets[${s}].columns[${c}].targetField`, code: 'Pattern', message: '' });
        }
      });
    });
    return parseUplFieldErrors(found);
  }

  private showPublishDialog(): void {
    this.publishDateError.set(null);
    this.validFrom.set(this.today());
    this.isPublishOpen.set(true);
    this.cdr.markForCheck();
  }

  private today(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  private resetModel(version: UplFormatVersion): void {
    this.model = {
      lockVersion: version.lockVersion,
      fileKind: version.fileKind ?? 'xlsx',
      encoding: version.encoding,
      delimiter: version.delimiter,
      matchColumnsBy: version.matchColumnsBy ?? 'header',
      sheets: structuredClone(version.sheets ?? [])
    };
    if (this.activeSheet() >= this.model.sheets.length) {
      this.activeSheet.set(Math.max(0, this.model.sheets.length - 1));
    }
    this.savedSnapshot = JSON.stringify(this.buildRequest());
  }

  private handleProblem(problem: ProblemDetail): void {
    if (problem?.status === 422) {
      const parsed = parseUplProblem(problem);
      this.errors.set(parsed);
      this.isPublishOpen.set(false);
      const addressed = parsed.find(item => item.sheet !== null);
      if (addressed && addressed.sheet !== null) {
        this.activeSheet.set(addressed.sheet);
      }
      return;
    }
    if (problem?.detail === 'STALE_VERSION') {
      this.conflict.set(true);
      return;
    }
    if (problem?.detail === 'UPL_FORMAT_NOT_DRAFT') {
      this.toast.info(this.i18n.translate('upl.err.UPL_FORMAT_NOT_DRAFT'));
      this.reload();
      return;
    }
    this.actionError.set(this.problemText(problem));
  }

  private problemText(problem: ProblemDetail): string {
    return uplProblemText(problem, key => this.i18n.translate(key));
  }
}
