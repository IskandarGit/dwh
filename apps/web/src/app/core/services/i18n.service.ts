import { HttpClient } from '@angular/common/http';
import { Injectable, Optional, Pipe, PipeTransform, computed, signal } from '@angular/core';
import {
  Observable,
  catchError,
  finalize,
  firstValueFrom,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError
} from 'rxjs';
import {
  CreateLanguageRequest,
  LanguageInfo,
  TranslationDictionary
} from '../models/i18n.models';

export type Language = string;
export type { LanguageInfo } from '../models/i18n.models';

export const LANGUAGE_LOCALES: Record<string, string> = {
  ru: 'ru-RU',
  uz: 'uz-UZ',
  en: 'en-US',
  kk: 'kk-KZ',
  ky: 'ky-KG',
  tg: 'tg-TJ',
  de: 'de-DE',
  tr: 'tr-TR'
};

export const LANGUAGE_NATIVE_NAMES: Record<string, string> = {
  ru: 'Русский',
  uz: 'O‘zbekcha',
  en: 'English',
  kk: 'Қазақша',
  ky: 'Кыргызча',
  tg: 'Тоҷикӣ',
  de: 'Deutsch',
  tr: 'Türkçe'
};

const API_ROOT = '/api/v1';
const RUSSIAN = 'ru';
const FALLBACK_LANGUAGE: LanguageInfo = {
  code: RUSSIAN,
  name: 'Русский',
  builtin: true,
  active: true,
  revision: 0,
  translated: 0,
  total: 0,
  coverage: 100
};

const TECHNICAL_RUSSIAN_FALLBACK: TranslationDictionary = {
  'common.loading': 'Загрузка…',
  'common.save': 'Сохранить',
  'common.cancel': 'Отмена',
  'common.error': 'Произошла ошибка',
  'auth.login': 'Вход в систему',
  'auth.login_btn': 'Войти',
  'auth.username': 'Логин или Email',
  'auth.password': 'Пароль'
};

function offlineRussianFallback(): TranslationDictionary {
  const testCatalog = (globalThis as typeof globalThis & {
    __SMARTUPCMS_TEST_RUSSIAN__?: TranslationDictionary;
  }).__SMARTUPCMS_TEST_RUSSIAN__;
  return testCatalog ?? TECHNICAL_RUSSIAN_FALLBACK;
}

interface CachedDictionary {
  revision: number;
  values: TranslationDictionary;
}

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly offlineFallback = offlineRussianFallback();
  readonly languages = signal<LanguageInfo[]>([FALLBACK_LANGUAGE]);
  readonly currentLang = signal<string>(RUSSIAN);
  readonly isLoading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly currentLanguage = computed(() =>
    this.languages().find(language => language.code === this.currentLang()) ?? FALLBACK_LANGUAGE
  );

  private readonly activeDictionary = signal<TranslationDictionary>(this.offlineFallback);
  private readonly russianDictionary = signal<TranslationDictionary>(this.offlineFallback);
  private readonly cache = new Map<string, CachedDictionary>();
  private readonly inFlight = new Map<string, Observable<TranslationDictionary>>();
  private initialization?: Promise<void>;

  constructor(@Optional() private readonly http: HttpClient | null) {}

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;

    this.initialization = this.initializeOnce();
    return this.initialization;
  }

  setLanguage(code: string, persist = true): Observable<void> {
    const normalized = this.normalize(code);
    const target = this.languages().find(language => language.code === normalized && language.active);
    if (!target) {
      return throwError(() => new Error(`Language ${normalized} is not active`));
    }

    const previousCode = this.currentLang();
    const previousDictionary = this.activeDictionary();

    return this.loadDictionary(normalized).pipe(
      tap(dictionary => {
        this.activate(normalized, dictionary);
      }),
      switchMap(() => persist
        ? this.client.patch<void>(`${API_ROOT}/settings/user`, { 'user.language': normalized }, {
            withCredentials: true
          })
        : of(undefined)),
      map(() => undefined),
      catchError(error => {
        this.activate(previousCode, previousDictionary);
        return throwError(() => error);
      })
    );
  }

  useAuthenticatedPreference(code: string | null | undefined): void {
    const normalized = this.normalize(code);
    if (normalized === this.currentLang()) return;
    this.setLanguage(normalized, false).subscribe({
      error: () => this.setLanguage(RUSSIAN, false).subscribe()
    });
  }

  refreshLanguages(): Observable<LanguageInfo[]> {
    return this.client.get<LanguageInfo[]>(`${API_ROOT}/i18n/languages`, {
      withCredentials: true
    }).pipe(
      tap(languages => this.languages.set(this.validLanguages(languages)))
    );
  }

  refreshLanguage(code: string): Observable<void> {
    const normalized = this.normalize(code);
    const activeCode = this.currentLang();
    return this.refreshLanguages().pipe(
      tap(() => {
        if (normalized === RUSSIAN) {
          // Every effective non-Russian dictionary contains per-key Russian
          // fallback values, so changing Russian invalidates the whole cache.
          this.cache.clear();
        } else {
          this.cache.delete(normalized);
        }
      }),
      switchMap(() => this.loadDictionary(normalized)),
      tap(dictionary => {
        if (normalized === RUSSIAN) {
          this.russianDictionary.set(dictionary);
        }
        if (this.currentLang() === normalized) {
          this.activeDictionary.set(dictionary);
        }
      }),
      switchMap(() => normalized === RUSSIAN && activeCode !== RUSSIAN
        ? this.loadDictionary(activeCode).pipe(
            tap(dictionary => this.activeDictionary.set(dictionary))
          )
        : of(undefined)),
      map(() => undefined)
    );
  }

  registerLanguage(code: string, name: string,
                   dictionary: TranslationDictionary): Observable<LanguageInfo> {
    const normalizedCode = (code ?? '').trim().toLowerCase();
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalizedCode)) {
      return throwError(() => new Error('Invalid language code'));
    }
    const request: CreateLanguageRequest = {
      code: normalizedCode,
      name: name.trim(),
      translations: dictionary
    };
    return this.client.post<LanguageInfo>(`${API_ROOT}/i18n/admin/languages`, request, {
      withCredentials: true
    }).pipe(
      switchMap(created => this.refreshLanguages().pipe(map(() => created)))
    );
  }

  getDictionary(code: string): TranslationDictionary {
    const normalized = this.normalize(code);
    return this.cache.get(normalized)?.values
      ?? (normalized === RUSSIAN ? this.russianDictionary() : this.russianDictionary());
  }

  exportDictionary(code: string): string {
    return JSON.stringify(this.getDictionary(code), null, 2);
  }

  hasKey(key: string): boolean {
    return Boolean(this.activeDictionary()[key] || this.russianDictionary()[key] || this.offlineFallback[key]);
  }

  getPluralForm(count: number, lang: string = this.currentLang()): Intl.LDMLPluralRule {
    try {
      const locale = LANGUAGE_LOCALES[lang] || lang;
      return new Intl.PluralRules(locale).select(count);
    } catch {
      return count === 1 ? 'one' : 'other';
    }
  }

  translate(key: string, params?: Record<string, string | number>): string {
    let resolvedKey = key;
    if (params && typeof params['count'] === 'number') {
      const plural = this.getPluralForm(params['count'] as number);
      const pluralKey = `${key}.${plural}`;
      if (this.hasKey(pluralKey)) {
        resolvedKey = pluralKey;
      }
    }

    const template = this.activeDictionary()[resolvedKey]
      ?? this.russianDictionary()[resolvedKey]
      ?? this.offlineFallback[resolvedKey]
      ?? this.activeDictionary()[key]
      ?? this.russianDictionary()[key]
      ?? this.offlineFallback[key]
      ?? key;
    if (!params) return template;
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder: string, name: string) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder
    );
  }

  formatDate(date: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions): string {
    if (!date) return '';
    try {
      const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
      if (isNaN(d.getTime())) return String(date);
      const locale = LANGUAGE_LOCALES[this.currentLang()] || this.currentLang();
      return new Intl.DateTimeFormat(locale, options ?? {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }).format(d);
    } catch {
      return String(date);
    }
  }

  formatDateTime(date: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions): string {
    if (!date) return '';
    try {
      const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
      if (isNaN(d.getTime())) return String(date);
      const locale = LANGUAGE_LOCALES[this.currentLang()] || this.currentLang();
      return new Intl.DateTimeFormat(locale, options ?? {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(d);
    } catch {
      return String(date);
    }
  }

  formatNumber(value: number | null | undefined, options?: Intl.NumberFormatOptions): string {
    if (value === null || value === undefined || typeof value !== 'number' || isNaN(value)) {
      return String(value ?? '');
    }
    try {
      const locale = LANGUAGE_LOCALES[this.currentLang()] || this.currentLang();
      return new Intl.NumberFormat(locale, options).format(value);
    } catch {
      return String(value);
    }
  }

  formatRelativeTime(date: Date | string | number | null | undefined): string {
    if (!date) return '';
    try {
      const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
      if (isNaN(d.getTime())) return '';
      const now = Date.now();
      const diffInSeconds = Math.round((d.getTime() - now) / 1000);
      const locale = LANGUAGE_LOCALES[this.currentLang()] || this.currentLang();
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

      const absDiff = Math.abs(diffInSeconds);
      if (absDiff < 60) return rtf.format(diffInSeconds, 'second');
      const diffInMinutes = Math.round(diffInSeconds / 60);
      if (Math.abs(diffInMinutes) < 60) return rtf.format(diffInMinutes, 'minute');
      const diffInHours = Math.round(diffInMinutes / 60);
      if (Math.abs(diffInHours) < 24) return rtf.format(diffInHours, 'hour');
      const diffInDays = Math.round(diffInHours / 24);
      if (Math.abs(diffInDays) < 30) return rtf.format(diffInDays, 'day');
      const diffInMonths = Math.round(diffInDays / 30);
      if (Math.abs(diffInMonths) < 12) return rtf.format(diffInMonths, 'month');
      return rtf.format(Math.round(diffInDays / 365), 'year');
    } catch {
      return this.formatDate(date);
    }
  }

  private async initializeOnce(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set(null);
    if (!this.http) {
      this.languages.set([FALLBACK_LANGUAGE]);
      this.russianDictionary.set(this.offlineFallback);
      this.activate(RUSSIAN, this.offlineFallback);
      this.isLoading.set(false);
      return;
    }
    try {
      const languages = this.validLanguages(await firstValueFrom(
        this.client.get<LanguageInfo[]>(`${API_ROOT}/i18n/languages`, { withCredentials: true })
      ));
      this.languages.set(languages);

      const russian = await firstValueFrom(this.loadDictionary(RUSSIAN));
      this.russianDictionary.set(russian);

      const saved = this.normalize(localStorage.getItem('dwh_lang'));
      const selected = languages.some(language => language.active && language.code === saved)
        ? saved
        : RUSSIAN;
      try {
        const dictionary = selected === RUSSIAN
          ? russian
          : await firstValueFrom(this.loadDictionary(selected));
        this.activate(selected, dictionary);
      } catch {
        this.activate(RUSSIAN, russian);
      }
    } catch {
      this.languages.set([FALLBACK_LANGUAGE]);
      this.activate(RUSSIAN, this.offlineFallback);
      this.loadError.set('Не удалось загрузить языковые пакеты');
    } finally {
      this.isLoading.set(false);
    }
  }

  private loadDictionary(code: string): Observable<TranslationDictionary> {
    const normalized = this.normalize(code);
    const revision = this.languages().find(language => language.code === normalized)?.revision ?? 0;
    const cached = this.cache.get(normalized);
    if (cached && cached.revision === revision) {
      return of(cached.values);
    }
    const existing = this.inFlight.get(normalized);
    if (existing) return existing;

    const request = this.client.get<TranslationDictionary>(`${API_ROOT}/i18n/${normalized}`, {
      withCredentials: true
    }).pipe(
      tap(values => {
        const immutable = { ...values };
        this.cache.set(normalized, { revision, values: immutable });
        if (normalized === RUSSIAN) this.russianDictionary.set(immutable);
      }),
      map(values => this.cache.get(normalized)?.values ?? { ...values }),
      finalize(() => this.inFlight.delete(normalized)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.inFlight.set(normalized, request);
    return request;
  }

  private activate(code: string, dictionary: TranslationDictionary): void {
    this.currentLang.set(code);
    this.activeDictionary.set(dictionary);
    localStorage.setItem('dwh_lang', code);
    document.documentElement.lang = code;
  }

  private validLanguages(languages: LanguageInfo[] | null | undefined): LanguageInfo[] {
    const valid = (languages ?? []).filter(language =>
      Boolean(language?.active && this.normalize(language.code) === language.code.toLowerCase())
    );
    return valid.some(language => language.code === RUSSIAN)
      ? valid
      : [FALLBACK_LANGUAGE, ...valid];
  }

  private normalize(code: string | null | undefined): string {
    const normalized = (code ?? RUSSIAN).trim().toLowerCase();
    return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized) ? normalized : RUSSIAN;
  }

  private get client(): HttpClient {
    if (!this.http) throw new Error('HttpClient is unavailable');
    return this.http;
  }
}

@Pipe({
  name: 't',
  standalone: true,
  pure: false
})
export class TranslatePipe implements PipeTransform {
  constructor(private readonly i18n: I18nService) {}

  transform(key: string, params?: Record<string, string | number>): string {
    return this.i18n.translate(key, params);
  }
}
