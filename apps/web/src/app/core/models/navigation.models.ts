export type NavigationTargetType = 'INTERNAL_ROUTE' | 'EXTERNAL_LINK' | 'EMBEDDED_IFRAME';

export interface CustomNavigationItem {
  id: number;
  code: string;
  title: string;
  titleKey?: string | null;
  sectionId: string;
  parentId?: number | null;
  icon: string;
  targetType: NavigationTargetType;
  url: string;
  openInIframe: boolean;
  requiredPermission?: string | null;
  sortOrder: number;
  state: 'A' | 'P';
  createdAt?: string;
  modifiedAt?: string;
}

export interface CreateNavigationItemPayload {
  code: string;
  title: string;
  titleKey?: string | null;
  sectionId?: string;
  parentId?: number | null;
  icon?: string;
  targetType?: NavigationTargetType;
  url: string;
  openInIframe?: boolean;
  requiredPermission?: string | null;
  sortOrder?: number;
}

export interface UpdateNavigationItemPayload {
  code?: string;
  title?: string;
  titleKey?: string | null;
  sectionId?: string;
  parentId?: number | null;
  icon?: string;
  targetType?: NavigationTargetType;
  url?: string;
  openInIframe?: boolean;
  requiredPermission?: string | null;
  sortOrder?: number;
  state?: 'A' | 'P';
}
