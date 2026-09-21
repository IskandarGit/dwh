import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { of, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { ApiService } from '../../../../core/services/api.service';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { UiModalComponent } from '../../../../shared/ui/ui-modal.component';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { UiBadgeComponent } from '../../../../shared/ui/ui-badge.component';
import { Project } from '../../../../core/models/task.models';
import { User } from '../../../../core/models/auth.models';
import { ProjectMember } from '../projects.models';

@Component({
  selector: 'app-project-members-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    UiModalComponent,
    UiButtonComponent,
    UiBadgeComponent
  ],
  template: `
    <ui-modal
      [isOpen]="isOpen"
      [title]="'projects.uchastniki_proekta_title' | t:{name: project?.name || ''}"
      size="lg"
      (close)="close.emit()"
    >
      <div body class="members-modal-body">
        <!-- Add Member Panel (visible if user can update project) -->
        <div *ngIf="canUpdateProject" class="add-member-panel">
          <div class="panel-header">
            <span class="material-symbols-outlined panel-icon" aria-hidden="true">person_add</span>
            <span class="panel-title">{{ 'projects.dobavit_uchastnika' | t }}</span>
          </div>

          <div class="add-member-controls">
            <!-- User Search / Selector -->
            <div class="user-search-wrapper">
              <label class="form-label" for="project-member-search">
                {{ 'projects.vyberite_polzovatelya' | t }} <span class="req">*</span>
              </label>
              <div class="search-input-box">
                <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
                <input
                  id="project-member-search"
                  type="text"
                  class="form-input"
                  [placeholder]="selectedUser ? selectedUser.name : ('projects.poisk_polzovatelya' | t)"
                  [(ngModel)]="userSearchQuery"
                  (ngModelChange)="onSearchInput($event)"
                  (focus)="isUserDropdownOpen = true"
                />
                <button
                  *ngIf="selectedUser"
                  type="button"
                  class="clear-user-btn"
                  [title]="'common.clear' | t"
                  (click)="clearSelectedUser()"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </div>

              <!-- User Search Results Dropdown -->
              <div *ngIf="isUserDropdownOpen && foundUsers.length > 0" class="user-dropdown-list">
                <button
                  *ngFor="let u of foundUsers"
                  type="button"
                  class="user-dropdown-item"
                  [class.is-member]="isUserAlreadyMember(u.id)"
                  [disabled]="isUserAlreadyMember(u.id)"
                  (click)="selectUser(u)"
                >
                  <span class="user-avatar-mini">{{ getInitials(u.name) }}</span>
                  <div class="user-item-info">
                    <span class="user-item-name">{{ u.name }}</span>
                    <span class="user-item-email text-muted">&#64;{{ u.login }} &bull; {{ u.email }}</span>
                  </div>
                  <span *ngIf="isUserAlreadyMember(u.id)" class="already-member-tag">
                    {{ 'projects.polzovatel_uzhe_uchastnik' | t }}
                  </span>
                </button>
              </div>
            </div>

            <!-- Role / Access Kind -->
            <div class="access-kind-wrapper">
              <label class="form-label" for="project-member-role">
                {{ 'projects.uroven_dostupa' | t }} <span class="req">*</span>
              </label>
              <select
                id="project-member-role"
                name="accessKind"
                class="form-input form-select"
                [(ngModel)]="selectedAccessKind"
              >
                <option value="MEMBER">{{ 'projects.rol_uchastnik' | t }}</option>
                <option value="MANAGER">{{ 'projects.rol_rukovoditel' | t }}</option>
                <option value="OBSERVER">{{ 'projects.rol_nablyudatel' | t }}</option>
              </select>
            </div>

            <!-- Submit Button -->
            <div class="add-btn-wrapper">
              <ui-button
                variant="primary"
                size="md"
                icon="add"
                [disabled]="!selectedUser || isAddingMember"
                [loading]="isAddingMember"
                (onClick)="submitAddMember()"
              >
                {{ 'common.add' | t }}
              </ui-button>
            </div>
          </div>
        </div>

        <!-- Members Table -->
        <div class="table-wrapper" role="region" [attr.aria-label]="'projects.tablica_uchastnikov_proekta' | t" tabindex="0">
          <table class="data-table" [attr.aria-label]="'projects.uchastniki_proekta' | t">
            <thead>
              <tr>
                <th>{{ 'nav.users' | t }}</th>
                <th>{{ 'iam.email' | t }}</th>
                <th>{{ 'projects.uroven_dostupa' | t }}</th>
                <th *ngIf="canUpdateProject" class="text-right">{{ 'audit.deystvie' | t }}</th>
              </tr>
            </thead>
            <tbody>
              <!-- Skeleton loading rows -->
              <ng-container *ngIf="isLoadingMembers">
                <tr class="skeleton-row" *ngFor="let item of [1, 2]">
                  <td><div class="skeleton-pill w-48"></div></td>
                  <td><div class="skeleton-pill w-36"></div></td>
                  <td><div class="skeleton-pill w-28"></div></td>
                  <td *ngIf="canUpdateProject" class="text-right"><div class="skeleton-pill w-20 ml-auto"></div></td>
                </tr>
              </ng-container>

              <!-- Real members rows -->
              <ng-container *ngIf="!isLoadingMembers">
                <tr *ngFor="let m of members">
                  <td>
                    <div class="member-user-cell">
                      <span class="user-avatar-mini">{{ getInitials(m.userName) }}</span>
                      <span class="font-medium">{{ m.userName }}</span>
                    </div>
                  </td>
                  <td class="text-muted tabular-nums">{{ m.userEmail || '—' }}</td>
                  <td>
                    <ui-badge *ngIf="m.accessKind === 'MANAGER'" variant="info">
                      {{ 'projects.rol_rukovoditel' | t }}
                    </ui-badge>
                    <ui-badge *ngIf="m.accessKind === 'MEMBER'" variant="success">
                      {{ 'projects.rol_uchastnik' | t }}
                    </ui-badge>
                    <ui-badge *ngIf="m.accessKind === 'OBSERVER'" variant="neutral">
                      {{ 'projects.rol_nablyudatel' | t }}
                    </ui-badge>
                    <ui-badge *ngIf="m.accessKind !== 'MANAGER' && m.accessKind !== 'MEMBER' && m.accessKind !== 'OBSERVER'" variant="neutral">
                      {{ m.accessKind }}
                    </ui-badge>
                  </td>
                  <td *ngIf="canUpdateProject" class="text-right">
                    <ui-button
                      variant="danger"
                      size="sm"
                      icon="delete"
                      [title]="'projects.udalit_iz_proekta' | t"
                      [loading]="isRemovingMember && memberToRemove?.userId === m.userId"
                      (onClick)="requestRemove(m)"
                    >
                      {{ 'common.delete' | t }}
                    </ui-button>
                  </td>
                </tr>
                <tr *ngIf="members.length === 0">
                  <td [attr.colspan]="canUpdateProject ? 4 : 3" class="empty-cell">
                    {{ 'projects.net_uchastnikov_proekta' | t }}
                  </td>
                </tr>
              </ng-container>
            </tbody>
          </table>
        </div>
      </div>

      <div footer class="modal-footer-actions">
        <ui-button variant="secondary" size="md" (onClick)="close.emit()">
          {{ 'common.close' | t }}
        </ui-button>
      </div>
    </ui-modal>

    <!-- Remove Member Confirmation Modal -->
    <ui-modal
      [isOpen]="memberToRemove !== null"
      [title]="'projects.udalit_iz_proekta' | t"
      size="sm"
      (close)="memberToRemove = null"
    >
      <div body *ngIf="memberToRemove" class="remove-prompt-body">
        <p class="remove-prompt-text">
          {{ 'projects.vy_uvereny_chto_hotite_udalit_uchastnika' | t:{name: memberToRemove.userName} }}
        </p>
      </div>
      <div footer class="modal-footer-actions">
        <ui-button variant="secondary" size="md" (onClick)="memberToRemove = null">
          {{ 'common.cancel' | t }}
        </ui-button>
        <ui-button
          variant="danger"
          size="md"
          icon="delete"
          [loading]="isRemovingMember"
          (onClick)="confirmRemove()"
        >
          {{ 'projects.udalit_iz_proekta' | t }}
        </ui-button>
      </div>
    </ui-modal>
  `,
  styles: [`
    .members-modal-body {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .add-member-panel {
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .panel-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 14px;
      color: var(--text-main);
    }

    .panel-icon {
      font-size: 18px;
      color: var(--primary);
    }

    .add-member-controls {
      display: flex;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
    }

    .user-search-wrapper {
      position: relative;
      flex: 1;
      min-width: 220px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .access-kind-wrapper {
      min-width: 160px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .add-btn-wrapper {
      padding-bottom: 1px;
    }

    .form-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-main);
    }

    .req {
      color: var(--danger);
    }

    .search-input-box {
      position: relative;
      display: flex;
      align-items: center;
    }

    .search-icon {
      position: absolute;
      left: 10px;
      font-size: 18px;
      color: var(--text-muted);
      pointer-events: none;
    }

    .form-input {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 12px 8px 34px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s;
    }

    .form-select {
      padding-left: 10px;
      cursor: pointer;
    }

    .form-input:focus {
      border-color: var(--primary);
    }

    .clear-user-btn {
      position: absolute;
      right: 8px;
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      padding: 2px;
    }

    .clear-user-btn:hover {
      color: var(--text-main);
    }

    .clear-user-btn span {
      font-size: 16px;
    }

    /* Dropdown popup */
    .user-dropdown-list {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      z-index: 20;
      margin-top: 4px;
      max-height: 200px;
      overflow-y: auto;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-md);
      display: flex;
      flex-direction: column;
    }

    .user-dropdown-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border: none;
      background: none;
      text-align: left;
      cursor: pointer;
      transition: background-color 0.1s;
      width: 100%;
    }

    .user-dropdown-item:hover:not(:disabled) {
      background-color: var(--bg-hover);
    }

    .user-dropdown-item:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .user-item-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
    }

    .user-item-name {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-main);
    }

    .user-item-email {
      font-size: 11px;
    }

    .already-member-tag {
      font-size: 10px;
      color: var(--text-muted);
      font-style: italic;
    }

    .user-avatar-mini {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background-color: var(--primary);
      color: #ffffff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
      flex-shrink: 0;
    }

    /* Table styles */
    .table-wrapper {
      overflow-x: auto;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      background-color: var(--bg-surface);
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }

    .data-table th {
      background-color: var(--bg-hover);
      color: var(--text-muted);
      font-weight: 600;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
    }

    .data-table td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-main);
      vertical-align: middle;
    }

    .data-table tr:last-child td {
      border-bottom: none;
    }

    .member-user-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .font-medium {
      font-weight: 500;
    }

    .text-muted {
      color: var(--text-muted);
    }

    .tabular-nums {
      font-variant-numeric: tabular-nums;
    }

    .text-right {
      text-align: right;
    }

    .empty-cell {
      text-align: center;
      color: var(--text-muted);
      padding: 24px 14px;
      font-style: italic;
    }

    /* Skeleton Loading */
    .skeleton-row td {
      padding: 12px 14px;
    }

    .skeleton-pill {
      height: 14px;
      background: linear-gradient(90deg, var(--bg-hover) 25%, var(--border-color) 50%, var(--bg-hover) 75%);
      background-size: 200% 100%;
      animation: skeleton-shimmer 1.5s infinite;
      border-radius: 4px;
    }

    .w-20 { width: 80px; }
    .w-28 { width: 112px; }
    .w-36 { width: 144px; }
    .w-48 { width: 192px; }
    .ml-auto { margin-left: auto; }

    @keyframes skeleton-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .modal-footer-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      width: 100%;
    }

    .remove-prompt-body {
      padding: 8px 0;
    }

    .remove-prompt-text {
      font-size: 14px;
      color: var(--text-main);
      margin: 0;
    }
  `]
})
export class ProjectMembersModalComponent {
  private readonly api = inject(ApiService);

  @Input() isOpen = false;
  @Input() project: Project | null = null;
  @Input() members: ProjectMember[] = [];
  @Input() isLoadingMembers = false;
  @Input() isAddingMember = false;
  @Input() isRemovingMember = false;
  @Input() canUpdateProject = false;

  @Output() close = new EventEmitter<void>();
  @Output() addMember = new EventEmitter<{ projectId: number; userId: number; accessKind: string }>();
  @Output() removeMember = new EventEmitter<{ projectId: number; userId: number }>();

  userSearchQuery = '';
  foundUsers: User[] = [];
  selectedUser: User | null = null;
  selectedAccessKind = 'MEMBER';
  isUserDropdownOpen = false;
  memberToRemove: ProjectMember | null = null;

  private searchSubject = new Subject<string>();

  constructor() {
    this.searchSubject.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      switchMap(query => {
        const trimmed = query.trim();
        if (!trimmed) {
          return of({ items: [] });
        }
        return this.api.get<{ items: User[] }>('/iam/users', {
          state: 'A',
          search: trimmed,
          limit: 15
        });
      })
    ).subscribe({
      next: res => {
        this.foundUsers = res.items || [];
        this.isUserDropdownOpen = true;
      },
      error: () => {
        this.foundUsers = [];
      }
    });
  }

  onSearchInput(query: string): void {
    if (this.selectedUser && query !== this.selectedUser.name) {
      this.selectedUser = null;
    }
    this.searchSubject.next(query);
  }

  selectUser(user: User): void {
    this.selectedUser = user;
    this.userSearchQuery = user.name;
    this.isUserDropdownOpen = false;
  }

  clearSelectedUser(): void {
    this.selectedUser = null;
    this.userSearchQuery = '';
    this.foundUsers = [];
    this.isUserDropdownOpen = false;
  }

  isUserAlreadyMember(userId: number): boolean {
    return this.members.some(m => m.userId === userId);
  }

  getInitials(name: string | undefined): string {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  submitAddMember(): void {
    if (!this.project || !this.selectedUser) return;
    this.addMember.emit({
      projectId: this.project.id,
      userId: this.selectedUser.id,
      accessKind: this.selectedAccessKind
    });
    this.clearSelectedUser();
  }

  requestRemove(member: ProjectMember): void {
    this.memberToRemove = member;
  }

  confirmRemove(): void {
    if (!this.memberToRemove) return;
    const target = this.memberToRemove;
    this.memberToRemove = null;
    this.removeMember.emit({
      projectId: target.projectId,
      userId: target.userId
    });
  }
}
