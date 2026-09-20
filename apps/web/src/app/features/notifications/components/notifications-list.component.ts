import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination.component';
import { NotificationItem } from '../../../core/models/notification.models';
import { NotificationFilterTab, resolveNotificationIcon } from '../notifications.models';

@Component({
  selector: 'app-notifications-list',
  standalone: true,
  imports: [CommonModule, TranslatePipe, UiButtonComponent, UiPaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div *ngIf="isLoading() && itemsCount() === 0" class="notif-loading" role="status">
      <div class="loading-spinner"></div>
      <span class="loading-text">{{ 'notifications.zagruzka' | t }}</span>
    </div>

    <div *ngIf="loadError() && !isLoading()" class="notif-error" role="alert">
      <span class="material-symbols-outlined error-icon" aria-hidden="true">error</span>
      <span class="error-text">{{ loadError() }}</span>
      <ui-button variant="secondary" size="sm" icon="refresh" (onClick)="retry.emit()">
        {{ 'notifications.povtorit' | t }}
      </ui-button>
    </div>

    <div
      *ngIf="(!isLoading() || itemsCount() > 0) && !loadError()"
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
        (click)="itemClick.emit(n)"
        (keydown)="itemKeydown.emit({ event: $event, item: n })"
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
            (click)="markAsReadClick.emit({ event: $event, item: n })"
          >
            <span class="material-symbols-outlined" aria-hidden="true">done</span>
          </button>
        </div>
      </article>

      <div *ngIf="filteredCount() === 0 && !isLoading()" class="empty-notif">
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
      *ngIf="filteredCount() > 0"
      [totalItems]="filteredCount()"
      [currentPage]="currentPage()"
      [pageSize]="pageSize()"
      (pageChange)="pageChange.emit($event)"
      (pageSizeChange)="pageSizeChange.emit($event)"
    ></ui-pagination>
  `,
  styles: [`
    :host { display: block; }
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
      width: 38px;
      height: 38px;
      border-radius: var(--radius-md);
      background-color: var(--bg-hover);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background-color 0.15s ease, color 0.15s ease;
    }
    .notif-icon-box.unread-icon {
      background-color: var(--primary-subtle);
      color: var(--primary);
    }
    .notif-icon-box .material-symbols-outlined {
      font-size: 20px;
    }
    .notif-body {
      flex: 1;
      min-width: 0;
    }
    .notif-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 4px;
    }
    .notif-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-main);
      line-height: 1.3;
    }
    .notif-time {
      font-size: 11px;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .notif-text {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.5;
      margin: 0 0 6px 0;
      white-space: pre-line;
    }
    .notif-target-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      font-weight: 500;
      color: var(--primary);
      margin-top: 2px;
    }
    .target-icon {
      font-size: 14px;
      transition: transform 0.15s ease;
    }
    .notif-item:hover .target-icon {
      transform: translateX(2px);
    }
    .notif-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      padding-top: 2px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--primary);
      flex-shrink: 0;
    }
    .mark-read-btn {
      width: 28px;
      height: 28px;
      border-radius: var(--radius-sm);
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s ease;
      padding: 0;
    }
    .mark-read-btn:hover:not(:disabled) {
      background-color: var(--bg-hover);
      color: var(--text-main);
      border-color: var(--border-color);
    }
    .mark-read-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .mark-read-btn .material-symbols-outlined {
      font-size: 16px;
    }
    .empty-notif {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 24px;
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
      margin-bottom: 12px;
    }
    .empty-icon {
      font-size: 28px;
      color: var(--text-muted);
    }
    .empty-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-main);
      margin-bottom: 4px;
    }
    .empty-subtitle {
      font-size: 13px;
      color: var(--text-muted);
    }
  `]
})
export class NotificationsListComponent {
  readonly paginatedItems = input.required<NotificationItem[]>();
  readonly itemsCount = input.required<number>();
  readonly filteredCount = input.required<number>();
  readonly filterTab = input.required<NotificationFilterTab>();
  readonly isLoading = input.required<boolean>();
  readonly loadError = input<string | null>(null);
  readonly isMarkingAll = input.required<boolean>();
  readonly pendingReads = input.required<Set<number>>();
  readonly currentPage = input.required<number>();
  readonly pageSize = input.required<number>();

  readonly itemClick = output<NotificationItem>();
  readonly itemKeydown = output<{ event: KeyboardEvent; item: NotificationItem }>();
  readonly markAsReadClick = output<{ event: MouseEvent; item: NotificationItem }>();
  readonly retry = output<void>();
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();

  getNotificationIcon(item: NotificationItem): string {
    return resolveNotificationIcon(item);
  }
}
