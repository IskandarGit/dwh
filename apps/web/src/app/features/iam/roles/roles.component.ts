import { Component, DestroyRef, OnInit, ViewChild, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, Subscription } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { Role, FormTreeItem, PermissionPair } from '../../../core/models/rbac.models';
import { TranslatePipe, I18nService } from '../../../core/services/i18n.service';
import { safeNumericRecordId } from '../../../core/services/search-target';
import { RoleScopePanelComponent } from '../org-units/public-api';
import { RoleModalsComponent } from './components/role-modals.component';
import { RoleCardsBarComponent } from './components/role-cards-bar.component';
import { RolePermissionsMatrixComponent } from './components/role-permissions-matrix.component';
import {
  GroupedForm,
  ModuleGroup,
  MODULE_ICON_MAP,
  MODULE_NAME_KEY_MAP,
  buildModuleGroups,
  arePermissionsDirty,
  countDirtyPermissions,
  toggleFormPermissionSet,
  toggleModulePermissionSet,
  toggleReadOnlyModulePermissionSet,
  toggleAllPermissionsSet,
  toggleReadOnlyAllPermissionsSet,
  filterRoles,
  filterModuleGroups
} from './roles.models';
import { RoleFormsService } from './services/role-forms.service';


@Component({
  selector: 'app-roles',
  standalone: true,
  imports: [
    TranslatePipe, CommonModule, FormsModule, UiButtonComponent, RoleScopePanelComponent, RoleModalsComponent, RoleCardsBarComponent, RolePermissionsMatrixComponent],
  templateUrl: './roles.component.html',
  styleUrl: './roles.component.css'
})
export class RolesComponent implements OnInit {
  readonly hasPermissionFn = (formCode: string, action: string) => this.hasPermission(formCode, action);
  readonly isPermissionDirtyFn = (formCode: string, action: string) => this.isPermissionDirty(formCode, action);
  readonly getModuleIconFn = (moduleCode: string) => this.getModuleIcon(moduleCode);
  readonly getModuleActionsCountFn = (mod: ModuleGroup) => this.getModuleActionsCount(mod);

  private readonly router = inject(Router, { optional: true });
  private readonly uiI18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private permissionsRequest?: Subscription;
  private panelLeaveSubscription?: Subscription;
  private roleScopePanel?: RoleScopePanelComponent;
  private readonly loadedPermissionsRoleId = signal<number | null>(null);
  readonly safeRoleId = safeNumericRecordId;
  readonly roles = signal<Role[]>([]);
  readonly forms = signal<FormTreeItem[]>([]);
  readonly selectedRole = signal<Role | null>(null);
  readonly rolePermissions = signal<Set<string>>(new Set());
  readonly originalRolePermissions = signal<Set<string>>(new Set());

  readonly isPermissionsDirty = computed<boolean>(() =>
    arePermissionsDirty(this.originalRolePermissions(), this.rolePermissions())
  );

  readonly dirtyPermissionsCount = computed<number>(() =>
    countDirtyPermissions(this.originalRolePermissions(), this.rolePermissions())
  );

  private readonly roleForms = inject(RoleFormsService);

  readonly isLoading = signal<boolean>(false);
  readonly permissionsError = signal('');
  readonly isSaving = signal<boolean>(false);
  readonly isSubmittingRole = this.roleForms.isSubmittingRole;
  readonly scopePanelBusy = signal(false);
  readonly roleUserCounts = signal<Record<number, number>>({});

  roleSearchQuery = '';
  matrixSearchQuery = '';
  selectedModuleTab = 'all';

  moduleGroups: ModuleGroup[] = [];

  // Modals & Form State
  readonly isCreateModalOpen = this.roleForms.isCreateModalOpen;
  readonly isEditModalOpen = this.roleForms.isEditModalOpen;
  readonly isDeleteModalOpen = this.roleForms.isDeleteModalOpen;
  readonly isDiscardPermissionsModalOpen = signal<boolean>(false);
  pendingRoleToSelect: Role | null = null;

  get isCreateSubmitted() { return this.roleForms.isCreateSubmitted; }
  set isCreateSubmitted(v: boolean) { this.roleForms.isCreateSubmitted = v; }

  get isEditSubmitted() { return this.roleForms.isEditSubmitted; }
  set isEditSubmitted(v: boolean) { this.roleForms.isEditSubmitted = v; }

  get newRoleForm() { return this.roleForms.newRoleForm; }
  set newRoleForm(v: any) { this.roleForms.newRoleForm = v; }

  get editRoleForm() { return this.roleForms.editRoleForm; }
  set editRoleForm(v: any) { this.roleForms.editRoleForm = v; }

  get editingRole() { return this.roleForms.editingRole; }
  set editingRole(v: Role | null) { this.roleForms.editingRole = v; }

  get deletingRole() { return this.roleForms.deletingRole; }
  set deletingRole(v: Role | null) { this.roleForms.deletingRole = v; }

  constructor(
    public permService: PermissionService,
    private api: ApiService,
    private toast: ToastService
  ) {
    this.destroyRef.onDestroy(() => this.panelLeaveSubscription?.unsubscribe());
  }

  @ViewChild(RoleScopePanelComponent)
  set scopePanel(panel: RoleScopePanelComponent | undefined) {
    this.roleScopePanel = panel;
    if (!panel) this.scopePanelBusy.set(false);
  }

  ngOnInit() {
    this.loadForms();
    this.loadRoles();
  }

  canCreateRole(): boolean {
    return this.permService.canCreate('rbac.roles') || this.permService.canCreate('iam.roles') || this.permService.canCreate('md_roles');
  }

  canUpdateRole(): boolean {
    return this.permService.canUpdate('rbac.roles') || this.permService.canUpdate('iam.roles') || this.permService.canUpdate('md_roles');
  }

  canDeleteRole(): boolean {
    return this.permService.canDelete('rbac.roles') || this.permService.canDelete('iam.roles') || this.permService.canDelete('md_roles');
  }

  canGrant(): boolean {
    return this.permService.hasPermission('rbac.roles', 'grant') ||
           this.permService.hasPermission('iam.roles', 'grant');
  }

  canViewOrgUnits(): boolean {
    return this.permService.hasPermission('iam.org_units', 'view') ||
           this.permService.hasPermission('iam.org_units', 'assign') ||
           this.scopePanelBusy();
  }

  canLeaveRecordPage(): boolean | Observable<boolean> {
    if (this.isSaving() || this.isPermissionsDirty()) return false;
    return this.roleScopePanel?.canLeave() ?? true;
  }

  canEditPermissions(): boolean {
    const role = this.selectedRole();
    return !!role && role.pcode !== 'admin' && this.canGrant() &&
      this.loadedPermissionsRoleId() === role.id && !this.isLoading() && !this.isSaving();
  }

  loadRoles() {
    this.loadRoleUserCounts();
    this.api.get<Role[]>('/rbac/roles').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        const list = res || [];
        this.roles.set(list);
        if (!this.selectedRole() && list.length > 0) {
          this.selectRole(list[0]);
        }
      },
      error: () => {
        this.api.get<Role[]>('/iam/roles').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: res => {
            const list = res || [];
            this.roles.set(list);
            if (!this.selectedRole() && list.length > 0) {
              this.selectRole(list[0]);
            }
          }
        });
      }
    });
  }

  loadRoleUserCounts() {
    this.api.get<Record<number, number>>('/iam/roles/user-counts').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: counts => this.roleUserCounts.set(counts || {}),
      error: () => {}
    });
  }

  loadForms() {
    this.api.get<FormTreeItem[]>('/rbac/forms').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(res => {
      const items = res || [];
      this.forms.set(items);
      this.buildModuleGroups(items);
    });
  }

  buildModuleGroups(items: FormTreeItem[]) {
    this.moduleGroups = buildModuleGroups(items, mod => this.getModuleDisplayName(mod));
  }

  selectRole(role: Role) {
    if (this.isSaving() || this.isSubmittingRole() || this.destroyRef.destroyed) return;
    const selected = this.selectedRole();
    if (this.scopePanelBusy() && selected?.id !== role.id) return;
    if (!selected || selected.id === role.id) {
      this.activateRole(role);
      return;
    }
    if (this.isPermissionsDirty()) {
      this.pendingRoleToSelect = role;
      this.isDiscardPermissionsModalOpen.set(true);
      return;
    }
    this.afterRoleScopeLeave(() => this.activateRole(role));
  }

  closeDiscardModal(): void {
    if (this.isSaving()) return;
    this.pendingRoleToSelect = null;
    this.isDiscardPermissionsModalOpen.set(false);
  }

  confirmDiscardAndSwitch(): void {
    if (this.isSaving()) return;
    const nextRole = this.pendingRoleToSelect;
    this.isDiscardPermissionsModalOpen.set(false);
    this.pendingRoleToSelect = null;
    if (nextRole) {
      this.rolePermissions.set(new Set(this.originalRolePermissions()));
      this.afterRoleScopeLeave(() => this.activateRole(nextRole));
    }
  }

  saveAndSwitch(): void {
    const nextRole = this.pendingRoleToSelect;
    const currentRole = this.selectedRole();
    if (!currentRole || !this.canEditPermissions()) return;

    this.isSaving.set(true);
    const pairs: PermissionPair[] = Array.from(this.rolePermissions()).map(p => {
      const parts = p.split('.');
      const action = parts.pop() || '';
      const formCode = parts.join('.');
      return { formCode, action };
    });

    this.api.put(`/rbac/roles/${currentRole.id}/permissions`, pairs).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.originalRolePermissions.set(new Set(this.rolePermissions()));
        this.toast.success(this.uiI18n.translate('iam.matrica_prav_uspeshno_sohranena'));
        this.isDiscardPermissionsModalOpen.set(false);
        this.pendingRoleToSelect = null;
        if (nextRole) {
          this.afterRoleScopeLeave(() => this.activateRole(nextRole));
        }
      },
      error: () => {
        this.isSaving.set(false);
      }
    });
  }

  private activateRole(role: Role): void {
    if (this.destroyRef.destroyed) return;
    this.permissionsRequest?.unsubscribe();
    this.selectedRole.set(role);
    this.rolePermissions.set(new Set());
    this.originalRolePermissions.set(new Set());
    this.loadedPermissionsRoleId.set(null);
    this.permissionsError.set('');
    this.isLoading.set(true);
    this.permissionsRequest = this.api.get<string[]>(`/rbac/roles/${role.id}/permissions`, undefined, { notifyError: false })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        if (this.selectedRole()?.id !== role.id) return;
        const perms = new Set(res || []);
        this.rolePermissions.set(new Set(perms));
        this.originalRolePermissions.set(new Set(perms));
        this.loadedPermissionsRoleId.set(role.id);
        this.isLoading.set(false);
      },
      error: error => {
        if (this.selectedRole()?.id !== role.id) return;
        this.permissionsError.set(error.detail || error.title);
        this.isLoading.set(false);
      }
    });
  }

  private afterRoleScopeLeave(action: () => void): void {
    if (this.destroyRef.destroyed) return;
    this.panelLeaveSubscription?.unsubscribe();
    this.panelLeaveSubscription = undefined;
    const decision = this.roleScopePanel?.canLeave() ?? true;
    if (typeof decision === 'boolean') {
      if (decision) action();
      return;
    }
    this.panelLeaveSubscription = decision.subscribe(allow => {
      if (allow && !this.destroyRef.destroyed) action();
    });
  }

  filteredRoles(): Role[] {
    return filterRoles(this.roles(), this.roleSearchQuery);
  }

  visibleModuleGroups(): ModuleGroup[] {
    return filterModuleGroups(this.moduleGroups, this.matrixSearchQuery, this.selectedModuleTab);
  }

  matchingFormsCount(): number {
    return this.visibleModuleGroups().reduce((acc, mod) => acc + mod.forms.length, 0);
  }

  getModuleActionsCount(mod: ModuleGroup): number {
    return mod.forms.reduce((sum, f) => sum + f.actions.length, 0);
  }

  setAllModulesExpanded(expanded: boolean) {
    this.moduleGroups.forEach(mod => mod.isExpanded = expanded);
  }

  toggleModuleExpand(mod: ModuleGroup) {
    mod.isExpanded = !mod.isExpanded;
  }

  getModuleDisplayName(mod: string): string {
    const key = MODULE_NAME_KEY_MAP[mod];
    return key ? this.uiI18n.translate(key) : this.uiI18n.translate('iam.module_named', { name: mod.toUpperCase() });
  }

  getModuleIcon(mod: string): string {
    return MODULE_ICON_MAP[mod] || 'folder';
  }

  totalActionsCount(): number {
    return this.forms().length;
  }

  activePermissionsCount(): number {
    return this.selectedRole()?.pcode === 'admin' ? this.totalActionsCount() : this.rolePermissions().size;
  }

  permissionPercentage(): number {
    const total = this.totalActionsCount();
    return total === 0 ? 0 : Math.round((this.activePermissionsCount() / total) * 100);
  }

  hasPermission(formCode: string, action: string): boolean {
    return this.selectedRole()?.pcode === 'admin' || this.rolePermissions().has(`${formCode}.${action}`);
  }

  togglePermission(formCode: string, action: string, event: Event) {
    if (!this.canEditPermissions()) return;

    const checked = (event.target as HTMLInputElement).checked;
    const current = new Set(this.rolePermissions());
    const key = `${formCode}.${action}`;

    if (checked) {
      current.add(key);
    } else {
      current.delete(key);
    }
    this.rolePermissions.set(current);
  }

  toggleAllForm(form: GroupedForm, grant: boolean) {
    if (!this.canEditPermissions()) return;
    this.rolePermissions.set(toggleFormPermissionSet(this.rolePermissions(), form, grant));
  }

  toggleAllModule(moduleGroup: ModuleGroup, grant: boolean) {
    if (!this.canEditPermissions()) return;
    this.rolePermissions.set(toggleModulePermissionSet(this.rolePermissions(), moduleGroup, grant));
  }

  toggleReadOnlyModule(moduleGroup: ModuleGroup) {
    if (!this.canEditPermissions()) return;
    this.rolePermissions.set(toggleReadOnlyModulePermissionSet(this.rolePermissions(), moduleGroup));
  }

  isPermissionDirty(formCode: string, action: string): boolean {
    if (this.selectedRole()?.pcode === 'admin') return false;
    const key = `${formCode}.${action}`;
    return this.originalRolePermissions().has(key) !== this.rolePermissions().has(key);
  }

  resetMatrixChanges(): void {
    if (!this.canEditPermissions()) return;
    this.rolePermissions.set(new Set(this.originalRolePermissions()));
  }

  toggleAllPermissions(grant: boolean): void {
    if (!this.canEditPermissions()) return;
    this.rolePermissions.set(toggleAllPermissionsSet(this.rolePermissions(), this.moduleGroups, grant));
  }

  toggleReadOnlyAllPermissions(): void {
    if (!this.canEditPermissions()) return;
    this.rolePermissions.set(toggleReadOnlyAllPermissionsSet(this.rolePermissions(), this.moduleGroups));
  }

  navigateToUsersWithRole(role: Role, event: Event): void {
    event.stopPropagation();
    this.router?.navigate(['/iam/users'], { queryParams: { roleId: role.id } });
  }

  savePermissions() {
    const role = this.selectedRole();
    if (!role || !this.canEditPermissions()) return;

    this.isSaving.set(true);
    const pairs: PermissionPair[] = Array.from(this.rolePermissions()).map(p => {
      const parts = p.split('.');
      const action = parts.pop() || '';
      const formCode = parts.join('.');
      return { formCode, action };
    });

    this.api.put(`/rbac/roles/${role.id}/permissions`, pairs).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.originalRolePermissions.set(new Set(this.rolePermissions()));
        this.toast.success(this.uiI18n.translate('iam.matrica_prav_uspeshno_sohranena'));
      },
      error: () => {
        this.isSaving.set(false);
      }
    });
  }

  openCreateModal() {
    this.roleForms.openCreateModal();
  }

  submitCreateRole() {
    this.roleForms.submitCreateRole(newRole => {
      this.loadRoles();
      this.selectRole(newRole);
    });
  }

  openEditRoleModal(role: Role) {
    this.roleForms.openEditRoleModal(role);
  }

  submitEditRole() {
    this.roleForms.submitEditRole(() => {
      this.loadRoles();
    });
  }

  openDeleteRoleModal(role: Role) {
    this.roleForms.openDeleteRoleModal(role, this.isSaving(), this.scopePanelBusy());
  }

  closeDeleteRoleModal(): void {
    this.roleForms.closeDeleteRoleModal();
  }

  confirmDeleteRole() {
    const target = this.deletingRole;
    if (!target || this.isSaving() || this.scopePanelBusy() || this.isSubmittingRole() || !safeNumericRecordId(target.id)) return;
    if (this.selectedRole()?.id === target.id) {
      this.afterRoleScopeLeave(() => this.deleteRole(target));
      return;
    }
    this.deleteRole(target);
  }

  private deleteRole(target: Role): void {
    if (this.destroyRef.destroyed || this.isSubmittingRole() || !this.isDeleteModalOpen()) return;
    this.roleForms.deleteRole(target, () => {
      if (this.selectedRole()?.id === target.id) {
        this.permissionsRequest?.unsubscribe();
        this.selectedRole.set(null);
        this.rolePermissions.set(new Set());
        this.loadedPermissionsRoleId.set(null);
        this.permissionsError.set('');
        this.isLoading.set(false);
      }
      this.loadRoles();
    });
  }
}
