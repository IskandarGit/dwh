import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { PermissionService } from '../../../core/services/permission.service';
import { CustomField } from '../../../core/models/custom-field.models';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import { TranslatePipe, I18nService } from '../../../core/services/i18n.service';

@Component({
  selector: 'app-custom-fields',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    FormsModule,
    UiButtonComponent,
    UiModalComponent
  ],
  template: `
    <div class="custom-fields-page">
      <!-- Header -->
      <div class="view-header">
        <div class="header-left">
          <div class="title-with-badge">
            <h1 class="view-title">{{ 'iam.dinamicheskie_atributy' | t }}</h1>
            <span class="count-badge" [title]="'iam.vsego_poley' | t">{{ filteredFields.length }}</span>
          </div>
          <span class="view-subtitle">{{ 'iam.sohranennye_znacheniya_etogo_atributa_mogut_stat' | t }}</span>
        </div>
        <div class="header-actions">
          <button
            type="button"
            class="icon-refresh-btn"
            [class.spinning]="isLoading"
            [disabled]="isLoading"
            (click)="loadFields()"
            [attr.aria-label]="'iam.obnovit_polya' | t"
            [title]="'common.refresh' | t"
          >
            <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
          </button>
          <ui-button
            *ngIf="canManage()"
            variant="primary"
            icon="add"
            (onClick)="openCreateModal()"
          >
            {{ 'iam.dobavit_pole' | t }}
          </ui-button>
        </div>
      </div>

      <!-- Toolbar: Tabs and Search -->
      <div class="toolbar-container">
        <!-- Entity Type Filter Tabs -->
        <div class="filter-tabs" role="group" [attr.aria-label]="'iam.filtr_po_tipu_suschnosti' | t">
          <button
            *ngFor="let ent of availableEntities"
            type="button"
            class="tab-btn"
            [class.active]="selectedEntity === ent"
            [attr.aria-pressed]="selectedEntity === ent"
            (click)="filterByEntity(ent)"
          >
            <span class="material-symbols-outlined tab-icon" aria-hidden="true">{{ getEntityIcon(ent) }}</span>
            <span class="tab-label">{{ getEntityLabel(ent) }}</span>
            <span class="tab-count">{{ getEntityCount(ent) }}</span>
          </button>
        </div>

        <!-- Quick Search -->
        <div class="search-box">
          <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
          <input
            type="text"
            class="search-input"
            [(ngModel)]="searchQuery"
            (ngModelChange)="applyFilter()"
            [placeholder]="'iam.poisk_poley' | t"
            [attr.aria-label]="'iam.poisk_poley' | t"
          />
          <button
            *ngIf="searchQuery"
            type="button"
            class="clear-search-btn"
            (click)="clearSearch()"
            [attr.aria-label]="'iam.sbrosit_poisk' | t"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      </div>

      <!-- Grid / Table -->
      <div class="card">
        <div class="table-wrapper" role="region" [attr.aria-label]="'iam.tablica_dinamicheskih_atributov' | t" tabindex="0">
          <table class="data-table" [attr.aria-label]="'iam.dinamicheskie_atributy' | t">
            <thead>
              <tr>
                <th class="col-order">#</th>
                <th>{{ 'iam.kod_polya' | t }}</th>
                <th>{{ 'iam.nazvanie' | t }}</th>
                <th>{{ 'iam.suschnost' | t }}</th>
                <th>{{ 'iam.tip_dannyh' | t }}</th>
                <th>{{ 'iam.obyazatelnoe' | t }}</th>
                <th>{{ 'iam.znachenie_po_umolchaniyu' | t }}</th>
                <th *ngIf="canManage()" class="text-right">{{ 'common.actions' | t }}</th>
              </tr>
            </thead>
            <tbody>
              <!-- Loading Skeleton / Spinner State -->
              <tr *ngIf="isLoading" class="loading-row">
                <td [attr.colspan]="canManage() ? 8 : 7" class="loading-cell">
                  <div class="loading-state">
                    <span class="material-symbols-outlined spin-icon" aria-hidden="true">progress_activity</span>
                    <span>{{ 'iam.zagruzka_poley' | t }}</span>
                  </div>
                </td>
              </tr>

              <!-- Data Rows -->
              <ng-container *ngIf="!isLoading">
                <tr *ngFor="let f of filteredFields">
                  <td class="col-order order-cell font-mono">{{ f.orderNo || 0 }}</td>
                  <td class="code-cell font-mono">
                    <div class="code-badge-wrap">
                      <span class="code-text">{{ f.code }}</span>
                      <button
                        type="button"
                        class="copy-code-btn"
                        (click)="copyCode(f.code)"
                        [attr.aria-label]="'iam.kopirovat_kod' | t"
                        [title]="'iam.kopirovat_kod' | t"
                      >
                        <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>
                      </button>
                    </div>
                  </td>
                  <td class="name-cell font-medium">{{ f.name }}</td>
                  <td>
                    <span class="entity-badge" [ngClass]="getEntityBadgeClass(f.entityType)">
                      <span class="material-symbols-outlined entity-icon" aria-hidden="true">{{ getEntityIcon(f.entityType) }}</span>
                      <span>{{ f.entityType }}</span>
                    </span>
                  </td>
                  <td>
                    <span class="type-badge" [ngClass]="'type-' + f.fieldType">
                      <span class="material-symbols-outlined type-icon" aria-hidden="true">{{ getTypeIcon(f.fieldType) }}</span>
                      <span>{{ getTypeName(f.fieldType) }}</span>
                    </span>
                  </td>
                  <td>
                    <span class="status-indicator" [class.active]="f.isRequired">
                      <span class="material-symbols-outlined status-icon" aria-hidden="true">
                        {{ f.isRequired ? 'check_circle' : 'remove_circle_outline' }}
                      </span>
                      <span>{{ (f.isRequired ? 'common.yes' : 'common.no') | t }}</span>
                    </span>
                  </td>
                  <td class="text-muted">{{ f.defaultValue || '—' }}</td>
                  <td *ngIf="canManage()" class="text-right">
                    <button
                      type="button"
                      class="action-btn"
                      (click)="openEditModal(f)"
                      [attr.aria-label]="'iam.edit_named' | t:{name: f.name}"
                      [title]="'common.edit' | t"
                    >
                      <span class="material-symbols-outlined" aria-hidden="true">edit</span>
                    </button>
                    <button
                      type="button"
                      class="action-btn danger"
                      (click)="requestDeleteField(f)"
                      [attr.aria-label]="'iam.delete_named' | t:{name: f.name}"
                      [title]="'common.delete' | t"
                    >
                      <span class="material-symbols-outlined" aria-hidden="true">delete</span>
                    </button>
                  </td>
                </tr>

                <!-- Empty State -->
                <tr *ngIf="filteredFields.length === 0">
                  <td [attr.colspan]="canManage() ? 8 : 7" class="empty-row">
                    <div class="empty-state" *ngIf="searchQuery">
                      <span class="material-symbols-outlined empty-icon" aria-hidden="true">search_off</span>
                      <p>{{ 'iam.nichego_ne_naydeno_po_zaprosu' | t }}: «<strong>{{ searchQuery }}</strong>»</p>
                      <ui-button variant="secondary" size="sm" (onClick)="clearSearch()">
                        {{ 'iam.sbrosit_poisk' | t }}
                      </ui-button>
                    </div>
                    <div class="empty-state" *ngIf="!searchQuery">
                      <span class="material-symbols-outlined empty-icon" aria-hidden="true">tune</span>
                      <p>{{ 'iam.dinamicheskie_polya_ne_naydeny' | t }}</p>
                      <ui-button *ngIf="canManage()" variant="primary" size="sm" icon="add" (onClick)="openCreateModal()">
                        {{ 'iam.dobavit_pole' | t }}
                      </ui-button>
                    </div>
                  </td>
                </tr>
              </ng-container>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Create / Edit Modal -->
      <ui-modal
        *ngIf="showModal"
        [isOpen]="showModal"
        [title]="(editingField ? 'iam.edit_field' : 'iam.new_custom_field') | t"
        [hasFooter]="false"
        (close)="closeModal()"
      >
        <form class="modal-form" (ngSubmit)="saveField()">
          <!-- Entity Target (only in creation) -->
          <div class="form-group" *ngIf="!editingField">
            <label class="form-label" for="custom-field-entity">
              {{ 'iam.celevaya_suschnost' | t }} <span class="req" aria-hidden="true">*</span>
            </label>
            <select id="custom-field-entity" name="entityType" class="form-select" [(ngModel)]="formData.entityType" required>
              <option value="USER">{{ 'iam.polzovatel_user' | t }}</option>
              <option value="PROJECT">{{ 'iam.proekt_project' | t }}</option>
              <option value="TASK">{{ 'iam.zadacha_task' | t }}</option>
              <option value="NOTE">{{ 'iam.zametka_note' | t }}</option>
            </select>
          </div>

          <!-- Code & Name -->
          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label" for="custom-field-code">
                {{ 'iam.kod_polya_slug' | t }} <span class="req" aria-hidden="true">*</span>
              </label>
              <input
                id="custom-field-code"
                name="code"
                type="text"
                class="form-input font-mono"
                [(ngModel)]="formData.code"
                (input)="onCodeInput($event)"
                [disabled]="!!editingField"
                [placeholder]="'iam.naprimer_inn_budget' | t"
                required
              />
              <span class="form-hint" *ngIf="!editingField">{{ 'iam.kod_polya_help' | t }}</span>
              <span class="form-hint readonly-hint" *ngIf="editingField">{{ 'iam.kod_polya_readonly' | t }}</span>
            </div>

            <div class="form-group flex-1">
              <label class="form-label" for="custom-field-name">
                {{ 'iam.nazvanie_polya' | t }} <span class="req" aria-hidden="true">*</span>
              </label>
              <input
                id="custom-field-name"
                name="name"
                type="text"
                class="form-input"
                [(ngModel)]="formData.name"
                [placeholder]="'iam.naprimer_inn_byudzhet_proekta' | t"
                required
              />
            </div>
          </div>

          <!-- Type, Default Value & Order -->
          <div class="form-row">
            <div class="form-group flex-1" *ngIf="!editingField">
              <label class="form-label" for="custom-field-type">
                {{ 'iam.tip_dannyh' | t }} <span class="req" aria-hidden="true">*</span>
              </label>
              <select id="custom-field-type" name="fieldType" class="form-select" [(ngModel)]="formData.fieldType" required>
                <option value="string">{{ 'iam.tekst_string' | t }}</option>
                <option value="number">{{ 'iam.chislo_number' | t }}</option>
                <option value="boolean">{{ 'iam.logicheskiy_pereklyuchatel_boolean' | t }}</option>
                <option value="date">{{ 'iam.data_date' | t }}</option>
                <option value="select">{{ 'iam.vypadayuschiy_spisok_select' | t }}</option>
                <option value="user_ref">{{ 'iam.ssylka_na_polzovatelya_user_ref' | t }}</option>
              </select>
            </div>

            <div class="form-group flex-1">
              <label class="form-label" for="custom-field-default">
                {{ 'iam.znachenie_po_umolchaniyu' | t }}
              </label>
              <input
                id="custom-field-default"
                name="defaultValue"
                type="text"
                class="form-input"
                [(ngModel)]="formData.defaultValue"
                [placeholder]="'iam.ne_obyazatelno' | t"
              />
            </div>

            <div class="form-group order-input-group">
              <label class="form-label" for="custom-field-order">
                {{ 'iam.poryadok_sortirovki' | t }}
              </label>
              <input
                id="custom-field-order"
                name="orderNo"
                type="number"
                class="form-input font-mono"
                [(ngModel)]="formData.orderNo"
                [placeholder]="'iam.poryadok_sortirovki_hint' | t"
              />
            </div>
          </div>

          <!-- Options for select type -->
          <div class="form-group" *ngIf="formData.fieldType === 'select'">
            <label class="form-label" for="custom-field-options">
              {{ 'iam.varianty_spiska' | t }} <span class="req" aria-hidden="true">*</span>
            </label>
            <textarea
              id="custom-field-options"
              name="optionsText"
              class="form-input options-input"
              [(ngModel)]="formData.optionsText"
              rows="4"
              [placeholder]="'iam.po_odnomu_variantu_v_stroke' | t"
              required
            ></textarea>
            <span class="form-hint">{{ 'iam.po_odnomu_variantu_v_stroke_dlya_otdelnogo_koda_' | t }}</span>
          </div>

          <!-- Required Toggle -->
          <div class="form-group checkbox-group">
            <label class="checkbox-label" for="custom-field-required">
              <input id="custom-field-required" name="isRequired" type="checkbox" [(ngModel)]="formData.isRequired" />
              <span>{{ 'iam.obyazatelnoe_dlya_zapolneniya' | t }}</span>
            </label>
          </div>

          <p *ngIf="formError" class="form-error" role="alert">{{ formError }}</p>

          <div class="modal-actions">
            <ui-button type="button" variant="secondary" (onClick)="closeModal()">{{ 'common.cancel' | t }}</ui-button>
            <ui-button type="submit" variant="primary" [loading]="saving">{{ 'common.save' | t }}</ui-button>
          </div>
        </form>
      </ui-modal>

      <!-- Delete Confirmation Modal -->
      <ui-modal
        [isOpen]="fieldToDelete !== null"
        [title]="'iam.udalenie_dinamicheskogo_polya' | t"
        size="sm"
        (close)="fieldToDelete = null"
      >
        <div body class="delete-confirmation" *ngIf="fieldToDelete as field">
          <p>{{ 'iam.udalit_dinamicheskoe_pole' | t }} <strong>«{{ field.name }}»</strong> ({{ field.code }})?</p>
          <span>{{ 'iam.sohranennye_znacheniya_etogo_atributa_mogut_stat' | t }}</span>
        </div>
        <div footer>
          <ui-button type="button" variant="secondary" (onClick)="fieldToDelete = null">{{ 'common.cancel' | t }}</ui-button>
          <ui-button type="button" variant="danger" [loading]="isDeleting" (onClick)="confirmDeleteField()">{{ 'common.delete' | t }}</ui-button>
        </div>
      </ui-modal>
    </div>
  `,
  styles: [`
    .custom-fields-page {
      padding: 0;
      max-width: 1400px;
      margin: 0 auto;
    }

    .view-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
      gap: 16px;
    }

    .title-with-badge {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .view-title {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-main);
      margin: 0;
      letter-spacing: -0.02em;
    }

    .count-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px 10px;
      border-radius: 12px;
      background: var(--primary-subtle, rgba(59, 130, 246, 0.1));
      color: var(--primary);
      font-size: 13px;
      font-weight: 600;
    }

    .view-subtitle {
      display: block;
      font-size: 13px;
      color: var(--text-light);
      margin-top: 4px;
    }

    .header-actions {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .icon-refresh-btn {
      width: 38px;
      height: 38px;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      color: var(--text-light);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
    }

    .icon-refresh-btn:hover:not(:disabled) {
      background: var(--bg-hover);
      color: var(--text-main);
      border-color: var(--border-strong, var(--border-color));
    }

    .icon-refresh-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .icon-refresh-btn.spinning .material-symbols-outlined {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      100% { transform: rotate(360deg); }
    }

    .toolbar-container {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .filter-tabs {
      display: flex;
      gap: 6px;
      background: var(--bg-hover);
      padding: 4px;
      border-radius: 10px;
      border: 1px solid var(--border-subtle);
      overflow-x: auto;
      max-width: 100%;
    }

    .tab-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: 7px;
      border: none;
      background: transparent;
      color: var(--text-light);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s;
    }

    .tab-icon {
      font-size: 17px;
      opacity: 0.85;
    }

    .tab-count {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.08);
      font-weight: 600;
    }

    .tab-btn:hover {
      background: rgba(0, 0, 0, 0.04);
      color: var(--text-main);
    }

    .tab-btn.active {
      background: var(--primary);
      color: var(--text-inverse, #fff);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    }

    .tab-btn.active .tab-count {
      background: rgba(255, 255, 255, 0.25);
      color: #fff;
    }

    .search-box {
      position: relative;
      display: flex;
      align-items: center;
      min-width: 260px;
      flex: 0 1 340px;
    }

    .search-icon {
      position: absolute;
      left: 10px;
      font-size: 19px;
      color: var(--text-light);
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      height: 38px;
      padding: 0 32px 0 36px;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-size: 13px;
      color: var(--text-main);
      transition: all 0.2s;
    }

    .search-input:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-subtle, rgba(59, 130, 246, 0.15));
    }

    .clear-search-btn {
      position: absolute;
      right: 8px;
      background: transparent;
      border: none;
      color: var(--text-light);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2px;
      border-radius: 50%;
    }

    .clear-search-btn:hover {
      color: var(--text-main);
      background: var(--bg-hover);
    }

    .clear-search-btn .material-symbols-outlined {
      font-size: 16px;
    }

    .card {
      background: var(--bg-surface);
      border-radius: 12px;
      border: 1px solid var(--border-color);
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    }

    .table-wrapper {
      overflow-x: auto;
    }

    .data-table {
      width: 100%;
      min-width: 820px;
      border-collapse: collapse;
      text-align: left;
    }

    .data-table th {
      padding: 12px 16px;
      background: var(--bg-hover);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
    }

    .col-order {
      width: 50px;
      text-align: center;
    }

    .order-cell {
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
    }

    .data-table td {
      padding: 13px 16px;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 14px;
      color: var(--text-main);
      vertical-align: middle;
    }

    .data-table tr:hover td {
      background: var(--bg-hover);
    }

    .code-cell {
      color: var(--primary-text, var(--primary));
      font-size: 13px;
    }

    .code-badge-wrap {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--bg-hover);
      padding: 3px 8px;
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
    }

    .code-text {
      font-weight: 600;
    }

    .copy-code-btn {
      background: transparent;
      border: none;
      padding: 1px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-light);
      cursor: pointer;
      border-radius: 4px;
      opacity: 0.7;
      transition: all 0.15s;
    }

    .copy-code-btn:hover {
      opacity: 1;
      color: var(--primary);
      background: rgba(0, 0, 0, 0.05);
    }

    .copy-code-btn .material-symbols-outlined {
      font-size: 14px;
    }

    .name-cell {
      font-weight: 500;
    }

    .entity-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 9px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .entity-icon {
      font-size: 15px;
    }

    .entity-badge.user { background: var(--primary-subtle, #e0f2fe); color: var(--primary, #0284c7); }
    .entity-badge.project { background: var(--info-bg, #e0e7ff); color: var(--info, #4f46e5); }
    .entity-badge.task { background: var(--success-bg, #dcfce7); color: var(--success, #16a34a); }
    .entity-badge.note { background: var(--warning-bg, #fef3c7); color: var(--warning, #d97706); }
    .entity-badge.custom-entity { background: var(--bg-hover); color: var(--text-main); border: 1px solid var(--border-color); }

    .type-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 6px;
      background: var(--bg-hover);
      border: 1px solid var(--border-subtle);
      font-size: 12px;
      color: var(--text-main);
      font-weight: 500;
    }

    .type-icon {
      font-size: 15px;
      color: var(--text-light);
    }

    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      background: var(--bg-hover);
      color: var(--text-muted);
    }

    .status-indicator.active {
      background: var(--success-bg, #dcfce7);
      color: var(--success, #16a34a);
    }

    .status-icon {
      font-size: 15px;
    }

    .action-btn {
      width: 32px;
      height: 32px;
      padding: 0;
      border-radius: 6px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-light);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s;
    }

    .action-btn:hover {
      background: var(--bg-hover);
      color: var(--text-main);
    }

    .action-btn.danger:hover {
      background: var(--danger-bg, #fee2e2);
      color: var(--danger, #dc2626);
    }

    .loading-cell {
      padding: 60px 16px !important;
      text-align: center;
    }

    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      color: var(--text-light);
      font-size: 14px;
    }

    .spin-icon {
      font-size: 32px;
      color: var(--primary);
      animation: spin 1s linear infinite;
    }

    .empty-row {
      text-align: center;
      padding: 56px 16px !important;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      color: var(--text-light);
    }

    .empty-icon {
      font-size: 48px;
      opacity: 0.4;
      color: var(--text-light);
    }

    .empty-state p {
      margin: 0;
      font-size: 14px;
    }

    .modal-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 4px 0;
    }

    .form-row {
      display: flex;
      gap: 16px;
    }

    .flex-1 { flex: 1; }

    .order-input-group {
      flex: 0 0 110px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-main);
    }

    .req { color: var(--danger, #dc2626); }

    .form-input, .form-select {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 9px 12px;
      color: var(--text-main);
      font-size: 14px;
      transition: border-color 0.2s;
    }

    .form-input:focus, .form-select:focus {
      outline: none;
      border-color: var(--primary);
    }

    .form-input:disabled {
      background: var(--bg-hover);
      color: var(--text-muted);
      cursor: not-allowed;
    }

    .options-input {
      min-height: 92px;
      resize: vertical;
      font-family: inherit;
    }

    .form-hint {
      color: var(--text-light);
      font-size: 12px;
      line-height: 1.4;
    }

    .readonly-hint {
      color: var(--warning, #d97706);
    }

    .form-error {
      margin: 0;
      color: var(--danger, #dc2626);
      font-size: 13px;
    }

    .checkbox-group {
      margin-top: 4px;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: var(--text-main);
      cursor: pointer;
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--border-color);
    }

    .delete-confirmation {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .delete-confirmation p { margin: 0; font-size: 14px; }
    .delete-confirmation span { color: var(--text-muted); font-size: 12px; }

    @media (max-width: 768px) {
      .view-header {
        flex-direction: column;
        align-items: stretch;
      }

      .toolbar-container {
        flex-direction: column;
        align-items: stretch;
      }

      .search-box {
        width: 100%;
        flex: 1 1 auto;
      }

      .form-row {
        flex-direction: column;
        gap: 12px;
      }

      .order-input-group {
        flex: 1 1 auto;
      }
    }
  `]
})
export class CustomFieldsComponent implements OnInit {
  private readonly uiI18n = inject(I18nService);
  fields: CustomField[] = [];
  filteredFields: CustomField[] = [];
  selectedEntity: string = 'ALL';
  searchQuery: string = '';

  isLoading: boolean = false;
  showModal: boolean = false;
  editingField: CustomField | null = null;
  saving: boolean = false;
  isDeleting: boolean = false;
  formError: string = '';
  fieldToDelete: CustomField | null = null;

  formData: {
    entityType: string;
    code: string;
    name: string;
    fieldType: string;
    isRequired: boolean;
    defaultValue: string;
    orderNo: number;
    optionsText: string;
  } = {
    entityType: 'USER',
    code: '',
    name: '',
    fieldType: 'string',
    isRequired: false,
    defaultValue: '',
    orderNo: 0,
    optionsText: ''
  };

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private permService: PermissionService
  ) {}

  ngOnInit() {
    this.loadFields();
  }

  canManage(): boolean {
    return this.permService.hasPermission('md.custom_fields', 'create') ||
           this.permService.hasPermission('md.custom_fields', 'update') ||
           this.permService.hasPermission('system.custom_fields', 'create');
  }

  get availableEntities(): string[] {
    const base = ['ALL', 'USER', 'PROJECT', 'TASK', 'NOTE'];
    const dynamic = this.fields
      .map(f => f.entityType)
      .filter(t => t && !base.includes(t));
    return [...base, ...Array.from(new Set(dynamic))];
  }

  getEntityCount(ent: string): number {
    if (ent === 'ALL') return this.fields.length;
    return this.fields.filter(f => f.entityType === ent).length;
  }

  loadFields() {
    this.isLoading = true;
    this.api.get<CustomField[]>('/custom-fields').subscribe({
      next: data => {
        this.fields = data || [];
        this.applyFilter();
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.toast.error(this.uiI18n.translate('iam.oshibka_zagruzki_dinamicheskih_poley'));
      }
    });
  }

  filterByEntity(entity: string) {
    this.selectedEntity = entity;
    this.applyFilter();
  }

  clearSearch() {
    this.searchQuery = '';
    this.applyFilter();
  }

  applyFilter() {
    const q = (this.searchQuery || '').trim().toLowerCase();
    const entity = this.selectedEntity;

    let result = [...this.fields];

    if (entity !== 'ALL') {
      result = result.filter(f => f.entityType === entity);
    }

    if (q) {
      result = result.filter(f =>
        (f.code && f.code.toLowerCase().includes(q)) ||
        (f.name && f.name.toLowerCase().includes(q)) ||
        (f.defaultValue && f.defaultValue.toLowerCase().includes(q)) ||
        (f.fieldType && f.fieldType.toLowerCase().includes(q))
      );
    }

    // Sort by orderNo, then name
    result.sort((a, b) => {
      const orderDiff = (a.orderNo || 0) - (b.orderNo || 0);
      if (orderDiff !== 0) return orderDiff;
      return (a.name || '').localeCompare(b.name || '');
    });

    this.filteredFields = result;
  }

  copyCode(code: string) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        this.toast.success(this.uiI18n.translate('iam.kod_skopirovan'));
      }).catch(() => {});
    }
  }

  onCodeInput(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input) return;
    const sanitized = input.value.toLowerCase().replace(/\s+/g, '_');
    this.formData.code = sanitized;
  }

  getEntityLabel(ent: string): string {
    switch (ent) {
      case 'ALL': return this.uiI18n.translate('iam.vse_suschnosti');
      case 'USER': return this.uiI18n.translate('nav.users');
      case 'PROJECT': return this.uiI18n.translate('nav.projects');
      case 'TASK': return this.uiI18n.translate('nav.tasks');
      case 'NOTE': return this.uiI18n.translate('iam.zametka_note');
      default: return ent;
    }
  }

  getEntityIcon(ent: string): string {
    switch (ent.toUpperCase()) {
      case 'ALL': return 'apps';
      case 'USER': return 'person';
      case 'PROJECT': return 'folder';
      case 'TASK': return 'task_alt';
      case 'NOTE': return 'description';
      case 'ORGANIZATION_UNIT': return 'corporate_fare';
      default: return 'data_object';
    }
  }

  getEntityBadgeClass(entity: string): string {
    const ent = (entity || '').toLowerCase();
    if (['user', 'project', 'task', 'note'].includes(ent)) {
      return ent;
    }
    return 'custom-entity';
  }

  getTypeName(type: string): string {
    switch (type) {
      case 'string': return this.uiI18n.translate('iam.tekst');
      case 'number': return this.uiI18n.translate('iam.chislo');
      case 'boolean': return this.uiI18n.translate('iam.da_net');
      case 'date': return this.uiI18n.translate('iam.data');
      case 'select': return this.uiI18n.translate('projects.spisok');
      case 'user_ref': return this.uiI18n.translate('iam.user_ref');
      default: return type;
    }
  }

  getTypeIcon(type: string): string {
    switch (type) {
      case 'string': return 'format_quote';
      case 'number': return 'tag';
      case 'boolean': return 'toggle_on';
      case 'date': return 'calendar_today';
      case 'select': return 'list';
      case 'user_ref': return 'person';
      default: return 'help';
    }
  }

  openCreateModal() {
    this.editingField = null;
    this.formData = {
      entityType: this.selectedEntity !== 'ALL' ? this.selectedEntity : 'USER',
      code: '',
      name: '',
      fieldType: 'string',
      isRequired: false,
      defaultValue: '',
      orderNo: (this.fields.length + 1) * 10,
      optionsText: ''
    };
    this.formError = '';
    this.showModal = true;
  }

  openEditModal(f: CustomField) {
    this.editingField = f;
    this.formData = {
      entityType: f.entityType,
      code: f.code,
      name: f.name,
      fieldType: f.fieldType,
      isRequired: f.isRequired,
      defaultValue: f.defaultValue || '',
      orderNo: f.orderNo || 0,
      optionsText: this.optionsToText(f.optionsJson)
    };
    this.formError = '';
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
    this.editingField = null;
    this.formError = '';
  }

  saveField() {
    if (!this.formData.name || !this.formData.code) {
      this.formError = this.uiI18n.translate('iam.zapolnite_obyazatelnye_polya');
      this.toast.error(this.uiI18n.translate('iam.zapolnite_obyazatelnye_polya'));
      return;
    }

    if (!this.editingField) {
      const codePattern = /^[a-z][a-z0-9_]{1,63}$/;
      if (!codePattern.test(this.formData.code)) {
        this.formError = this.uiI18n.translate('iam.invalid_code_slug');
        this.toast.error(this.uiI18n.translate('iam.invalid_code_slug'));
        return;
      }
    }

    const options = this.parseOptionsText(this.formData.optionsText);
    if (this.formData.fieldType === 'select' && options.length === 0) {
      this.formError = this.uiI18n.translate('iam.dobavte_hotya_by_odin_variant_spiska');
      return;
    }

    this.formError = '';
    this.saving = true;
    if (this.editingField) {
      this.api.patch(`/custom-fields/${this.editingField.id}`, {
        name: this.formData.name,
        isRequired: this.formData.isRequired,
        defaultValue: this.formData.defaultValue,
        options,
        orderNo: Number(this.formData.orderNo) || 0
      }).subscribe({
        next: () => {
          this.saving = false;
          this.toast.success(this.uiI18n.translate('iam.pole_uspeshno_obnovleno'));
          this.closeModal();
          this.loadFields();
        },
        error: () => {
          this.saving = false;
          this.toast.error(this.uiI18n.translate('iam.oshibka_sohraneniya_polya'));
        }
      });
    } else {
      this.api.post('/custom-fields', {
        entityType: this.formData.entityType,
        code: this.formData.code,
        name: this.formData.name,
        fieldType: this.formData.fieldType,
        isRequired: this.formData.isRequired,
        defaultValue: this.formData.defaultValue,
        orderNo: Number(this.formData.orderNo) || 0,
        options
      }).subscribe({
        next: () => {
          this.saving = false;
          this.toast.success(this.uiI18n.translate('iam.pole_uspeshno_sozdano'));
          this.closeModal();
          this.loadFields();
        },
        error: () => {
          this.saving = false;
          this.toast.error(this.uiI18n.translate('iam.oshibka_sozdaniya_polya'));
        }
      });
    }
  }

  requestDeleteField(field: CustomField) {
    this.fieldToDelete = field;
  }

  confirmDeleteField() {
    if (!this.fieldToDelete) return;
    const field = this.fieldToDelete;
    this.isDeleting = true;
    this.api.delete(`/custom-fields/${field.id}`).subscribe({
      next: () => {
        this.isDeleting = false;
        this.fieldToDelete = null;
        this.toast.success(this.uiI18n.translate('iam.pole_udaleno'));
        this.loadFields();
      },
      error: () => {
        this.isDeleting = false;
        this.toast.error(this.uiI18n.translate('iam.oshibka_udaleniya_polya'));
      }
    });
  }

  private parseOptionsText(value: string | undefined): Array<string | { value: string; label: string }> {
    return (value || '')
      .split(/\r?\n/)
      .map(option => option.trim())
      .filter((option, index, all) => option.length > 0 && all.indexOf(option) === index)
      .map(option => {
        const separatorIndex = option.indexOf('|');
        if (separatorIndex < 0) return option;

        const optionValue = option.slice(0, separatorIndex).trim();
        const optionLabel = option.slice(separatorIndex + 1).trim();
        return optionValue && optionLabel
          ? { value: optionValue, label: optionLabel }
          : option;
      });
  }

  private optionsToText(optionsJson: string | undefined): string {
    if (!optionsJson) return '';
    try {
      const options: unknown = JSON.parse(optionsJson);
      if (!Array.isArray(options)) return '';
      return options
        .map(option => {
          if (typeof option !== 'object' || option === null) return String(option);
          if (!('value' in option)) return '';

          const optionValue = String((option as { value: unknown }).value);
          const optionLabel = 'label' in option
            ? String((option as { label: unknown }).label)
            : optionValue;
          return optionValue === optionLabel ? optionValue : `${optionValue} | ${optionLabel}`;
        })
        .filter(Boolean)
        .join('\n');
    } catch {
      return '';
    }
  }
}
