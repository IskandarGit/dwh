import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, finalize } from 'rxjs';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NotificationService } from '../../core/services/notification.service';
import { ToastService } from '../../core/services/toast.service';
import { NotificationItem } from '../../core/models/notification.models';
import { I18nService } from '../../core/services/i18n.service';

import { NotificationFilterTab, resolveNotificationIcon } from './notifications.models';
import { NotificationsHeaderComponent } from './components/notifications-header.component';
import { NotificationsTabsComponent } from './components/notifications-tabs.component';
import { NotificationsListComponent } from './components/notifications-list.component';
import { NotificationPreferencesModalComponent } from './components/notification-preferences-modal.component';
import { NotificationPrefItem } from '../../core/models/notification.models';

export type { NotificationFilterTab };
export { resolveNotificationIcon };

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [
    CommonModule,
    NotificationsHeaderComponent,
    NotificationsTabsComponent,
    NotificationsListComponent,
    NotificationPreferencesModalComponent
  ],
  template: `
    <div class="notifications-container">
      <app-notifications-header
        [totalCount]="items().length"
        [unreadCount]="notifService.unreadCount()"
        [isLoading]="isLoading()"
        [hasPendingReads]="pendingReads().size > 0"
        [isMarkingAll]="isMarkingAll()"
        (refresh)="loadNotifications()"
        (markAllRead)="markAllAsRead()"
        (openPreferences)="openPreferencesModal()"
      />

      <div class="card notif-card">
        <app-notifications-tabs
          [filterTab]="filterTab()"
          [totalCount]="items().length"
          [unreadCount]="unreadItemsCount()"
          (tabChange)="setFilter($event)"
        />

        <app-notifications-list
          [paginatedItems]="paginatedItems()"
          [itemsCount]="items().length"
          [filteredCount]="filteredItems().length"
          [filterTab]="filterTab()"
          [isLoading]="isLoading()"
          [loadError]="loadError()"
          [isMarkingAll]="isMarkingAll()"
          [pendingReads]="pendingReads()"
          [currentPage]="currentPage"
          [pageSize]="pageSize"
          (itemClick)="onItemClick($event)"
          (itemKeydown)="onItemKeydown($event.event, $event.item)"
          (markAsReadClick)="onMarkAsReadClick($event.event, $event.item)"
          (retry)="loadNotifications()"
          (pageChange)="currentPage = $event"
          (pageSizeChange)="pageSize = $event; currentPage = 1"
        />
      </div>

      <app-notification-preferences-modal
        *ngIf="isPreferencesOpen()"
        [initialPreferences]="preferences()"
        [isSaving]="isSavingPreferences()"
        (close)="isPreferencesOpen.set(false)"
        (save)="savePreferences($event)"
      />
    </div>
  `,
  styles: [`
    :host { display: block; }
    .notifications-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 900px;
    }
    .card {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }
  `]
})
export class NotificationsComponent implements OnInit {
  private readonly router = inject(Router, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly uiI18n = inject(I18nService);
  readonly notifService = inject(NotificationService);

  readonly items = signal<NotificationItem[]>([]);
  readonly isLoading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly filterTab = signal<NotificationFilterTab>('all');
  readonly isMarkingAll = signal(false);
  readonly pendingReads = signal<Set<number>>(new Set());
  readonly isPreferencesOpen = signal(false);
  readonly isSavingPreferences = signal(false);
  readonly preferences = signal<NotificationPrefItem[]>([]);

  private listRequest?: Subscription;
  private countRequest?: Subscription;

  currentPage = 1;
  pageSize = 10;

  readonly unreadItemsCount = computed(() => {
    return this.items().filter(item => !item.isRead).length;
  });

  readonly filteredItems = computed(() => {
    const tab = this.filterTab();
    if (tab === 'unread') {
      return this.items().filter(item => !item.isRead);
    }
    return this.items();
  });

  paginatedItems(): NotificationItem[] {
    const list = this.filteredItems();
    const start = (this.currentPage - 1) * this.pageSize;
    return list.slice(start, start + this.pageSize);
  }

  ngOnInit(): void {
    this.loadNotifications();
  }

  loadNotifications(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.listRequest?.unsubscribe();
    this.listRequest = this.notifService.fetchNotifications(50).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.isLoading.set(false))
    ).subscribe({
      next: res => {
        this.items.set(Array.isArray(res) ? res : res?.items || []);
        const total = this.filteredItems().length;
        const maxPage = Math.max(1, Math.ceil(total / this.pageSize));
        this.currentPage = Math.min(this.currentPage, maxPage);
      },
      error: () => {
        this.loadError.set(this.uiI18n.translate('notifications.oshibka_zagruzki'));
      }
    });
  }

  setFilter(tab: NotificationFilterTab): void {
    this.filterTab.set(tab);
    this.currentPage = 1;
  }

  onItemClick(item: NotificationItem): void {
    if (item.targetUrl) {
      if (!item.isRead) {
        this.markAsRead(item);
      }
      if (item.targetUrl.startsWith('http://') || item.targetUrl.startsWith('https://')) {
        window.open(item.targetUrl, '_blank', 'noopener,noreferrer');
      } else {
        this.router?.navigateByUrl(item.targetUrl);
      }
    }
  }

  onItemKeydown(event: KeyboardEvent, item: NotificationItem): void {
    if ((event.key === 'Enter' || event.key === ' ') && item.targetUrl) {
      event.preventDefault();
      this.onItemClick(item);
    }
  }

  onMarkAsReadClick(event: MouseEvent, item: NotificationItem): void {
    event.stopPropagation();
    this.markAsRead(item);
  }

  markAsRead(item: NotificationItem): void {
    if (item.isRead || this.isMarkingAll() || this.pendingReads().has(item.id)) return;
    this.pendingReads.update(ids => new Set([...ids, item.id]));
    this.notifService.markAsRead(item.id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.pendingReads.update(ids => new Set([...ids].filter(id => id !== item.id))))
    ).subscribe({
      next: () => {
        this.items.update(list => list.map(i => i.id === item.id ? { ...i, isRead: true } : i));
        this.refreshUnreadCount();
      },
      error: () => {}
    });
  }

  markAllAsRead(): void {
    if (this.isMarkingAll() || this.pendingReads().size > 0 || this.notifService.unreadCount() === 0) return;
    this.isMarkingAll.set(true);
    this.notifService.markAllAsRead().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.isMarkingAll.set(false))
    ).subscribe({
      next: () => {
        this.toast.success(this.uiI18n.translate('notifications.vse_uvedomleniya_prochitany'));
        this.loadNotifications();
        this.refreshUnreadCount();
      },
      error: () => {}
    });
  }

  getNotificationIcon(item: NotificationItem): string {
    return resolveNotificationIcon(item);
  }

  private refreshUnreadCount(): void {
    this.countRequest?.unsubscribe();
    this.countRequest = this.notifService.fetchUnreadCount().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({ error: () => {} });
  }

  openPreferencesModal(): void {
    this.notifService.fetchPreferences().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: prefs => {
        this.preferences.set(prefs);
        this.isPreferencesOpen.set(true);
      },
      error: () => {
        this.preferences.set([]);
        this.isPreferencesOpen.set(true);
      }
    });
  }

  savePreferences(prefs: NotificationPrefItem[]): void {
    this.isSavingPreferences.set(true);
    this.notifService.updatePreferences(prefs).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.isSavingPreferences.set(false))
    ).subscribe({
      next: () => {
        this.isPreferencesOpen.set(false);
        this.toast.success(this.uiI18n.translate('notifications.preferences_saved'));
      },
      error: () => {
        this.toast.error(this.uiI18n.translate('notifications.preferences_error'));
      }
    });
  }
}
