import { signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/services/auth.service';
import { CommandPaletteService } from '../../core/services/command-palette.service';
import { I18nService } from '../../core/services/i18n.service';
import { NotificationService } from '../../core/services/notification.service';
import { PermissionService } from '../../core/services/permission.service';
import { ThemeService } from '../../core/services/theme.service';
import { ModuleService, InstalledModule } from '../../core/services/module.service';
import { NavigationService } from '../../core/services/navigation.service';
import { CustomNavigationItem } from '../../core/models/navigation.models';
import { AppShellComponent } from './app-shell.component';
import { translateTest } from '../../../testing/i18n-test.stub';

describe('AppShellComponent', () => {
  const viewport = new BehaviorSubject({ matches: false, breakpoints: {} });
  const authService = {
    currentUser: signal({ name: 'Иван Иванов', login: 'ivan' }),
    isLoggingOut: signal(false),
    logout: vi.fn()
  };
  const permissionService = {
    canView: vi.fn((_form: string) => true),
    canUpdate: vi.fn((_form: string) => true)
  };
  const themeService = {
    currentTheme: signal('light'),
    toggleTheme: vi.fn()
  };
  const i18nService = {
    currentLang: signal('ru'),
    isLoading: signal(false),
    languages: signal([
      { code: 'ru', name: 'Русский' },
      { code: 'uz', name: "O‘zbekcha" },
      { code: 'en', name: 'English' },
      { code: 'de', name: 'Deutsch' },
      { code: 'tr', name: 'Türkçe' }
    ]),
    setLanguage: vi.fn(() => of(undefined)),
    translate: translateTest
  };
  const notificationService = {
    unreadCount: signal(3),
    activeAnnouncement: signal(null),
    fetchUnreadCount: vi.fn(() => of(3)),
    fetchActiveAnnouncement: vi.fn(() => of(null)),
    connectSse: vi.fn(),
    disconnectSse: vi.fn(),
    resetSession: vi.fn(),
    dismissAnnouncement: vi.fn(() => of(undefined))
  };
  const paletteService = {
    isOpen: signal(false),
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
    search: vi.fn(() => of({ query: '', totalHits: 0, hits: [] }))
  };
  const activeCodes = signal<Set<string>>(new Set(['notes']));
  const moduleService = {
    isModuleActive: vi.fn((code: string) => activeCodes().has(code)),
    getActiveCustomModules: vi.fn((): InstalledModule[] => []),
    loadActiveModules: vi.fn(() => of([]))
  };
  const navigationService = {
    activeItems: signal<CustomNavigationItem[]>([]),
    isLoading: signal(false),
    loadActiveItems: vi.fn(() => of([])),
    loadAllItems: vi.fn(() => of([])),
    getItemById: vi.fn(() => of(null)),
    getItemByCode: vi.fn(() => of(null)),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    toggleItem: vi.fn(),
    deleteItem: vi.fn()
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    viewport.next({ matches: false, breakpoints: {} });
    paletteService.isOpen.set(false);
    paletteService.open.mockImplementation(() => paletteService.isOpen.set(true));
    paletteService.close.mockImplementation(() => paletteService.isOpen.set(false));
    paletteService.toggle.mockImplementation(() => paletteService.isOpen.update(open => !open));
    notificationService.unreadCount.set(3);
    permissionService.canView.mockImplementation((_form: string) => true);
    permissionService.canUpdate.mockImplementation((_form: string) => true);
    activeCodes.set(new Set(['notes']));
    moduleService.isModuleActive.mockImplementation((code: string) => activeCodes().has(code));
    moduleService.getActiveCustomModules.mockReturnValue([]);
    navigationService.activeItems.set([]);
    navigationService.loadActiveItems.mockReturnValue(of([]));
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([]),
        { provide: BreakpointObserver, useValue: { observe: () => viewport.asObservable() } },
        { provide: AuthService, useValue: authService },
        { provide: PermissionService, useValue: permissionService },
        { provide: ThemeService, useValue: themeService },
        { provide: I18nService, useValue: i18nService },
        { provide: NotificationService, useValue: notificationService },
        { provide: CommandPaletteService, useValue: paletteService },
        { provide: ModuleService, useValue: moduleService },
        { provide: NavigationService, useValue: navigationService }
      ]
    }).compileComponents();
  });

  it('offers a skip link and a named main landmark', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('a.skip-link[href="#main-content"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('main#main-content')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('nav[aria-label="Основная навигация"]')).not.toBeNull();
  });

  it('uses the SmartupCMS brand and exposes local administration routes', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('SmartupCMS');
    expect(fixture.nativeElement.textContent).not.toContain('DWH Platform');
    expect(fixture.nativeElement.querySelector('a[href="/announcements"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/system"]')).not.toBeNull();
  });

  it('names icon-only shell actions without relying on title', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('button[aria-label="Переключить тему"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('button[aria-label="Открыть уведомления"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('button[aria-label="Выйти из системы"]')).not.toBeNull();
  });

  it('exposes language selection and unread count to assistive technology', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    const selector = fixture.nativeElement.querySelector('#app-language-selector') as HTMLSelectElement;
    expect(selector.getAttribute('aria-label')).toBe('Язык интерфейса');
    expect(Array.from(selector.options).map(option => option.value))
      .toEqual(['ru', 'uz', 'en', 'de', 'tr']);
    expect(fixture.nativeElement.querySelector('.notif-btn .sr-only')?.textContent).toContain('3');
  });

  it('focuses this page content and cancels base-relative navigation when skipping the shell', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    fixture.nativeElement.querySelector('.skip-link').dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('main'));
  });

  it('excludes the closed mobile sidebar from interaction but keeps desktop navigation available', () => {
    viewport.next({ matches: true, breakpoints: {} });
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    const sidebar = fixture.nativeElement.querySelector('.sidebar') as HTMLElement;
    expect(sidebar.hasAttribute('inert')).toBe(true);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');

    viewport.next({ matches: false, breakpoints: {} });
    fixture.detectChanges();
    expect(sidebar.hasAttribute('inert')).toBe(false);
    expect(sidebar.getAttribute('aria-hidden')).toBeNull();
    expect(sidebar.getAttribute('aria-modal')).toBeNull();
  });

  it('opens mobile navigation with focus inside and an inactive background', async () => {
    viewport.next({ matches: true, breakpoints: {} });
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    const opener = fixture.nativeElement.querySelector('.mobile-menu-btn') as HTMLButtonElement;
    opener.focus();
    opener.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const sidebar = fixture.nativeElement.querySelector('.sidebar') as HTMLElement;
    expect(sidebar.contains(document.activeElement)).toBe(true);
    expect(sidebar.getAttribute('role')).toBe('dialog');
    expect(sidebar.getAttribute('aria-modal')).toBe('true');
    expect(sidebar.hasAttribute('inert')).toBe(false);
    expect(fixture.nativeElement.querySelector('.main-wrapper').hasAttribute('inert')).toBe(true);
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    expect(opener.getAttribute('aria-controls')).toBe(sidebar.id);
  });

  it.each(['button', 'Escape', 'backdrop'])('closes mobile navigation via %s and restores focus without collapsing desktop', async via => {
    viewport.next({ matches: true, breakpoints: {} });
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    const opener = fixture.nativeElement.querySelector('.mobile-menu-btn') as HTMLButtonElement;
    opener.focus();
    opener.click();
    fixture.detectChanges();
    await fixture.whenStable();

    if (via === 'button') fixture.nativeElement.querySelector('.mobile-drawer-close')?.click();
    if (via === 'backdrop') fixture.nativeElement.querySelector('.mobile-drawer-backdrop')?.click();
    if (via === 'Escape') document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.sidebar.mobile-open')).toBeNull();
    expect(fixture.componentInstance.isCollapsed()).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(fixture.nativeElement.querySelector('.main-wrapper').hasAttribute('inert')).toBe(false);
    expect(opener.getAttribute('aria-expanded')).toBe('false');
  });

  it('clears the mobile overlay when resizing to desktop and does not reopen it on return', async () => {
    viewport.next({ matches: true, breakpoints: {} });
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.mobile-menu-btn').click();
    fixture.detectChanges();
    await fixture.whenStable();

    viewport.next({ matches: false, breakpoints: {} });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.mobile-drawer-backdrop')).toBeNull();
    expect(fixture.nativeElement.querySelector('.main-wrapper').hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('main'));

    viewport.next({ matches: true, breakpoints: {} });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sidebar.mobile-open')).toBeNull();
  });

  it('hands mobile drawer focus to search without competing dialogs and returns it to the visible opener', async () => {
    viewport.next({ matches: true, breakpoints: {} });
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.autoDetectChanges();
    const opener = fixture.nativeElement.querySelector('.mobile-menu-btn') as HTMLButtonElement;
    opener.focus();
    opener.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const shortcut = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(shortcut);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(shortcut.defaultPrevented).toBe(true);
    expect(fixture.nativeElement.querySelector('.sidebar.mobile-open')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.palette-input'));

    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
  });

  it('shows the organization link only for iam.org_units view and keeps its navigation semantics', () => {
    permissionService.canView.mockReturnValue(false);
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.canViewOrgUnits()).toBe(false);
    expect(fixture.nativeElement.querySelector('a[href="/iam/org-units"]')).toBeNull();

    permissionService.canView.mockImplementation(form => form === 'iam.users');
    fixture.detectChanges();
    expect(fixture.componentInstance.canViewOrgUnits()).toBe(false);
    expect(fixture.nativeElement.querySelector('a[href="/iam/org-units"]')).toBeNull();

    fixture.destroy();
    permissionService.canView.mockImplementation(form => form === 'iam.org_units');
    vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue('/iam/org-units');
    const allowedFixture = TestBed.createComponent(AppShellComponent);
    allowedFixture.detectChanges();
    const link = allowedFixture.nativeElement.querySelector('a[href="/iam/org-units"]') as HTMLAnchorElement;
    expect(allowedFixture.componentInstance.canViewOrgUnits()).toBe(true);
    expect(link.title).toBe('Оргструктура');
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(link.querySelector('.nav-label')?.textContent).toContain('Оргструктура');

    allowedFixture.componentInstance.isCollapsed.set(true);
    allowedFixture.detectChanges();
    expect(allowedFixture.nativeElement.querySelector('a[href="/iam/org-units"]')).toBeNull();

    allowedFixture.componentInstance.isCollapsed.set(false);
    allowedFixture.componentInstance.isMobileMenuOpen.set(true);
    allowedFixture.detectChanges();
    expect(allowedFixture.nativeElement.querySelector('a[href="/iam/org-units"] .nav-label')).not.toBeNull();
    (allowedFixture.nativeElement.querySelector('a[href="/iam/org-units"]') as HTMLAnchorElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    allowedFixture.detectChanges();
    expect(allowedFixture.componentInstance.isMobileMenuOpen()).toBe(false);
  });

  it('declares typed navigation sections and renders dividers in collapsed desktop rail mode', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    const sections = fixture.componentInstance.navSections();
    expect(sections).toHaveLength(3);
    expect(sections.map(s => s.id)).toEqual(['workspace', 'iam', 'administration']);

    // Check items per section
    const workspaceSection = sections.find(s => s.id === 'workspace');
    expect(workspaceSection?.items.map(i => i.id)).toEqual([
      'tasks', 'projects', 'notes', 'files', 'analytics', 'notifications'
    ]);

    const iamSection = sections.find(s => s.id === 'iam');
    expect(iamSection?.items.map(i => i.id)).toEqual([
      'users', 'roles', 'org-units', 'custom-fields'
    ]);

    const adminSection = sections.find(s => s.id === 'administration');
    expect(adminSection?.items.map(i => i.id)).toEqual([
      'announcements', 'modules', 'navigation-settings', 'audit', 'system', 'settings'
    ]);

    // Initially expanded: section titles visible, no collapsed category buttons
    expect(fixture.nativeElement.querySelectorAll('.nav-section-title').length).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelectorAll('.rail-category-btn')).toHaveLength(0);

    // Toggle to collapsed rail mode: titles hidden, category buttons rendered
    fixture.componentInstance.toggleSidebar();
    fixture.detectChanges();
    expect(fixture.componentInstance.isCollapsed()).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('.nav-section-title')).toHaveLength(0);
    expect(fixture.nativeElement.querySelectorAll('.rail-category-btn').length).toBeGreaterThan(0);

    // Toggle back to expanded
    fixture.componentInstance.toggleSidebar();
    fixture.detectChanges();
    expect(fixture.componentInstance.isCollapsed()).toBe(false);
    expect(fixture.nativeElement.querySelectorAll('.rail-category-btn')).toHaveLength(0);
  });

  it('hides module link from navigation when module is disabled and shows when enabled', () => {
    activeCodes.set(new Set(['notes']));
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('a[href="/notes"]')).not.toBeNull();

    // Disable notes module
    activeCodes.set(new Set());
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('a[href="/notes"]')).toBeNull();
  });

  it('renders custom active modules dynamically in the navigation sidebar', () => {
    moduleService.getActiveCustomModules.mockReturnValue([
      {
        code: 'crm',
        name: 'CRM & Deals',
        version: '1.0.0',
        route: '/crm',
        icon: 'handshake',
        isSystem: false,
        status: 'ACTIVE',
        isActive: true
      }
    ]);
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    const crmLink = fixture.nativeElement.querySelector('a[href="/crm"]');
    expect(crmLink).not.toBeNull();
    expect(crmLink?.textContent).toContain('CRM & Deals');
  });

  it('collapses and expands navigation sections when header is clicked', () => {
    localStorage.removeItem('smartup_nav_collapsed_sections');
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    const headers = fixture.nativeElement.querySelectorAll('.nav-section-header');
    expect(headers.length).toBeGreaterThan(0);

    const firstHeader = headers[0] as HTMLButtonElement;
    expect(firstHeader.getAttribute('aria-expanded')).toBe('true');
    const firstContent = fixture.nativeElement.querySelector('#section-content-workspace');
    expect(firstContent?.classList.contains('collapsed')).toBe(false);

    // Click to collapse
    firstHeader.click();
    fixture.detectChanges();

    expect(firstHeader.getAttribute('aria-expanded')).toBe('false');
    expect(firstContent?.classList.contains('collapsed')).toBe(true);

    // Click again to expand
    firstHeader.click();
    fixture.detectChanges();

    expect(firstHeader.getAttribute('aria-expanded')).toBe('true');
    expect(firstContent?.classList.contains('collapsed')).toBe(false);
  });

  it('restores collapsed section state from localStorage', () => {
    localStorage.setItem('smartup_nav_collapsed_sections', JSON.stringify(['iam']));
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.isSectionExpanded('iam')).toBe(false);
    expect(fixture.componentInstance.isSectionExpanded('workspace')).toBe(true);

    const iamContent = fixture.nativeElement.querySelector('#section-content-iam');
    expect(iamContent?.classList.contains('collapsed')).toBe(true);

    localStorage.removeItem('smartup_nav_collapsed_sections');
  });

  it('shows active indicator dot on collapsed section when current route belongs to it', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    // Mock active route check
    vi.spyOn(fixture.componentInstance, 'isRouteActive').mockImplementation((route: string) => route === '/tasks');

    // Collapse workspace section
    fixture.componentInstance.toggleSection('workspace');
    fixture.detectChanges();

    const workspaceHeader = fixture.nativeElement.querySelector('.nav-section-header');
    const dot = workspaceHeader?.querySelector('.section-active-dot');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute('title')).toBe('Активен');
  });

  it('renders custom reports navigation section when active custom items exist', () => {
    navigationService.activeItems.set([
      {
        id: 1,
        code: 'superset-sales',
        title: 'Отчет по продажам (Superset)',
        sectionId: 'custom-reports',
        icon: 'bar-chart',
        targetType: 'EMBEDDED_IFRAME',
        url: 'https://superset.example.com/superset/dashboard/sales/',
        openInIframe: true,
        sortOrder: 10,
        state: 'A',
        createdAt: '2026-09-09T10:00:00Z',
        modifiedAt: '2026-09-09T10:00:00Z'
      }
    ]);
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    const sections = fixture.componentInstance.navSections();
    const reportsSection = sections.find(s => s.id === 'custom-reports');
    expect(reportsSection).toBeDefined();
    expect(reportsSection?.items).toHaveLength(1);
    expect(reportsSection?.items[0].route).toBe('/embed/superset-sales');
    expect(reportsSection?.items[0].label).toBe('Отчет по продажам (Superset)');
  });
  it('keeps sidebar collapsed without expanding on hover, displaying category rail buttons', () => {
    localStorage.removeItem('smartup_nav_sidebar_collapsed');
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.isCollapsed()).toBe(false);

    // Collapse it
    comp.toggleSidebar();
    fixture.detectChanges();
    expect(comp.isCollapsed()).toBe(true);

    const sidebar = fixture.nativeElement.querySelector('.sidebar') as HTMLElement;
    expect(sidebar.classList.contains('collapsed')).toBe(true);
    expect(sidebar.classList.contains('hover-expanded')).toBe(false);

    // Collapsed rail displays category buttons
    const categoryButtons = fixture.nativeElement.querySelectorAll('.rail-category-btn');
    expect(categoryButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders tooltips for nav items when collapsed', () => {
    localStorage.removeItem('smartup_nav_sidebar_collapsed');
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    // When expanded, no tooltip elements in DOM
    expect(fixture.nativeElement.querySelectorAll('.nav-tooltip')).toHaveLength(0);

    // Collapse sidebar
    fixture.componentInstance.toggleSidebar();
    fixture.detectChanges();
    expect(fixture.componentInstance.isCollapsed()).toBe(true);

    // Tooltips are rendered for items
    const tooltips = fixture.nativeElement.querySelectorAll('.nav-tooltip');
    expect(tooltips.length).toBeGreaterThan(0);
  });

  it('restores sidebar collapsed state from localStorage', () => {
    localStorage.setItem('smartup_nav_sidebar_collapsed', 'true');
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.isCollapsed()).toBe(true);

    localStorage.removeItem('smartup_nav_sidebar_collapsed');
  });

  it('displays rail flyout popover on hover in collapsed mode and dismisses on Escape or item click', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.isCollapsed.set(true);
    fixture.detectChanges();

    const sections = comp.navSections();
    const iamSection = sections.find(s => s.id === 'iam')!;
    const usersItem = iamSection.items[0];

    // Trigger item mouse enter
    comp.onItemMouseEnter(iamSection, usersItem, {
      currentTarget: { getBoundingClientRect: () => ({ top: 150 }) }
    } as any);

    // Fast-forward or trigger visibility
    comp.isFlyoutVisible.set(true);
    comp.hoveredFlyoutSection.set(iamSection);
    comp.hoveredFlyoutItem.set(usersItem);
    fixture.detectChanges();

    const flyout = fixture.nativeElement.querySelector('.rail-flyout-popover');
    expect(flyout).not.toBeNull();
    expect(flyout.textContent).toContain('Команда и доступ');
    expect(flyout.querySelectorAll('.flyout-item').length).toBe(iamSection.items.length);

    // Pressing Escape dismisses the flyout
    const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    comp.handleKeyDown(escEvent);
    fixture.detectChanges();

    expect(comp.isFlyoutVisible()).toBe(false);
  });

  it('supports category rail icons and floating flyout popover when collapsed', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.isCollapsed.set(true);
    fixture.detectChanges();

    // Rail should display category buttons
    const categoryButtons = fixture.nativeElement.querySelectorAll('.rail-category-btn');
    expect(categoryButtons.length).toBeGreaterThanOrEqual(1);

    expect(comp.isFlyoutVisible()).toBe(false);
    expect(fixture.nativeElement.querySelector('.rail-flyout-popover:not(.profile-flyout)')).toBeNull();

    const iamSection = comp.navSections().find(s => s.id === 'iam')!;

    // Open flyout by clicking category button in collapsed rail
    const dummyEvent = {
      stopPropagation: () => {},
      currentTarget: categoryButtons[0],
      target: categoryButtons[0]
    } as any;
    comp.onCategoryClick(iamSection, dummyEvent);
    fixture.detectChanges();

    expect(comp.isFlyoutVisible()).toBe(true);
    expect(comp.hoveredFlyoutSection()?.id).toBe('iam');

    const flyout = fixture.nativeElement.querySelector('.rail-flyout-popover:not(.profile-flyout)');
    expect(flyout).not.toBeNull();
    expect(flyout.textContent).toContain('Команда и доступ');
    expect(flyout.querySelectorAll('.flyout-item').length).toBe(iamSection.items.length);

    // Switch category to administration
    const adminSection = comp.navSections().find(s => s.id === 'administration')!;
    comp.onCategoryClick(adminSection, dummyEvent);
    fixture.detectChanges();

    expect(comp.hoveredFlyoutSection()?.id).toBe('administration');
    expect(flyout.textContent).toContain('Администрирование');

    // Press Escape to dismiss flyout
    const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    comp.handleKeyDown(escEvent);
    fixture.detectChanges();

    expect(comp.isFlyoutVisible()).toBe(false);
    expect(fixture.nativeElement.querySelector('.rail-flyout-popover:not(.profile-flyout)')).toBeNull();
  });

  it('closes flyout on document click outside', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.isCollapsed.set(true);
    const workspaceSection = comp.navSections().find(s => s.id === 'workspace')!;
    comp.hoveredFlyoutSection.set(workspaceSection);
    comp.isFlyoutVisible.set(true);
    fixture.detectChanges();

    expect(comp.isFlyoutVisible()).toBe(true);

    const outsideDiv = document.createElement('div');
    document.body.appendChild(outsideDiv);
    comp.onDocumentClick({ target: outsideDiv } as any);
    document.body.removeChild(outsideDiv);
    fixture.detectChanges();

    expect(comp.isFlyoutVisible()).toBe(false);
  });

  it('displays profile flyout on hover at footer when collapsed', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.isCollapsed.set(true);
    comp.onProfileMouseEnter({} as any);
    fixture.detectChanges();

    expect(comp.isProfileFlyoutVisible()).toBe(true);
    const profileFlyout = fixture.nativeElement.querySelector('.rail-flyout-popover.profile-flyout');
    expect(profileFlyout).not.toBeNull();
    expect(profileFlyout.textContent).toContain('Иван Иванов');

    comp.onProfileFlyoutClick();
    fixture.detectChanges();
    expect(comp.isProfileFlyoutVisible()).toBe(false);
  });
});
