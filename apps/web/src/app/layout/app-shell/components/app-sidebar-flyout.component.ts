import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { NavSection } from '../app-shell.models';

@Component({
  selector: 'app-sidebar-flyout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TranslatePipe
  ],
  template: `
    <!-- Collapsed Rail Flyout Popover (Opens next to hovered/clicked category) -->
    <div
      *ngIf="isCollapsed && !isMobile && isFlyoutVisible && hoveredFlyoutSection as section"
      class="rail-flyout-popover"
      [style.top.px]="flyoutAnchorTop"
      (mouseenter)="flyoutMouseEnter.emit()"
      (mouseleave)="flyoutMouseLeave.emit()"
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
            (click)="flyoutItemClick.emit()"
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
            (click)="flyoutItemClick.emit()"
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
                  (click)="flyoutItemClick.emit()"
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
      *ngIf="isCollapsed && !isMobile && isProfileFlyoutVisible"
      class="rail-flyout-popover profile-flyout"
      [style.bottom.px]="12"
      (mouseenter)="profileFlyoutMouseEnter.emit()"
      (mouseleave)="profileFlyoutMouseLeave.emit()"
      role="menu"
    >
      <div class="flyout-header profile-flyout-header">
        <div class="flyout-user-name">{{ currentUser?.name }}</div>
        <div class="flyout-user-role font-mono">&#64;{{ currentUser?.login }}</div>
      </div>
      <div class="flyout-body">
        <a routerLink="/iam/profile" class="flyout-item" (click)="profileFlyoutClick.emit()" role="menuitem">
          <span class="material-symbols-outlined flyout-icon">account_circle</span>
          <span class="flyout-label">{{ 'nav.profile' | t }}</span>
        </a>
        <a routerLink="/settings" class="flyout-item" (click)="profileFlyoutClick.emit()" role="menuitem">
          <span class="material-symbols-outlined flyout-icon">settings</span>
          <span class="flyout-label">{{ 'nav.settings' | t }}</span>
        </a>
        <button type="button" class="flyout-item flyout-btn text-danger" (click)="logout.emit()" role="menuitem">
          <span class="material-symbols-outlined flyout-icon">logout</span>
          <span class="flyout-label">{{ 'layout.app_shell.vyyti_iz_sistemy' | t }}</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: contents;
    }

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
      background-color: var(--primary);
      color: #ffffff;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 8px;
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

    .font-mono {
      font-family: monospace;
    }
  `]
})
export class AppSidebarFlyoutComponent {
  @Input() isCollapsed = false;
  @Input() isMobile = false;
  @Input() isFlyoutVisible = false;
  @Input() hoveredFlyoutSection: NavSection | null = null;
  @Input() flyoutAnchorTop = 0;
  @Input() isProfileFlyoutVisible = false;
  @Input() currentUser: any = null;

  @Output() flyoutMouseEnter = new EventEmitter<void>();
  @Output() flyoutMouseLeave = new EventEmitter<void>();
  @Output() flyoutItemClick = new EventEmitter<void>();
  @Output() profileFlyoutMouseEnter = new EventEmitter<void>();
  @Output() profileFlyoutMouseLeave = new EventEmitter<void>();
  @Output() profileFlyoutClick = new EventEmitter<void>();
  @Output() logout = new EventEmitter<void>();
}
