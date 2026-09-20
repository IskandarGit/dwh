export interface NotificationItem {
  id: number;
  userId: number;
  title: string;
  bodyMarkdown?: string;
  sourceModule?: string;
  entityType?: string;
  entityId?: string;
  targetUrl?: string;
  isRead: boolean;
  createdAt: string;
}

export interface Announcement {
  id: number;
  title: string;
  body: string;
  bannerType: 'INFO' | 'WARNING' | 'CRITICAL';
  publishedAt: string;
}

export interface NotificationPrefItem {
  eventType: string;
  channel: string;
  isEnabled: boolean;
}

