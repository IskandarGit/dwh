import { Injectable, signal } from '@angular/core';
import { Observable, Subject, map, of, startWith, switchMap, take, takeUntil, tap } from 'rxjs';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { NotificationItem, Announcement, NotificationPrefItem } from '../models/notification.models';
import { KeysetPage } from '../models/common.models';

interface BackendNotification {
  id: number;
  userId: number;
  type: string;
  title: string;
  body?: string;
  formLink?: string;
  sourceCode?: string;
  isRead: boolean;
  createdAt: string;
}

interface BackendUnreadCount {
  unread_count: number;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  readonly unreadCount = signal<number>(0);
  readonly activeAnnouncement = signal<Announcement | null>(null);

  private eventSource: EventSource | null = null;
  private isConnecting = false;
  private readonly sessionEnded = new Subject<void>();
  private readonly unreadChanged = new Subject<void>();

  constructor(
    private api: ApiService,
    private toast: ToastService
  ) {}

  fetchUnreadCount(): Observable<{ unreadCount: number }> {
    return this.unreadChanged.pipe(
      startWith(undefined),
      // A snapshot taken before an acknowledged read or incoming SSE event is obsolete.
      switchMap(() => this.api.get<BackendUnreadCount>('/notifications/unread-count')),
      take(1),
      takeUntil(this.sessionEnded),
      map(res => ({ unreadCount: res.unread_count })),
      tap(res => this.unreadCount.set(res.unreadCount))
    );
  }

  fetchNotifications(limit: number = 20, _cursor?: string): Observable<KeysetPage<NotificationItem>> {
    return this.api.get<BackendNotification[]>('/notifications/inbox', { limit }).pipe(
      takeUntil(this.sessionEnded),
      map(records => {
        const items = records.map(record => ({
          id: record.id,
          userId: record.userId,
          title: record.title,
          bodyMarkdown: record.body,
          sourceModule: record.sourceCode,
          targetUrl: record.formLink,
          isRead: record.isRead,
          createdAt: record.createdAt,
        }));
        return {
          items,
          nextCursor: null,
          hasMore: false,
          totalReturned: items.length,
        };
      })
    );
  }

  markAsRead(id: number): Observable<void> {
    return this.api.post<void>(`/notifications/inbox/${id}/read`).pipe(
      takeUntil(this.sessionEnded),
      tap(() => this.unreadChanged.next())
    );
  }

  markAllAsRead(): Observable<void> {
    return this.api.post<void>('/notifications/inbox/read-all').pipe(
      takeUntil(this.sessionEnded),
      tap(() => this.unreadChanged.next())
    );
  }

  fetchPreferences(): Observable<NotificationPrefItem[]> {
    return this.api.get<NotificationPrefItem[]>('/notifications/preferences').pipe(
      takeUntil(this.sessionEnded)
    );
  }

  updatePreferences(prefs: NotificationPrefItem[]): Observable<void> {
    return this.api.put<void>('/notifications/preferences', prefs).pipe(
      takeUntil(this.sessionEnded)
    );
  }

  fetchActiveAnnouncement(language = 'ru'): Observable<Announcement | null> {
    return this.api.get<Announcement[]>('/announcements/active', { language }).pipe(
      takeUntil(this.sessionEnded),
      map(res => res[0] ?? null),
      tap(a => this.activeAnnouncement.set(a))
    );
  }

  dismissAnnouncement(id?: number): Observable<void> {
    if (!id) {
      this.activeAnnouncement.set(null);
      return of(undefined as unknown as void);
    }
    return this.api.post<void>(`/announcements/${id}/read`).pipe(
      takeUntil(this.sessionEnded),
      tap(() => {
        if (this.activeAnnouncement()?.id === id) this.activeAnnouncement.set(null);
      })
    );
  }

  /**
   * Подключение к Server-Sent Events (SSE) потоку /api/v1/events для получения уведомлений в реальном времени.
   */
  connectSse(): void {
    if (this.eventSource || this.isConnecting) {
      return;
    }

    try {
      this.isConnecting = true;
      const source = new EventSource('/api/v1/events', { withCredentials: true });
      this.eventSource = source;

      source.onopen = () => {
        if (this.eventSource !== source) return;
        this.isConnecting = false;
      };

      // Слушатель события 'notification'
      source.addEventListener('notification', (event: MessageEvent) => {
        if (this.eventSource !== source) return;
        try {
          const data = JSON.parse(event.data);
          this.unreadCount.update(c => c + 1);
          this.unreadChanged.next();

          const title = data.title || 'Новое уведомление';
          const body = data.body || '';
          this.toast.info(body ? `${body}` : title, title);
        } catch (err) {
          console.debug('SSE: Error parsing notification event', err);
        }
      });

      // Слушатель события 'announcement'
      source.addEventListener('announcement', (event: MessageEvent) => {
        if (this.eventSource !== source) return;
        try {
          const data = JSON.parse(event.data);
          this.activeAnnouncement.set(data);
          this.toast.warning(data.title || 'Системное объявление', 'Объявление');
        } catch (err) {
          console.debug('SSE: Error parsing announcement event', err);
        }
      });

      source.onerror = () => {
        if (this.eventSource !== source) return;
        this.isConnecting = false;
        // EventSource автоматически выполняет реконнект в браузере
      };
    } catch (e) {
      this.isConnecting = false;
      console.debug('SSE connection init error:', e);
    }
  }

  /**
   * Закрытие SSE соединения при выходе из системы.
   */
  disconnectSse(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.isConnecting = false;
    }
  }

  /** End the authenticated shell's notification lifecycle, including pending HTTP callbacks. */
  resetSession(): void {
    this.sessionEnded.next();
    this.disconnectSse();
    this.unreadCount.set(0);
    this.activeAnnouncement.set(null);
  }
}
