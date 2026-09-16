import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class TaskFilterService {
  private readonly authService = inject(AuthService, { optional: true });

  activePreset: 'all' | 'my' | 'executor' | 'observer' | 'reported' | 'overdue' = 'all';
  viewMode: 'table' | 'kanban' = 'table';
  searchQuery = '';
  selectedPriority = '';
  selectedProjectId: number | null = null;
  statusFilterMode: 'active' | 'all' | number = 'active';
  currentPage = 1;
  readonly pageSize = 50;
  showExportMenu = false;

  taskPageCursors: Array<string | null> = [null];
  taskSearchTimer?: ReturnType<typeof setTimeout>;
  lastListAttempt: { page: number; cursor: string | null; reset: boolean } | null = null;

  hasActiveFilters(): boolean {
    return !!this.searchQuery || !!this.selectedPriority || this.selectedProjectId !== null || this.statusFilterMode !== 'active' || this.activePreset !== 'all';
  }

  clearSearch(onReload: () => void): void {
    clearTimeout(this.taskSearchTimer);
    this.searchQuery = '';
    onReload();
  }

  setPreset(preset: 'all' | 'my' | 'executor' | 'observer' | 'reported' | 'overdue', onReload: () => void): void {
    if (this.activePreset === preset) return;
    this.activePreset = preset;
    onReload();
  }

  setStatusFilterMode(mode: 'active' | 'all' | number, onReload: () => void): void {
    this.statusFilterMode = mode;
    onReload();
  }

  onProjectFilterChange(projectId: number | null, onReload: () => void): void {
    this.selectedProjectId = projectId;
    onReload();
  }

  onPriorityFilterChange(priority: string, onReload: () => void): void {
    this.selectedPriority = priority;
    onReload();
  }

  resetFilters(onReload: () => void): void {
    clearTimeout(this.taskSearchTimer);
    this.searchQuery = '';
    this.selectedPriority = '';
    this.selectedProjectId = null;
    this.statusFilterMode = 'active';
    this.activePreset = 'all';
    onReload();
  }

  buildListParams(cursor: string | null): Record<string, unknown> {
    let statusIdParam: number | undefined = undefined;
    let hideTerminalParam: boolean | undefined = undefined;

    if (this.statusFilterMode === 'active') {
      hideTerminalParam = true;
    } else if (this.statusFilterMode === 'all') {
      hideTerminalParam = false;
    } else if (typeof this.statusFilterMode === 'number') {
      statusIdParam = this.statusFilterMode;
    }

    let assignedUserIdParam: number | undefined = undefined;
    let memberRoleParam: string | undefined = undefined;
    let reporterIdParam: number | undefined = undefined;
    let overdueParam: boolean | undefined = undefined;

    const currentUserId = this.authService?.currentUser()?.id;
    if (this.activePreset === 'my') {
      assignedUserIdParam = currentUserId;
      memberRoleParam = 'R';
    } else if (this.activePreset === 'executor') {
      assignedUserIdParam = currentUserId;
      memberRoleParam = 'E';
    } else if (this.activePreset === 'observer') {
      assignedUserIdParam = currentUserId;
      memberRoleParam = 'O';
    } else if (this.activePreset === 'reported') {
      reporterIdParam = currentUserId;
    } else if (this.activePreset === 'overdue') {
      overdueParam = true;
    }

    return {
      limit: 50,
      cursor: cursor || undefined,
      search: this.searchQuery || undefined,
      priority: this.selectedPriority || undefined,
      project_id: this.selectedProjectId || undefined,
      status_id: statusIdParam,
      hide_terminal: hideTerminalParam,
      assigned_user_id: assignedUserIdParam,
      member_role: memberRoleParam,
      reporter_id: reporterIdParam,
      overdue: overdueParam
    };
  }

  cleanup(): void {
    clearTimeout(this.taskSearchTimer);
  }
}
