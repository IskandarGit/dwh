import { Component, OnInit, OnDestroy, signal, computed, HostListener, ElementRef, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { canonicalRecordId, recordResponseMatches, safeNumericRecordId } from '../../../core/services/search-target';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { User, UserSecuritySummary } from '../../../core/models/auth.models';
import { Role } from '../../../core/models/rbac.models';
import { CustomField } from '../../../core/models/custom-field.models';
import { KeysetPage } from '../../../core/models/common.models';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { UserOrgUnitsPanelComponent } from '../org-units/public-api';
import { UserFilterBarComponent } from './components/user-filter-bar.component';
import { UserTableViewComponent } from './components/user-table-view.component';
import { UserCreateModalComponent } from './components/user-create-modal.component';
import { UserEditModalComponent } from './components/user-edit-modal.component';
import { UserDetailModalComponent } from './components/user-detail-modal.component';

type SortColumn = 'id' | 'name' | 'login' | 'createdAt';
type SortDirection = 'asc' | 'desc';

export interface SecurityConfirmConfig {
  title: string;
  message: string;
  confirmBtnText: string;
  confirmBtnVariant: 'primary' | 'secondary' | 'danger' | 'ghost';
  action: () => void;
}

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    FormsModule,
    UiButtonComponent,
    UserFilterBarComponent,
    UserTableViewComponent,
    UserCreateModalComponent,
    UserEditModalComponent,
    UserDetailModalComponent
  ],


  template: `
    <div class="users-view">
      <!-- Minimal Header -->
      <div class="view-header">
        <div class="header-left">
          <h1 class="view-title">{{ 'nav.users' | t }}</h1>
          <span class="count-badge">{{ users().length }}</span>
        </div>
        <div class="header-right">
          <ui-button
            variant="secondary"
            size="md"
            icon="file_download"
            [title]="'iam.eksport_v_csv' | t"
            (onClick)="exportToCsv()"
          >
            {{ 'analytics.eksport' | t }}
          </ui-button>
          <ui-button
            *ngIf="canCreateUser()"
            variant="primary"
            size="md"
            icon="add"
            (onClick)="openCreateModal()"
          >
            {{ 'iam.novyy_polzovatel' | t }}
          </ui-button>
        </div>
      </div>

      <!-- Toolbar and Active Filters (Delegated Component) -->
      <app-user-filter-bar
        [searchQuery]="searchQuery"
        [selectedState]="selectedState"
        [isFilterMenuOpen]="isFilterMenuOpen()"
        [hasExtraFilters]="hasExtraFilters()"
        [roles]="roles()"
        [selectedRoleId]="selectedRoleId"
        [selected2fa]="selected2fa"
        [isLoading]="isLoading()"
        [hasAnyActiveFilters]="hasAnyActiveFilters()"
        [selectedRoleName]="getSelectedRoleName()"
        (searchQueryChange)="searchQuery = $event"
        (searchInput)="onSearchInput()"
        (clearSearch)="clearSearch()"
        (stateFilterChange)="setStateFilter($event)"
        (toggleFilterMenu)="toggleFilterMenu($event)"
        (resetExtraFilters)="resetExtraFilters()"
        (roleFilterChange)="selectedRoleId = $event; loadUsers(true)"
        (twoFactorFilterChange)="selected2fa = $event; loadUsers(true)"
        (refresh)="loadUsers(true)"
        (clearStateFilter)="clearStateFilter()"
        (clearRoleFilter)="clearRoleFilter()"
        (clear2faFilter)="clear2faFilter()"
        (resetAllFilters)="resetAllFilters()"
      ></app-user-filter-bar>

      <!-- Minimal Data Table (Delegated Component) -->
      <app-user-table-view
        [users]="users()"
        [paginatedUsers]="paginatedUsers()"
        [totalItems]="sortedUsers().length"
        [sortColumn]="sortColumn"
        [sortDirection]="sortDirection"
        [isLoading]="isLoading()"
        [hasMore]="hasMore()"
        [isLoadingMore]="isLoadingMore()"
        [currentPage]="currentPage"
        [pageSize]="pageSize"
        [canUpdateUser]="canUpdateUser()"
        [canBlockUser]="canBlockUser()"
        [canUnblockUser]="canUnblockUser()"
        [canDeleteUser]="canDeleteUser()"
        [getUserInitial]="getUserInitialFn"
        [getAvatarBgColor]="getAvatarBgColorFn"
        [getUserRoleNames]="getUserRoleNamesFn"
        [getManagerName]="getManagerNameFn"
        (sortChange)="changeSort($event)"
        (viewUser)="openViewModal($event)"
        (editUser)="openEditModal($event)"
        (toggleState)="toggleUserState($event.user, $event.action)"
        (deleteUser)="openDeleteConfirmModal($event)"
        (loadMore)="loadMore()"
        (pageChange)="currentPage = $event"
        (pageSizeChange)="pageSize = $event; currentPage = 1"
      ></app-user-table-view>
    </div>

    <!-- Create User Modal (Delegated Component) -->
    <app-user-create-modal
      [isOpen]="isCreateModalOpen()"
      [isSubmitting]="isSubmitting()"
      [isCreateSubmitted]="isCreateSubmitted"
      [createForm]="createForm"
      [users]="users()"
      [roles]="roles()"
      [languages]="i18n.languages()"
      [customFields]="customFields()"
      [showPassword]="showPassword()"
      [passwordStrength]="passwordStrength()"
      [hasMinLength]="hasMinLength()"
      [hasUpperAndLower]="hasUpperAndLower()"
      [hasDigitsOrSymbols]="hasDigitsOrSymbols()"
      [doesNotContainLogin]="doesNotContainLogin()"
      [isRoleSelected]="isRoleSelectedInCreateFn"
      (close)="isCreateModalOpen.set(false)"
      (submit)="submitCreateUser()"
      (toggleShowPassword)="showPassword.update(v => !v)"
      (generatePassword)="generateSecurePassword()"
      (copyPassword)="copyGeneratedPassword()"
      (toggleRole)="toggleRoleInCreate($event)"
    ></app-user-create-modal>

    <!-- Edit User Modal (Delegated Component) -->
    <app-user-edit-modal
      [isOpen]="isEditModalOpen()"
      [isSubmitting]="isSubmitting()"
      [isEditSubmitted]="isEditSubmitted"
      [editingUser]="editingUser"
      [editForm]="editForm"
      [roles]="roles()"
      [languages]="i18n.languages()"
      [customFields]="customFields()"
      [getAvailableManagers]="getAvailableManagersFn"
      [isRoleSelected]="isRoleSelectedInEditFn"
      (close)="closeEditModal()"
      (submit)="submitEditUser()"
      (toggleRole)="toggleRoleInEdit($event)"
    ></app-user-edit-modal>

    <!-- User Detail, Delete and Security Modals (Delegated Component) -->
    <app-user-detail-modal
      [isOpen]="isViewModalOpen()"
      [viewingUser]="viewingUser"
      [routeRecordId]="routeRecordId()"
      [recordLoading]="recordLoading()"
      [recordError]="recordError()"
      [recordNotFound]="recordNotFound()"
      [activeViewTab]="activeViewTab()"
      [isLoadingSecurity]="isLoadingSecurity()"
      [userSecurity]="userSecurity()"
      [isSecurityActionPending]="isSecurityActionPending()"
      [canUpdateUser]="canUpdateUser()"
      [canViewOrgUnits]="canViewOrgUnits()"
      [safeRecordId]="safeRecordId"
      [getUserInitial]="getUserInitialFn"
      [getAvatarBgColor]="getAvatarBgColorFn"
      [getUserRoleNames]="getUserRoleNamesFn"
      [getManagerName]="getManagerNameFn"
      [isDeleteModalOpen]="isDeleteModalOpen()"
      [deletingUser]="deletingUser"
      [isSubmitting]="isSubmitting()"
      [isSecConfirmModalOpen]="isSecConfirmModalOpen()"
      [secConfirmConfig]="secConfirmConfig"
      (closeRecordView)="closeRecordView()"
      (retryRecordView)="loadRecordView($event)"
      (switchTab)="switchViewTab($event.tab, $event.userId)"
      (openEdit)="openEditFromView()"
      (forcePasswordChange)="forcePasswordChange($event)"
      (reset2fa)="resetUser2fa($event)"
      (terminateAllSessions)="terminateUserSessions($event)"
      (terminateSingleSession)="terminateSingleSession($event.sessionId, $event.userId)"
      (orgPanelBusy)="orgPanelBusy.set($event)"
      (closeDeleteModal)="isDeleteModalOpen.set(false)"
      (confirmDelete)="confirmDeleteUser()"
      (closeSecConfirmModal)="isSecConfirmModalOpen.set(false)"
      (confirmSecurityAction)="confirmSecurityAction()"
    ></app-user-detail-modal>
  `,
  styles: [`
    .users-view {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 1400px;
    }

    /* Minimal Header */
    .view-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .view-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-main);
      margin: 0;
    }
    .user-count {
      font-size: 12px;
      color: var(--text-muted);
      background-color: var(--bg-hover);
      padding: 1px 7px;
      border-radius: 10px;
      font-weight: 500;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Compact Toolbar */
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .search-field {
      display: flex;
      align-items: center;
      gap: 6px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 4px 10px;
      width: 320px;
      max-width: 100%;
    }
    .search-icon {
      font-size: 17px;
      color: var(--text-muted);
    }
    .search-input {
      border: none;
      background: transparent;
      outline: none;
      font-size: 13px;
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

    .toolbar-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Segmented Switcher */
    .segmented-control {
      display: inline-flex;
      background-color: var(--bg-hover);
      padding: 2px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
    }
    .seg-btn {
      border: none;
      background: transparent;
      padding: 4px 10px;
      border-radius: var(--radius-xs);
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.1s ease;
    }
    .seg-btn.active {
      background-color: var(--bg-surface);
      color: var(--text-main);
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }

    /* Popover Filter */
    .filter-popover-wrapper {
      position: relative;
    }
    .filter-trigger-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .filter-trigger-btn .icon { font-size: 16px; }
    .filter-trigger-btn:hover, .filter-trigger-btn.open {
      color: var(--text-main);
      border-color: var(--text-muted);
    }
    .filter-trigger-btn.has-filters {
      color: var(--primary);
      border-color: var(--primary);
    }
    .filter-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: var(--primary);
    }

    .active-filters-bar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      padding: 6px 12px;
      background-color: var(--bg-hover);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
    }
    .active-filters-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .filter-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-main);
      background: var(--bg-surface);
      padding: 3px 8px;
      border-radius: 9999px;
      border: 1px solid var(--border-color);
    }
    .clear-pill-btn {
      background: none;
      border: none;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      cursor: pointer;
      border-radius: 50%;
      width: 16px;
      height: 16px;
      transition: color 0.15s ease, background-color 0.15s ease;
    }
    .clear-pill-btn .material-symbols-outlined { font-size: 13px; }
    .clear-pill-btn:hover {
      color: var(--danger);
      background-color: rgba(239, 68, 68, 0.1);
    }
    .reset-all-filters-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      background: none;
      border: none;
      cursor: pointer;
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      transition: color 0.15s ease, background-color 0.15s ease;
    }
    .reset-all-filters-btn .material-symbols-outlined { font-size: 15px; }
    .reset-all-filters-btn:hover {
      color: var(--danger);
      background-color: rgba(239, 68, 68, 0.08);
    }

    .filter-dropdown {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      width: 260px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      box-shadow: 0 6px 16px rgba(0,0,0,0.1);
      padding: 12px;
      z-index: 100;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .filter-dropdown-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 6px;
    }
    .dropdown-title { font-size: 12px; font-weight: 600; color: var(--text-main); }
    .reset-link {
      background: transparent;
      border: none;
      font-size: 11px;
      color: var(--primary);
      cursor: pointer;
      padding: 0;
    }
    .filter-dropdown-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .filter-caption { font-size: 11px; color: var(--text-muted); }
    .filter-select {
      height: 30px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-size: 12px;
      padding: 2px 6px;
      outline: none;
    }

    /* Minimal Table */
    .table-container {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      overflow-x: auto;
    }
    .clean-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }
    .clean-table th {
      padding: 8px 12px;
      font-weight: 600;
      color: var(--text-muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      border-bottom: 1px solid var(--border-color);
      background-color: var(--bg-hover);
      user-select: none;
      white-space: nowrap;
    }
    .th-sort { padding: 0 !important; }
    .th-sort:hover { color: var(--text-main); }
    .sort-button {
      width: 100%;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      letter-spacing: inherit;
      padding: 8px 12px;
      text-align: left;
      text-transform: inherit;
    }
    .sort-button.align-right { text-align: right; }
    .sort-ico { font-size: 13px; vertical-align: middle; margin-left: 2px; }

    .clean-table td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-main);
      vertical-align: middle;
    }
    .table-row:last-child td { border-bottom: none; }
    .table-row:hover { background-color: var(--bg-hover); }

    /* Identity */
    .user-identity {
      width: 100%;
      border: 0;
      background: transparent;
      color: inherit;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font: inherit;
      padding: 0;
      text-align: left;
    }
    .avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .avatar.lg {
      width: 44px;
      height: 44px;
      font-size: 18px;
    }
    .identity-info {
      display: flex;
      flex-direction: column;
    }
    .full-name { font-weight: 500; }
    .login-handle { font-size: 11px; color: var(--text-muted); }

    .contacts-cell {
      display: flex;
      flex-direction: column;
    }
    .contact-email { font-size: 12px; }
    .contact-phone { font-size: 11px; color: var(--text-muted); }

    .roles-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .role-pill {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 4px;
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      color: var(--text-main);
    }
    .manager-text { font-size: 12px; }
    .muted-dash { color: var(--text-light); }

    .twofa-dot {
      font-size: 16px;
      color: var(--text-light);
    }
    .twofa-dot.active { color: var(--success); }

    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .status-indicator .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: var(--text-light);
    }
    .status-indicator.active { color: var(--text-main); }
    .status-indicator.active .dot { background-color: var(--success); }

    .row-actions { white-space: nowrap; }

    .empty-state {
      text-align: center;
      padding: 32px 12px;
      color: var(--text-muted);
    }
    .empty-ico { font-size: 32px; color: var(--text-light); margin-bottom: 4px; }
    .empty-text { font-size: 13px; margin: 0; }

    .table-footer-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      padding: 6px 12px;
      border-top: 1px solid var(--border-color);
      background-color: var(--bg-hover);
    }
    .loaded-count-info {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .has-more-badge {
      background-color: rgba(99, 102, 241, 0.08);
      color: var(--primary);
      font-size: 11px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 9999px;
      border: 1px solid rgba(99, 102, 241, 0.2);
    }
    .load-more-wrap {
      display: flex;
      align-items: center;
    }

    /* Accessibility focus indicators */
    .user-identity:focus-visible,
    .sort-button:focus-visible,
    .status-tab:focus-visible,
    .filter-trigger-btn:focus-visible,
    .clear-pill-btn:focus-visible,
    .reset-all-filters-btn:focus-visible,
    .sec-action-btn:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
      border-radius: var(--radius-sm);
    }

    /* Minimal Modals */
    .clean-modal-body {
      padding: 4px 0;
    }
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .span-2 { grid-column: 1 / -1; }

    @media (max-width: 640px) {
      .view-header {
        align-items: flex-start;
        flex-direction: column;
      }
      .header-right,
      .toolbar-controls {
        width: 100%;
        flex-wrap: wrap;
      }
      .toolbar-controls { min-width: 0; }
      .status-tabs {
        max-width: 100%;
        overflow-x: auto;
      }
      .modal-form,
      .form-group { min-width: 0; }
      .form-grid { grid-template-columns: minmax(0, 1fr); }
      .span-2 { grid-column: auto; }
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .clean-label {
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
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
    .clean-input.disabled { background-color: var(--bg-hover); color: var(--text-muted); }

    .pwd-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    .pwd-wrapper .clean-input { width: 100%; padding-right: 90px; }
    .pwd-actions {
      position: absolute;
      right: 4px;
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .pwd-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      border-radius: var(--radius-sm);
      transition: color 0.15s ease, background-color 0.15s ease;
    }
    .pwd-btn:hover {
      color: var(--text-main);
      background-color: var(--bg-hover);
    }
    .pwd-btn:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 1px;
    }
    .pwd-btn .material-symbols-outlined {
      font-size: 18px;
    }
    .clean-hint { font-size: 10px; color: var(--text-muted); }
    .field-error { font-size: 10px; color: var(--danger); }

    .clean-checkbox {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-main);
      cursor: pointer;
    }

    .roles-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .role-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      font-size: 12px;
      color: var(--text-main);
      cursor: pointer;
    }
    .role-chip.selected {
      border-color: var(--primary);
      background-color: rgba(99,102,241,0.06);
    }
    .role-chip.locked { opacity: 0.8; cursor: not-allowed; }
    .lock-ico { font-size: 13px; color: var(--text-muted); }

    .view-body {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .view-header-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px;
      background-color: var(--bg-hover);
      border-radius: var(--radius-sm);
    }
    .view-header-card .info { display: flex; flex-direction: column; }
    .view-header-card .name { font-size: 15px; font-weight: 600; margin: 0; }
    .view-header-card .handle { font-size: 12px; color: var(--text-muted); }

    .info-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px solid var(--border-color);
      font-size: 12px;
    }
    .info-row:last-child { border-bottom: none; }
    .info-row .lbl { color: var(--text-muted); }
    .info-row .val { font-weight: 500; }

    .delete-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .delete-msg { font-size: 13px; margin: 0; line-height: 1.4; }
    .delete-sub { font-size: 11px; color: var(--text-muted); }

    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-muted { color: var(--text-muted); }
    .font-mono { font-family: monospace; }
    .text-xs { font-size: 11px; }
    .req { color: var(--danger); }

    /* Password Strength Meter */
    .pwd-strength-container {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 4px;
      padding: 8px 10px;
      background-color: var(--bg-hover);
      border-radius: var(--radius-sm);
    }
    .pwd-meter-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .pwd-meter-bars {
      display: flex;
      gap: 4px;
      flex: 1;
    }
    .pwd-bar {
      height: 4px;
      flex: 1;
      border-radius: 2px;
      background-color: var(--border-color);
      transition: background-color 0.2s ease;
    }
    .pwd-strength-label {
      font-size: 11px;
      font-weight: 600;
    }
    .pwd-checklist {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 10px;
      margin-top: 4px;
    }
    .check-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--text-muted);
    }
    .check-item.valid {
      color: var(--success);
    }
    .check-ico {
      font-size: 13px;
    }

    /* Modal Tabs */
    .modal-tab-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 2px;
    }
    .modal-tab-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      transition: all 0.15s ease;
      margin-bottom: -1px;
    }
    .modal-tab-btn:hover {
      color: var(--text-main);
    }
    .modal-tab-btn.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
      font-weight: 600;
    }
    .tab-icon {
      font-size: 16px;
    }

    /* Security Tab Content */
    .security-tab-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .security-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 30px;
      color: var(--text-muted);
      font-size: 13px;
    }
    .spin-icon {
      animation: spin 1s linear infinite;
    }
    @keyframes spin { 100% { transform: rotate(360deg); } }

    .security-details {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .sec-metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    .sec-metric-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px;
      background-color: var(--bg-hover);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
    }
    .sec-metric-lbl {
      font-size: 11px;
      color: var(--text-muted);
    }
    .sec-metric-val {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-main);
    }
    .sec-metric-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: var(--radius-xs);
      width: fit-content;
    }
    .sec-metric-badge.success {
      background-color: rgba(16, 185, 129, 0.12);
      color: var(--success);
    }
    .sec-metric-badge.warning {
      background-color: rgba(245, 158, 11, 0.12);
      color: var(--warning);
    }
    .sec-metric-badge.muted {
      background-color: var(--bg-surface);
      color: var(--text-muted);
    }
    .metric-icon {
      font-size: 13px;
    }

    /* Security Actions Bar */
    .sec-actions-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 10px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
    }
    .sec-action-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: var(--radius-sm);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-main);
      transition: all 0.15s ease;
    }
    .sec-action-btn:hover:not(:disabled) {
      background-color: var(--bg-hover);
    }
    .sec-action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .sec-action-btn .material-symbols-outlined {
      font-size: 16px;
    }
    .sec-action-btn.warning {
      border-color: rgba(245, 158, 11, 0.3);
      color: var(--warning);
    }
    .sec-action-btn.warning:hover:not(:disabled) {
      background-color: rgba(245, 158, 11, 0.08);
    }
    .sec-action-btn.danger {
      border-color: rgba(239, 68, 68, 0.3);
      color: var(--danger);
    }
    .sec-action-btn.danger:hover:not(:disabled) {
      background-color: rgba(239, 68, 68, 0.08);
    }

    /* Security Sub-sections */
    .sec-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .sec-section-title {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .sec-section-title h4 {
      font-size: 13px;
      font-weight: 600;
      margin: 0;
      color: var(--text-main);
    }
    .sec-title-icon {
      font-size: 16px;
      color: var(--text-muted);
    }
    .count-pill {
      font-size: 10px;
      background-color: var(--bg-hover);
      color: var(--text-muted);
      padding: 1px 6px;
      border-radius: 10px;
      font-weight: 500;
    }
    .sec-empty-state {
      padding: 14px;
      text-align: center;
      background-color: var(--bg-hover);
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      font-size: 12px;
    }
    .sec-table-scroll {
      max-height: 220px;
      overflow-y: auto;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
    }
    .clean-table.compact th,
    .clean-table.compact td {
      padding: 6px 10px;
    }
    .text-truncate {
      max-width: 250px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .danger-dot .dot {
      background-color: var(--danger) !important;
    }
    .btn-icon.danger:hover {
      color: var(--danger);
      background-color: rgba(239, 68, 68, 0.1);
    }
  `]
})
export class UsersComponent implements OnInit, OnDestroy {
  readonly getAvailableManagersFn = (userId: number) => this.getAvailableManagers(userId);
  readonly isRoleSelectedInEditFn = (roleId: number) => this.isRoleSelectedInEdit(roleId);
  readonly isRoleSelectedInCreateFn = (roleId: number) => this.isRoleSelectedInCreate(roleId);
  readonly getUserInitialFn = (u: User) => this.getUserInitial(u);
  readonly getAvatarBgColorFn = (name: string) => this.getAvatarBgColor(name);
  readonly getUserRoleNamesFn = (u: User) => this.getUserRoleNames(u);
  readonly getManagerNameFn = (u: User) => this.getManagerName(u);

  private readonly uiI18n = inject(I18nService);
  private readonly recordRoute = inject(ActivatedRoute, { optional: true });
  private readonly recordRouter = inject(Router, { optional: true });
  private recordRouteSubscription?: Subscription;
  private queryParamSubscription?: Subscription;
  private recordRequest?: Subscription;
  private panelLeaveSubscription?: Subscription;
  private recordRequestId = 0;
  private editSessionId = 0;
  private editSaveRequestId = 0;
  private destroyed = false;
  readonly routeRecordId = signal<string | null>(null);
  readonly recordLoading = signal(false);
  readonly recordError = signal(false);
  readonly recordNotFound = signal(false);
  readonly orgPanelBusy = signal(false);
  readonly safeRecordId = safeNumericRecordId;
  readonly users = signal<User[]>([]);
  readonly roles = signal<Role[]>([]);
  readonly customFields = signal<CustomField[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly isLoadingMore = signal<boolean>(false);
  readonly isSubmitting = signal<boolean>(false);
  readonly hasMore = signal<boolean>(false);
  readonly showPassword = signal<boolean>(false);
  readonly isFilterMenuOpen = signal<boolean>(false);
  readonly isSecConfirmModalOpen = signal<boolean>(false);
  secConfirmConfig: SecurityConfirmConfig | null = null;
  isCreateSubmitted = false;
  isEditSubmitted = false;
  nextCursor: string | null = null;

  // Filter state
  searchQuery = '';
  selectedState = '';
  selectedRoleId: number | null = null;
  selected2fa: boolean | null = null;
  currentPage = 1;
  pageSize = 10;


  // Sorting
  sortColumn: SortColumn = 'id';
  sortDirection: SortDirection = 'asc';

  private searchDebounceTimer: any = null;

  // Modals
  readonly isCreateModalOpen = signal<boolean>(false);
  readonly isEditModalOpen = signal<boolean>(false);
  readonly isViewModalOpen = signal<boolean>(false);
  readonly isDeleteModalOpen = signal<boolean>(false);

  readonly activeViewTab = signal<'info' | 'security' | 'orgUnits'>('info');
  readonly userSecurity = signal<UserSecuritySummary | null>(null);
  readonly isLoadingSecurity = signal<boolean>(false);
  readonly isSecurityActionPending = signal<boolean>(false);

  viewingUser: User | null = null;
  editingUser: User | null = null;
  deletingUser: User | null = null;

  createForm: any = {
    name: '',
    login: '',
    email: '',
    phone: '',
    password: '',
    managerId: null,
    language: 'ru',
    timezone: 'Asia/Tashkent',
    is2faEnabled: false,
    roleIds: [] as number[],
    attributes: {}
  };

  editForm: any = {
    name: '',
    phone: '',
    managerId: null,
    language: 'ru',
    timezone: 'Asia/Tashkent',
    is2faEnabled: false,
    roleIds: [] as number[],
    attributes: {}
  };

  constructor(
    public permService: PermissionService,
    private api: ApiService,
    private toast: ToastService,
    private elementRef: ElementRef,
    public i18n: I18nService
  ) {}

  @ViewChild('filterTrigger') private filterTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild(UserDetailModalComponent) private userDetailModal?: UserDetailModalComponent;
  get userOrgUnitsPanel(): UserOrgUnitsPanelComponent | undefined {
    return this.userDetailModal?.orgUnitsPanel;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isFilterMenuOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (!this.isFilterMenuOpen()) return;
    this.isFilterMenuOpen.set(false);
    queueMicrotask(() => this.filterTrigger?.nativeElement.focus());
  }

  ngOnInit() {
    this.recordRouteSubscription = this.recordRoute?.paramMap?.subscribe(params => this.loadRecordView(params.get('id')));
    this.queryParamSubscription = this.recordRoute?.queryParamMap?.subscribe(params => {
      const roleParam = params.get('roleId');
      if (roleParam && !isNaN(Number(roleParam))) {
        this.selectedRoleId = Number(roleParam);
      }
    });
    this.loadRoles();
    this.loadUsers(true);
    this.loadCustomFields();
  }

  canCreateUser(): boolean {
    return this.permService.canCreate('iam.users') || this.permService.canCreate('md_users');
  }

  canUpdateUser(): boolean {
    return this.permService.canUpdate('iam.users') || this.permService.canUpdate('md_users');
  }

  canDeleteUser(): boolean {
    return this.permService.canDelete('iam.users') || this.permService.canDelete('md_users');
  }

  canBlockUser(): boolean {
    return this.permService.hasPermission('iam.users', 'block') || this.permService.hasPermission('md_users', 'block');
  }

  canUnblockUser(): boolean {
    return this.permService.hasPermission('iam.users', 'unblock') || this.permService.hasPermission('md_users', 'unblock');
  }

  canViewOrgUnits(): boolean {
    return this.permService.hasPermission('iam.org_units', 'view') ||
           this.permService.hasPermission('iam.org_units', 'assign') ||
           this.orgPanelBusy();
  }

  canLeaveRecordPage(): boolean | Observable<boolean> {
    return this.userOrgUnitsPanel?.canLeave() ?? true;
  }

  loadUsers(reset: boolean = false) {
    if (reset) {
      this.nextCursor = null;
      this.isLoading.set(true);
    } else {
      this.isLoadingMore.set(true);
    }

    const params: any = {
      limit: 50,
      cursor: this.nextCursor || undefined,
      search: this.searchQuery ? this.searchQuery.trim() : undefined,
      state: this.selectedState || undefined,
      role_id: this.selectedRoleId || undefined,
      is_2fa_enabled: this.selected2fa !== null ? this.selected2fa : undefined
    };

    this.api.get<KeysetPage<User>>('/iam/users', params).subscribe({
      next: res => {
        this.isLoading.set(false);
        this.isLoadingMore.set(false);
        if (reset) {
          this.users.set(res.items || []);
        } else {
          this.users.update(cur => [...cur, ...(res.items || [])]);
        }
        this.nextCursor = res.nextCursor;
        this.hasMore.set(res.hasMore);
      },
      error: () => {
        this.isLoading.set(false);
        this.isLoadingMore.set(false);
      }
    });
  }

  loadMore() {
    if (this.hasMore() && !this.isLoading() && !this.isLoadingMore()) {
      this.loadUsers(false);
    }
  }

  loadRoles() {
    this.api.get<Role[]>('/rbac/roles').subscribe({
      next: res => {
        this.roles.set(res || []);
      },
      error: () => {
        this.api.get<Role[]>('/iam/roles').subscribe({
          next: res => this.roles.set(res || []),
          error: () => {}
        });
      }
    });
  }

  loadCustomFields() {
    this.api.get<CustomField[]>('/custom-fields', { entity_type: 'USER' }).subscribe(res => {
      this.customFields.set(res || []);
    });
  }

  hasExtraFilters(): boolean {
    return this.selectedRoleId !== null || this.selected2fa !== null;
  }

  resetExtraFilters() {
    this.selectedRoleId = null;
    this.selected2fa = null;
    this.loadUsers(true);
  }

  clearStateFilter(): void {
    this.selectedState = '';
    this.loadUsers(true);
  }

  clear2faFilter(): void {
    this.selected2fa = null;
    this.loadUsers(true);
  }

  hasAnyActiveFilters(): boolean {
    return !!(this.selectedRoleId !== null || this.selected2fa !== null || this.selectedState || this.searchQuery.trim());
  }

  resetAllFilters(): void {
    this.selectedRoleId = null;
    this.selected2fa = null;
    this.selectedState = '';
    this.searchQuery = '';
    this.recordRouter?.navigate([], { relativeTo: this.recordRoute, queryParams: { roleId: null }, queryParamsHandling: 'merge' });
    this.loadUsers(true);
  }

  toggleFilterMenu(event: MouseEvent) {
    event.stopPropagation();
    this.isFilterMenuOpen.update(v => !v);
  }

  setStateFilter(state: string) {
    this.selectedState = state;
    this.loadUsers(true);
  }

  onSearchInput() {
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.loadUsers(true);
    }, 250);
  }

  clearSearch() {
    this.searchQuery = '';
    this.loadUsers(true);
  }

  changeSort(col: SortColumn) {
    if (this.sortColumn === col) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = col;
      this.sortDirection = 'asc';
    }
  }

  sortedUsers(): User[] {
    const list = [...this.users()];
    const dir = this.sortDirection === 'asc' ? 1 : -1;

    return list.sort((a, b) => {
      if (this.sortColumn === 'id') return (a.id - b.id) * dir;
      if (this.sortColumn === 'name') return (a.name.localeCompare(b.name)) * dir;
      if (this.sortColumn === 'login') return (a.login.localeCompare(b.login)) * dir;
      if (this.sortColumn === 'createdAt') {
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
      }
      return 0;
    });
  }

  paginatedUsers(): User[] {
    const list = this.sortedUsers();
    const start = (this.currentPage - 1) * this.pageSize;
    return list.slice(start, start + this.pageSize);
  }


  getUserInitial(user: User): string {
    return user.name ? user.name.trim().charAt(0).toUpperCase() : 'U';
  }

  getAvatarBgColor(name: string): string {
    const colors = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6'];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  getManagerName(user: User): string | null {
    if (!user.managerId) return null;
    const m = this.users().find(u => u.id === user.managerId);
    return m ? m.name : `ID: #${user.managerId}`;
  }

  getUserRoleNames(user: User): string[] {
    if (!user.roleIds || user.roleIds.length === 0) return [];
    const allRoles = this.roles();
    return user.roleIds
      .map(id => allRoles.find(r => r.id === id)?.name)
      .filter((name): name is string => !!name);
  }

  getAvailableManagers(currentUserId: number): User[] {
    return this.users().filter(u => u.id !== currentUserId && u.state === 'A');
  }

  getSelectedRoleName(): string {
    if (!this.selectedRoleId) return '';
    const role = this.roles().find(r => r.id === this.selectedRoleId);
    return role ? role.name : String(this.selectedRoleId);
  }

  clearRoleFilter(): void {
    this.selectedRoleId = null;
    this.recordRouter?.navigate([], { relativeTo: this.recordRoute, queryParams: { roleId: null }, queryParamsHandling: 'merge' });
    this.loadUsers(true);
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.panelLeaveSubscription?.unsubscribe();
    this.recordRouteSubscription?.unsubscribe();
    this.queryParamSubscription?.unsubscribe();
    this.recordRequest?.unsubscribe();
    this.recordRequestId++;
    clearTimeout(this.searchDebounceTimer);
  }

  loadRecordView(id: string | null) {
    if (this.destroyed) return;
    const requestId = ++this.recordRequestId;
    this.recordRequest?.unsubscribe();
    this.routeRecordId.set(id);
    this.viewingUser = null;
    this.isViewModalOpen.set(id !== null);
    this.recordLoading.set(false);
    this.recordError.set(false);
    this.recordNotFound.set(false);
    this.activeViewTab.set('info');
    this.userSecurity.set(null);
    if (id === null) return;
    if (!canonicalRecordId(id)) {
      this.recordError.set(true); this.recordNotFound.set(true); return;
    }
    this.recordLoading.set(true);
    this.recordRequest = this.api.get<User>(`/iam/users/${id}`, undefined, { notifyError: false }).subscribe({
      next: user => {
        if (requestId !== this.recordRequestId) return;
        this.recordLoading.set(false);
        if (recordResponseMatches(user?.id, id)) this.viewingUser = user;
        else this.recordError.set(true);
      },
      error: error => {
        if (requestId !== this.recordRequestId) return;
        this.recordLoading.set(false); this.recordError.set(true);
        this.recordNotFound.set(error?.status === 404 || error?.status === 403);
      }
    });
  }

  closeRecordView() {
    if (this.destroyed) return;
    if (this.routeRecordId() !== null) {
      this.recordRouter?.navigate(['/iam/users'], { queryParamsHandling: 'preserve' });
      return;
    }
    this.afterOrgPanelLeave(() => this.isViewModalOpen.set(false));
  }

  openViewModal(user: User) {
    if (this.destroyed) return;
    const routeId = this.routeRecordId();
    if (routeId !== null) {
      if (!safeNumericRecordId(user.id)) return;
      if (String(user.id) === routeId) this.afterOrgPanelLeave(() => this.loadRecordView(routeId));
      else this.recordRouter?.navigate(['/iam/users', String(user.id)], { queryParamsHandling: 'preserve' });
      return;
    }
    this.afterOrgPanelLeave(() => {
      this.viewingUser = user;
      this.activeViewTab.set('info');
      this.userSecurity.set(null);
      this.isViewModalOpen.set(true);
    });
  }

  closeEditModal(expectedSessionId?: number) {
    if (this.destroyed) return;
    if (expectedSessionId !== undefined && expectedSessionId !== this.editSessionId) return;
    const closedSessionId = ++this.editSessionId;
    this.isEditModalOpen.set(false);
    this.editingUser = null;
    const routeId = this.routeRecordId();
    if (routeId !== null) this.afterOrgPanelLeave(() => {
      if (closedSessionId === this.editSessionId && routeId === this.routeRecordId()) {
        this.loadRecordView(routeId);
      }
    });
  }

  openEditFromView() {
    if (this.viewingUser && safeNumericRecordId(this.viewingUser.id) && this.canUpdateUser()) {
      const u = this.viewingUser;
      this.afterOrgPanelLeave(() => {
        this.isViewModalOpen.set(false);
        this.openEditModal(u);
      });
    }
  }

  private afterOrgPanelLeave(action: () => void): void {
    if (this.destroyed) return;
    this.panelLeaveSubscription?.unsubscribe();
    this.panelLeaveSubscription = undefined;
    const decision = this.userOrgUnitsPanel?.canLeave() ?? true;
    if (typeof decision === 'boolean') {
      if (decision) action();
      return;
    }
    this.panelLeaveSubscription = decision.subscribe((allow: boolean) => {
      if (allow && !this.destroyed) action();
    });
  }

  openCreateModal() {
    const defaultUserRole = this.roles().find(r => r.pcode === 'user');
    const defaultRoleIds = defaultUserRole ? [defaultUserRole.id] : [];

    this.createForm = {
      name: '',
      login: '',
      email: '',
      phone: '',
      password: '',
      managerId: null,
      language: 'ru',
      timezone: 'Asia/Tashkent',
      is2faEnabled: false,
      roleIds: defaultRoleIds,
      attributes: {}
    };
    this.showPassword.set(false);
    this.isCreateSubmitted = false;
    this.isCreateModalOpen.set(true);
  }

  isRoleSelectedInCreate(roleId: number): boolean {
    return (this.createForm.roleIds || []).includes(roleId);
  }

  toggleRoleInCreate(roleId: number) {
    const list = this.createForm.roleIds || [];
    if (list.includes(roleId)) {
      this.createForm.roleIds = list.filter((id: number) => id !== roleId);
    } else {
      this.createForm.roleIds = [...list, roleId];
    }
  }

  submitCreateUser() {
    this.isCreateSubmitted = true;
    if (!this.createForm.name || !this.createForm.login || !this.createForm.email || !this.createForm.password) {
      this.toast.warning(this.uiI18n.translate('iam.zapolnite_obyazatelnye_polya'));
      return;
    }

    if (this.createForm.password.length < 10) {
      this.toast.warning(this.uiI18n.translate('iam.parol_dolzhen_soderzhat_minimum_10_simvolov'));
      return;
    }

    this.isSubmitting.set(true);
    this.api.post('/iam/users', this.createForm).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.isCreateModalOpen.set(false);
        this.toast.success(this.uiI18n.translate('iam.polzovatel_uspeshno_sozdan'));
        this.loadUsers(true);
      },
      error: () => {
        this.isSubmitting.set(false);
      }
    });
  }

  openEditModal(user: User) {
    if (!safeNumericRecordId(user.id)) return;
    this.editSessionId++;
    this.editingUser = user;
    this.editForm = {
      name: user.name,
      phone: user.phone || '',
      managerId: user.managerId || null,
      language: user.language || 'ru',
      timezone: user.timezone || 'Asia/Tashkent',
      is2faEnabled: !!user.is2faEnabled,
      roleIds: user.roleIds ? [...user.roleIds] : [],
      attributes: { ...(user.attributes || {}) }
    };
    this.isEditSubmitted = false;
    this.isEditModalOpen.set(true);
  }

  isRoleSelectedInEdit(roleId: number): boolean {
    return (this.editForm.roleIds || []).includes(roleId);
  }

  toggleRoleInEdit(roleId: number) {
    const list = this.editForm.roleIds || [];
    if (list.includes(roleId)) {
      this.editForm.roleIds = list.filter((id: number) => id !== roleId);
    } else {
      this.editForm.roleIds = [...list, roleId];
    }
  }

  submitEditUser() {
    if (!this.editingUser) return;
    this.isEditSubmitted = true;
    if (!this.editForm.name) {
      this.toast.warning(this.uiI18n.translate('iam.imya_polzovatelya_obyazatelno'));
      return;
    }

    const editSessionId = this.editSessionId;
    const saveRequestId = ++this.editSaveRequestId;
    this.isSubmitting.set(true);
    this.api.patch(`/iam/users/${this.editingUser.id}`, this.editForm).subscribe({
      next: () => {
        if (this.destroyed) return;
        if (saveRequestId === this.editSaveRequestId) {
          this.isSubmitting.set(false);
          this.closeEditModal(editSessionId);
        }
        this.toast.success(this.uiI18n.translate('iam.dannye_sohraneny'));
        this.loadUsers(true);
      },
      error: () => {
        if (!this.destroyed && saveRequestId === this.editSaveRequestId) {
          this.isSubmitting.set(false);
        }
      }
    });
  }

  openDeleteConfirmModal(user: User) {
    this.deletingUser = user;
    this.isDeleteModalOpen.set(true);
  }

  confirmDeleteUser() {
    if (!this.deletingUser) return;

    this.isSubmitting.set(true);
    this.api.delete(`/iam/users/${this.deletingUser.id}`).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.isDeleteModalOpen.set(false);
        this.toast.success(this.uiI18n.translate('iam.polzovatel_uspeshno_udalen'));
        this.loadUsers(true);
      },
      error: () => {
        this.isSubmitting.set(false);
      }
    });
  }

  toggleUserState(user: User, action: 'block' | 'unblock') {
    this.api.post(`/iam/users/${user.id}/${action}`).subscribe({
      next: () => {
        this.toast.success(action === 'block' ? this.uiI18n.translate('iam.polzovatel_zablokirovan') : this.uiI18n.translate('iam.polzovatel_razblokirovan'));
        this.loadUsers(true);
      }
    });
  }

  exportToCsv() {
    const list = this.sortedUsers();
    if (list.length === 0) {
      this.toast.info(this.uiI18n.translate('iam.net_dannyh_dlya_eksporta'));
      return;
    }

    const headers = ['ID', this.uiI18n.translate('iam.imya'), this.uiI18n.translate('analytics.login'), 'Email', this.uiI18n.translate('iam.telefon.822f9fd'), this.uiI18n.translate('common.status'), '2FA', this.uiI18n.translate('iam.yazyk'), this.uiI18n.translate('iam.chasovoy_poyas'), this.uiI18n.translate('iam.sozdan')];
    const rows = list.map(u => [
      u.id,
      `"${(u.name || '').replace(/"/g, '""')}"`,
      `"${u.login}"`,
      `"${u.email}"`,
      `"${u.phone || ''}"`,
      u.state === 'A' ? this.uiI18n.translate('common.active') : this.uiI18n.translate('common.passive'),
      u.is2faEnabled ? this.uiI18n.translate('iam.da') : this.uiI18n.translate('iam.net'),
      u.language || 'ru',
      u.timezone || 'Asia/Tashkent',
      u.createdAt
    ]);

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(e => e.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `users_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.toast.success(this.uiI18n.translate('iam.eksport_vypolnen'));
  }

  switchViewTab(tab: 'info' | 'security' | 'orgUnits', userId?: number) {
    this.activeViewTab.set(tab);
    if (tab === 'security' && userId && (!this.userSecurity() || this.userSecurity()?.userId !== userId)) {
      this.loadUserSecurity(userId);
    }
  }

  loadUserSecurity(userId: number) {
    this.isLoadingSecurity.set(true);
    this.api.get<UserSecuritySummary>(`/iam/users/${userId}/security`).subscribe({
      next: (res) => {
        this.userSecurity.set(res);
        this.isLoadingSecurity.set(false);
      },
      error: () => {
        this.isLoadingSecurity.set(false);
      }
    });
  }

  terminateUserSessions(userId: number) {
    this.secConfirmConfig = {
      title: this.uiI18n.translate('iam.zavershit_vse_sessii'),
      message: this.uiI18n.translate('iam.podtverdit_zavershenie_vseh_sessiy'),
      confirmBtnText: this.uiI18n.translate('iam.vypolnit'),
      confirmBtnVariant: 'danger',
      action: () => {
        this.isSecurityActionPending.set(true);
        this.api.delete(`/iam/users/${userId}/sessions`).subscribe({
          next: () => {
            this.isSecurityActionPending.set(false);
            this.isSecConfirmModalOpen.set(false);
            this.toast.success(this.uiI18n.translate('iam.vse_sessii_zaversheny'));
            this.loadUserSecurity(userId);
          },
          error: () => this.isSecurityActionPending.set(false)
        });
      }
    };
    this.isSecConfirmModalOpen.set(true);
  }

  terminateSingleSession(sessionId: number, userId: number) {
    this.isSecurityActionPending.set(true);
    this.api.delete(`/iam/sessions/${sessionId}`).subscribe({
      next: () => {
        this.isSecurityActionPending.set(false);
        this.toast.success(this.uiI18n.translate('iam.sessiya_zavershena'));
        this.loadUserSecurity(userId);
      },
      error: () => this.isSecurityActionPending.set(false)
    });
  }

  forcePasswordChange(userId: number) {
    this.secConfirmConfig = {
      title: this.uiI18n.translate('iam.trebovanie_smeny_parolya'),
      message: this.uiI18n.translate('iam.podtverdit_trebovanie_smeny_parolya'),
      confirmBtnText: this.uiI18n.translate('iam.vypolnit'),
      confirmBtnVariant: 'primary',
      action: () => {
        this.isSecurityActionPending.set(true);
        this.api.post(`/iam/users/${userId}/force-password-change`).subscribe({
          next: () => {
            this.isSecurityActionPending.set(false);
            this.isSecConfirmModalOpen.set(false);
            this.toast.success(this.uiI18n.translate('iam.smena_parolya_potrebovana'));
            this.loadUserSecurity(userId);
            this.loadUsers(true);
          },
          error: () => this.isSecurityActionPending.set(false)
        });
      }
    };
    this.isSecConfirmModalOpen.set(true);
  }

  resetUser2fa(userId: number) {
    this.secConfirmConfig = {
      title: this.uiI18n.translate('iam.sbrosit_2fa'),
      message: this.uiI18n.translate('iam.podtverdit_sbros_2fa'),
      confirmBtnText: this.uiI18n.translate('iam.vypolnit'),
      confirmBtnVariant: 'danger',
      action: () => {
        this.isSecurityActionPending.set(true);
        this.api.post(`/iam/users/${userId}/reset-2fa`).subscribe({
          next: () => {
            this.isSecurityActionPending.set(false);
            this.isSecConfirmModalOpen.set(false);
            this.toast.success(this.uiI18n.translate('iam.2fa_sbroshena'));
            this.loadUserSecurity(userId);
            this.loadUsers(true);
          },
          error: () => this.isSecurityActionPending.set(false)
        });
      }
    };
    this.isSecConfirmModalOpen.set(true);
  }

  confirmSecurityAction(): void {
    if (this.secConfirmConfig?.action) {
      this.secConfirmConfig.action();
    }
  }

  generateSecurePassword(): string {
    const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lowers = 'abcdefghijkmnpqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%&*';
    const allChars = uppers + lowers + digits + symbols;

    const getRandom = (charset: string) => {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const array = new Uint32Array(1);
        crypto.getRandomValues(array);
        return charset[array[0] % charset.length];
      }
      return charset[Math.floor(Math.random() * charset.length)];
    };

    let generated = '';
    const login = (this.createForm.login || '').trim().toLowerCase();

    for (let attempt = 0; attempt < 10; attempt++) {
      const pwdChars: string[] = [
        getRandom(uppers),
        getRandom(uppers),
        getRandom(lowers),
        getRandom(lowers),
        getRandom(digits),
        getRandom(digits),
        getRandom(symbols),
        getRandom(symbols)
      ];

      while (pwdChars.length < 14) {
        pwdChars.push(getRandom(allChars));
      }

      for (let i = pwdChars.length - 1; i > 0; i--) {
        const j = typeof crypto !== 'undefined' && crypto.getRandomValues
          ? (() => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % (i + 1); })()
          : Math.floor(Math.random() * (i + 1));
        [pwdChars[i], pwdChars[j]] = [pwdChars[j], pwdChars[i]];
      }

      const candidate = pwdChars.join('');
      if (!login || login.length < 3 || !candidate.toLowerCase().includes(login)) {
        generated = candidate;
        break;
      }
    }

    if (!generated) {
      generated = 'K9#mX2$vL5@wP8';
    }

    this.createForm.password = generated;
    return generated;
  }

  async copyGeneratedPassword(): Promise<void> {
    if (!this.createForm.password) return;
    try {
      if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(this.createForm.password);
      }
      this.toast.success(this.uiI18n.translate('iam.parol_skopirovan_v_bufer'));
    } catch {
      this.toast.info(this.createForm.password);
    }
  }

  passwordStrength(): { score: number; label: string; color: string } {
    const pwd = this.createForm.password || '';
    const login = this.createForm.login || '';
    let score = 0;
    if (pwd.length >= 10) score++;
    if (/[a-z\u0430-\u044F\u0451]/.test(pwd) && /[A-Z\u0410-\u042F\u0401]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd) && /[^a-zA-Z0-9\u0430-\u044F\u0410-\u042F\u0451\u0401]/.test(pwd)) score++;
    else if (/[0-9]/.test(pwd) || /[^a-zA-Z0-9\u0430-\u044F\u0410-\u042F\u0451\u0401]/.test(pwd)) score += 0.5;
    if (login && login.length >= 3 && !pwd.toLowerCase().includes(login.toLowerCase())) score += 0.5;

    if (score < 1.5) return { score: 1, label: this.uiI18n.translate('iam.parol_slabyy'), color: 'var(--danger)' };
    if (score < 2.5) return { score: 2, label: this.uiI18n.translate('iam.parol_sredniy'), color: 'var(--warning)' };
    if (score < 3.5) return { score: 3, label: this.uiI18n.translate('iam.parol_horoshiy'), color: '#3b82f6' };
    return { score: 4, label: this.uiI18n.translate('iam.parol_otlichnyy'), color: 'var(--success)' };
  }

  hasMinLength(): boolean {
    return (this.createForm.password || '').length >= 10;
  }

  hasUpperAndLower(): boolean {
    const pwd = this.createForm.password || '';
    return /[a-z\u0430-\u044F\u0451]/.test(pwd) && /[A-Z\u0410-\u042F\u0401]/.test(pwd);
  }

  hasDigitsOrSymbols(): boolean {
    const pwd = this.createForm.password || '';
    return /[0-9]/.test(pwd) || /[^a-zA-Z0-9\u0430-\u044F\u0410-\u042F\u0451\u0401]/.test(pwd);
  }

  doesNotContainLogin(): boolean {
    const pwd = (this.createForm.password || '').toLowerCase();
    const login = (this.createForm.login || '').trim().toLowerCase();
    if (!login || login.length < 3) return true;
    return !pwd.includes(login);
  }
}
