import { Injectable, signal } from '@angular/core';
import { User } from '../../../../core/models/auth.models';
import { Role } from '../../../../core/models/rbac.models';
import { SortColumn, SortDirection } from '../users.models';

@Injectable({
  providedIn: 'root'
})
export class UserFilterService {
  searchQuery = '';
  selectedState = '';
  selectedRoleId: number | null = null;
  selected2fa: boolean | null = null;
  currentPage = 1;
  pageSize = 10;

  sortColumn: SortColumn = 'id';
  sortDirection: SortDirection = 'asc';

  readonly isFilterMenuOpen = signal<boolean>(false);

  hasExtraFilters(): boolean {
    return this.selectedRoleId !== null || this.selected2fa !== null;
  }

  resetExtraFilters(onReload: () => void): void {
    this.selectedRoleId = null;
    this.selected2fa = null;
    onReload();
  }

  clearStateFilter(onReload: () => void): void {
    this.selectedState = '';
    onReload();
  }

  clear2faFilter(onReload: () => void): void {
    this.selected2fa = null;
    onReload();
  }

  hasAnyActiveFilters(): boolean {
    return !!(this.selectedRoleId !== null || this.selected2fa !== null || this.selectedState || this.searchQuery.trim());
  }

  resetAllFilters(onResetNav: () => void, onReload: () => void): void {
    this.selectedRoleId = null;
    this.selected2fa = null;
    this.selectedState = '';
    this.searchQuery = '';
    onResetNav();
    onReload();
  }

  toggleFilterMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.isFilterMenuOpen.update(v => !v);
  }

  setStateFilter(state: string, onReload: () => void): void {
    this.selectedState = state;
    onReload();
  }

  changeSort(col: SortColumn): void {
    if (this.sortColumn === col) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = col;
      this.sortDirection = 'asc';
    }
  }

  sortedUsers(users: User[]): User[] {
    const list = [...users];
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

  paginatedUsers(users: User[]): User[] {
    const list = this.sortedUsers(users);
    const start = (this.currentPage - 1) * this.pageSize;
    return list.slice(start, start + this.pageSize);
  }

  getSelectedRoleName(roles: Role[]): string {
    if (!this.selectedRoleId) return '';
    const role = roles.find(r => r.id === this.selectedRoleId);
    return role ? role.name : String(this.selectedRoleId);
  }

  clearRoleFilter(onResetNav: () => void, onReload: () => void): void {
    this.selectedRoleId = null;
    onResetNav();
    onReload();
  }
}
