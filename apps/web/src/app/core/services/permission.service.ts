import { inject, Injectable, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class PermissionService {
  readonly permissions = signal<Set<string>>(new Set());
  readonly permissionVersion = signal<number>(1);

  private readonly formAliases: Record<string, string[]> = {
    'md_users': ['iam.users', 'md_users'],
    'iam.users': ['iam.users', 'md_users'],
    'md_roles': ['rbac.roles', 'iam.roles', 'md_roles', 'md.roles'],
    'iam.roles': ['rbac.roles', 'iam.roles', 'md_roles', 'md.roles'],
    'rbac.roles': ['rbac.roles', 'iam.roles', 'md_roles', 'md.roles'],
    'md.roles': ['rbac.roles', 'iam.roles', 'md_roles', 'md.roles'],
    'rbac.assignments': ['rbac.assignments', 'iam.assignments'],
    'md.custom_fields': ['md.custom_fields', 'system.custom_fields', 'md_custom_fields'],
    'system.custom_fields': ['md.custom_fields', 'system.custom_fields', 'md_custom_fields'],
    'md_custom_fields': ['md.custom_fields', 'system.custom_fields', 'md_custom_fields'],
    'iam.profile': ['iam.profile', 'md_profile'],
    'md_profile': ['iam.profile', 'md_profile'],
    'tasks': ['tasks.items', 'tasks'],
    'tasks.items': ['tasks.items', 'tasks'],
    'tasks.projects': ['tasks.projects', 'projects'],
    'projects': ['tasks.projects', 'projects'],
    'audit': ['audit.log', 'audit.logs', 'audit'],
    'audit.log': ['audit.log', 'audit.logs', 'audit'],
    'audit.logs': ['audit.log', 'audit.logs', 'audit'],
    'platform.files': ['platform.files', 'files'],
    'files': ['platform.files', 'files'],
    'platform.settings': ['platform.settings', 'settings'],
    'settings': ['platform.settings', 'settings'],
    'platform.announcements': ['platform.announcements', 'announcements'],
    'announcements': ['platform.announcements', 'announcements'],
    'notify.inbox': ['notify.inbox', 'notifications'],
    'notifications': ['notify.inbox', 'notifications'],
    'platform.webhooks': ['platform.webhooks', 'webhooks'],
    'webhooks': ['platform.webhooks', 'webhooks'],
    'platform.modules': ['platform.modules', 'modules'],
    'modules': ['platform.modules', 'modules'],
    'platform.navigation': ['platform.navigation', 'navigation'],
    'navigation': ['platform.navigation', 'navigation'],
    'notes': ['notes']
  };

  setPermissions(perms: string[], version: number = 1) {
    this.permissions.set(new Set(perms));
    this.permissionVersion.set(version);
  }

  clear() {
    this.permissions.set(new Set());
    this.permissionVersion.set(1);
  }

  hasPermission(form: string, action: string): boolean {
    const perms = this.permissions();
    if (perms.has('*.*')) {
      return true;
    }
    if (perms.has(`${form}.${action}`) || perms.has(`${form}.*`)) {
      return true;
    }
    const aliases = this.formAliases[form] || [form];
    for (const alias of aliases) {
      if (perms.has(`${alias}.${action}`) || perms.has(`${alias}.*`)) {
        return true;
      }
    }
    return false;
  }

  canView(form: string): boolean {
    return this.hasPermission(form, 'view');
  }

  canCreate(form: string): boolean {
    return this.hasPermission(form, 'create');
  }

  canUpdate(form: string): boolean {
    return this.hasPermission(form, 'update');
  }

  canDelete(form: string): boolean {
    return this.hasPermission(form, 'delete');
  }

  canManage(form: string): boolean {
    return this.hasPermission(form, 'manage');
  }
}

export function permissionGuard(form: string, action: string = 'view'): CanActivateFn {
  return () => {
    const permissions = inject(PermissionService);
    const router = inject(Router);
    return permissions.hasPermission(form, action)
      ? true
      : router.createUrlTree(['/settings']);
  };
}
