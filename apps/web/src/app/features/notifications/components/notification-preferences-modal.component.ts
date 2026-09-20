import { Component, EventEmitter, Input, Output, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NotificationPrefItem } from '../../../core/models/notification.models';
import { TranslatePipe } from '../../../core/services/i18n.service';

export interface EventTypeRow {
  code: string;
  titleKey: string;
  defaultTitle: string;
}

@Component({
  selector: 'app-notification-preferences-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  template: `
    <div class="modal-backdrop" (click)="onBackdropClick($event)" role="presentation">
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="pref-modal-title">
        <div class="modal-header">
          <div class="modal-title-wrap">
            <span class="material-symbols-outlined header-icon" aria-hidden="true">tune</span>
            <h2 id="pref-modal-title">{{ 'notifications.preferences_title' | t }}</h2>
          </div>
          <button type="button" class="close-btn" (click)="close.emit()" [attr.aria-label]="'common.close' | t">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div class="modal-body">
          <p class="modal-desc">
            {{ 'notifications.preferences_desc' | t }}
          </p>

          <div class="table-wrap">
            <table class="pref-table">
              <thead>
                <tr>
                  <th scope="col" class="event-col">{{ 'notifications.event_type' | t }}</th>
                  <th scope="col" class="channel-col">
                    <span class="material-symbols-outlined channel-icon" aria-hidden="true">notifications</span>
                    In-App
                  </th>
                  <th scope="col" class="channel-col">
                    <span class="material-symbols-outlined channel-icon" aria-hidden="true">mail</span>
                    Email
                  </th>
                  <th scope="col" class="channel-col">
                    <span class="material-symbols-outlined channel-icon" aria-hidden="true">send</span>
                    Telegram
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of eventRows">
                  <td class="event-title">
                    {{ row.titleKey | t }}
                  </td>
                  <td class="channel-cell">
                    <input
                      type="checkbox"
                      class="toggle-checkbox"
                      [checked]="isEnabled(row.code, 'in_app')"
                      (change)="toggle(row.code, 'in_app', $event)"
                      [attr.aria-label]="(row.titleKey | t) + ' - In-App'"
                    />
                  </td>
                  <td class="channel-cell">
                    <input
                      type="checkbox"
                      class="toggle-checkbox"
                      [checked]="isEnabled(row.code, 'email')"
                      (change)="toggle(row.code, 'email', $event)"
                      [attr.aria-label]="(row.titleKey | t) + ' - Email'"
                    />
                  </td>
                  <td class="channel-cell">
                    <input
                      type="checkbox"
                      class="toggle-checkbox"
                      [checked]="isEnabled(row.code, 'telegram')"
                      (change)="toggle(row.code, 'telegram', $event)"
                      [attr.aria-label]="(row.titleKey | t) + ' - Telegram'"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" (click)="close.emit()" [disabled]="isSaving">
            {{ 'common.cancel' | t }}
          </button>
          <button type="button" class="btn btn-primary" (click)="onSave()" [disabled]="isSaving">
            <span *ngIf="isSaving" class="spinner" aria-hidden="true"></span>
            <span>{{ 'common.save' | t }}</span>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1050;
      backdrop-filter: blur(2px);
      padding: 16px;
    }
    .modal-dialog {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      width: 100%;
      max-width: 680px;
      box-shadow: var(--shadow-xl, 0 20px 25px -5px rgba(0, 0, 0, 0.1));
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: modalFadeIn 0.15s ease-out;
    }
    @keyframes modalFadeIn {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .modal-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .modal-title-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .header-icon {
      font-size: 20px;
      color: var(--primary);
    }
    .modal-header h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--text-main);
    }
    .close-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-xs);
      padding: 4px;
    }
    .close-btn:hover { color: var(--text-main); background: var(--bg-hover); }
    .modal-body {
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .modal-desc {
      margin: 0;
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.4;
    }
    .table-wrap {
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .pref-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .pref-table th {
      background: var(--bg-hover);
      padding: 10px 14px;
      text-align: left;
      font-weight: 600;
      color: var(--text-main);
      border-bottom: 1px solid var(--border-color);
    }
    .pref-table td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-main);
    }
    .pref-table tr:last-child td {
      border-bottom: none;
    }
    .pref-table tr:hover td {
      background: var(--bg-hover);
    }
    .event-col { width: 52%; }
    .channel-col {
      width: 16%;
      text-align: center;
    }
    .channel-cell {
      text-align: center;
    }
    .channel-icon {
      font-size: 15px;
      vertical-align: text-bottom;
      margin-right: 3px;
      color: var(--text-muted);
    }
    .toggle-checkbox {
      width: 17px;
      height: 17px;
      cursor: pointer;
      accent-color: var(--primary);
    }
    .modal-footer {
      padding: 12px 18px;
      border-top: 1px solid var(--border-color);
      background: var(--bg-surface);
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    .btn {
      padding: 6px 16px;
      font-size: 13px;
      font-weight: 500;
      border-radius: var(--radius-sm);
      border: 1px solid transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.1s ease;
    }
    .btn-secondary {
      background: var(--bg-hover);
      border-color: var(--border-color);
      color: var(--text-main);
    }
    .btn-secondary:hover { background: var(--border-color); }
    .btn-primary {
      background: var(--primary);
      color: #fff;
    }
    .btn-primary:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `]
})
export class NotificationPreferencesModalComponent implements OnInit {
  @Input() initialPreferences: NotificationPrefItem[] = [];
  @Input() isSaving = false;

  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<NotificationPrefItem[]>();

  readonly eventRows: EventTypeRow[] = [
    { code: 'task_assigned', titleKey: 'notifications.pref_task_assigned', defaultTitle: 'Назначение на задачу (ответственный / соисполнитель)' },
    { code: 'task_observer', titleKey: 'notifications.pref_task_observer', defaultTitle: 'Добавление наблюдателем задачи' },
    { code: 'task_status', titleKey: 'notifications.pref_task_status', defaultTitle: 'Изменение статуса задачи' },
    { code: 'task_deadline', titleKey: 'notifications.pref_task_deadline', defaultTitle: 'Изменение дедлайна' },
    { code: 'task_deadline_reminder', titleKey: 'notifications.pref_task_deadline_reminder', defaultTitle: 'Приближение дедлайна (напоминание)' },
    { code: 'task_member_removed', titleKey: 'notifications.pref_task_member_removed', defaultTitle: 'Снятие с задачи' }
  ];

  private readonly prefsMap = new Map<string, boolean>();

  ngOnInit(): void {
    // Populate map with defaults (true) and overrides from initialPreferences
    for (const row of this.eventRows) {
      for (const channel of ['in_app', 'email', 'telegram']) {
        const key = `${row.code}:${channel}`;
        this.prefsMap.set(key, true);
      }
    }
    for (const item of this.initialPreferences) {
      const key = `${item.eventType}:${item.channel}`;
      this.prefsMap.set(key, item.isEnabled);
    }
  }

  isEnabled(eventType: string, channel: string): boolean {
    return this.prefsMap.get(`${eventType}:${channel}`) ?? true;
  }

  toggle(eventType: string, channel: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    this.prefsMap.set(`${eventType}:${channel}`, input.checked);
  }

  onSave(): void {
    const items: NotificationPrefItem[] = [];
    for (const [key, isEnabled] of this.prefsMap.entries()) {
      const [eventType, channel] = key.split(':');
      items.push({ eventType, channel, isEnabled });
    }
    this.save.emit(items);
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }
}
