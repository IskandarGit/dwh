import { Component, DestroyRef, OnDestroy, computed, effect, signal, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { PermissionService } from '../../core/services/permission.service';
import { ThemeService } from '../../core/services/theme.service';
import { I18nService, TranslatePipe, Language } from '../../core/services/i18n.service';
import { NotificationService } from '../../core/services/notification.service';
import { CommandPaletteService } from '../../core/services/command-palette.service';
import { CommandPaletteComponent } from '../command-palette/command-palette.component';
import { ToastService } from '../../core/services/toast.service';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TranslatePipe,
    CommandPaletteComponent
  ],
  template: `
    <a class="skip-link" href="#main-content">{{ 'layout.app_shell.pereyti_k_osnovnomu_soderzhimomu' | t }}</a>
    <div class="app-layout">
      <!-- Mobile Drawer Backdrop -->
      <div *ngIf="isMobileMenuOpen()" class="mobile-drawer-backdrop" (click)="closeMobileMenu()" aria-hidden="true"></div>

      <!-- Sidebar -->
      <aside class="sidebar" [class.collapsed]="isCollapsed()" [class.mobile-open]="isMobileMenuOpen()">
        <div class="sidebar-header">
          <div class="brand-logo" *ngIf="!isCollapsed() || isMobileMenuOpen()">
            <span class="brand-icon">S</span>
            <span class="brand-name">SmartupCMS</span>
          </div>
          <button
            type="button"
            class="toggle-btn"
            (click)="toggleSidebar()"
            [attr.aria-label]="(isCollapsed() ? 'layout.app_shell.expand_navigation' : 'layout.app_shell.collapse_navigation') | t"
            [attr.aria-expanded]="!isCollapsed()"
            [title]="(isCollapsed() ? 'common.expand' : 'common.collapse') | t"
          >
            <span class="material-symbols-outlined" aria-hidden="true">{{ isCollapsed() ? 'chevron_right' : 'chevron_left' }}</span>
          </button>
        </div>

        <nav class="sidebar-nav" [attr.aria-label]="'layout.app_shell.osnovnaya_navigaciya' | t" (click)="closeMobileMenu()">
          <!-- Tasks & Workflows -->
          <div class="nav-section-title" *ngIf="(!isCollapsed() || isMobileMenuOpen()) && (canViewTasks() || canViewProjects())">{{ 'nav.tasks' | t }}</div>
          <a *ngIf="canViewTasks()" routerLink="/tasks" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" [attr.aria-current]="isRouteActive('/tasks', true) ? 'page' : null" class="nav-item" [title]="'nav.tasks' | t">
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">task_alt</span>
            <span class="nav-label" *ngIf="!isCollapsed() || isMobileMenuOpen()">{{ 'nav.tasks' | t }}</span>
          </a>
          <a *ngIf="canViewProjects()" routerLink="/tasks/projects" routerLinkActive="active" [attr.aria-current]="isRouteActive('/tasks/projects') ? 'page' : null" class="nav-item" [title]="'nav.projects' | t">
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">folder</span>
            <span class="nav-label" *ngIf="!isCollapsed() || isMobileMenuOpen()">{{ 'nav.projects' | t }}</span>
          </a>
          <a *ngIf="canViewAnalytics()" routerLink="/analytics" routerLinkActive="active" [attr.aria-current]="isRouteActive('/analytics') ? 'page' : null" class="nav-item" [title]="'analytics.analitika_i_dashbordy' | t">
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">insights</span>
            <span class="nav-label" *ngIf="!isCollapsed() || isMobileMenuOpen()">{{ 'layout.app_shell.analitika' | t }}</span>
          </a>

          <!-- Master Data & IAM -->
          <div class="nav-section-title" *ngIf="(!isCollapsed() || isMobileMenuOpen()) && (canViewUsers() || canViewRoles() || canViewCustomFields())">{{ 'layout.app_shell.iam_nastroyki' | t }}</div>
          <a *ngIf="canViewUsers()" routerLink="/iam/users" routerLinkActive="active" [attr.aria-current]="isRouteActive('/iam/users') ? 'page' : null" class="nav-item" [title]="'nav.users' | t">
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">people</span>
            <span class="nav-label" *ngIf="!isCollapsed() || isMobileMenuOpen()">{{ 'nav.users' | t }}</span>
          </a>
          <a *ngIf="canViewRoles()" routerLink="/iam/roles" routerLinkActive="active" [attr.aria-current]="isRouteActive('/iam/roles') ? 'page' : null" class="nav-item" [title]="'nav.roles' | t">
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">security</span>
            <span class="nav-label" *ngIf="!isCollapsed() || isMobileMenuOpen()">{{ 'nav.roles' | t }}</span>
          </a>
          <a *ngIf="canViewCustomFields()" routerLink="/iam/custom-fields" routerLinkActive="active" [attr.aria-current]="isRouteActive('/iam/custom-fields') ? 'page' : null" class="nav-item" [title]="'nav.custom_fields' | t">
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">tune</span>
            <span class="nav-label" *ngIf="!isCollapsed() || isMobileMenuOpen()">{{ 'nav.custom_fields' | t }}</span>
          </a>

          <!-- System -->
          <div class="nav-section-title" *ngIf="(!isCollapsed() || isMobileMenuOpen()) && (canViewSources() || canViewFiles() || canViewNotifications() || canViewAnnouncements() || canViewAudit() || canViewSystem() || canViewSettings())">{{ 'audit.sistema' | t }}</div>
          <a *ngIf="canViewSources()" routerLink="/upl/sources" routerLinkActive="active" [attr.aria-current]="isRouteActive('/upl/sources') ? 'page' : null" class="nav-item" [title]="'nav.upl_sources' | t">
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">table_view</span>
            <span class="nav-label" *ngIf="!isCollapsed() || isMobileMenuOpen()">{{ 'nav.upl_sources' | t }}</span>
          </a>
          <a *ngIf="canViewFiles()" routerLink="/files" routerLinkActive="active" [attr.aria-current]="isRouteActive('/files') ? 'page' : null" class="nav-item" [title]="'files.faylovoe_hranilische' | t">
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">folder_open</span>
            <span class="nav-label" *ngIf="!isCollapsed() || isMobileMenuOpen()">{{ 'layout.app_shell.fayly' | t }}</span>
          </a>
          <a *ngIf="canViewNotifications()" routerLink="/notifications" routerLinkActive="active" [attr.aria-current]="isRouteActive('/notifications') ? 'page' : null" class="nav-item" [title]="'nav.notifications' | t">
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">notifications</span>
            <span class="nav-label" *ngIf="!isCollapsed() || isMobileMenuOpen()">{{ 'nav.notifications' | t }}</span>
            <span class="unread-chip" *ngIf="notifService.unreadCount() > 0">
              {{ notifService.unreadCount() }}
            </span>
          </a>
          <a *ngIf="canViewAnnouncements()" routerLink="/announcements" routerLinkActive="active" [attr.aria-current]="isRouteActive('/announcements') ? 'page' : null" class="nav-item" [title]="'layout.app_shell.upravlenie_obyavleniyami' | t">
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">campaign</span>
            <span class="nav-label" *ngIf="!isCollapsed() || isMobileMenuOpen()">{{ 'announcements.obyavleniya' | t }}</span>
          </a>
          <a *ngIf="canViewAudit()" routerLink="/audit" routerLinkActive="active" [attr.aria-current]="isRouteActive('/audit') ? 'page' : null" class="nav-item" [title]="'layout.app_shell.audit' | t">
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">history</span>
            <span class="nav-label" *ngIf="!isCollapsed() || isMobileMenuOpen()">{{ 'nav.audit' | t }}</span>
          </a>
          <a *ngIf="canViewSystem()" routerLink="/system" routerLinkActive="active" [attr.aria-current]="isRouteActive('/system') ? 'page' : null" class="nav-item" [title]="'system.sostoyanie_sistemy' | t">
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">monitor_heart</span>
            <span class="nav-label" *ngIf="!isCollapsed() || isMobileMenuOpen()">{{ 'layout.app_shell.sostoyanie' | t }}</span>
          </a>
          <a *ngIf="canViewSettings()" routerLink="/settings" routerLinkActive="active" [attr.aria-current]="isRouteActive('/settings') ? 'page' : null" class="nav-item" [title]="'layout.app_shell.nastroyki' | t">
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">settings</span>
            <span class="nav-label" *ngIf="!isCollapsed() || isMobileMenuOpen()">{{ 'nav.settings' | t }}</span>
          </a>
        </nav>

        <div class="sidebar-footer">
          <a routerLink="/iam/profile" routerLinkActive="active" [attr.aria-current]="isRouteActive('/iam/profile') ? 'page' : null" class="user-profile-btn" [title]="'nav.profile' | t" (click)="closeMobileMenu()">
            <div class="avatar-circle">
              {{ getUserInitial() }}
            </div>
            <div class="user-meta" *ngIf="!isCollapsed() || isMobileMenuOpen()">
              <div class="user-name">{{ authService.currentUser()?.name }}</div>
              <div class="user-role">&#64;{{ authService.currentUser()?.login }}</div>
            </div>
          </a>
        </div>
      </aside>

      <!-- Main Container -->
      <div class="main-wrapper">
        <!-- Top Navigation -->
        <header class="topbar">
          <div class="topbar-left">
            <button type="button" class="icon-btn mobile-menu-btn" [attr.aria-label]="'layout.app_shell.otkryt_menyu_navigacii' | t" (click)="toggleMobileMenu()">
              <span class="material-symbols-outlined" aria-hidden="true">{{ isMobileMenuOpen() ? 'close' : 'menu' }}</span>
            </button>

            <button type="button" class="palette-trigger" [attr.aria-label]="'layout.app_shell.otkryt_globalnyy_poisk' | t" aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" [attr.aria-expanded]="paletteService.isOpen()" [disabled]="authService.isLoggingOut()" (click)="paletteService.open()">
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
                [disabled]="i18n.isLoading() || isChangingLanguage() || authService.isLoggingOut()"
                [attr.aria-busy]="isChangingLanguage()"
                (change)="changeLanguage($event)"
              >
                <option *ngFor="let lang of i18n.languages()" [value]="lang.code">
                  {{ lang.code.toUpperCase() }} — {{ lang.name }}
                </option>
              </select>
            </div>

            <!-- Theme Toggle -->
            <button type="button" class="icon-btn" [attr.aria-label]="'layout.app_shell.pereklyuchit_temu' | t" [attr.aria-pressed]="themeService.currentTheme() === 'dark'" [disabled]="authService.isLoggingOut()" (click)="themeService.toggleTheme()" [title]="(themeService.currentTheme() === 'light' ? 'common.dark_theme' : 'common.light_theme') | t">
              <span class="material-symbols-outlined" aria-hidden="true">
                {{ themeService.currentTheme() === 'light' ? 'dark_mode' : 'light_mode' }}
              </span>
            </button>

            <!-- Notification Bell -->
            <button *ngIf="canReadNotifications()" type="button" class="icon-btn notif-btn" routerLink="/notifications" [attr.aria-label]="'layout.app_shell.otkryt_uvedomleniya' | t" [attr.aria-describedby]="notifService.unreadCount() > 0 ? 'header-unread-count' : null" [disabled]="authService.isLoggingOut()" [title]="'nav.notifications' | t">
              <span class="material-symbols-outlined" aria-hidden="true">notifications</span>
              <span class="bell-dot" *ngIf="notifService.unreadCount() > 0" aria-hidden="true"></span>
              <span id="header-unread-count" class="sr-only" *ngIf="notifService.unreadCount() > 0">{{ 'layout.app_shell.unread_notifications' | t:{count: notifService.unreadCount()} }}</span>
            </button>

            <!-- Logout -->
            <button type="button" class="icon-btn logout-btn" [attr.aria-label]="'layout.app_shell.vyyti_iz_sistemy' | t" [disabled]="authService.isLoggingOut()" [attr.aria-busy]="authService.isLoggingOut()" (click)="onLogout()" [title]="'layout.app_shell.vyyti_iz_sistemy' | t">
              <span class="material-symbols-outlined" aria-hidden="true">{{ authService.isLoggingOut() ? 'hourglass_top' : 'logout' }}</span>
            </button>
          </div>
        </header>


        <!-- Active Announcement Banner -->
        <div *ngIf="canReadAnnouncements() && notifService.activeAnnouncement()" class="announcement-banner" role="status">
          <div class="announcement-content">
            <span class="material-symbols-outlined banner-icon" aria-hidden="true">campaign</span>
            <div class="banner-text">
              <strong>{{ notifService.activeAnnouncement()?.title }}</strong>
              <p class="banner-body">{{ notifService.activeAnnouncement()?.body }}</p>
            </div>
          </div>
          <button type="button" class="banner-close" [disabled]="isDismissingAnnouncement() || authService.isLoggingOut()" [attr.aria-label]="'layout.app_shell.zakryt_obyavlenie' | t" (click)="dismissAnnouncement()">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <!-- Page View Outlet -->
        <main id="main-content" class="page-content" tabindex="-1">
          <router-outlet></router-outlet>
        </main>
      </div>
    </div>

    <!-- Command Palette Modal -->
    <app-command-palette></app-command-palette>

    <!-- Global Toast Container -->
  `,
  styles: [`
    .skip-link {
      position: fixed;
      top: 8px;
      left: 8px;
      z-index: 3000;
      transform: translateY(-160%);
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-main);
      box-shadow: var(--shadow-overlay);
    }

    .skip-link:focus {
      transform: translateY(0);
    }

    .app-layout {
      display: flex;
      height: 100vh;
      width: 100vw;
      overflow: hidden;
    }

    /* Sidebar */
    .sidebar {
      width: 220px;
      height: 100%;
      background-color: var(--bg-sidebar);
      color: #94a3b8;
      display: flex;
      flex-direction: column;
      border-right: 1px solid rgba(255, 255, 255, 0.05);
      transition: width 0.15s ease-in-out;
      flex-shrink: 0;
    }

    .sidebar.collapsed {
      width: 60px;
    }

    .sidebar-header {
      height: 52px;
      padding: 0 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .brand-logo {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .brand-icon {
      width: 26px;
      height: 26px;
      background-color: var(--primary);
      color: #ffffff;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 14px;
    }

    .brand-name {
      font-size: 14px;
      font-weight: 600;
      color: #f8fafc;
    }

    .toggle-btn {
      background: transparent;
      border: none;
      color: #64748b;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      border-radius: var(--radius-sm);
    }
    .toggle-btn:hover {
      background-color: var(--bg-sidebar-hover);
      color: #ffffff;
    }

    .sidebar-nav {
      flex: 1;
      padding: 10px 8px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .nav-section-title {
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.5px;
      color: #94a3b8;
      padding: 10px 8px 4px 8px;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      color: #94a3b8;
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.1s ease;
      position: relative;
    }

    .nav-item:hover {
      background-color: var(--bg-sidebar-hover);
      color: #f1f5f9;
    }

    .nav-item.active {
      background-color: var(--bg-sidebar-active);
      color: #ffffff;
      font-weight: 600;
    }

    .nav-icon {
      font-size: 18px;
    }

    .unread-chip {
      margin-left: auto;
      background-color: var(--primary);
      color: #ffffff;
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 9999px;
    }

    .sidebar-footer {
      padding: 10px 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .user-profile-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 8px;
      border-radius: var(--radius-sm);
      text-decoration: none;
      color: #f1f5f9;
      transition: background-color 0.1s ease;
    }
    .user-profile-btn:hover, .user-profile-btn.active {
      background-color: var(--bg-sidebar-hover);
    }

    .avatar-circle {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background-color: var(--primary);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 12px;
      flex-shrink: 0;
    }

    .user-meta {
      overflow: hidden;
    }

    .user-name {
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .user-role {
      font-size: 11px;
      color: #94a3b8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Main Wrapper */
    .main-wrapper {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background-color: var(--bg-app);
    }


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

    .banner-text { min-width: 0; overflow-wrap: anywhere; color: var(--text-main); }
    .banner-body { margin: 4px 0 0; white-space: pre-wrap; font-weight: 400; }

    .banner-close {
      background: transparent;
      border: none;
      cursor: pointer;
      color: var(--info);
      display: flex;
      align-items: center;
    }

    .banner-close { flex-shrink: 0; width: 44px; height: 44px; justify-content: center; }
    .banner-close:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .banner-close:disabled { cursor: wait; opacity: 0.5; }

    .page-content {
      flex: 1;
      min-width: 0;
      overflow-y: auto;
      padding: 20px;
    }

    /* Mobile Drawer */
    .mobile-menu-btn {
      display: none;
    }

    .mobile-drawer-backdrop {
      display: none;
    }

    @media (max-width: 1023px) {
      .sidebar,
      .sidebar.collapsed {
        width: 60px;
      }

      .brand-logo,
      .nav-label,
      .nav-section-title,
      .user-meta,
      .unread-chip {
        display: none;
      }

      .palette-trigger {
        width: min(240px, 40vw);
      }
    }

    @media (max-width: 767px) {
      .mobile-menu-btn {
        display: inline-flex;
      }

      .mobile-drawer-backdrop {
        display: block;
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.6);
        backdrop-filter: blur(3px);
        z-index: 1100;
        animation: fadeIn 0.15s ease-out;
      }

      .sidebar {
        position: fixed;
        left: -260px;
        top: 0;
        bottom: 0;
        width: 250px !important;
        z-index: 1200;
        box-shadow: var(--shadow-overlay);
        transition: left 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .sidebar.mobile-open {
        left: 0;
      }

      .sidebar.mobile-open .brand-logo,
      .sidebar.mobile-open .nav-label,
      .sidebar.mobile-open .nav-section-title,
      .sidebar.mobile-open .user-meta,
      .sidebar.mobile-open .unread-chip {
        display: flex !important;
      }

      .topbar {
        padding-inline: 8px;
        gap: 4px;
      }

      .topbar-left, .topbar-right { gap: 4px; }
      .icon-btn { width: 44px; height: 44px; }
      .lang-icon { display: none; }
      .lang-select { width: 64px; height: 44px; padding: 4px 18px 4px 4px; font-size: 12px; }

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

      .page-content {
        padding: 12px;
        overflow-x: hidden;
      }
    }

  `]
})
export class AppShellComponent implements OnDestroy {
  private readonly uiI18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  readonly isCollapsed = signal<boolean>(false);
  readonly isMobileMenuOpen = signal<boolean>(false);
  readonly isChangingLanguage = signal(false);
  readonly isDismissingAnnouncement = signal(false);
  private readonly announcementRevision = signal(0);
  readonly canReadNotifications = computed(() => this.canViewNotifications());
  readonly canReadAnnouncements = computed(() => this.permService.canView('platform.announcements'));

  constructor(
    public authService: AuthService,
    public permService: PermissionService,
    public themeService: ThemeService,
    public i18n: I18nService,
    public notifService: NotificationService,
    public paletteService: CommandPaletteService,
    private router: Router
  ) {
    // Permissions arrive asynchronously after login. Start only the reads
    // allowed by the server contract, and cancel them when access changes.
    effect(onCleanup => {
      if (!this.canReadNotifications()) {
        this.notifService.unreadCount.set(0);
        return;
      }
      const request = this.notifService.fetchUnreadCount().subscribe({ error: () => {} });
      this.notifService.connectSse();
      onCleanup(() => {
        request.unsubscribe();
        this.notifService.disconnectSse();
        this.notifService.unreadCount.set(0);
      });
    });
    effect(onCleanup => {
      if (!this.canReadAnnouncements()) {
        this.notifService.activeAnnouncement.set(null);
        return;
      }
      this.announcementRevision();
      const request = this.notifService.fetchActiveAnnouncement(this.i18n.currentLang()).subscribe({ error: () => {} });
      onCleanup(() => {
        request.unsubscribe();
        this.notifService.activeAnnouncement.set(null);
      });
    });
  }

  ngOnDestroy() {
    this.notifService.resetSession();
  }

  toggleSidebar() {
    this.isCollapsed.update(v => !v);
  }

  toggleMobileMenu() {
    this.isMobileMenuOpen.update(v => !v);
  }

  closeMobileMenu() {
    this.isMobileMenuOpen.set(false);
  }

  isRouteActive(route: string, exact: boolean = false): boolean {
    return exact ? this.router.url === route : this.router.url.startsWith(route);
  }

  canViewTasks(): boolean {
    return this.permService.canView('tasks.items') || this.permService.canView('tasks');
  }

  canViewProjects(): boolean {
    return this.permService.canView('tasks.projects') || this.permService.canView('projects');
  }

  canViewAnalytics(): boolean {
    return this.permService.canView('analytics.dashboard') || this.permService.canView('analytics');
  }

  canViewUsers(): boolean {
    return this.permService.canView('iam.users') || this.permService.canView('md_users');
  }

  canViewRoles(): boolean {
    return this.permService.canView('rbac.roles') || this.permService.canView('iam.roles') || this.permService.canView('md_roles') || this.permService.canView('md.roles');
  }

  canViewCustomFields(): boolean {
    return this.permService.canView('md.custom_fields') || this.permService.canView('system.custom_fields') || this.permService.canView('md_custom_fields');
  }

  canViewSources(): boolean {
    return this.permService.canView('upl.sources');
  }

  canViewFiles(): boolean {
    return this.permService.canView('platform.files') || this.permService.canView('files');
  }

  canViewNotifications(): boolean {
    return this.permService.canView('notify.inbox') || this.permService.canView('notifications');
  }

  canViewAnnouncements(): boolean {
    return this.permService.canUpdate('platform.announcements');
  }

  canViewAudit(): boolean {
    return this.permService.canView('audit.log') ||
           this.permService.canView('audit.logs') ||
           this.permService.canView('audit');
  }

  canViewSettings(): boolean {
    return this.permService.canView('platform.settings') ||
           this.permService.canView('settings') ||
           true; // Базовые личные настройки (язык, тема, пароль) доступны всем аутентифицированным пользователям
  }

  canViewSystem(): boolean {
    return this.permService.canView('platform.settings');
  }



  getUserInitial(): string {
    const user = this.authService.currentUser();
    return user && user.name ? user.name.charAt(0).toUpperCase() : 'U';
  }

  asLang(l: string): Language {
    return l as Language;
  }

  dismissAnnouncement() {
    if (this.isDismissingAnnouncement() || this.authService.isLoggingOut()) return;
    const a = this.notifService.activeAnnouncement();
    if (a && a.id) {
      this.isDismissingAnnouncement.set(true);
      this.notifService.dismissAnnouncement(a.id).pipe(
        finalize(() => this.isDismissingAnnouncement.set(false))
      ).subscribe({
        next: () => this.announcementRevision.update(revision => revision + 1),
        error: () => {} // ApiService owns the single error message; keep the banner for retry.
      });
    }
  }

  changeLanguage(event: Event) {
    const select = event.target as HTMLSelectElement;
    if (this.isChangingLanguage() || this.i18n.isLoading() || this.authService.isLoggingOut()) {
      select.value = this.i18n.currentLang();
      return;
    }
    if (select.value === this.i18n.currentLang()) return;
    this.isChangingLanguage.set(true);
    this.i18n.setLanguage(select.value).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.isChangingLanguage.set(false))
    ).subscribe({
      error: () => {
        select.value = this.i18n.currentLang();
        if (!this.destroyRef.destroyed) this.toast.error(this.uiI18n.translate('layout.app_shell.language_change_failed'));
      }
    });
  }

  onLogout() {
    this.authService.logout();
  }
}
