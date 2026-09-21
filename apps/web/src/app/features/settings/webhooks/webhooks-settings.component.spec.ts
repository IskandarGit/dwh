import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { I18nService } from '../../../core/services/i18n.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { WebhooksSettingsComponent } from './webhooks-settings.component';
import { WebhookSubscription, CreatedWebhookSubscription } from './webhooks-settings.models';
import { translateTest } from '../../../../testing/i18n-test.stub';

describe('WebhooksSettingsComponent', () => {
  const mockSubscriptions: WebhookSubscription[] = [
    {
      id: 1,
      name: 'ERP Integration',
      targetUrl: 'https://erp.example.com/webhooks',
      subscribedEvents: ['task.created', 'task.updated'],
      state: 'A',
      createdAt: '2026-09-18T10:00:00Z',
      createdBy: 42
    },
    {
      id: 2,
      name: 'Security Logger',
      targetUrl: 'https://sec.example.com/log',
      subscribedEvents: ['*'],
      state: 'P',
      createdAt: '2026-09-17T12:00:00Z',
      createdBy: 42
    }
  ];

  async function createFixture(
    subscriptions: WebhookSubscription[] = mockSubscriptions,
    canManage = true
  ) {
    const api = {
      get: vi.fn((url: string) => {
        if (url === '/webhooks/subscriptions') {
          return of(subscriptions);
        }
        return of([]);
      }),
      post: vi.fn((url: string, body: unknown) => {
        const created: CreatedWebhookSubscription = {
          id: 3,
          name: (body as any).name,
          targetUrl: (body as any).targetUrl,
          subscribedEvents: (body as any).subscribedEvents,
          state: 'A',
          createdAt: '2026-09-18T12:00:00Z',
          createdBy: 1,
          secretToken: 'whsec_test_secret_key_12345'
        };
        return of(created);
      }),
      patch: vi.fn(() => of(undefined)),
      delete: vi.fn(() => of(undefined))
    };

    const toast = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    };

    const permService = {
      hasPermission: vi.fn((form: string, action: string) => {
        if (form === 'platform.webhooks' && action === 'manage') return canManage;
        return true;
      })
    };

    const i18nService = {
      translate: translateTest
    };

    await TestBed.configureTestingModule({
      imports: [WebhooksSettingsComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: PermissionService, useValue: permService },
        { provide: I18nService, useValue: i18nService }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(WebhooksSettingsComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    return { fixture, component, api, toast, permService };
  }

  it('should load subscriptions on init and render table rows', async () => {
    const { fixture, component, api } = await createFixture();
    expect(api.get).toHaveBeenCalledWith('/webhooks/subscriptions');
    expect(component.subscriptions().length).toBe(2);

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('ERP Integration');
    expect(rows[0].textContent).toContain('https://erp.example.com/webhooks');
  });

  it('should display empty state if no subscriptions exist', async () => {
    const { fixture, component } = await createFixture([]);
    expect(component.subscriptions().length).toBe(0);

    const emptyCard = fixture.nativeElement.querySelector('.empty-card');
    expect(emptyCard).not.toBeNull();
  });

  it('should toggle state between Active and Paused', async () => {
    const { component, api, toast } = await createFixture();
    const sub = component.subscriptions()[0];

    component.toggleState(sub);

    expect(api.patch).toHaveBeenCalledWith('/webhooks/subscriptions/1', { state: 'P' });
    expect(toast.success).toHaveBeenCalled();
  });

  it('should handle creation flow and reveal secret key modal', async () => {
    const { component, api, toast } = await createFixture();

    component.openCreateModal();
    expect(component.isCreateModalOpen()).toBe(true);

    component.createName = 'New CRM Webhook';
    component.createTargetUrl = 'https://crm.corp/hook';
    component.selectedEvents = new Set(['task.created', 'task.completed']);

    expect(component.isCreateValid()).toBe(true);

    component.submitCreate();

    expect(api.post).toHaveBeenCalledWith('/webhooks/subscriptions', {
      name: 'New CRM Webhook',
      targetUrl: 'https://crm.corp/hook',
      subscribedEvents: ['task.created', 'task.completed']
    });

    expect(toast.success).toHaveBeenCalled();
    expect(component.isCreateModalOpen()).toBe(false);
    expect(component.createdSecretModalOpen()).toBe(true);
    expect(component.recentlyCreatedSubscription()?.secretToken).toBe('whsec_test_secret_key_12345');

    component.closeSecretModal();
    expect(component.createdSecretModalOpen()).toBe(false);
    expect(component.recentlyCreatedSubscription()).toBeNull();
  });

  it('should handle delete confirmation and deletion', async () => {
    const { component, api, toast } = await createFixture();
    const sub = component.subscriptions()[0];

    component.confirmDelete(sub);
    expect(component.isDeleteModalOpen()).toBe(true);
    expect(component.deletingSubscription()?.id).toBe(1);

    component.doDelete(1);
    expect(api.delete).toHaveBeenCalledWith('/webhooks/subscriptions/1');
    expect(toast.success).toHaveBeenCalled();
    expect(component.isDeleteModalOpen()).toBe(false);
  });
});
