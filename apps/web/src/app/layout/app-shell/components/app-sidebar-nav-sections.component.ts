import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { NavSection } from '../app-shell.models';

@Component({
  selector: 'app-sidebar-nav-sections',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TranslatePipe
  ],
  template: `
    <ng-container *ngFor="let section of navSections; let first = first">
      <button
        type="button"
        class="nav-section-header"
        *ngIf="hasVisibleItems(section)"
        (click)="toggleSection.emit({ id: section.id, event: $event })"
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
              (click)="toggleSubmenu.emit({ id: item.id, event: $event })"
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
  `,
  styles: [`
    :host {
      display: contents;
    }

    .nav-section-header {
      width: 100%;
      background: transparent;
      border: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 10px 4px 10px;
      margin-top: 6px;
      cursor: pointer;
      text-align: left;
      font-family: inherit;
      border-radius: var(--radius-sm);
    }
    .nav-section-header:hover {
      background-color: rgba(255, 255, 255, 0.03);
    }

    .nav-section-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #64748b;
      flex: 1;
    }

    .section-active-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background-color: var(--primary);
      margin-right: 6px;
      flex-shrink: 0;
    }

    .section-chevron {
      font-size: 16px;
      color: #64748b;
      transition: transform 0.2s ease;
      line-height: 1;
    }
    .section-chevron.rotated {
      transform: rotate(-90deg);
    }

    .nav-section-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow: hidden;
      transition: max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
      max-height: 1000px;
      opacity: 1;
    }
    .nav-section-content.collapsed {
      max-height: 0;
      opacity: 0;
      pointer-events: none;
    }

    .nav-item {
      position: relative;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 10px;
      border-radius: var(--radius-sm);
      color: var(--text-sidebar);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: background-color 0.12s, color 0.12s;
      white-space: nowrap;
      cursor: pointer;
    }

    .nav-item:hover {
      background-color: var(--bg-sidebar-hover);
      color: #ffffff;
    }

    .nav-item.active {
      background-color: var(--primary);
      color: #ffffff;
      font-weight: 600;
    }

    .nav-icon {
      font-size: 18px;
      line-height: 1;
      opacity: 0.85;
      flex-shrink: 0;
    }
    .nav-item.active .nav-icon {
      opacity: 1;
    }

    .nav-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .unread-chip {
      background-color: var(--primary);
      color: #ffffff;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 8px;
      margin-left: auto;
    }
    .nav-item.active .unread-chip {
      background-color: rgba(255, 255, 255, 0.25);
    }

    .sub-icon {
      font-size: 15px;
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
      font-family: inherit;
      text-align: left;
    }

    .submenu-chevron {
      font-size: 16px;
      margin-left: auto;
      transition: transform 0.2s ease;
      line-height: 1;
    }
    .submenu-chevron.rotated {
      transform: rotate(-90deg);
    }

    .nav-submenu {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-left: 28px;
    }

    .nav-subitem {
      font-size: 12px;
      padding: 6px 10px;
    }
  `]
})
export class AppSidebarNavSectionsComponent {
  @Input() navSections: NavSection[] = [];
  @Input() hasVisibleItems!: (section: NavSection) => boolean;
  @Input() isSectionExpanded!: (sectionId: string) => boolean;
  @Input() isSectionActive!: (section: NavSection) => boolean;
  @Input() isSubmenuExpanded!: (itemId: string) => boolean;
  @Input() isRouteActive!: (route: string, exact?: boolean) => boolean;

  @Output() toggleSection = new EventEmitter<{ id: string, event: MouseEvent }>();
  @Output() toggleSubmenu = new EventEmitter<{ id: string, event: MouseEvent }>();
}
