import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { NotificationFilterTab } from '../notifications.models';

@Component({
  selector: 'app-notifications-tabs',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="notif-tabs" role="tablist" [attr.aria-label]="'notifications.spisok_uvedomleniy' | t">
      <button
        type="button"
        role="tab"
        class="tab-btn"
        [class.active]="filterTab() === 'all'"
        [attr.aria-selected]="filterTab() === 'all'"
        (click)="tabChange.emit('all')"
      >
        <span>{{ 'notifications.vse' | t }}</span>
        <span class="tab-badge">{{ totalCount() }}</span>
      </button>
      <button
        type="button"
        role="tab"
        class="tab-btn"
        [class.active]="filterTab() === 'unread'"
        [attr.aria-selected]="filterTab() === 'unread'"
        (click)="tabChange.emit('unread')"
      >
        <span>{{ 'notifications.neprochitannye' | t }}</span>
        <span class="tab-badge tab-badge-unread" *ngIf="unreadCount() > 0">
          {{ unreadCount() }}
        </span>
      </button>
    </div>
  `,
  styles: [`
    :host { display: block; }
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
  `]
})
export class NotificationsTabsComponent {
  readonly filterTab = input.required<NotificationFilterTab>();
  readonly totalCount = input.required<number>();
  readonly unreadCount = input.required<number>();

  readonly tabChange = output<NotificationFilterTab>();
}
