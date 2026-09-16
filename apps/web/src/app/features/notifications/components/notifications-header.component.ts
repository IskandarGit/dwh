import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';

@Component({
  selector: 'app-notifications-header',
  standalone: true,
  imports: [CommonModule, TranslatePipe, UiButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="view-header">
      <div class="header-left">
        <h1 class="view-title">{{ 'notifications.centr_uvedomleniy' | t }}</h1>
        <span class="count-badge" [attr.aria-label]="'notifications.spisok_uvedomleniy' | t">
          {{ totalCount() }}
        </span>
      </div>
      <div class="header-right">
        <ui-button
          variant="secondary"
          icon="refresh"
          [loading]="isLoading()"
          [ariaLabel]="'notifications.obnovit' | t"
          (onClick)="refresh.emit()"
        >
          {{ 'notifications.obnovit' | t }}
        </ui-button>
        <ui-button
          variant="secondary"
          icon="done_all"
          [disabled]="unreadCount() === 0 || hasPendingReads() || isMarkingAll()"
          [loading]="isMarkingAll()"
          (onClick)="markAllRead.emit()"
        >
          {{ 'notifications.prochitat_vse' | t }}
        </ui-button>
        <ui-button
          variant="secondary"
          icon="tune"
          [ariaLabel]="'notifications.preferences_title' | t"
          (onClick)="openPreferences.emit()"
        >
          {{ 'notifications.preferences_title' | t }}
        </ui-button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
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
  `]
})
export class NotificationsHeaderComponent {
  readonly totalCount = input.required<number>();
  readonly unreadCount = input.required<number>();
  readonly isLoading = input.required<boolean>();
  readonly hasPendingReads = input.required<boolean>();
  readonly isMarkingAll = input.required<boolean>();

  readonly refresh = output<void>();
  readonly markAllRead = output<void>();
  readonly openPreferences = output<void>();
}
