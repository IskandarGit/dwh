import { Component, ElementRef, EventEmitter, Input, Output, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { NotificationService } from '../../../core/services/notification.service';
import { CommandPaletteService } from '../../../core/services/command-palette.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TranslatePipe
  ],
  template: `
    <!-- Top Navigation -->
    <header class="topbar">
      <div class="topbar-left">
        <button
          #mobileMenuBtn
          type="button"
          class="icon-btn mobile-menu-btn"
          [attr.aria-label]="'layout.app_shell.otkryt_menyu_navigacii' | t"
          [attr.aria-expanded]="isMobileMenuOpen"
          [attr.aria-controls]="sidebarId"
          (click)="toggleMobileMenu.emit()"
        >
          <span class="material-symbols-outlined" aria-hidden="true">{{ isMobileMenuOpen ? 'close' : 'menu' }}</span>
        </button>

        <button
          type="button"
          class="palette-trigger"
          [attr.aria-label]="'layout.app_shell.otkryt_globalnyy_poisk' | t"
          aria-haspopup="dialog"
          aria-keyshortcuts="Control+K Meta+K"
          [attr.aria-expanded]="paletteService.isOpen()"
          [disabled]="authService.isLoggingOut()"
          (click)="paletteService.open()"
        >
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <span class="trigger-text">{{ 'layout.app_shell.poisk' | t }}</span>
          <kbd class="shortcut-kbd">Ctrl K</kbd>
        </button>
      </div>

      <div class="topbar-right">
        <!-- Language Switcher -->
        <div class="lang-selector">
          <span class="material-symbols-outlined lang-icon" aria-hidden="true">language</span>
          <select
            id="app-language-selector"
            class="lang-select"
            [attr.aria-label]="'settings.yazyk_interfeysa' | t"
            [value]="i18n.currentLang()"
            [disabled]="i18n.isLoading() || isChangingLanguage || authService.isLoggingOut()"
            [attr.aria-busy]="isChangingLanguage"
            (change)="changeLanguage.emit($event)"
          >
            <option *ngFor="let lang of i18n.languages()" [value]="lang.code">
              {{ lang.code.toUpperCase() }} — {{ lang.name }}
            </option>
          </select>
        </div>

        <!-- Theme Toggle -->
        <button
          type="button"
          class="icon-btn"
          [attr.aria-label]="'layout.app_shell.pereklyuchit_temu' | t"
          [attr.aria-pressed]="themeService.currentTheme() === 'dark'"
          [disabled]="authService.isLoggingOut()"
          (click)="themeService.toggleTheme()"
          [title]="(themeService.currentTheme() === 'light' ? 'common.dark_theme' : 'common.light_theme') | t"
        >
          <span class="material-symbols-outlined" aria-hidden="true">
            {{ themeService.currentTheme() === 'light' ? 'dark_mode' : 'light_mode' }}
          </span>
        </button>

        <!-- Notification Bell -->
        <button
          *ngIf="canReadNotifications"
          type="button"
          class="icon-btn notif-btn"
          routerLink="/notifications"
          [attr.aria-label]="'layout.app_shell.otkryt_uvedomleniya' | t"
          [attr.aria-describedby]="notifService.unreadCount() > 0 ? 'header-unread-count' : null"
          [disabled]="authService.isLoggingOut()"
          [title]="'nav.notifications' | t"
        >
          <span class="material-symbols-outlined" aria-hidden="true">notifications</span>
          <span class="bell-dot" *ngIf="notifService.unreadCount() > 0" aria-hidden="true"></span>
          <span id="header-unread-count" class="sr-only" *ngIf="notifService.unreadCount() > 0">
            {{ 'layout.app_shell.unread_notifications' | t:{count: notifService.unreadCount()} }}
          </span>
        </button>

        <!-- Logout -->
        <button
          type="button"
          class="icon-btn logout-btn"
          [attr.aria-label]="'layout.app_shell.vyyti_iz_sistemy' | t"
          [disabled]="authService.isLoggingOut()"
          [attr.aria-busy]="authService.isLoggingOut()"
          (click)="onLogout()"
          [title]="'layout.app_shell.vyyti_iz_sistemy' | t"
        >
          <span class="material-symbols-outlined" aria-hidden="true">
            {{ authService.isLoggingOut() ? 'hourglass_top' : 'logout' }}
          </span>
        </button>
      </div>
    </header>

    <!-- Active Announcement Banner -->
    <div *ngIf="canReadAnnouncements && notifService.activeAnnouncement()" class="announcement-banner" role="status">
      <div class="announcement-content">
        <span class="material-symbols-outlined banner-icon" aria-hidden="true">campaign</span>
        <div class="banner-text">
          <strong>{{ notifService.activeAnnouncement()?.title }}</strong>
          <p class="banner-body">{{ notifService.activeAnnouncement()?.body }}</p>
        </div>
      </div>
      <button
        type="button"
        class="banner-close"
        [disabled]="isDismissingAnnouncement || authService.isLoggingOut()"
        [attr.aria-label]="'layout.app_shell.zakryt_obyavlenie' | t"
        (click)="dismissAnnouncement.emit()"
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </div>
  `,
  styles: [`
    /* Topbar */
    .topbar {
      height: 52px;
      background-color: var(--bg-surface);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 18px;
      flex-shrink: 0;
      gap: 12px;
    }

    .topbar-left {
      display: flex;
      align-items: center;
      min-width: 0;
    }

    .palette-trigger {
      display: flex;
      align-items: center;
      gap: 8px;
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 6px 12px;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      width: 240px;
      height: 34px;
      flex-shrink: 0;
    }
    .palette-trigger:hover:not(:disabled) {
      border-color: var(--primary);
      color: var(--text-main);
    }

    .trigger-text {
      flex: 1;
      text-align: left;
    }

    .shortcut-kbd {
      font-size: 10px;
      padding: 2px 4px;
      border-radius: 3px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
    }

    .topbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .lang-selector {
      position: relative;
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }

    .lang-icon {
      position: absolute;
      left: 8px;
      pointer-events: none;
      color: var(--text-muted);
      font-size: 17px;
    }

    .lang-select {
      height: 34px;
      max-width: 174px;
      padding: 4px 24px 4px 30px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      font-size: 11px;
      font-weight: 600;
      color: var(--text-main);
      cursor: pointer;
    }

    .icon-btn {
      width: 34px;
      height: 34px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      position: relative;
      flex-shrink: 0;
    }
    .icon-btn:hover:not(:disabled) {
      background-color: var(--bg-hover);
      color: var(--text-main);
    }

    .icon-btn:disabled, .palette-trigger:disabled, .lang-select:disabled {
      opacity: 0.6;
      cursor: wait;
    }

    .palette-trigger:focus-visible,
    .icon-btn:focus-visible,
    .lang-select:focus-visible {
      outline: 2px solid var(--focus-ring, var(--primary));
      outline-offset: 2px;
    }

    .bell-dot {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background-color: var(--danger);
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border-width: 0;
    }

    /* Announcement Banner */
    .announcement-banner {
      flex-shrink: 0;
      max-height: 28vh;
      overflow-y: auto;
      background-color: var(--info-bg);
      border-bottom: 1px solid var(--border-color);
      color: var(--info);
      padding: 8px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      font-weight: 500;
    }

    .announcement-content {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .banner-icon {
      font-size: 20px;
    }

    .banner-text {
      min-width: 0;
      overflow-wrap: anywhere;
      color: var(--text-main);
    }
    .banner-body {
      margin: 4px 0 0;
      white-space: pre-wrap;
      font-weight: 400;
    }

    .banner-close {
      background: transparent;
      border: none;
      cursor: pointer;
      color: var(--info);
      display: flex;
      align-items: center;
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      justify-content: center;
    }
    .banner-close:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }
    .banner-close:disabled {
      cursor: wait;
      opacity: 0.5;
    }

    .mobile-menu-btn {
      display: none;
    }

    @media (max-width: 1023px) {
      .palette-trigger {
        width: min(240px, 40vw);
      }
    }

    @media (max-width: 767px) {
      .mobile-menu-btn {
        display: inline-flex;
      }

      .topbar {
        padding-inline: 8px;
        gap: 4px;
      }

      .topbar-left, .topbar-right {
        gap: 4px;
      }
      .icon-btn {
        width: 44px;
        height: 44px;
      }
      .lang-icon {
        display: none;
      }
      .lang-select {
        width: 64px;
        height: 44px;
        padding: 4px 18px 4px 4px;
        font-size: 12px;
      }

      .trigger-text,
      .shortcut-kbd {
        display: none;
      }

      .palette-trigger {
        width: 44px;
        height: 44px;
        padding: 0;
        justify-content: center;
      }
    }
  `]
})
export class AppHeaderComponent {
  readonly authService = inject(AuthService);
  readonly themeService = inject(ThemeService);
  readonly i18n = inject(I18nService);
  readonly notifService = inject(NotificationService);
  readonly paletteService = inject(CommandPaletteService);

  @ViewChild('mobileMenuBtn') mobileMenuBtn?: ElementRef<HTMLButtonElement>;

  @Input() isMobile = false;
  @Input() isMobileMenuOpen = false;
  @Input() sidebarId = 'app-sidebar-nav';
  @Input() isChangingLanguage = false;
  @Input() isDismissingAnnouncement = false;
  @Input() canReadNotifications = false;
  @Input() canReadAnnouncements = false;

  @Output() toggleMobileMenu = new EventEmitter<void>();
  @Output() changeLanguage = new EventEmitter<Event>();
  @Output() dismissAnnouncement = new EventEmitter<void>();
  @Output() logout = new EventEmitter<void>();

  onLogout() {
    this.logout.emit();
    this.authService.logout();
  }
}
