import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, finalize } from 'rxjs';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NotificationService } from '../../core/services/notification.service';
import { ToastService } from '../../core/services/toast.service';
import { UiButtonComponent } from '../../shared/ui/ui-button.component';
import { UiPaginationComponent } from '../../shared/ui/ui-pagination.component';
import { NotificationItem } from '../../core/models/notification.models';
import { TranslatePipe, I18nService } from '../../core/services/i18n.service';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    UiButtonComponent,
    UiPaginationComponent
  ],
  template: `
    <div class="notifications-container">
      <div class="view-header">
        <div class="header-left">
          <h1 class="view-title">{{ 'notifications.centr_uvedomleniy' | t }}</h1>
          <span class="count-badge" [attr.aria-label]="'notifications.spisok_uvedomleniy' | t">
            {{ items().length }}
          </span>
        </div>
        <div class="header-right">
          <ui-button
            variant="secondary"
            icon="refresh"
            [loading]="isLoading()"
            [attr.aria-label]="'notifications.obnovit' | t"
            (onClick)="loadNotifications()"
          >
            {{ 'notifications.obnovit' | t }}
          </ui-button>
          <ui-button
            variant="secondary"
            icon="done_all"
            [disabled]="notifService.unreadCount() === 0 || pendingReads().size > 0 || isMarkingAll()"
            [loading]="isMarkingAll()"
            (onClick)="markAllAsRead()"
          >
            {{ 'notifications.prochitat_vse' | t }}
          </ui-button>
        </div>
      </div>

      <div class="card notif-card">
        <div class="notif-tabs" role="tablist" [attr.aria-label]="'notifications.spisok_uvedomleniy' | t">
          <button
            type="button"
            role="tab"
            class="tab-btn"
            [class.active]="filterTab() === 'all'"
            [attr.aria-selected]="filterTab() === 'all'"
            (click)="setFilter('all')"
          >
            <span>{{ 'notifications.vse' | t }}</span>
            <span class="tab-badge">{{ items().length }}</span>
          </button>
          <button
            type="button"
            role="tab"
            class="tab-btn"
            [class.active]="filterTab() === 'unread'"
            [attr.aria-selected]="filterTab() === 'unread'"
            (click)="setFilter('unread')"
          >
            <span>{{ 'notifications.neprochitannye' | t }}</span>
            <span class="tab-badge tab-badge-unread" *ngIf="unreadItemsCount() > 0">
              {{ unreadItemsCount() }}
            </span>
          </button>
        </div>

        <div *ngIf="isLoading() && items().length === 0" class="notif-loading" role="status">
          <div class="loading-spinner"></div>
          <span class="loading-text">{{ 'notifications.zagruzka' | t }}</span>
        </div>

        <div *ngIf="loadError() && !isLoading()" class="notif-error" role="alert">
          <span class="material-symbols-outlined error-icon" aria-hidden="true">error</span>
          <span class="error-text">{{ loadError() }}</span>
          <ui-button variant="secondary" size="sm" icon="refresh" (onClick)="loadNotifications()">
            {{ 'notifications.povtorit' | t }}
          </ui-button>
        </div>

        <div
          *ngIf="(!isLoading() || items().length > 0) && !loadError()"
          class="notif-list"
          role="region"
          [attr.aria-label]="'notifications.spisok_uvedomleniy' | t"
        >
          <article
            *ngFor="let n of paginatedItems()"
            class="notif-item"
            [class.unread]="!n.isRead"
            [class.clickable]="!!n.targetUrl"
            [attr.tabindex]="n.targetUrl ? 0 : null"
            [attr.role]="n.targetUrl ? 'button' : null"
            (click)="onItemClick(n)"
            (keydown)="onItemKeydown($event, n)"
          >
            <div class="notif-icon-box" [class.unread-icon]="!n.isRead">
              <span class="material-symbols-outlined" aria-hidden="true">
                {{ getNotificationIcon(n) }}
              </span>
            </div>
            <div class="notif-body">
              <div class="notif-header">
                <span class="notif-title font-medium">{{ n.title }}</span>
                <span class="notif-time tabular-nums text-muted">{{ n.createdAt | date:'dd.MM.yyyy HH:mm' }}</span>
              </div>
              <p class="notif-text" *ngIf="n.bodyMarkdown">{{ n.bodyMarkdown }}</p>
              <div class="notif-target-link" *ngIf="n.targetUrl">
                <span class="material-symbols-outlined target-icon" aria-hidden="true">arrow_forward</span>
                <span>{{ 'notifications.pereyti_k_resursu' | t }}</span>
              </div>
            </div>
            <div class="notif-actions">
              <span class="dot" *ngIf="!n.isRead" aria-hidden="true"></span>
              <button
                *ngIf="!n.isRead"
                type="button"
                class="mark-read-btn"
                [disabled]="isMarkingAll() || pendingReads().has(n.id)"
                [attr.aria-label]="'notifications.mark_named_read' | t:{title: n.title}"
                (click)="onMarkAsReadClick($event, n)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">done</span>
              </button>
            </div>
          </article>

          <div *ngIf="filteredItems().length === 0 && !isLoading()" class="empty-notif">
            <div class="empty-icon-wrap">
              <span class="material-symbols-outlined empty-icon" aria-hidden="true">
                {{ filterTab() === 'unread' ? 'mark_email_read' : 'notifications_off' }}
              </span>
            </div>
            <div class="empty-title">
              {{ (filterTab() === 'unread' ? 'notifications.vse_uvedomleniya_prochitany' : 'notifications.u_vas_net_uvedomleniy') | t }}
            </div>
            <div class="empty-subtitle">
              {{ (filterTab() === 'unread' ? 'notifications.net_novyh_uvedomleniy' : 'notifications.zdes_budut_uvedomleniya') | t }}
            </div>
          </div>
        </div>

        <ui-pagination
          *ngIf="filteredItems().length > 0"
          [totalItems]="filteredItems().length"
          [currentPage]="currentPage"
          [pageSize]="pageSize"
          (pageChange)="currentPage = $event"
          (pageSizeChange)="pageSize = $event; currentPage = 1"
        ></ui-pagination>
      </div>
    </div>
  `,

  styles: [`
    .notifications-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 900px;
    }

    .view-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .view-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-main);
      letter-spacing: -0.3px;
      margin: 0;
    }

    .count-badge {
      font-size: 12px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 12px;
      background-color: var(--bg-hover);
      color: var(--text-muted);
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .card {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }

    .notif-tabs {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border-color);
      background-color: var(--bg-surface);
    }

    .tab-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .tab-btn:hover {
      background-color: var(--bg-hover);
      color: var(--text-main);
    }

    .tab-btn.active {
      background-color: var(--primary-subtle);
      color: var(--primary);
      font-weight: 600;
      border-color: rgba(99, 102, 241, 0.15);
    }

    .tab-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 10px;
      background-color: var(--bg-hover);
      color: var(--text-muted);
    }

    .tab-badge-unread {
      background-color: var(--primary);
      color: #ffffff;
    }

    .tab-btn.active .tab-badge:not(.tab-badge-unread) {
      background-color: rgba(99, 102, 241, 0.2);
      color: var(--primary);
    }

    .notif-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 48px 24px;
      color: var(--text-muted);
    }

    .loading-spinner {
      width: 28px;
      height: 28px;
      border: 3px solid var(--border-color);
      border-top-color: var(--primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .notif-error {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      background-color: var(--danger-subtle, rgba(239, 68, 68, 0.08));
      color: var(--danger, #ef4444);
      border-bottom: 1px solid var(--border-color);
    }

    .error-icon {
      font-size: 20px;
      flex-shrink: 0;
    }

    .error-text {
      flex: 1;
      font-size: 13px;
    }

    .notif-list {
      display: flex;
      flex-direction: column;
    }

    .notif-item {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-color);
      transition: background-color 0.15s ease, border-color 0.15s ease;
      position: relative;
    }

    .notif-item:last-child {
      border-bottom: none;
    }

    .notif-item:hover {
      background-color: var(--bg-hover);
    }

    .notif-item.unread {
      background-color: var(--primary-subtle);
    }

    .notif-item.clickable {
      cursor: pointer;
    }

    .notif-item.clickable:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }

    .notif-icon-box {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background-color: var(--bg-hover);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }

    .notif-icon-box .material-symbols-outlined {
      font-size: 18px;
    }

    .notif-icon-box.unread-icon {
      background-color: var(--primary);
      color: #ffffff;
      box-shadow: 0 2px 4px rgba(99, 102, 241, 0.25);
    }

    .notif-body {
      flex: 1;
      min-width: 0;
    }

    .notif-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 4px;
    }

    .notif-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-main);
      line-height: 1.4;
    }

    .notif-time {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .notif-text {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.45;
      margin: 0 0 6px 0;
      word-break: break-word;
    }

    .notif-target-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 500;
      color: var(--primary);
      margin-top: 4px;
    }

    .notif-target-link .target-icon {
      font-size: 14px;
      transition: transform 0.15s ease;
    }

    .notif-item:hover .notif-target-link .target-icon {
      transform: translateX(3px);
    }

    .notif-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      align-self: center;
      margin-left: 8px;
    }

    .notif-actions .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--primary);
      display: inline-block;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
    }

    .mark-read-btn {
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      background: var(--bg-surface);
      color: var(--primary);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .mark-read-btn:hover:not(:disabled) {
      border-color: var(--primary);
      background: var(--bg-hover);
      transform: scale(1.05);
    }

    .mark-read-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .mark-read-btn .material-symbols-outlined {
      font-size: 18px;
    }

    .font-medium { font-weight: 500; }
    .text-muted { color: var(--text-muted); }

    .empty-notif {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 56px 24px;
      text-align: center;
    }

    .empty-icon-wrap {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background-color: var(--bg-hover);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }

    .empty-icon {
      font-size: 28px;
      color: var(--text-muted);
    }

    .empty-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-main);
      margin-bottom: 6px;
    }

    .empty-subtitle {
      font-size: 13px;
      color: var(--text-muted);
      max-width: 360px;
      line-height: 1.45;
    }
  `]
})
export class NotificationsComponent implements OnInit {
  private readonly uiI18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router, { optional: true });
  private listRequest?: Subscription;
  private countRequest?: Subscription;

  readonly items = signal<NotificationItem[]>([]);
  readonly isMarkingAll = signal(false);
  readonly isLoading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly pendingReads = signal<ReadonlySet<number>>(new Set());
  readonly filterTab = signal<'all' | 'unread'>('all');

  readonly unreadItemsCount = computed(() =>
    this.items().filter(item => !item.isRead).length
  );

  readonly filteredItems = computed(() => {
    const tab = this.filterTab();
    const list = this.items();
    if (tab === 'unread') {
      return list.filter(item => !item.isRead);
    }
    return list;
  });

  currentPage = 1;
  pageSize = 10;

  paginatedItems(): NotificationItem[] {
    const list = this.filteredItems();
    const start = (this.currentPage - 1) * this.pageSize;
    return list.slice(start, start + this.pageSize);
  }

  constructor(
    public notifService: NotificationService,
    private toast: ToastService
  ) {}

  ngOnInit() {
    this.loadNotifications();
  }

  setFilter(tab: 'all' | 'unread') {
    this.filterTab.set(tab);
    this.currentPage = 1;
  }

  loadNotifications() {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.listRequest?.unsubscribe();
    this.listRequest = this.notifService.fetchNotifications(50).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.isLoading.set(false))
    ).subscribe({
      next: res => {
        this.items.set(res.items || []);
        const total = this.filteredItems().length;
        const maxPage = Math.max(1, Math.ceil(total / this.pageSize));
        this.currentPage = Math.min(this.currentPage, maxPage);
      },
      error: () => {
        this.loadError.set(this.uiI18n.translate('notifications.oshibka_zagruzki'));
      }
    });
  }

  markAllAsRead() {
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

  markAsRead(item: NotificationItem) {
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

  onMarkAsReadClick(event: MouseEvent, item: NotificationItem) {
    event.stopPropagation();
    this.markAsRead(item);
  }

  onItemClick(item: NotificationItem) {
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

  onItemKeydown(event: KeyboardEvent, item: NotificationItem) {
    if ((event.key === 'Enter' || event.key === ' ') && item.targetUrl) {
      event.preventDefault();
      this.onItemClick(item);
    }
  }

  getNotificationIcon(item: NotificationItem): string {
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

  private refreshUnreadCount() {
    this.countRequest?.unsubscribe();
    this.countRequest = this.notifService.fetchUnreadCount().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({ error: () => {} });
  }
}
