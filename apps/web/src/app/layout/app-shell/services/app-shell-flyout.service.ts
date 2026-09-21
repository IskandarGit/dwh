import { Injectable, signal } from '@angular/core';
import { NavItem, NavSection } from '../app-shell.models';

@Injectable({ providedIn: 'root' })
export class AppShellFlyoutService {
  readonly hoveredFlyoutSection = signal<NavSection | null>(null);
  readonly hoveredFlyoutItem = signal<NavItem | null>(null);
  readonly flyoutAnchorTop = signal<number>(0);
  readonly isFlyoutVisible = signal<boolean>(false);
  readonly isProfileFlyoutVisible = signal<boolean>(false);

  private flyoutOpenTimer: any = null;
  private flyoutCloseTimer: any = null;
  private profileFlyoutCloseTimer: any = null;

  onItemMouseEnter(section: NavSection, item: NavItem, event: MouseEvent, isCollapsed: boolean, isMobile: boolean) {
    if (!isCollapsed || isMobile) return;
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

  onFlyoutItemClick(onNavClick: () => void) {
    this.closeFlyout();
    onNavClick();
  }

  onProfileMouseEnter(event: MouseEvent, isCollapsed: boolean, isMobile: boolean) {
    if (!isCollapsed || isMobile) return;
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

  onProfileFlyoutClick(onNavClick: () => void) {
    this.closeProfileFlyout();
    onNavClick();
  }

  onCategoryMouseEnter(section: NavSection, event: MouseEvent, isCollapsed: boolean, isMobile: boolean) {
    if (!isCollapsed || isMobile) return;
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

  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.rail-flyout-popover') && !target.closest('.rail-category-btn') && !target.closest('.user-profile-btn')) {
      this.closeFlyout();
      this.closeProfileFlyout();
    }
  }
}
