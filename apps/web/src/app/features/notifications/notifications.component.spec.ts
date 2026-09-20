import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../../core/services/notification.service';
import { ToastService } from '../../core/services/toast.service';
import { NotificationsComponent } from './notifications.component';

describe('NotificationsComponent UI contracts', () => {
  const notificationService = {
    unreadCount: signal(1),
    fetchNotifications: vi.fn(() => of({ items: [] })),
    fetchUnreadCount: vi.fn(() => of(1)),
    markAllAsRead: vi.fn(() => of(undefined)),
    markAsRead: vi.fn(() => of(undefined))
  };
  const toastService = { success: vi.fn() };
  const router = { navigateByUrl: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [NotificationsComponent],
      providers: [
        { provide: NotificationService, useValue: notificationService },
        { provide: ToastService, useValue: toastService },
        { provide: Router, useValue: router }
      ]
    }).compileComponents();
  });

  it('exposes marking an unread notification as an explicit named button', () => {
    const fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    fixture.componentInstance.items.set([{
      id: 7,
      userId: 3,
      title: 'Новая задача',
      isRead: false,
      createdAt: '2026-08-30T00:00:00Z'
    }]);
    fixture.detectChanges();

    const action = fixture.nativeElement.querySelector('.mark-read-btn') as HTMLButtonElement;
    expect(action).not.toBeNull();
    expect(action.type).toBe('button');
    expect(action.getAttribute('aria-label')).toBe('Отметить уведомление «Новая задача» как прочитанное');
  });

  it('filters items between "all" and "unread" tabs', () => {
    const fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    fixture.componentInstance.items.set([
      { id: 1, userId: 3, title: 'Item 1', isRead: true, createdAt: '2026-08-30T00:00:00Z' },
      { id: 2, userId: 3, title: 'Item 2', isRead: false, createdAt: '2026-08-30T00:00:00Z' }
    ]);
    fixture.detectChanges();

    expect(fixture.componentInstance.paginatedItems()).toHaveLength(2);

    fixture.componentInstance.setFilter('unread');
    fixture.detectChanges();

    expect(fixture.componentInstance.paginatedItems()).toHaveLength(1);
    expect(fixture.componentInstance.paginatedItems()[0].id).toBe(2);

    fixture.componentInstance.setFilter('all');
    fixture.detectChanges();

    expect(fixture.componentInstance.paginatedItems()).toHaveLength(2);
  });

  it('navigates to targetUrl when clicking a notification row and marks it read', () => {
    const fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    const item = {
      id: 5,
      userId: 3,
      title: 'Задача назначена',
      targetUrl: '/tasks/100',
      isRead: false,
      createdAt: '2026-08-30T00:00:00Z'
    };
    fixture.componentInstance.items.set([item]);
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('.notif-item.clickable') as HTMLElement;
    expect(row).not.toBeNull();

    row.click();

    expect(notificationService.markAsRead).toHaveBeenCalledWith(5);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/tasks/100');
  });

  it('provides dynamic icons based on sourceModule', () => {
    const fixture = TestBed.createComponent(NotificationsComponent);
    const comp = fixture.componentInstance;

    expect(comp.getNotificationIcon({ id: 1, userId: 1, title: 'T', sourceModule: 'tasks', isRead: false, createdAt: '' })).toBe('task_alt');
    expect(comp.getNotificationIcon({ id: 2, userId: 1, title: 'C', sourceModule: 'comments', isRead: false, createdAt: '' })).toBe('chat_bubble');
    expect(comp.getNotificationIcon({ id: 3, userId: 1, title: 'S', sourceModule: 'system', isRead: false, createdAt: '' })).toBe('dns');
    expect(comp.getNotificationIcon({ id: 4, userId: 1, title: 'A', sourceModule: 'auth', isRead: false, createdAt: '' })).toBe('shield');
    expect(comp.getNotificationIcon({ id: 5, userId: 1, title: 'R', sourceModule: 'reports', isRead: false, createdAt: '' })).toBe('analytics');
    expect(comp.getNotificationIcon({ id: 6, userId: 1, title: 'D', isRead: true, createdAt: '' })).toBe('drafts');
    expect(comp.getNotificationIcon({ id: 7, userId: 1, title: 'U', isRead: false, createdAt: '' })).toBe('mark_email_unread');
  });

  it('stops propagation when mark-read button is clicked on a clickable row', () => {
    const fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    fixture.componentInstance.items.set([{
      id: 9,
      userId: 3,
      title: 'Задача',
      targetUrl: '/tasks/99',
      isRead: false,
      createdAt: '2026-08-30T00:00:00Z'
    }]);
    fixture.detectChanges();

    const markBtn = fixture.nativeElement.querySelector('.mark-read-btn') as HTMLButtonElement;
    markBtn.click();

    // markAsRead was called for id 9, but router should NOT have been navigated
    expect(notificationService.markAsRead).toHaveBeenCalledWith(9);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
