import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Role } from '../../../../core/models/rbac.models';
import { TranslatePipe } from '../../../../core/services/i18n.service';

@Component({
  selector: 'app-role-cards-bar',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  template: `
    <div class="roles-strip-container">
      <div class="roles-strip-header">
        <span class="strip-title">{{ 'iam.vyberite_rol_dlya_nastroyki_prav' | t }}</span>
        <div class="search-field" style="width: 220px;">
          <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
          <label class="sr-only" for="role-search">{{ 'iam.poisk_roley' | t }}</label>
          <input
            id="role-search"
            name="roleSearch"
            type="text"
            class="search-input"
            style="height: 30px;"
            [placeholder]="'iam.filtr_roley' | t"
            [ngModel]="searchQuery"
            (ngModelChange)="searchQueryChange.emit($event)"
          />
        </div>
      </div>

      <div class="roles-cards-grid">
        <div
          *ngFor="let r of roles"
          class="role-card-btn"
          [class.active]="selectedRole?.id === r.id"
        >
          <button
            type="button"
            class="role-select-btn"
            [attr.aria-label]="'iam.select_role_named' | t:{name: r.name}"
            [attr.aria-pressed]="selectedRole?.id === r.id"
            [disabled]="isSaving || scopePanelBusy || isSubmittingRole"
            (click)="selectRole.emit(r)"
          >
            <span class="role-card-head">
              <span class="role-card-title">{{ r.name }}</span>
              <span class="role-sys-tag font-mono" *ngIf="r.pcode">{{ r.pcode }}</span>
              <span class="role-custom-tag" *ngIf="!r.pcode">{{ 'iam.kastomnaya' | t }}</span>
            </span>
            <div class="role-status-line">
              <span class="status-dot" aria-hidden="true" [class.active]="r.state === 'A'"></span>
              <span class="status-text">{{ (r.state === 'A' ? 'common.active_feminine' : 'common.disabled_feminine') | t }}</span>
            </div>
          </button>

          <div class="role-card-foot">
            <button
              type="button"
              class="role-users-btn"
              [attr.aria-label]="'iam.prosmotr_polzovateley_roli' | t:{name: r.name, count: roleUserCounts[r.id] || 0}"
              [title]="'iam.prosmotr_polzovateley_roli' | t:{name: r.name, count: roleUserCounts[r.id] || 0}"
              (click)="navigateToUsers.emit({ role: r, event: $event })"
            >
              <span class="material-symbols-outlined users-icon" aria-hidden="true">group</span>
              <span>{{ roleUserCounts[r.id] || 0 }}</span>
            </button>

            <div class="role-btns">
              <button
                type="button"
                class="mini-btn"
                [attr.aria-label]="'iam.edit_role_named' | t:{name: r.name}"
                [title]="'iam.redaktirovat_rol' | t"
                *ngIf="canUpdateRole"
                (click)="openEdit.emit(r)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">edit</span>
              </button>
              <button
                type="button"
                class="mini-btn delete"
                [attr.aria-label]="'iam.delete_role_named' | t:{name: r.name}"
                [title]="'iam.udalit_rol' | t"
                *ngIf="!r.pcode && canDeleteRole"
                [disabled]="isSaving || scopePanelBusy || isSubmittingRole"
                (click)="openDelete.emit(r)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">delete</span>
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          class="add-role-dashed-btn"
          *ngIf="canCreateRole"
          (click)="openCreate.emit()"
        >
          <span class="material-symbols-outlined" aria-hidden="true">add</span>
          <span>{{ 'iam.sozdat_rol' | t }}</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .roles-strip-container {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .roles-strip-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .strip-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-main);
    }
    .search-field {
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-field .search-icon {
      position: absolute;
      left: 8px;
      font-size: 16px;
      color: var(--text-muted);
      pointer-events: none;
    }
    .search-input {
      width: 100%;
      height: 32px;
      padding: 4px 8px 4px 28px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-size: 12px;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .search-input:focus { border-color: var(--primary); }

    .roles-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
      gap: 10px;
    }
    .role-card-btn {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      padding: 0;
      overflow: hidden;
      transition: all 0.15s ease;
    }
    .role-card-btn:hover { border-color: var(--primary-light); background-color: var(--bg-hover); }
    .role-card-btn.active {
      border-color: var(--primary);
      background-color: var(--primary-50);
      box-shadow: 0 0 0 1px var(--primary);
    }
    .role-select-btn {
      width: 100%;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
      font: inherit;
      padding: 10px 12px;
      text-align: left;
    }
    .role-card-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 6px;
    }
    .role-card-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-main);
      line-height: 1.3;
    }
    .role-sys-tag {
      font-size: 9px;
      background-color: var(--bg-hover);
      padding: 2px 5px;
      border-radius: 4px;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .role-custom-tag {
      font-size: 9px;
      background-color: var(--primary-50);
      color: var(--primary);
      padding: 2px 5px;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .role-status-line {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--text-muted);
    }
    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: var(--border-color);
    }
    .status-dot.active { background-color: var(--success); }

    .role-card-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 12px;
      background-color: rgba(0, 0, 0, 0.02);
      border-top: 1px solid var(--border-color);
    }
    .role-users-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--text-muted);
      border: none;
      background: transparent;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .role-users-btn:hover {
      background-color: var(--bg-hover);
      color: var(--text-main);
    }
    .role-users-btn .users-icon { font-size: 14px; }

    .role-btns { display: flex; align-items: center; gap: 4px; }
    .mini-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 4px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }
    .mini-btn:hover { background-color: var(--bg-hover); color: var(--text-main); }
    .mini-btn.delete:hover { background-color: var(--danger-50); color: var(--danger); }
    .mini-btn span { font-size: 14px; }

    .add-role-dashed-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 80px;
      border: 1px dashed var(--border-color);
      border-radius: var(--radius-sm);
      background-color: transparent;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .add-role-dashed-btn:hover {
      border-color: var(--primary);
      color: var(--primary);
      background-color: var(--primary-50);
    }
    .add-role-dashed-btn span.material-symbols-outlined { font-size: 20px; }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .font-mono { font-family: monospace; }
  `]
})
export class RoleCardsBarComponent {
  @Input() roles: Role[] = [];
  @Input() selectedRole: Role | null = null;
  @Input() roleUserCounts: Record<number, number> = {};
  @Input() searchQuery = '';
  @Input() isSaving = false;
  @Input() scopePanelBusy = false;
  @Input() isSubmittingRole = false;
  @Input() canCreateRole = false;
  @Input() canUpdateRole = false;
  @Input() canDeleteRole = false;

  @Output() searchQueryChange = new EventEmitter<string>();
  @Output() selectRole = new EventEmitter<Role>();
  @Output() navigateToUsers = new EventEmitter<{ role: Role; event: MouseEvent }>();
  @Output() openEdit = new EventEmitter<Role>();
  @Output() openDelete = new EventEmitter<Role>();
  @Output() openCreate = new EventEmitter<void>();
}
