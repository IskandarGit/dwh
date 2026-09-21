import { FormTreeItem, Role } from '../../../core/models/rbac.models';

export interface FormActionItem {
  action: string;
  actionName: string;
}

export interface GroupedForm {
  module: string;
  formCode: string;
  formName: string;
  actions: FormActionItem[];
}

export interface ModuleGroup {
  moduleCode: string;
  moduleName: string;
  forms: GroupedForm[];
  isExpanded: boolean;
}

export const MODULE_ICON_MAP: Record<string, string> = {
  'md': 'admin_panel_settings',
  'iam': 'security',
  'ms.task': 'task_alt',
  'ms.notify': 'notifications',
  'platform': 'hub',
  'audit': 'history',
  'mf': 'folder_open',
  'kwh': 'database'
};

export const MODULE_NAME_KEY_MAP: Record<string, string> = {
  'md': 'iam.polzovateli_i_bezopasnost_iam',
  'iam': 'iam.uchetnye_zapisi_i_profil_iam',
  'ms.task': 'iam.upravlenie_zadachami_task',
  'ms.notify': 'iam.opovescheniya_i_sobytiya_notif',
  'platform': 'iam.sistemnaya_platforma_platform',
  'audit': 'iam.zhurnal_audita_audit',
  'mf': 'iam.faylovoe_hranilische_file',
  'kwh': 'iam.hranilische_dannyh_dwh'
};

export function buildModuleGroups(
  items: FormTreeItem[],
  getModuleName: (modCode: string) => string
): ModuleGroup[] {
  const groupedMap = new Map<string, Map<string, GroupedForm>>();

  for (const item of items) {
    if (!groupedMap.has(item.module)) {
      groupedMap.set(item.module, new Map());
    }
    const moduleMap = groupedMap.get(item.module)!;

    if (!moduleMap.has(item.formCode)) {
      moduleMap.set(item.formCode, {
        module: item.module,
        formCode: item.formCode,
        formName: item.formName,
        actions: []
      });
    }

    moduleMap.get(item.formCode)!.actions.push({
      action: item.action,
      actionName: item.actionName
    });
  }

  const groups: ModuleGroup[] = [];
  groupedMap.forEach((formMap, modCode) => {
    groups.push({
      moduleCode: modCode,
      moduleName: getModuleName(modCode),
      forms: Array.from(formMap.values()),
      isExpanded: true
    });
  });

  return groups;
}

export function arePermissionsDirty(orig: Set<string>, curr: Set<string>): boolean {
  if (orig.size !== curr.size) return true;
  for (const p of curr) {
    if (!orig.has(p)) return true;
  }
  return false;
}

export function countDirtyPermissions(orig: Set<string>, curr: Set<string>): number {
  let diff = 0;
  for (const p of curr) {
    if (!orig.has(p)) diff++;
  }
  for (const p of orig) {
    if (!curr.has(p)) diff++;
  }
  return diff;
}

export function toggleFormPermissionSet(
  current: Set<string>,
  form: GroupedForm,
  grant: boolean
): Set<string> {
  const next = new Set(current);
  for (const act of form.actions) {
    const key = `${form.formCode}.${act.action}`;
    if (grant) next.add(key); else next.delete(key);
  }
  return next;
}

export function toggleModulePermissionSet(
  current: Set<string>,
  moduleGroup: ModuleGroup,
  grant: boolean
): Set<string> {
  const next = new Set(current);
  for (const f of moduleGroup.forms) {
    for (const act of f.actions) {
      const key = `${f.formCode}.${act.action}`;
      if (grant) next.add(key); else next.delete(key);
    }
  }
  return next;
}

export function toggleReadOnlyModulePermissionSet(
  current: Set<string>,
  moduleGroup: ModuleGroup
): Set<string> {
  const next = new Set(current);
  for (const f of moduleGroup.forms) {
    for (const act of f.actions) {
      const key = `${f.formCode}.${act.action}`;
      if (act.action === 'view') next.add(key); else next.delete(key);
    }
  }
  return next;
}

export function toggleAllPermissionsSet(
  current: Set<string>,
  moduleGroups: ModuleGroup[],
  grant: boolean
): Set<string> {
  const next = new Set(current);
  for (const group of moduleGroups) {
    for (const f of group.forms) {
      for (const act of f.actions) {
        const key = `${f.formCode}.${act.action}`;
        if (grant) next.add(key); else next.delete(key);
      }
    }
  }
  return next;
}

export function toggleReadOnlyAllPermissionsSet(
  current: Set<string>,
  moduleGroups: ModuleGroup[]
): Set<string> {
  const next = new Set(current);
  for (const group of moduleGroups) {
    for (const f of group.forms) {
      for (const act of f.actions) {
        const key = `${f.formCode}.${act.action}`;
        if (act.action === 'view') next.add(key); else next.delete(key);
      }
    }
  }
  return next;
}

export function filterRoles(roles: Role[], query: string): Role[] {
  const q = query.trim().toLowerCase();
  if (!q) return roles;
  return roles.filter(r =>
    r.name.toLowerCase().includes(q) || (r.pcode && r.pcode.toLowerCase().includes(q))
  );
}

export function filterModuleGroups(
  moduleGroups: ModuleGroup[],
  query: string,
  activeTab: string
): ModuleGroup[] {
  const q = query.trim().toLowerCase();
  return moduleGroups
    .filter(mod => activeTab === 'all' || mod.moduleCode === activeTab)
    .map(mod => {
      if (!q) return mod;
      const matchingForms = mod.forms.filter(f =>
        f.formName.toLowerCase().includes(q) ||
        f.formCode.toLowerCase().includes(q) ||
        f.actions.some(a => a.actionName.toLowerCase().includes(q) || a.action.toLowerCase().includes(q))
      );
      return {
        ...mod,
        isExpanded: true,
        forms: matchingForms
      };
    })
    .filter(mod => mod.forms.length > 0);
}
