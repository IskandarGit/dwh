import { Component, DestroyRef, ElementRef, HostListener, OnDestroy, ViewChild, computed, effect, signal, inject } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
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
import { ModuleService } from '../../core/services/module.service';
import { NavigationService } from '../../core/services/navigation.service';
import { finalize } from 'rxjs';

export interface NavItem {
  id: string;
  route?: string;
  labelKey?: string;
  label?: string;
  titleKey?: string;
  icon: string;
  permission: () => boolean;
  exact?: boolean;
  badge?: () => number;
  children?: NavItem[];
  external?: boolean;
  targetUrl?: string;
  openInIframe?: boolean;
}

export interface NavSection {
  id: string;
  titleKey: string;
  items: NavItem[];
}

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
    <a class="skip-link" href="#main-content" (click)="skipToContent($event)">{{ 'layout.app_shell.pereyti_k_osnovnomu_soderzhimomu' | t }}</a>
    <div class="app-layout">
      <!-- Mobile Drawer Backdrop -->
      <div *ngIf="isMobile() && isMobileMenuOpen()" class="mobile-drawer-backdrop" (click)="closeMobileMenu(true)" aria-hidden="true"></div>

      <!-- Sidebar Slot (preserves flex-layout width during floating hover) -->
      <div class="sidebar-slot" [class.collapsed]="isCollapsed()">
        <!-- Sidebar -->
        <aside
          #sidebarElement
          [id]="sidebarId"
          class="sidebar"
          [class.collapsed]="isCollapsed()"
          [class.mobile-open]="isMobile() && isMobileMenuOpen()"
          [attr.role]="isMobile() && isMobileMenuOpen() ? 'dialog' : null"
          [attr.aria-modal]="isMobile() && isMobileMenuOpen() ? 'true' : null"
          [attr.aria-hidden]="isMobile() && !isMobileMenuOpen() ? 'true' : null"
          [attr.inert]="isMobile() && !isMobileMenuOpen() ? true : null"
        >
          <div class="sidebar-header">
            <div class="brand-logo" *ngIf="!isCollapsed() || isMobileMenuOpen()">
              <span class="brand-icon">S</span>
              <span class="brand-name">SmartupCMS</span>
            </div>
            <div class="brand-mark-collapsed" *ngIf="isCollapsed() && !isMobileMenuOpen()" [title]="'SmartupCMS'">
              <span class="brand-icon">S</span>
            </div>
            <button
              *ngIf="!isMobile()"
              type="button"
              class="toggle-btn"
              [class.pinned]="!isCollapsed()"
              (click)="toggleSidebar()"
              [attr.aria-label]="(isCollapsed() ? 'layout.app_shell.expand_navigation' : 'layout.app_shell.collapse_navigation') | t"
              [attr.aria-expanded]="!isCollapsed()"
              [title]="(isCollapsed() ? 'layout.app_shell.expand_navigation' : 'layout.app_shell.collapse_navigation') | t"
            >
              <span class="material-symbols-outlined" aria-hidden="true">{{ isCollapsed() ? 'chevron_right' : 'chevron_left' }}</span>
            </button>
            <button
              *ngIf="isMobile() && isMobileMenuOpen()"
              #mobileDrawerClose
              type="button"
              class="mobile-drawer-close"
              [attr.aria-label]="'common.close' | t"
              (click)="closeMobileMenu(true)"
            >
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>

          <nav class="sidebar-nav" [attr.aria-label]="'layout.app_shell.osnovnaya_navigaciya' | t" (click)="onNavClick()">
            <!-- Collapsed Mode: Categories Rail (Main Categories of the Menu) -->
            <div *ngIf="isCollapsed() && !isMobileMenuOpen()" class="rail-category-list">
              <ng-container *ngFor="let section of navSections()">
                <button
                  *ngIf="hasVisibleItems(section)"
                  type="button"
                  class="rail-category-btn"
                  [class.active]="isSectionActive(section)"
                  [class.open]="isFlyoutVisible() && hoveredFlyoutSection()?.id === section.id"
                  [attr.aria-label]="section.titleKey | t"
                  [attr.title]="section.titleKey | t"
                  (click)="onCategoryClick(section, $event)"
                  (mouseenter)="onCategoryMouseEnter(section, $event)"
                  (mouseleave)="onCategoryMouseLeave()"
                >
                  <span class="material-symbols-outlined rail-category-icon" aria-hidden="true">{{ getSectionIcon(section.id) }}</span>
                  <span class="rail-category-active-bar" *ngIf="isSectionActive(section)" aria-hidden="true"></span>
                  <span class="rail-category-badge" *ngIf="getSectionBadge(section) > 0">{{ getSectionBadge(section) }}</span>
                  <div class="nav-tooltip" role="tooltip">
                    <span>{{ section.titleKey | t }}</span>
                  </div>
                </button>
              </ng-container>
            </div>

            <!-- Expanded Mode / Mobile Drawer: Full Sections Hierarchy -->
            <ng-container *ngIf="!isCollapsed() || isMobileMenuOpen()">
              <ng-container *ngFor="let section of navSections(); let first = first">
                <button
                  type="button"
                  class="nav-section-header"
                  *ngIf="hasVisibleItems(section)"
                  (click)="toggleSection(section.id, $event)"
                  [attr.aria-expanded]="isSectionExpanded(section.id)"
                  [attr.aria-controls]="'section-content-' + section.id"
                  [attr.aria-label]="(isSectionExpanded(section.id) ? 'layout.app_shell.collapse_section' : 'layout.app_shell.expand_section') | t"
                >
                  <span class="nav-section-title">{{ section.titleKey | t }}</span>
                  <span class="section-active-dot" *ngIf="!isSectionExpanded(section.id) && isSectionActive(section)" [attr.title]="'common.active' | t"></span>
                  <span class="material-symbols-outlined section-chevron" [class.rotated]="!isSectionExpanded(section.id)" aria-hidden="true">expand_more</span>
                </button>
                <div
                  [id]="'section-content-' + section.id"
                  class="nav-section-content"
                  [class.collapsed]="!isSectionExpanded(section.id)"
                >
                  <ng-container *ngFor="let item of section.items">
                    <!-- Internal link item -->
                    <a
                      *ngIf="item.permission() && !item.children?.length && !item.external"
                      [routerLink]="item.route"
                      routerLinkActive="active"
                      [routerLinkActiveOptions]="{ exact: !!item.exact }"
                      [attr.aria-current]="item.route && isRouteActive(item.route, !!item.exact) ? 'page' : null"
                      class="nav-item"
                      [title]="item.label ? item.label : ((item.titleKey || item.labelKey!) | t)"
                    >
                      <span class="material-symbols-outlined nav-icon" aria-hidden="true">{{ item.icon }}</span>
                      <span class="nav-label">{{ item.label ? item.label : (item.labelKey! | t) }}</span>
                      <span class="unread-chip" *ngIf="item.badge && item.badge() > 0">
                        {{ item.badge() }}
                      </span>
                    </a>

                    <!-- External link item -->
                    <a
                      *ngIf="item.permission() && !item.children?.length && item.external"
                      [href]="item.targetUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="nav-item"
                      [title]="item.label ? item.label : ((item.titleKey || item.labelKey!) | t)"
                    >
                      <span class="material-symbols-outlined nav-icon" aria-hidden="true">{{ item.icon }}</span>
                      <span class="nav-label">{{ item.label ? item.label : (item.labelKey! | t) }}</span>
                      <span class="material-symbols-outlined sub-icon" style="margin-left: auto; font-size: 14px; opacity: 0.7;" aria-hidden="true">open_in_new</span>
                    </a>

                    <!-- Submenu parent -->
                    <div *ngIf="item.permission() && item.children?.length" class="nav-parent-group">
                      <button
                        type="button"
                        class="nav-item nav-parent-btn"
                        (click)="toggleSubmenu(item.id, $event)"
                        [attr.aria-expanded]="isSubmenuExpanded(item.id)"
                        [title]="item.label ? item.label : ((item.titleKey || item.labelKey!) | t)"
                      >
                        <span class="material-symbols-outlined nav-icon" aria-hidden="true">{{ item.icon }}</span>
                        <span class="nav-label">{{ item.label ? item.label : (item.labelKey! | t) }}</span>
                        <span class="material-symbols-outlined submenu-chevron" [class.rotated]="!isSubmenuExpanded(item.id)" aria-hidden="true">expand_more</span>
                      </button>

                      <div class="nav-submenu" *ngIf="isSubmenuExpanded(item.id)">
                        <ng-container *ngFor="let child of item.children">
                          <a
                            *ngIf="child.permission()"
                            [routerLink]="child.route"
                            routerLinkActive="active"
                            [routerLinkActiveOptions]="{ exact: !!child.exact }"
                            [attr.aria-current]="child.route && isRouteActive(child.route, !!child.exact) ? 'page' : null"
                            class="nav-item nav-subitem"
                            [title]="child.label ? child.label : ((child.titleKey || child.labelKey!) | t)"
                          >
                            <span class="material-symbols-outlined nav-icon sub-icon" aria-hidden="true">{{ child.icon }}</span>
                            <span class="nav-label">{{ child.label ? child.label : (child.labelKey! | t) }}</span>
                          </a>
                        </ng-container>
                      </div>
                    </div>
                  </ng-container>
                </div>
              </ng-container>
            </ng-container>
          </nav>

          <div class="sidebar-footer">
            <a
              routerLink="/iam/profile"
              routerLinkActive="active"
              [attr.aria-current]="isRouteActive('/iam/profile') ? 'page' : null"
              class="user-profile-btn"
              [title]="'nav.profile' | t"
              (mouseenter)="onProfileMouseEnter($event)"
              (mouseleave)="onProfileMouseLeave()"
              (click)="onNavClick()"
            >
              <div class="avatar-circle">
                {{ getUserInitial() }}
              </div>
              <div class="user-meta" *ngIf="!isCollapsed() || isMobileMenuOpen()">
                <div class="user-name">{{ authService.currentUser()?.name }}</div>
                <div class="user-role">&#64;{{ authService.currentUser()?.login }}</div>
              </div>
              <div class="nav-tooltip" *ngIf="isCollapsed() && !isMobile()" role="tooltip">
                <span>{{ authService.currentUser()?.name || ('nav.profile' | t) }}</span>
              </div>
            </a>
          </div>
        </aside>

        <!-- Collapsed Rail Flyout Popover (Opens next to hovered/clicked category) -->
        <div
          *ngIf="isCollapsed() && !isMobile() && isFlyoutVisible() && hoveredFlyoutSection() as section"
          class="rail-flyout-popover"
          [style.top.px]="flyoutAnchorTop()"
          (mouseenter)="onFlyoutMouseEnter()"
          (mouseleave)="onFlyoutMouseLeave()"
          role="menu"
          [attr.aria-label]="section.titleKey | t"
        >
          <div class="flyout-header">
            <span class="flyout-section-title">{{ section.titleKey | t }}</span>
          </div>
          <div class="flyout-body">
            <ng-container *ngFor="let item of section.items">
              <!-- Internal link item -->
              <a
                *ngIf="item.permission() && !item.children?.length && !item.external"
                [routerLink]="item.route"
                routerLinkActive="active"
                [routerLinkActiveOptions]="{ exact: !!item.exact }"
                class="flyout-item"
                (click)="onFlyoutItemClick()"
                role="menuitem"
              >
                <span class="material-symbols-outlined flyout-icon" aria-hidden="true">{{ item.icon }}</span>
                <span class="flyout-label">{{ item.label ? item.label : ((item.titleKey || item.labelKey!) | t) }}</span>
                <span class="unread-chip flyout-chip" *ngIf="item.badge && item.badge() > 0">
                  {{ item.badge() }}
                </span>
              </a>

              <!-- External link item -->
              <a
                *ngIf="item.permission() && !item.children?.length && item.external"
                [href]="item.targetUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="flyout-item"
                (click)="onFlyoutItemClick()"
                role="menuitem"
              >
                <span class="material-symbols-outlined flyout-icon" aria-hidden="true">{{ item.icon }}</span>
                <span class="flyout-label">{{ item.label ? item.label : ((item.titleKey || item.labelKey!) | t) }}</span>
                <span class="material-symbols-outlined flyout-ext-icon" aria-hidden="true">open_in_new</span>
              </a>

              <!-- Submenu group item -->
              <div *ngIf="item.permission() && item.children?.length" class="flyout-parent-group">
                <div class="flyout-item flyout-parent-header">
                  <span class="material-symbols-outlined flyout-icon" aria-hidden="true">{{ item.icon }}</span>
                  <span class="flyout-label">{{ item.label ? item.label : ((item.titleKey || item.labelKey!) | t) }}</span>
                </div>
                <div class="flyout-subitems">
                  <ng-container *ngFor="let child of item.children">
                    <a
                      *ngIf="child.permission()"
                      [routerLink]="child.route"
                      routerLinkActive="active"
                      [routerLinkActiveOptions]="{ exact: !!child.exact }"
                      class="flyout-item flyout-subitem"
                      (click)="onFlyoutItemClick()"
                      role="menuitem"
                    >
                      <span class="material-symbols-outlined flyout-icon sub-icon" aria-hidden="true">{{ child.icon }}</span>
                      <span class="flyout-label">{{ child.label ? child.label : (child.labelKey! | t) }}</span>
                    </a>
                  </ng-container>
                </div>
              </div>
            </ng-container>
          </div>
        </div>

        <!-- Collapsed Rail Profile Popover -->
        <div
          *ngIf="isCollapsed() && !isMobile() && isProfileFlyoutVisible()"
          class="rail-flyout-popover profile-flyout"
          [style.bottom.px]="12"
          (mouseenter)="onProfileFlyoutMouseEnter()"
          (mouseleave)="onProfileFlyoutMouseLeave()"
          role="menu"
        >
          <div class="flyout-header profile-flyout-header">
            <div class="flyout-user-name">{{ authService.currentUser()?.name }}</div>
            <div class="flyout-user-role font-mono">&#64;{{ authService.currentUser()?.login }}</div>
          </div>
          <div class="flyout-body">
            <a routerLink="/iam/profile" class="flyout-item" (click)="onProfileFlyoutClick()" role="menuitem">
              <span class="material-symbols-outlined flyout-icon">account_circle</span>
              <span class="flyout-label">{{ 'nav.profile' | t }}</span>
            </a>
            <a routerLink="/settings" class="flyout-item" (click)="onProfileFlyoutClick()" role="menuitem">
              <span class="material-symbols-outlined flyout-icon">settings</span>
              <span class="flyout-label">{{ 'nav.settings' | t }}</span>
            </a>
            <button type="button" class="flyout-item flyout-btn text-danger" (click)="onLogout()" role="menuitem">
              <span class="material-symbols-outlined flyout-icon">logout</span>
              <span class="flyout-label">{{ 'layout.app_shell.vyyti_iz_sistemy' | t }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Main Container -->
      <div class="main-wrapper" [attr.inert]="isMobile() && isMobileMenuOpen() ? true : null">
        <!-- Top Navigation -->
        <header class="topbar">
          <div class="topbar-left">
            <button
              #mobileMenuBtn
              type="button"
              class="icon-btn mobile-menu-btn"
              [attr.aria-label]="'layout.app_shell.otkryt_menyu_navigacii' | t"
              [attr.aria-expanded]="isMobileMenuOpen()"
              [attr.aria-controls]="sidebarId"
              (click)="toggleMobileMenu()"
            >
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
        <main id="main-content" #mainContent class="page-content" tabindex="-1">
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

    /* Collapsed Rail Categories */
    .brand-mark-collapsed {
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .rail-category-list {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 6px 0;
      width: 100%;
    }

    .rail-category-btn {
      position: relative;
      width: 44px;
      height: 44px;
      border-radius: 10px;
      background: transparent;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      cursor: pointer;
      transition: background-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
    }

    .rail-category-btn:hover,
    .rail-category-btn.open {
      background-color: var(--bg-sidebar-hover, rgba(255, 255, 255, 0.08));
      color: #ffffff;
    }

    .rail-category-btn.active {
      background-color: rgba(2, 132, 199, 0.18);
      color: #38bdf8;
    }

    .rail-category-btn.active .rail-category-icon {
      color: #38bdf8;
    }

    .rail-category-icon {
      font-size: 22px;
      line-height: 1;
    }

    .rail-category-active-bar {
      position: absolute;
      left: 0;
      top: 10px;
      bottom: 10px;
      width: 3px;
      border-radius: 0 3px 3px 0;
      background-color: var(--primary, #0284c7);
    }

    .rail-category-badge {
      position: absolute;
      top: 4px;
      right: 4px;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      border-radius: 8px;
      background-color: var(--danger, #ef4444);
      color: #ffffff;
      font-size: 10px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }

    /* Rail Flyout Popover (Floating card matching user screenshot) */
    .rail-flyout-popover {
      position: fixed;
      left: 64px;
      width: 240px;
      max-height: calc(100vh - 32px);
      background-color: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
      z-index: 1250;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      padding: 8px;
      animation: flyout-appear 0.14s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .rail-flyout-popover.profile-flyout {
      width: 220px;
    }

    @keyframes flyout-appear {
      from {
        opacity: 0;
        transform: translateX(-6px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    .flyout-header {
      padding: 6px 10px 8px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 4px;
    }

    .flyout-section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #94a3b8;
    }

    .profile-flyout-header {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .flyout-user-name {
      font-size: 13px;
      font-weight: 600;
      color: #f8fafc;
    }

    .flyout-user-role {
      font-size: 11px;
      color: #94a3b8;
    }

    .flyout-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .flyout-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 6px;
      color: #cbd5e1;
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.12s ease;
      cursor: pointer;
    }

    .flyout-btn {
      width: 100%;
      background: transparent;
      border: none;
      font-family: inherit;
      text-align: left;
    }

    .flyout-item:hover,
    .flyout-item.highlighted {
      background-color: rgba(255, 255, 255, 0.08);
      color: #ffffff;
    }

    .flyout-item.active {
      background-color: #0284c7 !important;
      color: #ffffff !important;
      font-weight: 600;
    }

    .flyout-item.active .flyout-icon {
      color: #ffffff !important;
      opacity: 1;
    }

    .flyout-icon {
      font-size: 18px;
      color: #94a3b8;
      opacity: 0.9;
      flex-shrink: 0;
    }

    .flyout-label {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .flyout-chip {
      margin-left: auto;
      font-size: 11px;
    }

    .flyout-ext-icon {
      font-size: 14px;
      margin-left: auto;
      opacity: 0.7;
    }

    .flyout-parent-group {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .flyout-parent-header {
      font-weight: 600;
      color: #94a3b8;
      pointer-events: none;
    }

    .flyout-subitems {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-left: 12px;
    }

    .flyout-subitem {
      font-size: 12px;
      padding: 6px 10px;
    }

    .text-danger {
      color: #f87171 !important;
    }
    .text-danger:hover {
      background-color: rgba(239, 68, 68, 0.15) !important;
      color: #fca5a5 !important;
    }

    .sidebar-slot:has(.rail-flyout-popover) .nav-tooltip {
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
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

    /* Sidebar Layout Slot: reserves space in document flow so page never jumps on hover-expand */
    .sidebar-slot {
      width: 220px;
      height: 100%;
      flex-shrink: 0;
      position: relative;
      transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .sidebar-slot.collapsed {
      width: 60px;
    }

    /* Sidebar */
    .sidebar {
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      width: 220px;
      height: 100%;
      background-color: var(--bg-sidebar);
      color: #94a3b8;
      display: flex;
      flex-direction: column;
      border-right: 1px solid rgba(255, 255, 255, 0.06);
      transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s ease, border-color 0.2s ease;
      z-index: 100;
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

    .toggle-btn,
    .mobile-drawer-close {
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
    .toggle-btn:hover,
    .mobile-drawer-close:hover {
      background-color: var(--bg-sidebar-hover);
      color: #ffffff;
    }

    .sidebar-divider {
      height: 1px;
      margin: 8px 6px;
      background: rgba(255, 255, 255, 0.08);
    }

    .sidebar-nav {
      flex: 1;
      padding: 10px 8px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .nav-section-header {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: transparent;
      border: none;
      padding: 8px 6px 4px 6px;
      cursor: pointer;
      text-align: left;
      border-radius: var(--radius-sm);
      transition: background-color 0.15s ease;
      color: inherit;
    }

    .nav-section-header:hover {
      background-color: var(--bg-sidebar-hover);
    }

    .nav-section-header:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 1px;
    }

    .nav-section-title {
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.5px;
      color: #94a3b8;
      padding: 0 4px;
      flex: 1;
    }

    .section-chevron {
      font-size: 16px;
      color: #64748b;
      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .section-chevron.rotated {
      transform: rotate(-90deg);
    }

    .section-active-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: var(--primary);
      margin-right: 6px;
      flex-shrink: 0;
    }

    .nav-section-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
      transition: max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
      max-height: 1200px;
      opacity: 1;
      overflow: hidden;
    }

    .nav-section-content.collapsed {
      max-height: 0;
      opacity: 0;
      pointer-events: none;
    }

    .nav-parent-group {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .nav-parent-btn {
      width: 100%;
      background: transparent;
      border: none;
      cursor: pointer;
      font-family: inherit;
      text-align: left;
    }

    .submenu-chevron {
      font-size: 16px;
      margin-left: auto;
      color: #64748b;
      transition: transform 0.2s ease;
    }

    .submenu-chevron.rotated {
      transform: rotate(-90deg);
    }

    .nav-submenu {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-left: 12px;
      margin-left: 14px;
      border-left: 1px solid rgba(255, 255, 255, 0.1);
    }

    .nav-subitem {
      font-size: 12px;
      padding: 6px 8px;
    }

    .sub-icon {
      font-size: 16px;
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
      transition: all 0.15s ease;
      position: relative;
      border-left: 3px solid transparent;
    }

    .nav-item:hover {
      background-color: var(--bg-sidebar-hover);
      color: #f1f5f9;
    }

    .nav-item.active {
      background-color: var(--bg-sidebar-active);
      border-left-color: var(--primary);
      color: #ffffff;
      font-weight: 600;
    }

    .sidebar.collapsed:not(.hover-expanded) .nav-item {
      justify-content: center;
      padding: 8px 0;
      border-left: none;
    }

    .toggle-btn.pinned {
      color: var(--primary);
    }

    .collapsed-badge-dot {
      position: absolute;
      top: 7px;
      right: 14px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: var(--primary);
      box-shadow: 0 0 0 2px var(--bg-sidebar);
    }

    .nav-tooltip {
      position: absolute;
      left: 64px;
      top: 50%;
      transform: translateY(-50%) translateX(-4px);
      background: #1e293b;
      color: #f8fafc;
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.1);
      transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s;
      z-index: 1200;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .nav-tooltip-badge {
      background: var(--primary);
      color: #ffffff;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 9999px;
    }

    .nav-item:hover .nav-tooltip,
    .nav-item:focus-visible .nav-tooltip,
    .user-profile-btn:hover .nav-tooltip {
      opacity: 1;
      visibility: visible;
      transform: translateY(-50%) translateX(0);
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
      .sidebar-slot {
        width: 60px;
      }

      .sidebar.collapsed:not(.hover-expanded) .brand-logo,
      .sidebar.collapsed:not(.hover-expanded) .nav-label,
      .sidebar.collapsed:not(.hover-expanded) .nav-section-title,
      .sidebar.collapsed:not(.hover-expanded) .user-meta,
      .sidebar.collapsed:not(.hover-expanded) .unread-chip {
        display: none;
      }

      .palette-trigger {
        width: min(240px, 40vw);
      }
    }

    @media (max-width: 767px) {
      .sidebar-slot {
        width: 0 !important;
      }

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
  @ViewChild('mainContent') mainContent?: ElementRef<HTMLElement>;
  @ViewChild('mobileMenuBtn') mobileMenuBtn?: ElementRef<HTMLButtonElement>;
  @ViewChild('sidebarElement') sidebarElement?: ElementRef<HTMLElement>;
  @ViewChild('mobileDrawerClose') mobileDrawerClose?: ElementRef<HTMLButtonElement>;

  readonly sidebarId = 'app-sidebar';
  private readonly uiI18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breakpointObserver = inject(BreakpointObserver, { optional: true });

  private readonly COLLAPSED_STATE_KEY = 'smartup_nav_sidebar_collapsed';
  readonly isCollapsed = signal<boolean>(this.loadCollapsedState());

  // Collapsed rail flyout popover
  readonly hoveredFlyoutSection = signal<NavSection | null>(null);
  readonly hoveredFlyoutItem = signal<NavItem | null>(null);
  readonly flyoutAnchorTop = signal<number>(0);
  readonly isFlyoutVisible = signal<boolean>(false);
  readonly isProfileFlyoutVisible = signal<boolean>(false);
  private flyoutOpenTimer: any = null;
  private flyoutCloseTimer: any = null;
  private profileFlyoutCloseTimer: any = null;
  private hoverTimeout: any = null;
  readonly isMobile = signal<boolean>(false);
  readonly isMobileMenuOpen = signal<boolean>(false);
  readonly isChangingLanguage = signal(false);
  readonly isDismissingAnnouncement = signal(false);
  private readonly announcementRevision = signal(0);
  readonly canReadNotifications = computed(() => this.canViewNotifications());
  readonly canReadAnnouncements = computed(() => this.permService.canView('platform.announcements'));

  private readonly COLLAPSED_SECTIONS_KEY = 'smartup_nav_collapsed_sections';
  readonly collapsedSections = signal<Set<string>>(this.loadCollapsedSections());
  readonly expandedSubmenus = signal<Set<string>>(new Set<string>());

  readonly navSections = computed<NavSection[]>(() => {
    const customItems: NavItem[] = this.moduleService.getActiveCustomModules().map(mod => ({
      id: `module-${mod.code}`,
      route: mod.route!,
      label: mod.name,
      icon: mod.icon || 'extension',
      permission: () => true
    }));

    const workspaceItems: NavItem[] = [
      { id: 'tasks', route: '/tasks', labelKey: 'nav.tasks', icon: 'task_alt', permission: () => this.canViewTasks(), exact: true },
      { id: 'projects', route: '/tasks/projects', labelKey: 'nav.projects', icon: 'folder', permission: () => this.canViewProjects() }
    ];

    if (this.moduleService.isModuleActive('notes')) {
      workspaceItems.push({
        id: 'notes',
        route: '/notes',
        labelKey: 'nav.notes',
        icon: 'description',
        permission: () => this.canViewNotes()
      });
    }

    workspaceItems.push(
      { id: 'files', route: '/files', labelKey: 'layout.app_shell.fayly', titleKey: 'files.faylovoe_hranilische', icon: 'folder_open', permission: () => this.canViewFiles() },
      { id: 'analytics', route: '/analytics', labelKey: 'layout.app_shell.analitika', titleKey: 'analytics.analitika_i_dashbordy', icon: 'insights', permission: () => this.canViewAnalytics() },
      { id: 'notifications', route: '/notifications', labelKey: 'nav.notifications', icon: 'notifications', permission: () => this.canViewNotifications(), badge: () => this.notifService.unreadCount() }
    );

    const sections: NavSection[] = [
      {
        id: 'workspace',
        titleKey: 'nav.section.workspace',
        items: workspaceItems
      }
    ];

    if (customItems.length > 0) {
      sections.push({
        id: 'custom-modules',
        titleKey: 'modules.title',
        items: customItems
      });
    }

    sections.push(
      {
        id: 'iam',
        titleKey: 'nav.section.iam',
        items: [
          { id: 'users', route: '/iam/users', labelKey: 'nav.users', icon: 'people', permission: () => this.canViewUsers() },
          { id: 'roles', route: '/iam/roles', labelKey: 'nav.roles', icon: 'security', permission: () => this.canViewRoles() },
          { id: 'org-units', route: '/iam/org-units', labelKey: 'iam.org_units.title', titleKey: 'iam.org_units.title', icon: 'account_tree', permission: () => this.canViewOrgUnits() },
          { id: 'custom-fields', route: '/iam/custom-fields', labelKey: 'nav.custom_fields', icon: 'tune', permission: () => this.canViewCustomFields() }
        ]
      },
      {
        id: 'administration',
        titleKey: 'nav.section.administration',
        items: [
          { id: 'announcements', route: '/announcements', labelKey: 'announcements.obyavleniya', titleKey: 'layout.app_shell.upravlenie_obyavleniyami', icon: 'campaign', permission: () => this.canViewAnnouncements() },
          { id: 'modules', route: '/settings/modules', labelKey: 'nav.modules', icon: 'extension', permission: () => this.canViewModules() },
          { id: 'navigation-settings', route: '/settings/navigation', labelKey: 'nav.navigation_settings', icon: 'menu_open', permission: () => this.canViewNavigationSettings() },
          { id: 'audit', route: '/audit', labelKey: 'nav.audit', titleKey: 'layout.app_shell.audit', icon: 'history', permission: () => this.canViewAudit() },
          { id: 'system', route: '/system', labelKey: 'layout.app_shell.sostoyanie', titleKey: 'system.sostoyanie_sistemy', icon: 'monitor_heart', permission: () => this.canViewSystem() },
          { id: 'settings', route: '/settings', labelKey: 'nav.settings', titleKey: 'layout.app_shell.nastroyki', icon: 'settings', permission: () => this.canViewSettings() }
        ]
      }
    );

    const customNavItems = this.navService.activeItems();
    if (customNavItems.length > 0) {
      const customReportItems: NavItem[] = [];

      for (const ci of customNavItems) {
        const navItem: NavItem = {
          id: `custom-nav-${ci.code}`,
          route: ci.targetType === 'EMBEDDED_IFRAME' ? `/embed/${ci.code}` : (ci.targetType === 'INTERNAL_ROUTE' ? ci.url : undefined),
          targetUrl: ci.targetType === 'EXTERNAL_LINK' ? ci.url : undefined,
          external: ci.targetType === 'EXTERNAL_LINK',
          openInIframe: ci.targetType === 'EMBEDDED_IFRAME',
          label: ci.title,
          icon: ci.icon || 'analytics',
          permission: () => true
        };

        const targetSection = sections.find(s => s.id === ci.sectionId);
        if (targetSection) {
          targetSection.items.push(navItem);
        } else {
          customReportItems.push(navItem);
        }
      }

      if (customReportItems.length > 0) {
        sections.splice(1, 0, {
          id: 'custom-reports',
          titleKey: 'nav.section.reports_and_services',
          items: customReportItems
        });
      }
    }

    return sections;
  });

  constructor(
    public authService: AuthService,
    public permService: PermissionService,
    public themeService: ThemeService,
    public i18n: I18nService,
    public notifService: NotificationService,
    public paletteService: CommandPaletteService,
    public moduleService: ModuleService,
    public navService: NavigationService,
    private router: Router
  ) {
    effect(() => {
      if (this.authService.currentUser()) {
        this.moduleService.loadActiveModules().subscribe({ error: () => {} });
        this.navService.loadActiveItems().subscribe({ error: () => {} });
      }
    });
    if (this.breakpointObserver) {
      this.breakpointObserver.observe('(max-width: 768px)')
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(result => {
          const wasMobile = this.isMobile();
          this.isMobile.set(result.matches);
          if (wasMobile && !result.matches) {
            if (this.isMobileMenuOpen()) {
              this.isMobileMenuOpen.set(false);
            }
            this.mainContent?.nativeElement?.focus();
            setTimeout(() => {
              this.mainContent?.nativeElement?.focus();
            }, 0);
          }
        });
    }

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

  @HostListener('keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (this.isFlyoutVisible() || this.isProfileFlyoutVisible()) {
        this.closeFlyout();
        this.closeProfileFlyout();
        return;
      }
    }
    if (this.isMobile() && this.isMobileMenuOpen()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closeMobileMenu(true);
      } else if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.code === 'KeyK' || event.key.toLowerCase() === 'k')) {
        this.isMobileMenuOpen.set(false);
        const opener = this.mobileMenuBtn?.nativeElement || document.querySelector('.mobile-menu-btn') as HTMLElement;
        if (opener) {
          opener.closest('.main-wrapper')?.removeAttribute('inert');
          opener.focus();
        }
      }
    }
  }

  ngOnDestroy() {
    this.notifService.resetSession();
  }

  skipToContent(event: MouseEvent) {
    event.preventDefault();
    this.mainContent?.nativeElement?.focus();
  }

  hasVisibleItems(section: NavSection): boolean {
    return section.items.some(item => item.permission());
  }

  private loadCollapsedSections(): Set<string> {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = localStorage.getItem(this.COLLAPSED_SECTIONS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            return new Set<string>(parsed);
          }
        }
      }
    } catch {
      // Ignore storage errors in test or restricted environments
    }
    return new Set<string>();
  }

  isSectionExpanded(sectionId: string): boolean {
    return !this.collapsedSections().has(sectionId);
  }

  toggleSection(sectionId: string, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.collapsedSections.update(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(this.COLLAPSED_SECTIONS_KEY, JSON.stringify([...next]));
        }
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }

  isSectionActive(section: NavSection): boolean {
    return section.items.some(item => {
      if (item.route && this.isRouteActive(item.route, !!item.exact)) return true;
      if (item.children) {
        return item.children.some(child => child.route && this.isRouteActive(child.route, !!child.exact));
      }
      return false;
    });
  }

  isSubmenuExpanded(itemId: string): boolean {
    return this.expandedSubmenus().has(itemId);
  }

  toggleSubmenu(itemId: string, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.expandedSubmenus.update(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  private loadCollapsedState(): boolean {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return localStorage.getItem(this.COLLAPSED_STATE_KEY) === 'true';
      }
    } catch {
      // Ignore in tests or restricted environments
    }
    return false;
  }

  onItemMouseEnter(section: NavSection, item: NavItem, event: MouseEvent) {
    if (!this.isCollapsed() || this.isMobile()) {
      return;
    }
    if (this.flyoutCloseTimer) {
      clearTimeout(this.flyoutCloseTimer);
      this.flyoutCloseTimer = null;
    }
    const target = (event.currentTarget || event.target) as HTMLElement;
    const rect = target.getBoundingClientRect();
    const top = Math.max(8, Math.min(rect.top - 4, (typeof window !== 'undefined' ? window.innerHeight : 800) - 340));

    this.flyoutOpenTimer = setTimeout(() => {
      this.closeProfileFlyout();
      this.hoveredFlyoutSection.set(section);
      this.hoveredFlyoutItem.set(item);
      this.flyoutAnchorTop.set(top);
      this.isFlyoutVisible.set(true);
    }, 80);
  }

  onItemMouseLeave() {
    if (this.flyoutOpenTimer) {
      clearTimeout(this.flyoutOpenTimer);
      this.flyoutOpenTimer = null;
    }
    this.flyoutCloseTimer = setTimeout(() => {
      this.closeFlyout();
    }, 180);
  }

  onFlyoutMouseEnter() {
    if (this.flyoutCloseTimer) {
      clearTimeout(this.flyoutCloseTimer);
      this.flyoutCloseTimer = null;
    }
  }

  onFlyoutMouseLeave() {
    this.flyoutCloseTimer = setTimeout(() => {
      this.closeFlyout();
    }, 150);
  }

  closeFlyout() {
    if (this.flyoutOpenTimer) {
      clearTimeout(this.flyoutOpenTimer);
      this.flyoutOpenTimer = null;
    }
    if (this.flyoutCloseTimer) {
      clearTimeout(this.flyoutCloseTimer);
      this.flyoutCloseTimer = null;
    }
    this.isFlyoutVisible.set(false);
    this.hoveredFlyoutSection.set(null);
    this.hoveredFlyoutItem.set(null);
  }

  onFlyoutItemClick() {
    this.closeFlyout();
    this.onNavClick();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.rail-flyout-popover') && !target.closest('.rail-category-btn') && !target.closest('.user-profile-btn')) {
      this.closeFlyout();
      this.closeProfileFlyout();
    }
  }

  @HostListener('window:keydown.escape')
  onEscapeKey() {
    this.closeFlyout();
    this.closeProfileFlyout();
    this.closeMobileMenu(true);
  }

  onProfileMouseEnter(event: MouseEvent) {
    if (!this.isCollapsed() || this.isMobile()) return;
    this.closeFlyout();
    this.isProfileFlyoutVisible.set(true);
  }

  onProfileMouseLeave() {
    this.profileFlyoutCloseTimer = setTimeout(() => {
      this.closeProfileFlyout();
    }, 180);
  }

  onProfileFlyoutMouseEnter() {
    if (this.profileFlyoutCloseTimer) {
      clearTimeout(this.profileFlyoutCloseTimer);
      this.profileFlyoutCloseTimer = null;
    }
  }

  onProfileFlyoutMouseLeave() {
    this.profileFlyoutCloseTimer = setTimeout(() => {
      this.closeProfileFlyout();
    }, 150);
  }

  closeProfileFlyout() {
    if (this.profileFlyoutCloseTimer) {
      clearTimeout(this.profileFlyoutCloseTimer);
      this.profileFlyoutCloseTimer = null;
    }
    this.isProfileFlyoutVisible.set(false);
  }

  onProfileFlyoutClick() {
    this.closeProfileFlyout();
    this.onNavClick();
  }

  onCategoryMouseEnter(section: NavSection, event: MouseEvent) {
    if (!this.isCollapsed() || this.isMobile()) return;
    if (this.flyoutOpenTimer) {
      clearTimeout(this.flyoutOpenTimer);
      this.flyoutOpenTimer = null;
    }
    if (this.flyoutCloseTimer) {
      clearTimeout(this.flyoutCloseTimer);
      this.flyoutCloseTimer = null;
    }
    const target = (event.currentTarget || event.target) as HTMLElement;
    const rect = target.getBoundingClientRect();
    const top = Math.max(8, Math.min(rect.top, (typeof window !== 'undefined' ? window.innerHeight : 800) - 340));

    this.flyoutOpenTimer = setTimeout(() => {
      this.closeProfileFlyout();
      this.hoveredFlyoutSection.set(section);
      this.flyoutAnchorTop.set(top);
      this.isFlyoutVisible.set(true);
    }, 60);
  }

  onCategoryMouseLeave() {
    if (this.flyoutOpenTimer) {
      clearTimeout(this.flyoutOpenTimer);
      this.flyoutOpenTimer = null;
    }
    this.flyoutCloseTimer = setTimeout(() => {
      this.closeFlyout();
    }, 180);
  }

  onCategoryClick(section: NavSection, event: MouseEvent) {
    event.stopPropagation();
    if (this.isFlyoutVisible() && this.hoveredFlyoutSection()?.id === section.id) {
      this.closeFlyout();
    } else {
      if (this.flyoutOpenTimer) {
        clearTimeout(this.flyoutOpenTimer);
        this.flyoutOpenTimer = null;
      }
      if (this.flyoutCloseTimer) {
        clearTimeout(this.flyoutCloseTimer);
        this.flyoutCloseTimer = null;
      }
      const target = (event.currentTarget || event.target) as HTMLElement;
      const rect = target.getBoundingClientRect();
      const top = Math.max(8, Math.min(rect.top, (typeof window !== 'undefined' ? window.innerHeight : 800) - 340));
      this.closeProfileFlyout();
      this.hoveredFlyoutSection.set(section);
      this.flyoutAnchorTop.set(top);
      this.isFlyoutVisible.set(true);
    }
  }

  getSectionBadge(section: NavSection): number {
    return section.items.reduce((sum, item) => {
      const b = item.badge ? item.badge() : 0;
      return sum + (typeof b === 'number' ? b : 0);
    }, 0);
  }

  getSectionIcon(sectionId?: string): string {
    switch (sectionId) {
      case 'workspace': return 'space_dashboard';
      case 'iam': return 'manage_accounts';
      case 'administration': return 'tune';
      case 'custom-modules': return 'extension';
      case 'custom-reports': return 'analytics';
      default: return 'folder';
    }
  }

  private saveCollapsedState(collapsed: boolean): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(this.COLLAPSED_STATE_KEY, String(collapsed));
      }
    } catch {
      // Ignore
    }
  }

  toggleSidebar() {
    this.isCollapsed.update(v => {
      const next = !v;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(this.COLLAPSED_STATE_KEY, String(next));
        }
      } catch {
        // Ignore
      }
      return next;
    });
    this.closeFlyout();
    this.closeProfileFlyout();
  }


  toggleMobileMenu() {
    if (this.isMobileMenuOpen()) {
      this.closeMobileMenu(true);
    } else {
      this.openMobileMenu();
    }
  }

  openMobileMenu() {
    this.isMobileMenuOpen.set(true);
    setTimeout(() => {
      const closeBtn = this.sidebarElement?.nativeElement?.querySelector<HTMLElement>('.mobile-drawer-close');
      if (closeBtn) {
        closeBtn.focus();
      } else {
        this.sidebarElement?.nativeElement?.querySelector<HTMLElement>('button, a[href]')?.focus();
      }
    }, 0);
  }

  closeMobileMenu(restoreFocus: boolean = true) {
    if (!this.isMobileMenuOpen()) return;
    this.isMobileMenuOpen.set(false);
    const opener = this.mobileMenuBtn?.nativeElement;
    if (opener) {
      opener.closest('.main-wrapper')?.removeAttribute('inert');
      if (restoreFocus) {
        opener.focus();
        setTimeout(() => {
          opener.focus();
        }, 0);
      }
    }
  }

  onNavClick() {
    if (this.isMobileMenuOpen()) {
      this.closeMobileMenu(false);
    }
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

  canViewOrgUnits(): boolean {
    return this.permService.canView('iam.org_units');
  }

  canViewCustomFields(): boolean {
    return this.permService.canView('md.custom_fields') || this.permService.canView('system.custom_fields') || this.permService.canView('md_custom_fields');
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

  canViewNotes(): boolean {
    return this.permService.canView('notes') && this.moduleService.isModuleActive('notes');
  }

  canViewModules(): boolean {
    return this.permService.canView('platform.modules');
  }

  canViewNavigationSettings(): boolean {
    return this.permService.canView('platform.navigation');
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
