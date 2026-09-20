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
import { AppHeaderComponent } from './components/app-header.component';
import { AppSidebarComponent } from './components/app-sidebar.component';
import { ToastService } from '../../core/services/toast.service';
import { ModuleService } from '../../core/services/module.service';
import { NavigationService } from '../../core/services/navigation.service';
import { finalize } from 'rxjs';

export type { NavItem, NavSection } from './app-shell.models';
import {
  NavItem,
  NavSection,
  buildNavSections,
  loadCollapsedSections,
  loadCollapsedState,
  COLLAPSED_STATE_KEY,
  COLLAPSED_SECTIONS_KEY,
  SECTION_ICON_MAP
} from './app-shell.models';
import { AppShellFlyoutService } from './services/app-shell-flyout.service';
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TranslatePipe,
    CommandPaletteComponent,
    AppHeaderComponent,
    AppSidebarComponent
  ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.css'
})
export class AppShellComponent implements OnDestroy {
  @ViewChild('mainContent') mainContent?: ElementRef<HTMLElement>;
  @ViewChild(AppHeaderComponent) appHeader?: AppHeaderComponent;
  get mobileMenuBtn(): ElementRef<HTMLButtonElement> | undefined {
    return this.appHeader?.mobileMenuBtn;
  }
  @ViewChild(AppSidebarComponent) appSidebar?: AppSidebarComponent;
  get sidebarElement(): ElementRef<HTMLElement> | undefined {
    return this.appSidebar?.sidebarElement;
  }
  get mobileDrawerClose(): ElementRef<HTMLButtonElement> | undefined {
    return this.appSidebar?.mobileDrawerClose;
  }

  readonly isSectionActiveFn = (section: NavSection) => this.isSectionActive(section);
  readonly isRouteActiveFn = (route: string, exact: boolean = false) => this.isRouteActive(route, exact);
  readonly getSectionIconFn = (id: string) => this.getSectionIcon(id);
  readonly getSectionBadgeFn = (section: NavSection) => this.getSectionBadge(section);
  readonly hasVisibleItemsFn = (section: NavSection) => this.hasVisibleItems(section);
  readonly isSectionExpandedFn = (id: string) => this.isSectionExpanded(id);
  readonly isSubmenuExpandedFn = (id: string) => this.isSubmenuExpanded(id);

  readonly sidebarId = 'app-sidebar';
  private readonly uiI18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breakpointObserver = inject(BreakpointObserver, { optional: true });

  private readonly COLLAPSED_STATE_KEY = COLLAPSED_STATE_KEY;
  readonly isCollapsed = signal<boolean>(loadCollapsedState());

  private readonly flyout = inject(AppShellFlyoutService);

  // Collapsed rail flyout popover
  readonly hoveredFlyoutSection = this.flyout.hoveredFlyoutSection;
  readonly hoveredFlyoutItem = this.flyout.hoveredFlyoutItem;
  readonly flyoutAnchorTop = this.flyout.flyoutAnchorTop;
  readonly isFlyoutVisible = this.flyout.isFlyoutVisible;
  readonly isProfileFlyoutVisible = this.flyout.isProfileFlyoutVisible;

  readonly isMobile = signal<boolean>(false);
  readonly isMobileMenuOpen = signal<boolean>(false);
  readonly isChangingLanguage = signal(false);
  readonly isDismissingAnnouncement = signal(false);
  private readonly announcementRevision = signal(0);
  readonly canReadNotifications = computed(() => this.canViewNotifications());
  readonly canReadAnnouncements = computed(() => this.permService.canView('platform.announcements'));

  private readonly COLLAPSED_SECTIONS_KEY = COLLAPSED_SECTIONS_KEY;
  readonly collapsedSections = signal<Set<string>>(loadCollapsedSections());
  readonly expandedSubmenus = signal<Set<string>>(new Set<string>());

  readonly navSections = computed<NavSection[]>(() => buildNavSections({
    activeCustomModules: this.moduleService.getActiveCustomModules(),
    customNavItems: this.navService.activeItems(),
    isNotesActive: this.moduleService.isModuleActive('notes'),
    canViewTasks: () => this.canViewTasks(),
    canViewProjects: () => this.canViewProjects(),
    canViewNotes: () => this.canViewNotes(),
    canViewFiles: () => this.canViewFiles(),
    canViewAnalytics: () => this.canViewAnalytics(),
    canViewNotifications: () => this.canViewNotifications(),
    canViewUsers: () => this.canViewUsers(),
    canViewRoles: () => this.canViewRoles(),
    canViewOrgUnits: () => this.canViewOrgUnits(),
    canViewCustomFields: () => this.canViewCustomFields(),
    canViewAnnouncements: () => this.canViewAnnouncements(),
    canViewModules: () => this.canViewModules(),
    canViewNavigationSettings: () => this.canViewNavigationSettings(),
    canViewAudit: () => this.canViewAudit(),
    canViewSystem: () => this.canViewSystem(),
    canViewSettings: () => this.canViewSettings(),
    unreadCount: () => this.notifService.unreadCount()
  }));

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


  onItemMouseEnter(section: NavSection, item: NavItem, event: MouseEvent) {
    this.flyout.onItemMouseEnter(section, item, event, this.isCollapsed(), this.isMobile());
  }

  onItemMouseLeave() {
    this.flyout.onItemMouseLeave();
  }

  onFlyoutMouseEnter() {
    this.flyout.onFlyoutMouseEnter();
  }

  onFlyoutMouseLeave() {
    this.flyout.onFlyoutMouseLeave();
  }

  closeFlyout() {
    this.flyout.closeFlyout();
  }

  onFlyoutItemClick() {
    this.flyout.onFlyoutItemClick(() => this.onNavClick());
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    this.flyout.onDocumentClick(event);
  }

  @HostListener('window:keydown.escape')
  onEscapeKey() {
    this.closeFlyout();
    this.closeProfileFlyout();
    this.closeMobileMenu(true);
  }

  onProfileMouseEnter(event: MouseEvent) {
    this.flyout.onProfileMouseEnter(event, this.isCollapsed(), this.isMobile());
  }

  onProfileMouseLeave() {
    this.flyout.onProfileMouseLeave();
  }

  onProfileFlyoutMouseEnter() {
    this.flyout.onProfileFlyoutMouseEnter();
  }

  onProfileFlyoutMouseLeave() {
    this.flyout.onProfileFlyoutMouseLeave();
  }

  closeProfileFlyout() {
    this.flyout.closeProfileFlyout();
  }

  onProfileFlyoutClick() {
    this.flyout.onProfileFlyoutClick(() => this.onNavClick());
  }

  onCategoryMouseEnter(section: NavSection, event: MouseEvent) {
    this.flyout.onCategoryMouseEnter(section, event, this.isCollapsed(), this.isMobile());
  }

  onCategoryMouseLeave() {
    this.flyout.onCategoryMouseLeave();
  }

  onCategoryClick(section: NavSection, event: MouseEvent) {
    this.flyout.onCategoryClick(section, event);
  }

  getSectionBadge(section: NavSection): number {
    return section.items.reduce((sum, item) => sum + (item.badge?.() || 0), 0);
  }

  getSectionIcon(sectionId?: string): string {
    return (sectionId && SECTION_ICON_MAP[sectionId]) || 'folder';
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

  canViewTasks = () => this.permService.canView('tasks.items') || this.permService.canView('tasks');
  canViewProjects = () => this.permService.canView('tasks.projects') || this.permService.canView('projects');
  canViewAnalytics = () => this.permService.canView('analytics.dashboard') || this.permService.canView('analytics');
  canViewUsers = () => this.permService.canView('iam.users') || this.permService.canView('md_users');
  canViewRoles = () => this.permService.canView('rbac.roles') || this.permService.canView('iam.roles') || this.permService.canView('md_roles') || this.permService.canView('md.roles');
  canViewOrgUnits = () => this.permService.canView('iam.org_units');
  canViewCustomFields = () => this.permService.canView('md.custom_fields') || this.permService.canView('system.custom_fields') || this.permService.canView('md_custom_fields');
  canViewFiles = () => this.permService.canView('platform.files') || this.permService.canView('files');
  canViewNotifications = () => this.permService.canView('notify.inbox') || this.permService.canView('notifications');
  canViewAnnouncements = () => this.permService.canUpdate('platform.announcements');
  canViewAudit = () => this.permService.canView('audit.log') || this.permService.canView('audit.logs') || this.permService.canView('audit');
  canViewSettings = () => true;
  canViewSystem = () => this.permService.canView('platform.settings');
  canViewNotes = () => this.permService.canView('notes') && this.moduleService.isModuleActive('notes');
  canViewModules = () => this.permService.canView('platform.modules');
  canViewNavigationSettings = () => this.permService.canView('platform.navigation');



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
