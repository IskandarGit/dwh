import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { UiPaginationComponent } from '../../../../shared/ui/ui-pagination.component';
import { User } from '../../../../core/models/auth.models';
import { Role } from '../../../../core/models/rbac.models';

export type SortColumn = 'id' | 'name' | 'login' | 'createdAt';
export type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-user-table-view',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    UiButtonComponent,
    UiPaginationComponent
  ],
  template: `
    <div class="table-container" role="region" [attr.aria-label]="'iam.tablica_polzovateley' | t" tabindex="0">
      <table class="clean-table" [attr.aria-label]="'iam.spisok_polzovateley' | t">
        <thead>
          <tr>
            <th class="th-sort">
              <button type="button" class="sort-button" (click)="sortChange.emit('name')" [attr.aria-pressed]="sortColumn === 'name'">
                {{ 'audit.polzovatel' | t }}
                <span class="material-symbols-outlined sort-ico" aria-hidden="true" *ngIf="sortColumn === 'name'">
                  {{ sortDirection === 'asc' ? 'north' : 'south' }}
                </span>
              </button>
            </th>
            <th>{{ 'iam.kontakty' | t }}</th>
            <th>{{ 'iam.roli' | t }}</th>
            <th>{{ 'iam.rukovoditel' | t }}</th>
            <th class="text-center" style="width: 70px;">2FA</th>
            <th style="width: 110px;">{{ 'common.status' | t }}</th>
            <th class="th-sort text-right" style="width: 110px;">
              <button type="button" class="sort-button align-right" (click)="sortChange.emit('createdAt')" [attr.aria-pressed]="sortColumn === 'createdAt'">
                {{ 'iam.sozdan' | t }}
                <span class="material-symbols-outlined sort-ico" aria-hidden="true" *ngIf="sortColumn === 'createdAt'">
                  {{ sortDirection === 'asc' ? 'north' : 'south' }}
                </span>
              </button>
            </th>
            <th class="text-right" style="width: 140px;"></th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let u of paginatedUsers" class="table-row">
            <td>
              <button type="button" class="user-identity" (click)="viewUser.emit(u)" [attr.aria-label]="'iam.open_user_profile_named' | t:{name: u.name}">
                <div class="avatar" [style.background-color]="getAvatarBgColor(u.name)">
                  {{ getUserInitial(u) }}
                </div>
                <div class="identity-info">
                  <span class="full-name">{{ u.name }}</span>
                  <span class="login-handle font-mono">&#64;{{ u.login }}</span>
                </div>
              </button>
            </td>
            <td>
              <div class="contacts-cell">
                <span class="contact-email">{{ u.email }}</span>
                <span class="contact-phone font-mono" *ngIf="u.phone">{{ u.phone }}</span>
              </div>
            </td>
            <td>
              <div class="roles-wrap">
                <span *ngFor="let rName of getUserRoleNames(u)" class="role-pill">
                  {{ rName }}
                </span>
                <span *ngIf="getUserRoleNames(u).length === 0" class="muted-dash">—</span>
              </div>
            </td>
            <td>
              <span class="manager-text" *ngIf="getManagerName(u) as mName">{{ mName }}</span>
              <span class="muted-dash" *ngIf="!getManagerName(u)">—</span>
            </td>
            <td class="text-center">
              <span
                class="material-symbols-outlined twofa-dot"
                [class.active]="u.is2faEnabled"
                [title]="(u.is2faEnabled ? 'iam.two_factor_enabled' : 'iam.two_factor_disabled_short') | t"
                [attr.aria-label]="(u.is2faEnabled ? 'iam.two_factor_enabled' : 'iam.two_factor_disabled_short') | t"
              >
                {{ u.is2faEnabled ? 'check_circle' : 'remove' }}
              </span>
            </td>
            <td>
              <span class="status-indicator" [class.active]="u.state === 'A'">
                <span class="dot"></span>
                {{ (u.state === 'A' ? 'common.active_masculine' : 'common.disabled_masculine') | t }}
              </span>
            </td>
            <td class="text-right text-muted font-mono text-xs">{{ u.createdAt | date:'dd.MM.yyyy' }}</td>
            <td class="text-right row-actions">
              <ui-button
                variant="ghost"
                size="sm"
                icon="visibility"
                [ariaLabel]="'iam.view_user_named' | t:{name: u.name}"
                [title]="'iam.prosmotr' | t"
                (onClick)="viewUser.emit(u)"
              ></ui-button>
              <ui-button
                *ngIf="canUpdateUser"
                variant="ghost"
                size="sm"
                icon="edit"
                [ariaLabel]="'iam.edit_user_named' | t:{name: u.name}"
                [title]="'common.edit' | t"
                (onClick)="editUser.emit(u)"
              ></ui-button>
              <ui-button
                *ngIf="u.state === 'A' && canBlockUser"
                variant="ghost"
                size="sm"
                icon="lock"
                [ariaLabel]="'iam.block_user_named' | t:{name: u.name}"
                [title]="'common.block' | t"
                (onClick)="toggleState.emit({ user: u, action: 'block' })"
              ></ui-button>
              <ui-button
                *ngIf="u.state === 'P' && canUnblockUser"
                variant="ghost"
                size="sm"
                icon="lock_open"
                [ariaLabel]="'iam.unblock_user_named' | t:{name: u.name}"
                [title]="'common.unblock' | t"
                (onClick)="toggleState.emit({ user: u, action: 'unblock' })"
              ></ui-button>
              <ui-button
                *ngIf="u.login !== 'admin' && canDeleteUser"
                variant="ghost"
                size="sm"
                icon="delete"
                [ariaLabel]="'iam.delete_user_named' | t:{name: u.name}"
                [title]="'common.delete' | t"
                (onClick)="deleteUser.emit(u)"
              ></ui-button>
            </td>
          </tr>

          <tr *ngIf="users.length === 0 && !isLoading">
            <td colspan="8" class="empty-state">
              <span class="material-symbols-outlined empty-ico" aria-hidden="true">search_off</span>
              <p class="empty-text">{{ 'iam.polzovateli_ne_naydeny' | t }}</p>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Table Footer / Keyset pagination & load more bar -->
      <div class="table-footer-bar">
        <div class="loaded-count-info">
          <span>{{ 'iam.pokazano_polzovateley' | t:{count: users.length} }}</span>
          <span *ngIf="hasMore" class="has-more-badge">{{ 'iam.est_esche' | t }}</span>
        </div>

        <div class="load-more-wrap" *ngIf="hasMore">
          <ui-button
            variant="secondary"
            size="sm"
            icon="arrow_downward"
            [loading]="isLoadingMore"
            (onClick)="loadMore.emit()"
          >
            {{ 'iam.zagruzit_esche' | t }}
          </ui-button>
        </div>

        <!-- Pagination -->
        <ui-pagination
          [totalItems]="totalItems"
          [currentPage]="currentPage"
          [pageSize]="pageSize"
          (pageChange)="pageChange.emit($event)"
          (pageSizeChange)="pageSizeChange.emit($event)"
        ></ui-pagination>
      </div>
    </div>
  `,
  styles: [`
    .table-container {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      overflow: hidden;
      box-shadow: var(--shadow-sm);
    }
    .clean-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }
    .clean-table th {
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
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

    .font-mono { font-family: monospace; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-muted { color: var(--text-muted); }
    .text-xs { font-size: 11px; }

    /* Accessibility focus indicators */
    .user-identity:focus-visible,
    .sort-button:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
      border-radius: var(--radius-sm);
    }
  `]
})
export class UserTableViewComponent {
  @Input() users: User[] = [];
  @Input() paginatedUsers: User[] = [];
  @Input() totalItems = 0;
  @Input() sortColumn: SortColumn = 'createdAt';
  @Input() sortDirection: SortDirection = 'desc';
  @Input() isLoading = false;
  @Input() hasMore = false;
  @Input() isLoadingMore = false;
  @Input() currentPage = 1;
  @Input() pageSize = 15;
  @Input() canUpdateUser = false;
  @Input() canBlockUser = false;
  @Input() canUnblockUser = false;
  @Input() canDeleteUser = false;

  @Input() getUserInitial!: (u: User) => string;
  @Input() getAvatarBgColor!: (name: string) => string;
  @Input() getUserRoleNames!: (u: User) => string[];
  @Input() getManagerName!: (u: User) => string | null;

  @Output() sortChange = new EventEmitter<SortColumn>();
  @Output() viewUser = new EventEmitter<User>();
  @Output() editUser = new EventEmitter<User>();
  @Output() toggleState = new EventEmitter<{ user: User, action: 'block' | 'unblock' }>();
  @Output() deleteUser = new EventEmitter<User>();
  @Output() loadMore = new EventEmitter<void>();
  @Output() pageChange = new EventEmitter<number>();
  @Output() pageSizeChange = new EventEmitter<number>();
}
