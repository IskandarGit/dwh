import { Component, DestroyRef, ElementRef, HostListener, OnDestroy, ViewChild, effect, signal, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { A11yModule } from '@angular/cdk/a11y';
import { Router } from '@angular/router';
import { CommandPaletteService } from '../../core/services/command-palette.service';
import { ModuleService } from '../../core/services/module.service';
import { SearchHit, SearchResult } from '../../core/models/search.models';
import { searchTarget } from '../../core/services/search-target';
import { EMPTY, Subject, catchError, of, switchMap, timer } from 'rxjs';
import { TranslatePipe, I18nService } from '../../core/services/i18n.service';

import {
  RECENT_SEARCHES_STORAGE_KEY,
  MAX_RECENT_SEARCHES,
  CategoryItem
} from './command-palette.models';
import { CommandPaletteResultsComponent } from './components/command-palette-results.component';
import { CommandPaletteFooterComponent } from './components/command-palette-footer.component';

export {
  RECENT_SEARCHES_STORAGE_KEY,
  MAX_RECENT_SEARCHES,
  type CategoryItem
};

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    FormsModule,
    A11yModule,
    CommandPaletteResultsComponent,
    CommandPaletteFooterComponent
  ],
  template: `
    <div *ngIf="paletteService.isOpen()" class="palette-backdrop" (click)="onBackdropClick($event)">
      <div
        class="palette-dialog"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
      >
        <h2 class="sr-only" [id]="titleId">{{ 'layout.command_palette.globalnyy_poisk' | t }}</h2>

        <!-- Search Header Box -->
        <div class="palette-search-box">
          <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
          <label class="sr-only" [for]="inputId">{{ 'layout.command_palette.poisk_zadach_proektov_i_polzovateley' | t }}</label>
          <input
            #searchInput
            [id]="inputId"
            type="text"
            class="palette-input"
            role="combobox"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            aria-autocomplete="list"
            [attr.aria-expanded]="results().length > 0"
            [attr.aria-controls]="results().length > 0 ? listboxId : null"
            [attr.aria-activedescendant]="results().length > 0 ? optionId(selectedIndex) : null"
            [placeholder]="'layout.command_palette.poisk_zadach_proektov_polzovateley_esc_dlya_zakr' | t"
            [(ngModel)]="searchQuery"
            (ngModelChange)="onSearchChange($event)"
          />
          <button
            *ngIf="searchQuery"
            type="button"
            class="palette-clear-btn"
            [attr.aria-label]="'search.clear_query' | t"
            (click)="clearQuery()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">cancel</span>
          </button>
          <kbd class="esc-badge" aria-hidden="true">ESC</kbd>
          <button
            type="button"
            class="palette-close"
            [attr.aria-label]="'layout.command_palette.close_search' | t"
            (click)="paletteService.close()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <!-- Category Filters -->
        <div class="palette-category">
          <label for="search-category" class="sr-only">{{ 'search.category' | t }}</label>
          <select id="search-category" class="sr-only" [(ngModel)]="entityType" (ngModelChange)="onSearchChange(searchQuery)">
            <option value="ALL">{{ 'search.entity.all' | t }}</option>
            <option value="TASK">{{ 'nav.tasks' | t }}</option>
            <option value="PROJECT">{{ 'nav.projects' | t }}</option>
            <option value="USER">{{ 'nav.users' | t }}</option>
            <option *ngIf="moduleService.isModuleActive('notes')" value="NOTE">{{ 'search.entity.note' | t }}</option>
          </select>
          <div class="category-pills" role="tablist" [attr.aria-label]="'search.category' | t">
            <button
              *ngFor="let cat of categories()"
              type="button"
              class="cat-pill"
              [class.active]="entityType === cat.value"
              (click)="setCategory(cat.value)"
            >
              <span class="material-symbols-outlined pill-icon" aria-hidden="true">{{ cat.icon }}</span>
              <span>{{ cat.label | t }}</span>
            </button>
          </div>
        </div>

        <!-- Did you mean suggestion -->
        <div *ngIf="metadata()?.suggestedQuery && metadata()?.suggestedQuery !== searchQuery" class="palette-suggestion">
          <span class="material-symbols-outlined suggestion-icon" aria-hidden="true">lightbulb</span>
          <span class="suggestion-label">{{ 'search.did_you_mean' | t }}:</span>
          <button type="button" class="suggestion-btn" (click)="applySuggestion(metadata()!.suggestedQuery!)">
            {{ metadata()!.suggestedQuery }}
          </button>
        </div>

        <!-- Results / States Container -->
        <app-command-palette-results
          [isLoading]="isLoading()"
          [errorMessage]="errorMessage()"
          [retrySeconds]="retrySeconds()"
          [searchQuery]="searchQuery"
          [metadata]="metadata()"
          [results]="results()"
          [recentSearches]="recentSearches()"
          [selectedIndex]="selectedIndex"
          [listboxId]="listboxId"
          [validQuery]="validQuery(searchQuery)"
          (retry)="retrySearch()"
          (selectRecent)="selectRecent($event)"
          (clearRecent)="clearRecentSearches()"
          (selectHit)="navigateTo($event)"
        />

        <!-- Footer keyboard shortcuts -->
        <app-command-palette-footer />
      </div>
    </div>
  `,
  styleUrl: './command-palette.component.css'
})
export class CommandPaletteComponent implements OnDestroy {
  private readonly uiI18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private static nextId = 0;

  searchQuery = '';
  entityType = 'ALL';
  readonly metadata = signal<SearchResult | null>(null);
  readonly retrySeconds = signal(0);
  private retryUntil = 0;
  private cooldownTimer?: ReturnType<typeof setInterval>;
  selectedIndex = 0;
  readonly isLoading = signal<boolean>(false);
  readonly results = signal<SearchHit[]>([]);
  readonly errorMessage = signal<string>('');
  readonly recentSearches = signal<string[]>([]);
  private readonly searchSubject = new Subject<string | null>();
  private readonly componentId = CommandPaletteComponent.nextId++;
  readonly titleId = `command-palette-title-${this.componentId}`;
  readonly inputId = `command-palette-input-${this.componentId}`;
  readonly listboxId = `command-palette-results-${this.componentId}`;
  public readonly moduleService = inject(ModuleService);
  private previouslyFocusedElement: HTMLElement | null = null;
  private wasOpen = false;

  readonly categories = computed<CategoryItem[]>(() => {
    const list: CategoryItem[] = [
      { value: 'ALL', label: 'search.entity.all', icon: 'apps' },
      { value: 'TASK', label: 'nav.tasks', icon: 'task_alt' },
      { value: 'PROJECT', label: 'nav.projects', icon: 'folder' },
      { value: 'USER', label: 'nav.users', icon: 'person' }
    ];
    if (this.moduleService.isModuleActive('notes')) {
      list.push({ value: 'NOTE', label: 'search.entity.note', icon: 'description' });
    }
    return list;
  });

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  constructor(
    public paletteService: CommandPaletteService,
    private router: Router
  ) {
    this.loadRecentSearches();

    effect(() => {
      const isOpen = this.paletteService.isOpen();
      if (isOpen && !this.wasOpen) {
        this.resetSearch();
        this.loadRecentSearches();
        this.previouslyFocusedElement = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
        document.body.classList.add('palette-open');
        queueMicrotask(() => {
          if (!this.destroyRef.destroyed && this.paletteService.isOpen()) this.searchInput?.nativeElement.focus();
        });
      } else if (!isOpen && this.wasOpen) {
        this.resetSearch();
        document.body.classList.remove('palette-open');
        const focusTarget = this.previouslyFocusedElement;
        queueMicrotask(() => {
          if (!this.destroyRef.destroyed && !this.paletteService.isOpen() && focusTarget?.isConnected) focusTarget.focus();
        });
        this.previouslyFocusedElement = null;
      }
      this.wasOpen = isOpen;
    });

    this.searchSubject.pipe(
      switchMap(query => {
        if (query === null || !this.validQuery(query) || this.retryUntil > Date.now()) return EMPTY;
        // A new input cancels both the debounce timer and an older HTTP request.
        return timer(120).pipe(
          switchMap(() => this.paletteService.search(query, this.entityType)),
          catchError(error => {
            this.results.set([]);
            this.isLoading.set(false);
            this.errorMessage.set(this.getSearchErrorMessage(error));
            if (error?.status === 429) this.startCooldown(error.retryAfterSeconds);
            return of(null);
          })
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(res => {
      if (!res || !this.paletteService.isOpen()) return;
      const hits = (res.hits || []).filter(h => {
        if (h.entityType === 'NOTE' && !this.moduleService.isModuleActive('notes')) {
          return false;
        }
        return true;
      });
      this.results.set(hits);
      this.metadata.set(res);
      this.selectedIndex = 0;
      this.isLoading.set(false);
    });
  }

  ngOnDestroy() {
    clearInterval(this.cooldownTimer);
    this.paletteService.close();
    this.searchSubject.complete();
    document.body.classList.remove('palette-open');
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.code === 'KeyK' || event.key.toLowerCase() === 'k')) {
      event.preventDefault();
      if (!event.repeat) this.paletteService.toggle();
    } else if (event.key === 'Escape' && this.paletteService.isOpen()) {
      event.preventDefault();
      event.stopPropagation();
      this.paletteService.close();
    } else if (this.paletteService.isOpen() && event.target === this.searchInput?.nativeElement && this.results().length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.selectedIndex = (this.selectedIndex + 1) % this.results().length;
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.selectedIndex = (this.selectedIndex - 1 + this.results().length) % this.results().length;
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const hit = this.results()[this.selectedIndex];
        if (hit) {
          this.navigateTo(hit);
        }
      }
    }
  }

  onSearchChange(query: string) {
    const normalized = query.trim();
    this.results.set([]);
    this.metadata.set(null);
    this.selectedIndex = 0;
    this.errorMessage.set(this.retryUntil > Date.now() ? this.uiI18n.translate('search.rate_limited') :
      this.queryLength(normalized) > 200 ? this.uiI18n.translate('search.query_too_long') : '');
    this.isLoading.set(this.validQuery(normalized) && this.retryUntil <= Date.now());
    this.searchSubject.next(normalized);
  }

  setCategory(category: string) {
    this.entityType = category;
    this.onSearchChange(this.searchQuery);
  }

  clearQuery() {
    this.searchQuery = '';
    this.onSearchChange('');
    this.searchInput?.nativeElement.focus();
  }

  applySuggestion(suggestion: string) {
    this.searchQuery = suggestion;
    this.onSearchChange(suggestion);
    this.searchInput?.nativeElement.focus();
  }

  retrySearch() {
    if (this.retryUntil > Date.now()) return;
    this.onSearchChange(this.searchQuery);
  }

  private resetSearch(): void {
    this.searchQuery = '';
    this.onSearchChange('');
  }

  optionId(index: number): string {
    return `${this.listboxId}-option-${index}`;
  }

  navigateTo(hit: SearchHit) {
    const target = searchTarget(hit);
    if (!target) return;
    if (this.searchQuery.trim().length >= 2) {
      this.saveRecentSearch(this.searchQuery.trim());
    }
    this.paletteService.close();
    this.router.navigate(target);
  }

  selectRecent(query: string) {
    this.searchQuery = query;
    this.onSearchChange(query);
    this.searchInput?.nativeElement.focus();
  }

  private loadRecentSearches() {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.recentSearches.set(parsed.filter(item => typeof item === 'string'));
        }
      }
    } catch {
      // localStorage may fail or be restricted
    }
  }

  private saveRecentSearch(query: string) {
    try {
      const current = this.recentSearches().filter(q => q.toLowerCase() !== query.toLowerCase());
      const updated = [query, ...current].slice(0, MAX_RECENT_SEARCHES);
      this.recentSearches.set(updated);
      localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // localStorage may fail
    }
  }

  clearRecentSearches() {
    try {
      this.recentSearches.set([]);
      localStorage.removeItem(RECENT_SEARCHES_STORAGE_KEY);
    } catch {
      // localStorage may fail
    }
  }

  queryLength(query: string): number { return Array.from(query.trim()).length; }

  validQuery(query: string): boolean {
    const length = this.queryLength(query);
    return length >= 2 && length <= 200;
  }

  private startCooldown(seconds: unknown): void {
    const bounded = typeof seconds === 'number' && Number.isSafeInteger(seconds) && seconds >= 0
      ? Math.min(seconds, 300) : 1;
    this.retryUntil = Date.now() + bounded * 1000;
    this.retrySeconds.set(bounded);
    clearInterval(this.cooldownTimer);
    this.cooldownTimer = setInterval(() => {
      this.retrySeconds.set(Math.max(0, Math.ceil((this.retryUntil - Date.now()) / 1000)));
      if (this.retrySeconds() === 0) clearInterval(this.cooldownTimer);
    }, 250);
  }

  onBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('palette-backdrop')) {
      this.paletteService.close();
    }
  }

  private getSearchErrorMessage(error: unknown): string {
    if ((error as { status?: number })?.status === 429) return this.uiI18n.translate('search.rate_limited');
    if (error && typeof error === 'object') {
      const detail = (error as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail.trim()) return detail;
    }
    return this.uiI18n.translate('layout.command_palette.ne_udalos_vypolnit_poisk_proverte_soedinenie_i_p');
  }
}
