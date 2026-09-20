import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { NavItem, NavSection } from '../app-shell.models';
import { AppSidebarNavSectionsComponent } from './app-sidebar-nav-sections.component';
import { AppSidebarFlyoutComponent } from './app-sidebar-flyout.component';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TranslatePipe,
    AppSidebarNavSectionsComponent,
    AppSidebarFlyoutComponent
  ],
  template: `
    <!-- Mobile Drawer Backdrop -->
    <div *ngIf="isMobile && isMobileMenuOpen" class="mobile-drawer-backdrop" (click)="closeMobileMenu.emit(true)" aria-hidden="true"></div>

    <!-- Sidebar Slot (preserves flex-layout width during floating hover) -->
    <div class="sidebar-slot" [class.collapsed]="isCollapsed">
      <!-- Sidebar -->
      <aside
        #sidebarElement
        [id]="sidebarId"
        class="sidebar"
        [class.collapsed]="isCollapsed"
        [class.mobile-open]="isMobile && isMobileMenuOpen"
        [attr.role]="isMobile && isMobileMenuOpen ? 'dialog' : null"
        [attr.aria-modal]="isMobile && isMobileMenuOpen ? 'true' : null"
        [attr.aria-hidden]="isMobile && !isMobileMenuOpen ? 'true' : null"
        [attr.inert]="isMobile && !isMobileMenuOpen ? true : null"
      >
        <div class="sidebar-header">
          <div class="brand-logo" *ngIf="!isCollapsed || isMobileMenuOpen">
            <span class="brand-icon">S</span>
            <span class="brand-name">SmartupCMS</span>
          </div>
          <div class="brand-mark-collapsed" *ngIf="isCollapsed && !isMobileMenuOpen" [title]="'SmartupCMS'">
            <span class="brand-icon">S</span>
          </div>
          <button
            *ngIf="!isMobile"
            type="button"
            class="toggle-btn"
            [class.pinned]="!isCollapsed"
            (click)="toggleSidebar.emit()"
            [attr.aria-label]="(isCollapsed ? 'layout.app_shell.expand_navigation' : 'layout.app_shell.collapse_navigation') | t"
            [attr.aria-expanded]="!isCollapsed"
            [title]="(isCollapsed ? 'layout.app_shell.expand_navigation' : 'layout.app_shell.collapse_navigation') | t"
          >
            <span class="material-symbols-outlined" aria-hidden="true">{{ isCollapsed ? 'chevron_right' : 'chevron_left' }}</span>
          </button>
          <button
            *ngIf="isMobile && isMobileMenuOpen"
            #mobileDrawerClose
            type="button"
            class="mobile-drawer-close"
            [attr.aria-label]="'common.close' | t"
            (click)="closeMobileMenu.emit(true)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <nav class="sidebar-nav" [attr.aria-label]="'layout.app_shell.osnovnaya_navigaciya' | t" (click)="onNavClick.emit()">
          <!-- Collapsed Mode: Categories Rail (Main Categories of the Menu) -->
          <div *ngIf="isCollapsed && !isMobileMenuOpen" class="rail-category-list">
            <ng-container *ngFor="let section of navSections">
              <button
                *ngIf="hasVisibleItems(section)"
                type="button"
                class="rail-category-btn"
                [class.active]="isSectionActive(section)"
                [class.open]="isFlyoutVisible && hoveredFlyoutSection?.id === section.id"
                [attr.aria-label]="section.titleKey | t"
                [attr.title]="section.titleKey | t"
                (click)="categoryClick.emit({ section: section, event: $event })"
                (mouseenter)="categoryMouseEnter.emit({ section: section, event: $event })"
                (mouseleave)="categoryMouseLeave.emit()"
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
          <app-sidebar-nav-sections
            *ngIf="!isCollapsed || isMobileMenuOpen"
            [navSections]="navSections"
            [hasVisibleItems]="hasVisibleItems"
            [isSectionExpanded]="isSectionExpanded"
            [isSectionActive]="isSectionActive"
            [isSubmenuExpanded]="isSubmenuExpanded"
            [isRouteActive]="isRouteActive"
            (toggleSection)="toggleSection.emit($event)"
            (toggleSubmenu)="toggleSubmenu.emit($event)"
          ></app-sidebar-nav-sections>
        </nav>

        <div class="sidebar-footer">
          <a
            routerLink="/iam/profile"
            routerLinkActive="active"
            [attr.aria-current]="isRouteActive('/iam/profile') ? 'page' : null"
            class="user-profile-btn"
            [title]="'nav.profile' | t"
            (mouseenter)="profileMouseEnter.emit($event)"
            (mouseleave)="profileMouseLeave.emit()"
            (click)="onNavClick.emit()"
          >
            <div class="avatar-circle">
              {{ getUserInitial() }}
            </div>
            <div class="user-meta" *ngIf="!isCollapsed || isMobileMenuOpen">
              <div class="user-name">{{ currentUser?.name }}</div>
              <div class="user-role font-mono">&#64;{{ currentUser?.login }}</div>
            </div>
            <div class="nav-tooltip" *ngIf="isCollapsed && !isMobile" role="tooltip">
              <span>{{ currentUser?.name || ('nav.profile' | t) }}</span>
            </div>
          </a>
        </div>
      </aside>

      <!-- Collapsed Rail Flyouts (Section Popover + Profile Popover) -->
      <app-sidebar-flyout
        [isCollapsed]="isCollapsed"
        [isMobile]="isMobile"
        [isFlyoutVisible]="isFlyoutVisible"
        [hoveredFlyoutSection]="hoveredFlyoutSection"
        [flyoutAnchorTop]="flyoutAnchorTop"
        [isProfileFlyoutVisible]="isProfileFlyoutVisible"
        [currentUser]="currentUser"
        (flyoutMouseEnter)="flyoutMouseEnter.emit()"
        (flyoutMouseLeave)="flyoutMouseLeave.emit()"
        (flyoutItemClick)="flyoutItemClick.emit()"
        (profileFlyoutMouseEnter)="profileFlyoutMouseEnter.emit()"
        (profileFlyoutMouseLeave)="profileFlyoutMouseLeave.emit()"
        (profileFlyoutClick)="profileFlyoutClick.emit()"
        (logout)="logout.emit()"
      ></app-sidebar-flyout>
    </div>
  `,
  styleUrl: './app-sidebar.component.css'
})
export class AppSidebarComponent {
  @ViewChild('sidebarElement') sidebarElement?: ElementRef<HTMLElement>;
  @ViewChild('mobileDrawerClose') mobileDrawerClose?: ElementRef<HTMLButtonElement>;

  @Input() sidebarId = 'app-sidebar';
  @Input() isMobile = false;
  @Input() isMobileMenuOpen = false;
  @Input() isCollapsed = false;
  @Input() navSections: NavSection[] = [];
  @Input() isFlyoutVisible = false;
  @Input() hoveredFlyoutSection: NavSection | null = null;
  @Input() flyoutAnchorTop = 0;
  @Input() isProfileFlyoutVisible = false;
  @Input() currentUser: any = null;

  @Input() isSectionActive!: (section: NavSection) => boolean;
  @Input() isRouteActive!: (route: string, exact?: boolean) => boolean;
  @Input() getSectionIcon!: (id: string) => string;
  @Input() getSectionBadge!: (section: NavSection) => number;
  @Input() hasVisibleItems!: (section: NavSection) => boolean;
  @Input() isSectionExpanded!: (sectionId: string) => boolean;
  @Input() isSubmenuExpanded!: (itemId: string) => boolean;

  @Output() toggleSidebar = new EventEmitter<void>();
  @Output() closeMobileMenu = new EventEmitter<boolean>();
  @Output() onNavClick = new EventEmitter<void>();
  @Output() toggleSection = new EventEmitter<{ id: string, event: MouseEvent }>();
  @Output() toggleSubmenu = new EventEmitter<{ id: string, event: MouseEvent }>();
  @Output() categoryClick = new EventEmitter<{ section: NavSection, event: MouseEvent }>();
  @Output() categoryMouseEnter = new EventEmitter<{ section: NavSection, event: MouseEvent }>();
  @Output() categoryMouseLeave = new EventEmitter<void>();
  @Output() profileMouseEnter = new EventEmitter<MouseEvent>();
  @Output() profileMouseLeave = new EventEmitter<void>();
  @Output() flyoutMouseEnter = new EventEmitter<void>();
  @Output() flyoutMouseLeave = new EventEmitter<void>();
  @Output() flyoutItemClick = new EventEmitter<void>();
  @Output() profileFlyoutMouseEnter = new EventEmitter<void>();
  @Output() profileFlyoutMouseLeave = new EventEmitter<void>();
  @Output() profileFlyoutClick = new EventEmitter<void>();
  @Output() logout = new EventEmitter<void>();

  getUserInitial(): string {
    const user = this.currentUser;
    return user && user.name ? user.name.charAt(0).toUpperCase() : 'U';
  }
}
