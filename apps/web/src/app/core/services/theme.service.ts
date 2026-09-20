import { Injectable, signal, effect } from '@angular/core';

export type ThemeMode = 'light' | 'dark';
export type ThemePreference = 'light' | 'dark' | 'system';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  readonly themePreference = signal<ThemePreference>(this.getInitialPreference());
  readonly currentTheme = signal<ThemeMode>(this.resolveEffectiveTheme(this.getInitialPreference()));

  constructor() {
    effect(() => {
      const pref = this.themePreference();
      const resolved = this.resolveEffectiveTheme(pref);
      this.currentTheme.set(resolved);
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', resolved);
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dwh_theme', pref);
      }
    });

    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => {
        if (this.themePreference() === 'system') {
          const resolved = mediaQuery.matches ? 'dark' : 'light';
          this.currentTheme.set(resolved);
          if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('data-theme', resolved);
          }
        }
      };
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', listener);
      } else if ((mediaQuery as any).addListener) {
        (mediaQuery as any).addListener(listener);
      }
    }
  }

  toggleTheme() {
    const next: ThemeMode = this.currentTheme() === 'light' ? 'dark' : 'light';
    this.themePreference.set(next);
  }

  setTheme(theme: ThemePreference | ThemeMode) {
    this.themePreference.set(theme);
  }

  private resolveEffectiveTheme(pref: ThemePreference): ThemeMode {
    if (pref === 'dark') return 'dark';
    if (pref === 'light') return 'light';
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }

  private getInitialPreference(): ThemePreference {
    if (typeof localStorage === 'undefined') return 'light';
    const saved = localStorage.getItem('dwh_theme');
    if (saved === 'dark' || saved === 'light' || saved === 'system') {
      return saved;
    }
    return 'light';
  }
}
