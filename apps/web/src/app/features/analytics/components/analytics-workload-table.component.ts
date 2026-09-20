import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { UiBadgeComponent } from '../../../shared/ui/ui-badge.component';
import { UserWorkload, WorkloadSortColumn, SortDirection } from '../analytics.models';

@Component({
  selector: 'app-analytics-workload-table',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    UiBadgeComponent
  ],
  template: `
    <div class="table-card" style="margin-top: 20px;">
      <div class="card-header-row" style="padding: 14px 20px; border-bottom: 1px solid var(--border-color);">
        <div>
          <h2 class="card-title">{{ 'analytics.utilizaciya_i_zagruzka_komandy' | t }}</h2>
          <p class="card-subtitle">{{ 'analytics.raspredelenie_aktivnyh_i_vypolnennyh_zadach_po_i' | t }}</p>
        </div>

        <!-- Quick User Filter -->
        <div class="user-search-box" *ngIf="workload.length > 0">
          <span class="material-symbols-outlined search-ico" aria-hidden="true">search</span>
          <input
            type="text"
            class="search-mini-input"
            [placeholder]="'analytics.poisk_sotrudnika' | t"
            [attr.aria-label]="'analytics.poisk_sotrudnika' | t"
            [ngModel]="searchUserQuery()"
            (ngModelChange)="searchUserQuery.set($event)"
          />
          <button
            *ngIf="searchUserQuery()"
            type="button"
            class="clear-mini-btn"
            (click)="searchUserQuery.set('')"
            [attr.aria-label]="'common.clear' | t"
          >
            <span class="material-symbols-outlined" style="font-size: 14px;">close</span>
          </button>
        </div>
      </div>

      <div class="table-scroll" role="region" tabindex="0" [attr.aria-label]="'analytics.utilizaciya_i_zagruzka_komandy' | t">
        <table>
          <thead>
            <tr>
              <th style="width: 240px;" class="th-sort">
                <button type="button" class="sort-button" (click)="changeWorkloadSort('name')" [attr.aria-pressed]="workloadSortColumn() === 'name'">
                  {{ 'analytics.sotrudnik' | t }}
                  <span class="material-symbols-outlined sort-ico" *ngIf="workloadSortColumn() === 'name'">
                    {{ workloadSortDir() === 'asc' ? 'north' : 'south' }}
                  </span>
                </button>
              </th>
              <th class="th-sort">
                <button type="button" class="sort-button" (click)="changeWorkloadSort('login')" [attr.aria-pressed]="workloadSortColumn() === 'login'">
                  {{ 'analytics.login' | t }}
                  <span class="material-symbols-outlined sort-ico" *ngIf="workloadSortColumn() === 'login'">
                    {{ workloadSortDir() === 'asc' ? 'north' : 'south' }}
                  </span>
                </button>
              </th>
              <th class="th-sort">
                <button type="button" class="sort-button" (click)="changeWorkloadSort('assigned')" [attr.aria-pressed]="workloadSortColumn() === 'assigned'">
                  {{ 'analytics.naznacheno_zadach' | t }}
                  <span class="material-symbols-outlined sort-ico" *ngIf="workloadSortColumn() === 'assigned'">
                    {{ workloadSortDir() === 'asc' ? 'north' : 'south' }}
                  </span>
                </button>
              </th>
              <th class="th-sort">
                <button type="button" class="sort-button" (click)="changeWorkloadSort('completed')" [attr.aria-pressed]="workloadSortColumn() === 'completed'">
                  {{ 'analytics.zaversheno' | t }}
                  <span class="material-symbols-outlined sort-ico" *ngIf="workloadSortColumn() === 'completed'">
                    {{ workloadSortDir() === 'asc' ? 'north' : 'south' }}
                  </span>
                </button>
              </th>
              <th class="th-sort">
                <button type="button" class="sort-button" (click)="changeWorkloadSort('efficiency')" [attr.aria-pressed]="workloadSortColumn() === 'efficiency'">
                  {{ 'analytics.effektivnost' | t }}
                  <span class="material-symbols-outlined sort-ico" *ngIf="workloadSortColumn() === 'efficiency'">
                    {{ workloadSortDir() === 'asc' ? 'north' : 'south' }}
                  </span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let u of filteredWorkload()">
              <td>
                <div class="user-cell">
                  <div class="user-avatar-sm" [style.background-color]="getAvatarBgColor(u.userName)">
                    {{ getUserInitial(u.userName) }}
                  </div>
                  <span class="user-name-text">{{ u.userName }}</span>
                </div>
              </td>
              <td>
                <span class="mono badge badge-neutral">{{ u.userLogin }}</span>
              </td>
              <td style="font-weight: 600;">{{ u.assignedTasks }}</td>
              <td class="text-success" style="font-weight: 600;">{{ u.completedTasks }}</td>
              <td>
                <div class="efficiency-cell">
                  <ui-badge [variant]="u.assignedTasks > 0 && (u.completedTasks / u.assignedTasks) >= 0.7 ? 'success' : 'neutral'">
                    {{ u.assignedTasks > 0 ? ((u.completedTasks / u.assignedTasks) * 100 | number:'1.0-0') : 0 }}%
                  </ui-badge>
                  <div class="eff-mini-bar-bg" *ngIf="u.assignedTasks > 0">
                    <div class="eff-mini-bar-fill"
                      [style.width.%]="getEfficiencyPercent(u)"
                      [style.background-color]="(u.completedTasks / u.assignedTasks) >= 0.7 ? 'var(--success)' : 'var(--primary)'">
                    </div>
                  </div>
                </div>
              </td>
            </tr>
            <tr *ngIf="filteredWorkload().length === 0 && !loading && !error">
              <td colspan="5" class="empty">
                <span>{{ 'analytics.dannye_po_zagruzke_sotrudnikov_otsutstvuyut' | t }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .table-card {
      min-width: 0;
      max-width: 100%;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm);
      overflow: hidden;
    }

    .card-header-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }

    .card-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-main);
      overflow-wrap: anywhere;
    }

    .card-subtitle {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
      overflow-wrap: anywhere;
    }

    .user-search-box {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 2px 8px;
      height: 28px;
      transition: border-color 0.15s ease;
    }
    .user-search-box:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 0 1px var(--primary);
    }
    .search-ico {
      font-size: 16px;
      color: var(--text-muted);
    }
    .search-mini-input {
      border: none;
      outline: none;
      background: transparent;
      font-size: 12px;
      color: var(--text-main);
      width: 130px;
    }
    .clear-mini-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      padding: 0;
    }
    .clear-mini-btn:hover {
      color: var(--text-main);
    }

    .table-scroll {
      width: 100%;
      overflow-x: auto;
    }
    .table-scroll:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    th {
      text-align: left;
      padding: 10px 14px;
      background-color: var(--bg-hover);
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      border-bottom: 1px solid var(--border-color);
    }

    td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-main);
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover td {
      background-color: var(--bg-hover);
    }

    .th-sort {
      padding: 0 !important;
    }
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
      display: inline-flex;
      align-items: center;
      gap: 4px;
      user-select: none;
      transition: color 0.15s ease;
    }
    .sort-button:hover {
      color: var(--primary);
    }
    .sort-button:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
      border-radius: var(--radius-xs);
    }
    .sort-ico {
      font-size: 14px;
      vertical-align: middle;
    }

    .user-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .user-avatar-sm {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background-color: var(--primary-subtle);
      color: var(--primary-text);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
    }

    .user-name-text {
      font-weight: 600;
      color: var(--text-main);
    }

    .mono {
      font-family: monospace;
    }

    .badge {
      font-size: 11px;
      font-weight: 500;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .badge-neutral {
      background-color: var(--bg-hover);
      color: var(--text-muted);
    }

    .text-success { color: var(--success); }

    .efficiency-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .eff-mini-bar-bg {
      width: 50px;
      height: 5px;
      border-radius: 9999px;
      background-color: var(--bg-hover);
      overflow: hidden;
    }
    .eff-mini-bar-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.2s ease;
    }

    td.empty {
      padding: 30px;
      text-align: center;
      color: var(--text-muted);
    }
  `]
})
export class AnalyticsWorkloadTableComponent {
  private _workload = signal<UserWorkload[]>([]);

  @Input() set workload(value: UserWorkload[]) {
    this._workload.set(value || []);
  }
  get workload(): UserWorkload[] {
    return this._workload();
  }

  @Input() loading = false;
  @Input() error = '';

  searchUserQuery = signal('');
  workloadSortColumn = signal<WorkloadSortColumn>('assigned');
  workloadSortDir = signal<SortDirection>('desc');

  filteredWorkload = computed(() => {
    const query = this.searchUserQuery().trim().toLowerCase();
    let list = this._workload();
    if (query) {
      list = list.filter(u =>
        u.userName.toLowerCase().includes(query) ||
        u.userLogin.toLowerCase().includes(query)
      );
    }
    const col = this.workloadSortColumn();
    const dir = this.workloadSortDir() === 'asc' ? 1 : -1;

    return [...list].sort((a, b) => {
      let diff = 0;
      switch (col) {
        case 'name':
          diff = a.userName.localeCompare(b.userName);
          break;
        case 'login':
          diff = a.userLogin.localeCompare(b.userLogin);
          break;
        case 'assigned':
          diff = a.assignedTasks - b.assignedTasks;
          break;
        case 'completed':
          diff = a.completedTasks - b.completedTasks;
          break;
        case 'efficiency': {
          const effA = a.assignedTasks > 0 ? a.completedTasks / a.assignedTasks : 0;
          const effB = b.assignedTasks > 0 ? b.completedTasks / b.assignedTasks : 0;
          diff = effA - effB;
          break;
        }
      }
      return diff !== 0 ? diff * dir : a.userName.localeCompare(b.userName);
    });
  });

  changeWorkloadSort(col: WorkloadSortColumn): void {
    if (this.workloadSortColumn() === col) {
      this.workloadSortDir.update(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.workloadSortColumn.set(col);
      this.workloadSortDir.set(col === 'name' || col === 'login' ? 'asc' : 'desc');
    }
  }

  getEfficiencyPercent(u: UserWorkload): number {
    if (u.assignedTasks <= 0) return 0;
    return Math.min(100, Math.round((u.completedTasks / u.assignedTasks) * 100));
  }

  getAvatarBgColor(name: string): string {
    const colors = [
      '#4338ca', '#0369a1', '#047857', '#b45309',
      '#6d28d9', '#be185d', '#0f766e', '#c2410c'
    ];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  getUserInitial(name: string): string {
    return (name || '').trim().charAt(0).toUpperCase() || '?';
  }
}
