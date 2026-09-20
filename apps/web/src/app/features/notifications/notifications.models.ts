import { NotificationItem } from '../../core/models/notification.models';

export type NotificationFilterTab = 'all' | 'unread';

export function resolveNotificationIcon(item: NotificationItem): string {
  const src = (item.sourceModule || item.entityType || '').toLowerCase();
  if (src.includes('task')) return 'task_alt';
  if (src.includes('comment')) return 'chat_bubble';
  if (src.includes('system') || src.includes('instance')) return 'dns';
  if (src.includes('security') || src.includes('auth') || src.includes('iam')) return 'shield';
  if (src.includes('report') || src.includes('analytics')) return 'analytics';
  if (src.includes('file')) return 'folder_open';
  if (src.includes('note')) return 'sticky_note_2';
  return item.isRead ? 'drafts' : 'mark_email_unread';
}
