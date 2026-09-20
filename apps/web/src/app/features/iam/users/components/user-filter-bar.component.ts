import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { Role } from '../../../../core/models/rbac.models';

@Component({
  selector: 'app-user-filter-bar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    UiButtonComponent
  ],
  template: `
    <!-- Compact Single-Line Toolbar -->
    <div class="toolbar">
      <div class="search-field">
        <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
        <label class="sr-only" for="user-search">{{ 'iam.poisk_polzovateley' | t }}</label>
        <input
          id="user-search"
          name="userSearch"
          type="text"
          class="search-input"
          [placeholder]="'iam.poisk_po_imeni_loginu_email' | t"
          [ngModel]="searchQuery"
          (ngModelChange)="searchQueryChange.emit($event)"
          (input)="searchInput.emit()"
        />
        <button
          *ngIf="searchQuery"
          type="button"
          class="btn-icon"
          style="position: absolute; right: 6px;"
          [attr.aria-label]="'iam.ochistit_poisk_polzovateley' | t"
          (click)="clearSearch.emit()"
        >
          <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">close</span>
        </button>
      </div>

      <div class="toolbar-controls">
        <!-- Segmented Status Switcher -->
        <div class="status-tabs" role="group" [attr.aria-label]="'iam.filtr_polzovateley_po_statusu' | t">
          <button
            type="button"
            class="status-tab"
            [class.active]="selectedState === ''"
            [attr.aria-pressed]="selectedState === ''"
            (click)="stateFilterChange.emit('')"
          >
            {{ 'common.all' | t }}
          </button>
          <button
            type="button"
            class="status-tab"
            [class.active]="selectedState === 'A'"
            [attr.aria-pressed]="selectedState === 'A'"
            (click)="stateFilterChange.emit('A')"
          >
            <span class="status-tab-dot" style="background-color: var(--success);" aria-hidden="true"></span>
            {{ 'iam.aktivnye' | t }}
          </button>
          <button
            type="button"
            class="status-tab"
            [class.active]="selectedState === 'P'"
            [attr.aria-pressed]="selectedState === 'P'"
            (click)="stateFilterChange.emit('P')"
          >
            <span class="status-tab-dot" style="background-color: var(--danger);" aria-hidden="true"></span>
            {{ 'iam.zablokirovannye' | t }}
          </button>
        </div>

        <!-- Grouped Filter Popover Trigger -->
        <div class="filter-popover-wrapper">
          <button
            type="button"
            class="filter-trigger-btn"
            aria-haspopup="dialog"
            [attr.aria-expanded]="isFilterMenuOpen"
            aria-controls="user-extra-filters"
            [class.has-filters]="hasExtraFilters"
            [class.open]="isFilterMenuOpen"
            (click)="toggleFilterMenu.emit($event)"
          >
            <span class="material-symbols-outlined icon" aria-hidden="true">tune</span>
            <span>{{ 'iam.filtry' | t }}</span>
            <span class="filter-dot" *ngIf="hasExtraFilters"></span>
          </button>

          <!-- Filter Dropdown Panel -->
          <div
            id="user-extra-filters"
            class="filter-dropdown"
            role="dialog"
            [attr.aria-label]="'iam.dopolnitelnye_filtry_polzovateley' | t"
            *ngIf="isFilterMenuOpen"
            (click)="$event.stopPropagation()"
          >
            <div class="filter-dropdown-header">
              <span class="dropdown-title">{{ 'iam.dopolnitelnye_filtry' | t }}</span>
              <button type="button" class="reset-link" *ngIf="hasExtraFilters" (click)="resetExtraFilters.emit()">
                {{ 'iam.sbrosit' | t }}
              </button>
            </div>

            <div class="filter-dropdown-body">
              <div class="filter-group">
                <label class="filter-caption" for="user-role-filter">{{ 'iam.rol_polzovatelya' | t }}</label>
                <select
                  id="user-role-filter"
                  name="userRoleFilter"
                  class="filter-select"
                  [ngModel]="selectedRoleId"
                  (ngModelChange)="roleFilterChange.emit($event)"
                >
                  <option [ngValue]="null">{{ 'iam.vse_roli' | t }}</option>
                  <option *ngFor="let r of roles" [ngValue]="r.id">{{ r.name }}</option>
                </select>
              </div>

              <div class="filter-group">
                <label class="filter-caption" for="user-2fa-filter">{{ 'iam.dvuhfaktornaya_zaschita_2fa' | t }}</label>
                <select
                  id="user-2fa-filter"
                  name="user2faFilter"
                  class="filter-select"
                  [ngModel]="selected2fa"
                  (ngModelChange)="twoFactorFilterChange.emit($event)"
                >
                  <option [ngValue]="null">{{ 'iam.lyuboy_status_2fa' | t }}</option>
                  <option [ngValue]="true">{{ 'iam.tolko_s_2fa' | t }}</option>
                  <option [ngValue]="false">{{ 'iam.bez_2fa' | t }}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <ui-button
          variant="ghost"
          size="sm"
          icon="refresh"
          [ariaLabel]="'iam.obnovit_spisok_polzovateley' | t"
          [loading]="isLoading"
          [title]="'common.refresh' | t"
          (onClick)="refresh.emit()"
        ></ui-button>
      </div>
    </div>

    <!-- Active Filters Bar -->
    <div class="active-filters-bar" *ngIf="hasAnyActiveFilters">
      <span class="active-filters-label">{{ 'iam.filtry' | t }}:</span>

      <!-- Status Filter Pill -->
      <div *ngIf="selectedState" class="filter-pill">
        <span>{{ 'iam.filtr_status' | t:{status: selectedState === 'A' ? ('iam.aktivnye' | t) : ('iam.zablokirovannye' | t)} }}</span>
        <button type="button" class="clear-pill-btn" [attr.aria-label]="'iam.ochistit_filtr' | t" (click)="clearStateFilter.emit()">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>

      <!-- Role Filter Pill -->
      <div *ngIf="selectedRoleId" class="filter-pill">
        <span>{{ 'iam.filtr_po_roli' | t:{name: selectedRoleName} }}</span>
        <button type="button" class="clear-pill-btn" [attr.aria-label]="'iam.ochistit_filtr_roli' | t" (click)="clearRoleFilter.emit()">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>

      <!-- 2FA Filter Pill -->
      <div *ngIf="selected2fa !== null" class="filter-pill">
        <span>{{ 'iam.filtr_2fa' | t:{status: selected2fa ? ('iam.vklyuchena' | t) : ('iam.otklyuchena' | t)} }}</span>
        <button type="button" class="clear-pill-btn" [attr.aria-label]="'iam.ochistit_filtr' | t" (click)="clear2faFilter.emit()">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>

      <!-- Reset All Button -->
      <button type="button" class="reset-all-filters-btn" (click)="resetAllFilters.emit()">
        <span class="material-symbols-outlined" aria-hidden="true">filter_alt_off</span>
        <span>{{ 'iam.sbrosit_vse_filtry' | t }}</span>
      </button>
    </div>
  `,
  styles: [`
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .search-field {
      position: relative;
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
    .btn-icon {
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .toolbar-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }
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

    /* Accessibility focus indicators */
    .status-tab:focus-visible,
    .filter-trigger-btn:focus-visible,
    .clear-pill-btn:focus-visible,
    .reset-all-filters-btn:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
      border-radius: var(--radius-sm);
    }

    @media (max-width: 640px) {
      .toolbar-controls {
        width: 100%;
        flex-wrap: wrap;
        min-width: 0;
      }
      .status-tabs {
        max-width: 100%;
        overflow-x: auto;
      }
    }
  `]
})
export class UserFilterBarComponent {
  @Input() searchQuery = '';
  @Input() selectedState = '';
  @Input() isFilterMenuOpen = false;
  @Input() hasExtraFilters = false;
  @Input() roles: Role[] = [];
  @Input() selectedRoleId: number | null = null;
  @Input() selected2fa: boolean | null = null;
  @Input() isLoading = false;
  @Input() hasAnyActiveFilters = false;
  @Input() selectedRoleName = '';

  @Output() searchQueryChange = new EventEmitter<string>();
  @Output() searchInput = new EventEmitter<void>();
  @Output() clearSearch = new EventEmitter<void>();
  @Output() stateFilterChange = new EventEmitter<string>();
  @Output() toggleFilterMenu = new EventEmitter<MouseEvent>();
  @Output() resetExtraFilters = new EventEmitter<void>();
  @Output() roleFilterChange = new EventEmitter<number | null>();
  @Output() twoFactorFilterChange = new EventEmitter<boolean | null>();
  @Output() refresh = new EventEmitter<void>();
  @Output() clearStateFilter = new EventEmitter<void>();
  @Output() clearRoleFilter = new EventEmitter<void>();
  @Output() clear2faFilter = new EventEmitter<void>();
  @Output() resetAllFilters = new EventEmitter<void>();
}
