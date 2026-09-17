export interface WebhookSubscription {
  id: number;
  name: string;
  targetUrl: string;
  subscribedEvents: string[];
  state: 'A' | 'P';
  createdAt: string;
  createdBy: number;
}

export interface CreatedWebhookSubscription extends WebhookSubscription {
  secretToken: string;
}

export interface CreateWebhookSubscriptionDto {
  name: string;
  targetUrl: string;
  subscribedEvents: string[];
}

export interface UpdateWebhookSubscriptionDto {
  name?: string;
  targetUrl?: string;
  subscribedEvents?: string[];
  state?: 'A' | 'P';
}

export interface WebhookEventOption {
  code: string;
  nameKey: string;
  descKey: string;
}

export const AVAILABLE_WEBHOOK_EVENTS: WebhookEventOption[] = [
  { code: '*', nameKey: 'settings.webhooks.event_all', descKey: 'settings.webhooks.event_all_desc' },
  { code: 'task.created', nameKey: 'settings.webhooks.event_task_created', descKey: 'settings.webhooks.event_task_created_desc' },
  { code: 'task.updated', nameKey: 'settings.webhooks.event_task_updated', descKey: 'settings.webhooks.event_task_updated_desc' },
  { code: 'task.completed', nameKey: 'settings.webhooks.event_task_completed', descKey: 'settings.webhooks.event_task_completed_desc' },
  { code: 'project.created', nameKey: 'settings.webhooks.event_project_created', descKey: 'settings.webhooks.event_project_created_desc' },
  { code: 'project.updated', nameKey: 'settings.webhooks.event_project_updated', descKey: 'settings.webhooks.event_project_updated_desc' },
  { code: 'user.created', nameKey: 'settings.webhooks.event_user_created', descKey: 'settings.webhooks.event_user_created_desc' },
  { code: 'user.blocked', nameKey: 'settings.webhooks.event_user_blocked', descKey: 'settings.webhooks.event_user_blocked_desc' },
  { code: 'security.alert', nameKey: 'settings.webhooks.event_security_alert', descKey: 'settings.webhooks.event_security_alert_desc' }
];

