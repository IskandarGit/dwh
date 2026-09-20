import { Component, OnDestroy, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { canonicalRecordId, recordResponseMatches, safeNumericRecordId } from '../../../core/services/search-target';
import { RecordNavigationDecision } from '../../../core/guards/record-navigation.guard';
import { Subscription } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination.component';
import { Project, ProjectTaskStats } from '../../../core/models/task.models';
import { UiCustomFieldsComponent } from '../../../shared/ui/ui-custom-fields.component';
import { CustomField } from '../../../core/models/custom-field.models';
import { TranslatePipe, I18nService } from '../../../core/services/i18n.service';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    FormsModule,
    RouterModule,
    UiButtonComponent,
    UiModalComponent,
    UiPaginationComponent,
    UiCustomFieldsComponent
  ],

  template: `
    <ui-modal *ngIf="routeRecordId() !== null" [isOpen]="true" [title]="'projects.proekt' | t" size="sm" (close)="closeRecordView()">
      <div body>
        <p *ngIf="recordLoading()" role="status">{{ 'search.record_loading' | t }}</p>
        <div *ngIf="recordError()" role="alert">
          <p>{{ (recordNotFound() ? 'search.record_not_found' : 'search.record_load_error') | t }}</p>
          <ui-button *ngIf="!recordNotFound()" variant="secondary" (onClick)="loadRecordView(routeRecordId())">{{ 'audit.retry' | t }}</ui-button>
        </div>
        <div *ngIf="viewingProject() as project" [attr.data-record-id]="routeRecordId()">
          <p>#{{ routeRecordId() }}</p>
          <h3>{{ project.name }}</h3>
          <p>{{ project.description }}</p>
          <p>{{ (project.state === 'A' ? 'common.active_masculine' : 'common.blocked_masculine') | t }}</p>
          <div class="attributes-stack" *ngIf="hasAttributes(project.attributes)">
            <h4>{{ 'projects.custom_fields' | t }}</h4>
            <div *ngFor="let item of formatAttributes(project.attributes)" class="attr-stack-item">
              <span class="attr-k">{{ item.key }}:</span>
              <span class="attr-v">{{ item.value }}</span>
            </div>
          </div>
        </div>
      </div>
      <div footer><ui-button variant="secondary" (onClick)="closeRecordView()">{{ 'search.back_to_list' | t }}</ui-button></div>
    </ui-modal>
    <div class="projects-page">
      <!-- Header -->
      <div class="view-header">
        <div class="header-left">
          <h1 class="view-title">{{ 'nav.projects' | t }}</h1>
          <span *ngIf="isListReady()" class="count-badge">{{ filteredProjects().length }}</span>

          <!-- View Mode Switcher -->
          <div class="status-tabs" role="group" [attr.aria-label]="'projects.rezhim_otobrazheniya_proektov' | t">
            <button
              type="button"
              class="status-tab"
              [class.active]="viewMode === 'list'"
              [attr.aria-pressed]="viewMode === 'list'"
              (click)="viewMode = 'list'"
              [title]="'projects.spisok_tablica' | t"
            >
              <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">table_rows</span>
              <span>{{ 'projects.spisok' | t }}</span>
            </button>
            <button
              type="button"
              class="status-tab"
              [class.active]="viewMode === 'cards'"
              [attr.aria-pressed]="viewMode === 'cards'"
              (click)="viewMode = 'cards'"
              [title]="'projects.kartochki' | t"
            >
              <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">grid_view</span>
              <span>{{ 'projects.kartochki' | t }}</span>
            </button>
          </div>
        </div>

        <div class="header-right">
          <ui-button
            *ngIf="canCreateProject()"
            variant="primary"
            size="md"
            icon="add"
            (onClick)="openCreateModal()"
          >
            {{ 'projects.novyy_proekt' | t }}
          </ui-button>
        </div>
      </div>

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="search-field">
          <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
          <label class="sr-only" for="project-search">{{ 'projects.poisk_proektov' | t }}</label>
          <input
            id="project-search"
            name="projectSearch"
            type="text"
            class="search-input"
            [placeholder]="'projects.poisk_po_nazvaniyu_ili_opisaniyu' | t"
            [ngModel]="searchQuery"
            (ngModelChange)="setSearchQuery($event)"
          />
          <button *ngIf="searchQuery" type="button" class="btn-icon project-search-clear" style="position: absolute; right: 6px;" [attr.aria-label]="'projects.ochistit_poisk_proektov' | t" (click)="clearSearch()">
            <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">close</span>
          </button>
        </div>

        <div class="status-tabs" role="group" [attr.aria-label]="'projects.filtr_proektov_po_statusu' | t">
          <button
            type="button"
            class="status-tab"
            data-testid="project-state-filter"
            [class.active]="selectedState === 'all'"
            [attr.aria-pressed]="selectedState === 'all'"
            (click)="setSelectedState('all')"
          >
            {{ 'common.all' | t }}
          </button>
          <button
            type="button"
            class="status-tab"
            data-testid="project-state-filter"
            [class.active]="selectedState === 'A'"
            [attr.aria-pressed]="selectedState === 'A'"
            (click)="setSelectedState('A')"
          >
            <span class="status-tab-dot" style="background-color: var(--success);" aria-hidden="true"></span>
            {{ 'iam.aktivnye' | t }}
          </button>
          <button
            type="button"
            class="status-tab"
            data-testid="project-state-filter"
            [class.active]="selectedState === 'P'"
            [attr.aria-pressed]="selectedState === 'P'"
            (click)="setSelectedState('P')"
          >
            <span class="status-tab-dot" style="background-color: var(--text-light);" aria-hidden="true"></span>
            {{ 'projects.arhiv' | t }}
          </button>
        </div>
      </div>

      <div
        *ngIf="isLoading()"
        class="request-state"
        data-testid="projects-list-loading"
        role="status"
        aria-live="polite"
      >
        {{ 'projects.loading_projects' | t }}
      </div>
      <div *ngIf="listLoadError()" class="request-state request-error" data-testid="projects-list-error" role="alert">
        <span>{{ 'projects.load_projects_error' | t }}</span>
        <button type="button" class="request-retry projects-list-retry" (click)="loadProjects()">
          {{ 'projects.retry_projects' | t }}
        </button>
      </div>

      <div
        *ngIf="!canViewTasks()"
        class="stats-state"
        data-testid="projects-stats-permission"
        role="status"
      >
        {{ 'projects.stats_permission' | t }}
      </div>
      <div
        *ngIf="canViewTasks() && statsLoading()"
        class="stats-state"
        data-testid="projects-stats-loading"
        role="status"
        aria-live="polite"
      >
        {{ 'projects.loading_stats' | t }}
      </div>
      <div
        *ngIf="canViewTasks() && statsLoadError()"
        class="stats-state request-error"
        data-testid="projects-stats-error"
        role="alert"
      >
        <span>{{ 'projects.load_stats_error' | t }}</span>
        <button type="button" class="request-retry projects-stats-retry" (click)="loadStats()">
          {{ 'projects.retry_stats' | t }}
        </button>
      </div>
      <div *ngIf="canViewTasks() && statsLoaded()" class="stats-state" data-testid="projects-stats-scope" role="status">
        {{ 'projects.closed_stats_scope' | t }}
      </div>

      <!-- ======================================================================= -->
      <!-- VIEW 1: TABLE / LIST VIEW (Default)                                     -->
      <!-- ======================================================================= -->
      <div class="table-card" *ngIf="viewMode === 'list' && isListReady()">
        <div class="table-wrapper" role="region" [attr.aria-label]="'projects.tablica_proektov' | t" tabindex="0">
          <table class="data-table" [attr.aria-label]="'projects.spisok_proektov' | t">
            <thead>
              <tr>
                <th style="width: 60px;">ID</th>
                <th>{{ 'projects.proekt' | t }}</th>
                <th style="width: 110px;">{{ 'common.status' | t }}</th>
                <th *ngIf="canViewTasks()" style="width: 220px;">{{ 'projects.closed_tasks' | t }}</th>
                <th style="width: 120px;">{{ 'iam.sozdan' | t }}</th>
                <th class="text-right" style="width: 140px;">{{ 'common.actions' | t }}</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let p of paginatedProjects()" class="project-row">
                <td class="tabular-nums font-mono text-muted">#{{ p.id }}</td>
                <td>
                  <div class="project-title-cell">
                    <span class="material-symbols-outlined folder-icon" aria-hidden="true">folder</span>
                    <div class="project-info-group">
                      <button *ngIf="canViewTasks(); else plainProjectName" type="button" class="project-name" (click)="viewProjectTasks(p)">
                        {{ p.name }}
                      </button>
                      <ng-template #plainProjectName><span class="project-name-text">{{ p.name }}</span></ng-template>
                      <span *ngIf="p.description" class="project-desc-line">{{ p.description }}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <span class="status-pill" [class.active]="p.state === 'A'">
                    <span class="status-dot" [class.active]="p.state === 'A'"></span>
                    {{ (p.state === 'A' ? 'projects.state_active' : 'projects.state_archived') | t }}
                  </span>
                </td>
                <td *ngIf="canViewTasks()">
                  <div *ngIf="hasProjectStats(p.id); else unknownTableStats" class="progress-cell">
                    <div class="progress-labels">
                      <span class="progress-count tabular-nums">
                        {{ 'projects.closed_ratio' | t:{done: getProjectDoneCount(p.id), total: getProjectTotalCount(p.id)} }}
                      </span>
                      <span class="progress-percent tabular-nums">
                        {{ getProjectPercent(p.id) }}%
                      </span>
                    </div>
                    <div
                      class="progress-bar-bg"
                      role="progressbar"
                      [attr.aria-label]="'projects.closed_progress_named' | t:{name: p.name}"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      [attr.aria-valuenow]="getProjectPercent(p.id)"
                    >
                      <div
                        class="progress-bar-fill"
                        [style.width.%]="getProjectPercent(p.id)"
                        [class.complete]="getProjectPercent(p.id) === 100 && getProjectTotalCount(p.id) > 0"
                      ></div>
                    </div>
                  </div>
                  <ng-template #unknownTableStats><span class="stats-unknown">{{ 'projects.stats_unknown' | t }}</span></ng-template>
                </td>
                <td>
                  <span class="tabular-nums text-muted text-xs">
                    {{ p.createdAt | date:'dd.MM.yyyy' }}
                  </span>
                </td>
                <td class="text-right">
                  <div class="row-action-btns">
                    <button
                      *ngIf="canViewTasks()"
                      type="button"
                      class="action-link-btn"
                      [attr.aria-label]="'projects.open_tasks_named' | t:{name: p.name}"
                      [title]="'projects.pereyti_k_zadacham_proekta' | t"
                      (click)="viewProjectTasks(p)"
                    >
                      <span class="material-symbols-outlined" aria-hidden="true">task_alt</span>
                      {{ 'nav.tasks' | t }}
                    </button>
                    <button
                      *ngIf="canUpdateProject()"
                      type="button"
                      class="icon-ghost-btn"
                      [attr.aria-label]="'projects.edit_named' | t:{name: p.name}"
                      [title]="'projects.redaktirovat_proekt' | t"
                      (click)="openEditModal(p)"
                    >
                      <span class="material-symbols-outlined" aria-hidden="true">edit</span>
                    </button>
                  </div>
                </td>
              </tr>

              <tr *ngIf="filteredProjects().length === 0">
                <td [attr.colspan]="canViewTasks() ? 6 : 5" class="empty-state-cell">
                  <span class="material-symbols-outlined empty-icon" aria-hidden="true">folder_off</span>
                  <p>{{ 'projects.proekty_ne_naydeny' | t }}</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <ui-pagination
          [totalItems]="filteredProjects().length"
          [currentPage]="currentPage"
          [pageSize]="pageSize"
          (pageChange)="setPage($event)"
          (pageSizeChange)="setPageSize($event)"
        ></ui-pagination>
      </div>

      <!-- ======================================================================= -->
      <!-- VIEW 2: CARDS GRID VIEW                                                 -->
      <!-- ======================================================================= -->
      <div class="cards-view-wrapper" *ngIf="viewMode === 'cards' && isListReady()">
        <div class="projects-grid">
          <div
            *ngFor="let p of paginatedProjects()"
            class="project-card"
          >
            <div class="card-top">
              <div class="project-icon-box">
                <span class="material-symbols-outlined" aria-hidden="true">folder</span>
              </div>
              <div class="card-top-right">
                <span class="status-pill" [class.active]="p.state === 'A'">
                  <span class="status-dot" [class.active]="p.state === 'A'"></span>
                  {{ (p.state === 'A' ? 'projects.state_active' : 'projects.state_archived') | t }}
                </span>
                <button
                  *ngIf="canUpdateProject()"
                  type="button"
                  class="edit-btn"
                  [attr.aria-label]="'projects.edit_named' | t:{name: p.name}"
                  [title]="'projects.redaktirovat_proekt' | t"
                  (click)="openEditModal(p)"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">edit</span>
                </button>
              </div>
            </div>

            <div class="card-content">
              <h3 class="project-title">
                <button *ngIf="canViewTasks(); else plainCardProjectName" type="button" class="project-title-btn" (click)="viewProjectTasks(p)">
                  {{ p.name }}
                </button>
                <ng-template #plainCardProjectName><span class="project-name-text">{{ p.name }}</span></ng-template>
              </h3>
              <p class="project-desc">{{ p.description || ('projects.description_missing' | t) }}</p>
            </div>

            <div *ngIf="canViewTasks() && hasProjectStats(p.id)" class="card-progress">
              <div class="progress-labels">
                <span class="progress-count tabular-nums">
                  {{ 'projects.closed_ratio' | t:{done: getProjectDoneCount(p.id), total: getProjectTotalCount(p.id)} }}
                </span>
                <span class="progress-percent tabular-nums">
                  {{ getProjectPercent(p.id) }}%
                </span>
              </div>
              <div
                class="progress-bar-bg"
                role="progressbar"
                [attr.aria-label]="'projects.closed_progress_named' | t:{name: p.name}"
                aria-valuemin="0"
                aria-valuemax="100"
                [attr.aria-valuenow]="getProjectPercent(p.id)"
              >
                <div
                  class="progress-bar-fill"
                  [style.width.%]="getProjectPercent(p.id)"
                  [class.complete]="getProjectPercent(p.id) === 100 && getProjectTotalCount(p.id) > 0"
                ></div>
              </div>
            </div>

            <div class="card-foot">
              <span class="foot-date tabular-nums">{{ 'projects.created_at' | t:{date: (p.createdAt | date:'dd.MM.yyyy') || ''} }}</span>
              <button *ngIf="canViewTasks() && hasProjectStats(p.id)" type="button" class="view-tasks-link" (click)="viewProjectTasks(p)">
                {{ 'projects.tasks_count_arrow' | t:{count: getProjectTotalCount(p.id)} }}
              </button>
              <span *ngIf="canViewTasks() && !hasProjectStats(p.id)" class="stats-unknown">{{ 'projects.stats_unknown' | t }}</span>
            </div>
          </div>

          <div *ngIf="filteredProjects().length === 0" class="empty-projects-cell">
            <span class="material-symbols-outlined empty-icon" aria-hidden="true">folder_off</span>
            <p>{{ 'projects.proekty_ne_naydeny' | t }}</p>
          </div>
        </div>

        <ui-pagination
          [totalItems]="filteredProjects().length"
          [currentPage]="currentPage"
          [pageSize]="pageSize"
          (pageChange)="setPage($event)"
          (pageSizeChange)="setPageSize($event)"
        ></ui-pagination>
      </div>
    </div>


    <!-- ======================================================================= -->
    <!-- Create Project Modal                                                    -->
    <!-- ======================================================================= -->
    <ui-modal
      [isOpen]="isCreateModalOpen()"
      [title]="'projects.sozdanie_novogo_proekta' | t"
      size="sm"
      [dismissible]="!isSubmitting()"
      (close)="requestCloseCreate()"
    >
      <form body id="project-create-form" (ngSubmit)="submitCreateProject()">
        <fieldset class="modal-form modal-form-fieldset project-create-form" [disabled]="isSubmitting()">
          <div class="form-group">
            <div class="label-row">
              <label class="clean-label" for="project-create-name">{{ 'projects.nazvanie_proekta' | t }}</label>
              <span class="req-tag">{{ 'projects.obyazatelnoe_pole' | t }}</span>
            </div>
            <input
              id="project-create-name"
              name="projectCreateName"
              type="text"
              class="clean-input"
              required
              [attr.aria-invalid]="isCreateSubmitted && !createForm.name.trim()"
              [attr.aria-describedby]="isCreateSubmitted && !createForm.name.trim() ? 'project-create-name-error' : null"
              [class.input-error]="isCreateSubmitted && !createForm.name.trim()"
              [(ngModel)]="createForm.name"
              [placeholder]="'projects.naprimer_vnedrenie_dwh_cdc' | t"
            />
            <span id="project-create-name-error" class="error-msg" *ngIf="isCreateSubmitted && !createForm.name.trim()">
              {{ 'projects.pozhaluysta_ukazhite_nazvanie_proekta' | t }}
            </span>
          </div>
          <div class="form-group">
            <div class="label-row">
              <label class="clean-label" for="project-create-description">{{ 'projects.opisanie_proekta' | t }}</label>
            </div>
            <textarea
              id="project-create-description"
              name="projectCreateDescription"
              class="clean-input clean-textarea"
              rows="3"
              [(ngModel)]="createForm.description"
              [placeholder]="'projects.celi_granicy_i_kontekst_proekta' | t"
            ></textarea>
          </div>
          <div class="form-group" *ngIf="projectCustomFields().length > 0">
            <ui-custom-fields
              [fields]="projectCustomFields()"
              [values]="createForm.attributes || {}"
              (valuesChange)="createForm.attributes = $event"
            ></ui-custom-fields>
          </div>
          <div *ngIf="createSaveError()" class="request-state request-error" data-testid="project-create-save-error" role="alert">
            {{ createSaveError() }}
          </div>
        </fieldset>
      </form>
      <div footer>
        <ui-button variant="secondary" size="md" [disabled]="isSubmitting()" (onClick)="requestCloseCreate()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button type="submit" form="project-create-form" variant="primary" size="md" [loading]="isSubmitting()">{{ 'projects.sozdat_proekt' | t }}</ui-button>
      </div>
    </ui-modal>

    <ui-modal
      [isOpen]="isCreateDiscardConfirmationOpen()"
      [title]="'projects.discard_create_title' | t"
      size="sm"
      (close)="cancelNavigationDiscard('create')"
    >
      <div body><p>{{ 'projects.discard_create_message' | t }}</p></div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="cancelNavigationDiscard('create')">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="danger" size="md" (onClick)="confirmDiscardCreate()">{{ 'projects.discard_create_action' | t }}</ui-button>
      </div>
    </ui-modal>

    <!-- ======================================================================= -->
    <!-- Edit Project Modal                                                      -->
    <!-- ======================================================================= -->
    <ui-modal
      [isOpen]="isEditModalOpen()"
      [title]="'projects.redaktirovanie_proekta' | t"
      size="sm"
      [dismissible]="!isSubmitting()"
      (close)="requestCloseEdit()"
    >
      <div body class="request-state" data-testid="project-edit-loading" *ngIf="editLoading()" role="status">
        {{ 'projects.edit_loading' | t }}
      </div>
      <div body class="request-state request-error" data-testid="project-edit-load-error" *ngIf="editLoadError()" role="alert">
        <span>{{ 'projects.edit_load_error' | t }}</span>
        <ui-button class="project-edit-retry" variant="secondary" size="sm" (onClick)="retryEditLoad()">{{ 'projects.retry_edit_load' | t }}</ui-button>
      </div>
      <form body id="project-edit-form" (ngSubmit)="submitEditProject()" *ngIf="editingProject as p">
        <fieldset class="modal-form modal-form-fieldset project-edit-form" [disabled]="isSubmitting()">
          <div class="form-group">
            <div class="label-row">
              <label class="clean-label" for="project-edit-name">{{ 'projects.nazvanie_proekta' | t }}</label>
              <span class="req-tag">{{ 'projects.obyazatelnoe_pole' | t }}</span>
            </div>
            <input
              id="project-edit-name"
              name="projectEditName"
              type="text"
              class="clean-input"
              required
              [attr.aria-invalid]="isEditSubmitted && !editForm.name.trim()"
              [attr.aria-describedby]="isEditSubmitted && !editForm.name.trim() ? 'project-edit-name-error' : null"
              [class.input-error]="isEditSubmitted && !editForm.name.trim()"
              [(ngModel)]="editForm.name"
            />
            <span id="project-edit-name-error" class="error-msg" *ngIf="isEditSubmitted && !editForm.name.trim()">
              {{ 'projects.nazvanie_proekta_ne_mozhet_byt_pustym' | t }}
            </span>
          </div>
          <div class="form-group">
            <div class="label-row">
              <label class="clean-label" for="project-edit-state">{{ 'iam.status_aktivnosti' | t }}</label>
            </div>
            <select id="project-edit-state" name="projectEditState" class="clean-input" [(ngModel)]="editForm.state">
              <option value="A">{{ 'projects.state_active' | t }}</option>
              <option value="P">{{ 'projects.state_archived' | t }}</option>
            </select>
          </div>
          <div class="form-group">
            <div class="label-row">
              <label class="clean-label" for="project-edit-description">{{ 'projects.opisanie' | t }}</label>
            </div>
            <textarea id="project-edit-description" name="projectEditDescription" class="clean-input clean-textarea" rows="3" [(ngModel)]="editForm.description"></textarea>
          </div>
          <div class="form-group" *ngIf="projectCustomFields().length > 0">
            <ui-custom-fields
              [fields]="projectCustomFields()"
              [values]="editForm.attributes || {}"
              (valuesChange)="editForm.attributes = $event"
            ></ui-custom-fields>
          </div>
          <div *ngIf="editSaveError()" class="request-state request-error" data-testid="project-edit-save-error" role="alert">
            {{ editSaveError() }}
          </div>
        </fieldset>
      </form>
      <div footer>
        <ui-button variant="secondary" size="md" [disabled]="isSubmitting()" (onClick)="requestCloseEdit()">{{ 'common.cancel' | t }}</ui-button>
        <ui-button *ngIf="editingProject" type="submit" form="project-edit-form" variant="primary" size="md" [loading]="isSubmitting()">{{ 'common.save' | t }}</ui-button>
      </div>
    </ui-modal>

    <ui-modal
      [isOpen]="isEditDiscardConfirmationOpen()"
      [title]="'projects.discard_edit_title' | t"
      size="sm"
      (close)="cancelNavigationDiscard('edit')"
    >
      <div body><p>{{ 'projects.discard_edit_message' | t }}</p></div>
      <div footer>
        <ui-button variant="secondary" size="md" (onClick)="cancelNavigationDiscard('edit')">{{ 'common.cancel' | t }}</ui-button>
        <ui-button variant="danger" size="md" (onClick)="confirmDiscardEdit()">{{ 'projects.discard_edit_action' | t }}</ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    .projects-page {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
    }

    /* Header */
    .view-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .header-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .view-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-main);
      margin: 0;
    }
    .proj-count {
      font-size: 12px;
      color: var(--text-muted);
      background-color: var(--bg-hover);
      padding: 1px 7px;
      border-radius: 10px;
      font-weight: 500;
      border: 1px solid var(--border-color);
    }

    /* View Switcher */
    .view-switcher {
      display: flex;
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 2px;
      gap: 2px;
    }
    .view-btn {
      border: none;
      background: transparent;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      border-radius: var(--radius-xs);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.1s ease;
    }
    .view-btn .material-symbols-outlined { font-size: 15px; }
    .view-btn.active {
      background-color: var(--bg-surface);
      color: var(--text-main);
      box-shadow: var(--shadow-sm);
    }

    .header-right { display: flex; align-items: center; gap: 8px; }

    /* Toolbar */
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 8px 12px;
    }
    .request-state,
    .stats-state {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 40px;
      padding: 9px 12px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      background-color: var(--bg-surface);
      color: var(--text-muted);
      font-size: 12px;
    }
    .request-error {
      border-color: var(--danger);
      background-color: var(--danger-bg);
      color: var(--danger);
    }
    .request-retry {
      min-height: 28px;
      padding: 3px 9px;
      border: 1px solid currentColor;
      border-radius: var(--radius-xs);
      background-color: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
    }
    .search-box {
      display: flex;
      align-items: center;
      gap: 6px;
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 4px 8px;
      width: 280px;
      max-width: 100%;
    }
    .search-box .icon { font-size: 16px; color: var(--text-muted); }
    .search-input {
      border: none;
      background: transparent;
      outline: none;
      font-size: 12px;
      color: var(--text-main);
      width: 100%;
    }
    .clear-btn {
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      padding: 0;
    }
    .clear-btn .material-symbols-outlined { font-size: 14px; }

    .segmented-control {
      display: flex;
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 2px;
      gap: 2px;
    }
    .segment-btn {
      border: none;
      background: transparent;
      padding: 3px 10px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      border-radius: var(--radius-xs);
      cursor: pointer;
      transition: all 0.1s ease;
    }
    .segment-btn.active {
      background-color: var(--bg-surface);
      color: var(--text-main);
      box-shadow: var(--shadow-sm);
    }

    /* Table Styles */
    .table-card {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      overflow: hidden;
    }
    .table-wrapper { overflow-x: auto; }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .data-table th {
      text-align: left;
      padding: 8px 12px;
      background-color: var(--bg-hover);
      border-bottom: 1px solid var(--border-color);
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .data-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-main);
    }
    .project-row { transition: background 0.1s ease; }
    .project-row:hover { background-color: var(--bg-hover); }
    .project-row:last-child td { border-bottom: none; }

    .project-title-cell {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .folder-icon { font-size: 20px; color: var(--warning); flex-shrink: 0; }
    .project-info-group { display: flex; flex-direction: column; gap: 2px; }
    .project-name,
    .project-title-btn,
    .view-tasks-link {
      border: 0;
      background: transparent;
      cursor: pointer;
      font: inherit;
      min-height: 28px;
      padding: 0 2px;
      text-align: left;
      display: inline-flex;
      align-items: center;
    }
    .project-name,
    .project-name-text { font-weight: 600; color: var(--text-main); }
    .project-name:hover,
    .project-title-btn:hover,
    .view-tasks-link:hover { text-decoration: underline; }
    .project-desc-line {
      font-size: 11px;
      color: var(--text-muted);
      max-width: 400px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-pill {
      font-size: 11px;
      font-weight: 500;
      padding: 2px 7px;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background-color: var(--bg-hover);
      color: var(--text-muted);
    }
    .status-pill.active { background-color: rgba(16,185,129,0.1); color: var(--success); }
    .status-dot { width: 5px; height: 5px; border-radius: 50%; background-color: var(--text-muted); }
    .status-dot.active { background-color: var(--success); }

    /* Progress Cell */
    .progress-cell { display: flex; flex-direction: column; gap: 4px; }
    .progress-labels { display: flex; justify-content: space-between; font-size: 11px; }
    .progress-count { color: var(--text-muted); font-size: 10px; }
    .progress-percent { font-weight: 600; color: var(--text-main); font-size: 10px; }
    .progress-bar-bg {
      height: 5px;
      background-color: var(--bg-hover);
      border-radius: 3px;
      overflow: hidden;
      border: 1px solid var(--border-color);
    }
    .progress-bar-fill {
      height: 100%;
      background-color: var(--primary);
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    .progress-bar-fill.complete { background-color: var(--success); }
    .stats-unknown { color: var(--text-muted); font-size: 11px; }

    .row-action-btns { display: inline-flex; align-items: center; gap: 6px; }
    .action-link-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      min-height: 28px;
      border-radius: var(--radius-xs);
      border: 1px solid var(--border-color);
      background-color: var(--bg-hover);
      color: var(--text-main);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
    }
    .action-link-btn:hover { border-color: var(--primary); color: var(--primary); }
    .action-link-btn .material-symbols-outlined { font-size: 14px; }

    .icon-ghost-btn {
      min-width: 28px;
      min-height: 28px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .icon-ghost-btn:hover { color: var(--text-main); background-color: var(--bg-hover); }
    .icon-ghost-btn .material-symbols-outlined { font-size: 16px; }

    .empty-state-cell {
      padding: 40px;
      text-align: center;
      color: var(--text-muted);
    }
    .empty-icon { font-size: 36px; color: var(--text-light); margin-bottom: 6px; }

    /* Grid */
    .projects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }

    .project-card {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: all 0.12s ease;
    }
    .project-card:hover {
      border-color: var(--primary);
      transform: translateY(-1px);
      box-shadow: var(--shadow-sm);
    }

    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .project-icon-box {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-sm);
      background-color: rgba(245, 158, 11, 0.12);
      color: var(--warning);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .project-icon-box .material-symbols-outlined { font-size: 18px; }
    .card-top-right { display: flex; align-items: center; gap: 6px; }

    .edit-btn {
      min-width: 28px;
      min-height: 28px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      padding: 3px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .edit-btn:hover { color: var(--text-main); background-color: var(--bg-hover); }
    .edit-btn .material-symbols-outlined { font-size: 15px; }

    .card-content { display: flex; flex-direction: column; gap: 4px; }
    .project-title { font-size: 14px; font-weight: 600; margin: 0; color: var(--text-main); }
    .project-desc {
      font-size: 12px;
      color: var(--text-muted);
      margin: 0;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .card-progress { display: flex; flex-direction: column; gap: 4px; padding-top: 4px; }

    .card-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 8px;
      border-top: 1px solid var(--border-color);
      font-size: 11px;
    }
    .foot-date { color: var(--text-muted); }
    .project-title-btn { color: inherit; font-weight: inherit; }
    .view-tasks-link { color: var(--primary); font-weight: 500; }

    .empty-projects-cell {
      grid-column: 1 / -1;
      padding: 40px;
      text-align: center;
      color: var(--text-muted);
    }

    /* Modal Form */
    .modal-form { display: flex; flex-direction: column; gap: 12px; }
    .form-group { display: flex; flex-direction: column; gap: 4px; }
    .label-row { display: flex; align-items: center; justify-content: space-between; }
    .clean-label { font-size: 11px; font-weight: 500; color: var(--text-muted); }
    .req-tag {
      font-size: 10px;
      font-weight: 500;
      color: var(--danger);
      background-color: var(--danger-bg);
      padding: 1px 5px;
      border-radius: 4px;
    }
    .clean-input {
      height: 32px;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-size: 13px;
      outline: none;
    }
    .clean-input:focus { border-color: var(--primary); }
    .clean-input.input-error { border-color: var(--danger); background-color: var(--danger-bg); }
    .error-msg { font-size: 11px; color: var(--danger); margin-top: 2px; }
    .modal-form-fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }


    .clean-textarea { height: auto; padding: 6px 8px; resize: vertical; font-family: inherit; }

    .tabular-nums { font-variant-numeric: tabular-nums; }
    .font-mono { font-family: monospace; }
    .text-right { text-align: right; }
    .text-muted { color: var(--text-muted); }
    .text-xs { font-size: 11px; }
    .attributes-stack { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; }
    .attr-stack-item { display: flex; gap: 8px; font-size: 13px; }
    .attr-k { color: var(--text-muted); font-weight: 500; }
    .attr-v { color: var(--text-main); }
  `]
})
export class ProjectsComponent implements OnInit, OnDestroy {
  private readonly uiI18n = inject(I18nService);
  private readonly recordRoute = inject(ActivatedRoute, { optional: true });
  private readonly navigationDecision = new RecordNavigationDecision();
  private recordRouteSubscription?: Subscription;
  private recordRequest?: Subscription;
  private recordRequestId = 0;
  readonly routeRecordId = signal<string | null>(null);
  readonly viewingProject = signal<Project | null>(null);
  readonly recordLoading = signal(false);
  readonly recordError = signal(false);
  readonly recordNotFound = signal(false);
  private listRequest?: Subscription;
  private statsRequest?: Subscription;
  private editDetailRequest?: Subscription;
  private createSaveRequest?: Subscription;
  private editSaveRequest?: Subscription;
  private editDetailRequestId = 0;
  private createSaveRequestId = 0;
  private editSaveRequestId = 0;
  private destroyed = false;

  readonly projects = signal<Project[]>([]);
  readonly projectStats = signal<Record<number, ProjectTaskStats>>({});
  readonly isLoading = signal<boolean>(false);
  readonly listLoadError = signal<boolean>(false);
  readonly listLoaded = signal<boolean>(false);
  readonly statsLoading = signal<boolean>(false);
  readonly statsLoadError = signal<boolean>(false);
  readonly statsLoaded = signal<boolean>(false);
  readonly isSubmitting = signal<boolean>(false);
  readonly editLoading = signal<boolean>(false);
  readonly editLoadError = signal<boolean>(false);
  readonly createSaveError = signal<string | null>(null);
  readonly editSaveError = signal<string | null>(null);

  viewMode: 'list' | 'cards' = 'list';
  searchQuery = '';
  selectedState: 'all' | 'A' | 'P' = 'all';
  currentPage = 1;
  pageSize = 10;

  isCreateSubmitted = false;
  isEditSubmitted = false;

  readonly isCreateModalOpen = signal<boolean>(false);
  readonly isEditModalOpen = signal<boolean>(false);
  readonly isCreateDiscardConfirmationOpen = signal<boolean>(false);
  readonly isEditDiscardConfirmationOpen = signal<boolean>(false);

  readonly projectCustomFields = signal<CustomField[]>([]);
  createForm: { name: string; description: string; attributes?: Record<string, any> } = { name: '', description: '', attributes: {} };
  editForm: { name: string; description: string; state: 'A' | 'P'; attributes?: Record<string, any> } = { name: '', description: '', state: 'A', attributes: {} };
  editingProject: Project | null = null;
  private createFormBaseline: { name: string; description: string; attributes?: Record<string, any> } = { name: '', description: '', attributes: {} };
  private editFormBaseline: { name: string; description: string; state: 'A' | 'P'; attributes?: Record<string, any> } | null = null;
  private editTargetId: number | null = null;

  constructor(
    public permService: PermissionService,
    private api: ApiService,
    private toast: ToastService,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadProjects();
    this.loadStats();
    this.loadProjectCustomFields();
    this.recordRouteSubscription = this.recordRoute?.paramMap?.subscribe(params => this.loadRecordView(params.get('id')));
  }

  ngOnDestroy() {
    this.navigationDecision.settle(false);
    this.recordRouteSubscription?.unsubscribe();
    this.recordRequest?.unsubscribe();
    this.recordRequestId++;
    this.destroyed = true;
    this.listRequest?.unsubscribe();
    this.statsRequest?.unsubscribe();
    this.editDetailRequestId++;
    this.createSaveRequestId++;
    this.editSaveRequestId++;
    this.editDetailRequest?.unsubscribe();
    this.createSaveRequest?.unsubscribe();
    this.editSaveRequest?.unsubscribe();
  }

  canCreateProject(): boolean {
    return this.permService.canCreate('tasks.projects');
  }

  canUpdateProject(): boolean {
    return this.permService.canUpdate('tasks.projects');
  }

  canViewTasks(): boolean {
    return this.permService.canView('tasks.items');
  }

  loadProjects(focusProjectId?: number) {
    if (this.destroyed) return;

    this.listRequest?.unsubscribe();
    this.isLoading.set(true);
    this.listLoadError.set(false);
    this.listLoaded.set(false);
    this.projects.set([]);
    this.listRequest = this.api.get<Project[]>('/tasks/projects', undefined, { notifyError: false }).subscribe({
      next: res => {
        if (this.destroyed) return;
        this.isLoading.set(false);
        const projects = res || [];
        this.projects.set(projects);
        this.listLoaded.set(true);

        const filteredProjects = this.filteredProjects();
        if (focusProjectId !== undefined) {
          const projectIndex = filteredProjects.findIndex(project => project.id === focusProjectId);
          if (projectIndex >= 0) {
            this.currentPage = Math.floor(projectIndex / this.pageSize) + 1;
            return;
          }
        }

        this.clampCurrentPage();
      },
      error: () => {
        if (this.destroyed) return;
        this.isLoading.set(false);
        this.listLoadError.set(true);
      }
    });
  }

  loadStats() {
    this.statsRequest?.unsubscribe();
    this.projectStats.set({});
    this.statsLoading.set(false);
    this.statsLoadError.set(false);
    this.statsLoaded.set(false);

    if (this.destroyed || !this.canViewTasks()) return;

    this.statsLoading.set(true);
    this.statsRequest = this.api.get<ProjectTaskStats[]>('/tasks/projects/stats', undefined, { notifyError: false }).subscribe({
      next: res => {
        if (this.destroyed) return;
        const map: Record<number, ProjectTaskStats> = {};
        for (const s of res || []) {
          map[s.projectId] = s;
        }
        this.projectStats.set(map);
        this.statsLoading.set(false);
        this.statsLoaded.set(true);
      },
      error: () => {
        if (this.destroyed) return;
        this.statsLoading.set(false);
        this.statsLoadError.set(true);
      }
    });
  }

  setSearchQuery(value: string) {
    this.searchQuery = value;
    this.currentPage = 1;
  }

  clearSearch() {
    this.searchQuery = '';
    this.currentPage = 1;
  }

  setSelectedState(state: 'all' | 'A' | 'P') {
    this.selectedState = state;
    this.currentPage = 1;
  }

  setPage(page: number) {
    if (!this.isListReady()) return;
    this.currentPage = page;
  }

  setPageSize(pageSize: number) {
    if (!this.isListReady()) return;
    this.pageSize = pageSize;
    this.currentPage = 1;
  }

  isListReady(): boolean {
    return this.listLoaded() && !this.isLoading() && !this.listLoadError();
  }

  private clampCurrentPage() {
    const lastPage = Math.max(1, Math.ceil(this.filteredProjects().length / this.pageSize));
    this.currentPage = Math.min(this.currentPage, lastPage);
  }

  filteredProjects(): Project[] {
    const q = this.searchQuery.trim().toLowerCase();
    const st = this.selectedState;

    return this.projects().filter(p => {
      const matchSearch = !q || p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q));
      const matchState = st === 'all' || p.state === st;
      return matchSearch && matchState;
    });
  }

  paginatedProjects(): Project[] {
    const list = this.filteredProjects();
    const start = (this.currentPage - 1) * this.pageSize;
    return list.slice(start, start + this.pageSize);
  }


  hasProjectStats(projectId: number): boolean {
    return this.canViewTasks()
      && this.statsLoaded()
      && !this.statsLoading()
      && !this.statsLoadError()
      && this.projectStats()[projectId] !== undefined;
  }

  getProjectTotalCount(projectId: number): number {
    return this.projectStats()[projectId]?.totalTasks ?? 0;
  }

  getProjectDoneCount(projectId: number): number {
    return this.projectStats()[projectId]?.doneTasks ?? 0;
  }

  getProjectPercent(projectId: number): number {
    const stats = this.projectStats()[projectId];
    if (!stats) return 0;
    const total = stats.totalTasks;
    if (total === 0) return 0;
    return Math.round((stats.doneTasks / total) * 100);
  }

  openCreateModal() {
    if (
      this.destroyed
      || !this.canCreateProject()
      || this.isSubmitting()
      || this.isCreateModalOpen()
      || this.isEditModalOpen()
      || this.isCreateDiscardConfirmationOpen()
      || this.isEditDiscardConfirmationOpen()
    ) return;
    this.isCreateSubmitted = false;
    this.createForm = { name: '', description: '' };
    this.createFormBaseline = { ...this.createForm };
    this.createSaveError.set(null);
    this.isCreateDiscardConfirmationOpen.set(false);
    this.isCreateModalOpen.set(true);
  }

  requestCloseCreate() {
    if (this.destroyed || this.isSubmitting() || !this.isCreateModalOpen()) return;
    if (this.isCreateDraftDirty()) {
      this.isCreateDiscardConfirmationOpen.set(true);
      return;
    }
    this.closeCreateModal();
  }

  confirmDiscardCreate() {
    if (
      this.destroyed
      || this.isSubmitting()
      || !this.isCreateModalOpen()
      || !this.isCreateDiscardConfirmationOpen()
    ) return;
    this.closeCreateModal();
    this.navigationDecision.settle(true);
  }

  submitCreateProject() {
    if (
      this.destroyed
      || !this.canCreateProject()
      || !this.isCreateModalOpen()
      || this.isEditModalOpen()
      || this.isCreateDiscardConfirmationOpen()
      || this.isEditDiscardConfirmationOpen()
      || this.isSubmitting()
    ) return;
    this.isCreateSubmitted = true;
    if (!this.createForm.name.trim()) {
      this.toast.warning(this.uiI18n.translate('projects.vvedite_nazvanie_proekta'));
      return;
    }

    const requestId = ++this.createSaveRequestId;
    this.createSaveError.set(null);
    this.isSubmitting.set(true);
    const payload: any = {
      name: this.createForm.name.trim(),
      description: this.createForm.description.trim()
    };
    if (this.createForm.attributes && Object.keys(this.createForm.attributes).length > 0) {
      payload.attributes = this.createForm.attributes;
    }
    this.createSaveRequest = this.api.post<Project>('/tasks/projects', payload).subscribe({
      next: created => {
        if (
          this.destroyed
          || requestId !== this.createSaveRequestId
          || !this.isCreateModalOpen()
          || this.isEditModalOpen()
        ) return;
        this.isSubmitting.set(false);
        this.closeCreateModal();
        this.toast.success(this.uiI18n.translate('projects.proekt_uspeshno_sozdan'));
        // Creation must leave the user looking at the new record, even when the
        // current filters or pagination would otherwise hide it.
        this.searchQuery = '';
        this.selectedState = 'all';
        this.loadProjects(created.id);
        this.loadStats();
      },
      error: err => {
        if (
          this.destroyed
          || requestId !== this.createSaveRequestId
          || !this.isCreateModalOpen()
          || this.isEditModalOpen()
        ) return;
        this.isSubmitting.set(false);
        this.createSaveError.set(err?.detail || this.uiI18n.translate('projects.create_save_error'));
      }
    });
  }

  openEditModal(p: Project) {
    if (!safeNumericRecordId(p.id)) return;
    if (
      this.destroyed
      || !this.canUpdateProject()
      || this.isSubmitting()
      || this.isCreateModalOpen()
      || this.isEditModalOpen()
      || this.isCreateDiscardConfirmationOpen()
      || this.isEditDiscardConfirmationOpen()
    ) return;
    this.isEditSubmitted = false;
    this.editTargetId = p.id;
    this.editingProject = null;
    this.editFormBaseline = null;
    this.editSaveError.set(null);
    this.isEditDiscardConfirmationOpen.set(false);
    this.isEditModalOpen.set(true);
    this.loadEditDetails(p.id);
  }

  retryEditLoad() {
    if (
      this.destroyed
      || this.isSubmitting()
      || this.editLoading()
      || !this.isEditModalOpen()
      || this.isCreateModalOpen()
      || this.isCreateDiscardConfirmationOpen()
      || this.isEditDiscardConfirmationOpen()
      || this.editTargetId == null
    ) return;
    this.loadEditDetails(this.editTargetId);
  }

  requestCloseEdit() {
    if (this.destroyed || this.isSubmitting() || !this.isEditModalOpen()) return;
    if (this.isEditDraftDirty()) {
      this.isEditDiscardConfirmationOpen.set(true);
      return;
    }
    this.closeEditModal();
  }

  confirmDiscardEdit() {
    if (
      this.destroyed
      || this.isSubmitting()
      || !this.isEditModalOpen()
      || !this.isEditDiscardConfirmationOpen()
    ) return;
    this.closeEditModal();
    this.navigationDecision.settle(true);
  }

  submitEditProject() {
    if (
      this.destroyed
      || !this.canUpdateProject()
      || !this.isEditModalOpen()
      || this.isCreateModalOpen()
      || this.isCreateDiscardConfirmationOpen()
      || this.isEditDiscardConfirmationOpen()
      || !this.editingProject
      || !this.editFormBaseline
      || this.editLoading()
      || this.editLoadError()
      || this.isSubmitting()
    ) return;
    this.isEditSubmitted = true;
    if (!this.editForm.name.trim()) {
      this.toast.warning(this.uiI18n.translate('projects.nazvanie_proekta_obyazatelno'));
      return;
    }

    const payload: Record<string, unknown> = {};
    const name = this.editForm.name.trim();
    const description = this.editForm.description.trim();
    if (name !== this.editFormBaseline.name) payload['name'] = name;
    if (description !== this.editFormBaseline.description) payload['description'] = description;
    if (this.editForm.state !== this.editFormBaseline.state) payload['state'] = this.editForm.state;
    if (JSON.stringify(this.editForm.attributes || {}) !== JSON.stringify(this.editFormBaseline.attributes || {})) {
      payload['attributes'] = this.editForm.attributes;
    }
    if (Object.keys(payload).length === 0) {
      this.closeEditModal();
      return;
    }

    const editedProjectId = this.editingProject.id;
    const requestId = ++this.editSaveRequestId;
    this.editSaveError.set(null);
    this.isSubmitting.set(true);
    this.editSaveRequest = this.api.patch<void>(`/tasks/projects/${editedProjectId}`, payload).subscribe({
      next: () => {
        if (
          this.destroyed
          || requestId !== this.editSaveRequestId
          || !this.isEditModalOpen()
          || this.editingProject?.id !== editedProjectId
        ) return;
        this.isSubmitting.set(false);
        this.closeEditModal();
        this.toast.success(this.uiI18n.translate('projects.proekt_obnovlen'));
        this.loadProjects();
        this.loadStats();
      },
      error: err => {
        if (
          this.destroyed
          || requestId !== this.editSaveRequestId
          || !this.isEditModalOpen()
          || this.editingProject?.id !== editedProjectId
        ) return;
        this.isSubmitting.set(false);
        this.editSaveError.set(err?.detail || this.uiI18n.translate('projects.edit_save_error'));
      }
    });
  }

  private loadEditDetails(projectId: number) {
    const requestId = ++this.editDetailRequestId;
    this.editDetailRequest?.unsubscribe();
    this.editLoading.set(true);
    this.editLoadError.set(false);
    this.editSaveError.set(null);
    this.editingProject = null;
    this.editFormBaseline = null;

    this.editDetailRequest = this.api.get<Project>(`/tasks/projects/${projectId}`, undefined, { notifyError: false }).subscribe({
      next: project => {
        if (
          this.destroyed
          || requestId !== this.editDetailRequestId
          || !this.isEditModalOpen()
          || this.isCreateModalOpen()
          || this.editTargetId !== projectId
        ) return;
        this.editLoading.set(false);
        if (!project || project.id !== projectId) {
          this.editLoadError.set(true);
          return;
        }
        const normalized: { name: string; description: string; state: 'A' | 'P'; attributes?: Record<string, any> } = {
          name: project.name.trim(),
          description: (project.description || '').trim(),
          state: project.state
        };
        if (project.attributes && Object.keys(project.attributes).length > 0) {
          normalized.attributes = { ...project.attributes };
        }
        this.editingProject = project;
        this.editForm = { ...normalized };
        this.editFormBaseline = { ...normalized, ...(normalized.attributes ? { attributes: { ...normalized.attributes } } : {}) };
      },
      error: () => {
        if (
          this.destroyed
          || requestId !== this.editDetailRequestId
          || !this.isEditModalOpen()
          || this.editTargetId !== projectId
        ) return;
        this.editLoading.set(false);
        this.editLoadError.set(true);
      }
    });
  }

  private isCreateDraftDirty(): boolean {
    return this.createForm.name !== this.createFormBaseline.name
      || this.createForm.description !== this.createFormBaseline.description
      || (!!this.createForm.attributes && Object.keys(this.createForm.attributes).length > 0);
  }

  private isEditDraftDirty(): boolean {
    return !!this.editFormBaseline && (
      this.editForm.name !== this.editFormBaseline.name
      || this.editForm.description !== this.editFormBaseline.description
      || this.editForm.state !== this.editFormBaseline.state
      || JSON.stringify(this.editForm.attributes || {}) !== JSON.stringify(this.editFormBaseline.attributes || {})
    );
  }

  private closeCreateModal() {
    this.createSaveRequestId++;
    this.createSaveRequest?.unsubscribe();
    this.isCreateModalOpen.set(false);
    this.isCreateDiscardConfirmationOpen.set(false);
    this.createSaveError.set(null);
    this.createForm = { name: '', description: '' };
    this.createFormBaseline = { ...this.createForm };
  }

  private closeEditModal() {
    this.editDetailRequestId++;
    this.editSaveRequestId++;
    this.editDetailRequest?.unsubscribe();
    this.editSaveRequest?.unsubscribe();
    this.isEditModalOpen.set(false);
    this.isEditDiscardConfirmationOpen.set(false);
    this.editLoading.set(false);
    this.editLoadError.set(false);
    this.editSaveError.set(null);
    this.editingProject = null;
    this.editTargetId = null;
    this.editFormBaseline = null;
  }

  viewProjectTasks(project: Project) {
    if (!this.canViewTasks() || !safeNumericRecordId(project.id)) return;
    this.router.navigate(['/tasks'], { queryParams: { project_id: project.id } });
  }

  loadRecordView(id: string | null) {
    const requestId = ++this.recordRequestId;
    this.recordRequest?.unsubscribe();
    this.routeRecordId.set(id);
    this.viewingProject.set(null);
    this.recordLoading.set(false);
    this.recordError.set(false);
    this.recordNotFound.set(false);
    if (id === null) return;
    if (!canonicalRecordId(id)) {
      this.recordError.set(true); this.recordNotFound.set(true); return;
    }
    this.recordLoading.set(true);
    this.recordRequest = this.api.get<Project>(`/tasks/projects/${id}`, undefined, { notifyError: false }).subscribe({
      next: project => {
        if (this.destroyed || requestId !== this.recordRequestId) return;
        this.recordLoading.set(false);
        if (recordResponseMatches(project?.id, id)) this.viewingProject.set(project);
        else this.recordError.set(true);
      },
      error: error => {
        if (this.destroyed || requestId !== this.recordRequestId) return;
        this.recordLoading.set(false); this.recordError.set(true);
        this.recordNotFound.set(error?.status === 404 || error?.status === 403);
      }
    });
  }

  closeRecordView() { this.router.navigate(['/tasks/projects'], { queryParamsHandling: 'preserve' }); }

  cancelNavigationDiscard(kind: 'create' | 'edit') {
    (kind === 'create' ? this.isCreateDiscardConfirmationOpen : this.isEditDiscardConfirmationOpen).set(false);
    this.navigationDecision.settle(false);
  }

  canLeaveRecordPage() {
    if (this.isSubmitting()) return false;
    const dialog = this.isCreateModalOpen() && this.isCreateDraftDirty() ? this.isCreateDiscardConfirmationOpen :
      this.isEditModalOpen() && this.isEditDraftDirty() ? this.isEditDiscardConfirmationOpen : null;
    if (dialog) return this.navigationDecision.request(() => dialog.set(true), () => dialog.set(false));
    if (this.isCreateModalOpen()) this.closeCreateModal();
    if (this.isEditModalOpen()) this.closeEditModal();
    return true;
  }

  loadProjectCustomFields() {
    this.api.get<CustomField[]>('/custom-fields', { entity_type: 'PROJECT' }).subscribe({
      next: res => {
        if (Array.isArray(res)) {
          const validFields = res.filter(f => f && typeof f === 'object' && typeof f.code === 'string' && typeof f.fieldType === 'string');
          this.projectCustomFields.set(validFields);
        } else {
          this.projectCustomFields.set([]);
        }
      },
      error: () => {}
    });
  }

  hasAttributes(attrs: any): boolean {
    if (!attrs || typeof attrs !== 'object') return false;
    return Object.keys(attrs).length > 0;
  }

  formatAttributes(attrs: any): Array<{ key: string; value: string }> {
    if (!this.hasAttributes(attrs)) return [];
    const fields = this.projectCustomFields();
    return Object.entries(attrs).map(([k, v]) => {
      const field = fields.find(f => f.code === k);
      const keyLabel = field ? field.name : k;
      let valueStr = String(v ?? '');
      if (field?.fieldType === 'boolean') {
        valueStr = v === true || v === 'true'
          ? this.uiI18n.translate('common.yes')
          : this.uiI18n.translate('common.no');
      } else if (field?.fieldType === 'select' && field.optionsJson) {
        try {
          const opts = JSON.parse(field.optionsJson);
          if (Array.isArray(opts)) {
            const matched = opts.find(o => typeof o === 'object' && o !== null ? o.value === v : o === v);
            if (matched && typeof matched === 'object' && matched.label) {
              valueStr = matched.label;
            }
          }
        } catch {
          // ignore
        }
      }
      return { key: keyLabel, value: valueStr };
    });
  }
}
