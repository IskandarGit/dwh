import { InstalledModule } from '../../core/services/module.service';
import { CustomNavigationItem } from '../../core/models/navigation.models';

export interface NavItem {
  id: string;
  route?: string;
  labelKey?: string;
  label?: string;
  titleKey?: string;
  icon: string;
  permission: () => boolean;
  exact?: boolean;
  badge?: () => number;
  children?: NavItem[];
  external?: boolean;
  targetUrl?: string;
  openInIframe?: boolean;
}

export interface NavSection {
  id: string;
  titleKey: string;
  items: NavItem[];
}

export interface BuildNavSectionsOptions {
  activeCustomModules: InstalledModule[];
  customNavItems: CustomNavigationItem[];
  isNotesActive: boolean;
  canViewTasks: () => boolean;
  canViewProjects: () => boolean;
  canViewNotes: () => boolean;
  canViewFiles: () => boolean;
  canViewAnalytics: () => boolean;
  canViewNotifications: () => boolean;
  canViewUsers: () => boolean;
  canViewRoles: () => boolean;
  canViewOrgUnits: () => boolean;
  canViewCustomFields: () => boolean;
  canViewAnnouncements: () => boolean;
  canViewModules: () => boolean;
  canViewNavigationSettings: () => boolean;
  canViewAudit: () => boolean;
  canViewSystem: () => boolean;
  canViewSettings: () => boolean;
  unreadCount: () => number;
}

export function buildNavSections(options: BuildNavSectionsOptions): NavSection[] {
  const customItems: NavItem[] = options.activeCustomModules.map(mod => ({
    id: `module-${mod.code}`,
    route: mod.route!,
    label: mod.name,
    icon: mod.icon || 'extension',
    permission: () => true
  }));

  const workspaceItems: NavItem[] = [
    { id: 'tasks', route: '/tasks', labelKey: 'nav.tasks', icon: 'task_alt', permission: options.canViewTasks, exact: true },
    { id: 'projects', route: '/tasks/projects', labelKey: 'nav.projects', icon: 'folder', permission: options.canViewProjects }
  ];

  if (options.isNotesActive) {
    workspaceItems.push({
      id: 'notes',
      route: '/notes',
      labelKey: 'nav.notes',
      icon: 'description',
      permission: options.canViewNotes
    });
  }

  workspaceItems.push(
    { id: 'files', route: '/files', labelKey: 'layout.app_shell.fayly', titleKey: 'files.faylovoe_hranilische', icon: 'folder_open', permission: options.canViewFiles },
    { id: 'analytics', route: '/analytics', labelKey: 'layout.app_shell.analitika', titleKey: 'analytics.analitika_i_dashbordy', icon: 'insights', permission: options.canViewAnalytics },
    { id: 'notifications', route: '/notifications', labelKey: 'nav.notifications', icon: 'notifications', permission: options.canViewNotifications, badge: options.unreadCount }
  );

  const sections: NavSection[] = [
    {
      id: 'workspace',
      titleKey: 'nav.section.workspace',
      items: workspaceItems
    }
  ];

  if (customItems.length > 0) {
    sections.push({
      id: 'custom-modules',
      titleKey: 'modules.title',
      items: customItems
    });
  }

  sections.push(
    {
      id: 'iam',
      titleKey: 'nav.section.iam',
      items: [
        { id: 'users', route: '/iam/users', labelKey: 'nav.users', icon: 'people', permission: options.canViewUsers },
        { id: 'roles', route: '/iam/roles', labelKey: 'nav.roles', icon: 'security', permission: options.canViewRoles },
        { id: 'org-units', route: '/iam/org-units', labelKey: 'iam.org_units.title', titleKey: 'iam.org_units.title', icon: 'account_tree', permission: options.canViewOrgUnits },
        { id: 'custom-fields', route: '/iam/custom-fields', labelKey: 'nav.custom_fields', icon: 'tune', permission: options.canViewCustomFields }
      ]
    },
    {
      id: 'administration',
      titleKey: 'nav.section.administration',
      items: [
        { id: 'announcements', route: '/announcements', labelKey: 'announcements.obyavleniya', titleKey: 'layout.app_shell.upravlenie_obyavleniyami', icon: 'campaign', permission: options.canViewAnnouncements },
        { id: 'modules', route: '/settings/modules', labelKey: 'nav.modules', icon: 'extension', permission: options.canViewModules },
        { id: 'navigation-settings', route: '/settings/navigation', labelKey: 'nav.navigation_settings', icon: 'menu_open', permission: options.canViewNavigationSettings },
        { id: 'audit', route: '/audit', labelKey: 'nav.audit', titleKey: 'layout.app_shell.audit', icon: 'history', permission: options.canViewAudit },
        { id: 'system', route: '/system', labelKey: 'layout.app_shell.sostoyanie', titleKey: 'system.sostoyanie_sistemy', icon: 'monitor_heart', permission: options.canViewSystem },
        { id: 'settings', route: '/settings', labelKey: 'nav.settings', titleKey: 'layout.app_shell.nastroyki', icon: 'settings', permission: options.canViewSettings }
      ]
    }
  );

  const customNavItems = options.customNavItems;
  if (customNavItems.length > 0) {
    const customReportItems: NavItem[] = [];

    for (const ci of customNavItems) {
      const navItem: NavItem = {
        id: `custom-nav-${ci.code}`,
        route: ci.targetType === 'EMBEDDED_IFRAME' ? `/embed/${ci.code}` : (ci.targetType === 'INTERNAL_ROUTE' ? ci.url : undefined),
        targetUrl: ci.targetType === 'EXTERNAL_LINK' ? ci.url : undefined,
        external: ci.targetType === 'EXTERNAL_LINK',
        openInIframe: ci.targetType === 'EMBEDDED_IFRAME',
        label: ci.title,
        icon: ci.icon || 'analytics',
        permission: () => true
      };

      const targetSection = sections.find(s => s.id === ci.sectionId);
      if (targetSection) {
        targetSection.items.push(navItem);
      } else {
        customReportItems.push(navItem);
      }
    }

    if (customReportItems.length > 0) {
      sections.splice(1, 0, {
        id: 'custom-reports',
        titleKey: 'nav.section.reports_and_services',
        items: customReportItems
      });
    }
  }

  return sections;
}

export const COLLAPSED_STATE_KEY = 'smartup_nav_sidebar_collapsed';
export const COLLAPSED_SECTIONS_KEY = 'smartup_nav_collapsed_sections';

export function loadCollapsedSections(): Set<string> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = localStorage.getItem(COLLAPSED_SECTIONS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return new Set<string>(parsed);
      }
    }
  } catch {}
  return new Set<string>();
}

export function loadCollapsedState(): boolean {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem(COLLAPSED_STATE_KEY) === 'true';
    }
  } catch {}
  return false;
}

export const SECTION_ICON_MAP: Record<string, string> = {
  'workspace': 'space_dashboard',
  'iam': 'manage_accounts',
  'administration': 'tune',
  'custom-modules': 'extension',
  'custom-reports': 'analytics'
};
