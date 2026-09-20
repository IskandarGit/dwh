import { TranslationDictionary } from '../../core/models/i18n.models';

export type SettingsTab =
  | 'general'
  | 'security'
  | 'storage'
  | 'preferences'
  | 'languages'
  | 'search'
  | 'navigation';

export interface LegacyLanguage {
  name: string;
  dict: TranslationDictionary;
}

export function filterKnownTranslations(
  dictionary: TranslationDictionary,
  knownKeys: Set<string>
): TranslationDictionary {
  return Object.fromEntries(Object.entries(dictionary).filter(([key, value]) =>
    knownKeys.has(key) && typeof value === 'string' && value.trim().length > 0 && value.length <= 4000
  ));
}

export function readLegacyLanguages(): Record<string, LegacyLanguage> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem('dwh_custom_languages') ?? '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
    const result: Record<string, LegacyLanguage> = {};
    for (const [rawCode, rawEntry] of Object.entries(parsed)) {
      const code = rawCode.trim().toLowerCase();
      if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code)
          || !rawEntry || Array.isArray(rawEntry) || typeof rawEntry !== 'object') continue;
      const entry = rawEntry as { name?: unknown; dict?: unknown };
      if (typeof entry.name !== 'string' || !entry.name.trim()
          || !entry.dict || Array.isArray(entry.dict) || typeof entry.dict !== 'object') continue;
      const dict = Object.fromEntries(Object.entries(entry.dict).filter((pair): pair is [string, string] =>
        typeof pair[1] === 'string'
      ));
      result[code] = { name: entry.name.trim(), dict };
    }
    return result;
  } catch {
    return {};
  }
}
