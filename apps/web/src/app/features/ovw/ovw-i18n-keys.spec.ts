import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PACKAGED_RUSSIAN } from '../../core/i18n/packaged-russian';

const OVW_DIR = 'src/app/features/ovw';
const SHELL_FILES = [
  'src/app/layout/app-shell/app-shell.component.ts',
  'src/app/layout/app-shell/app-shell.models.ts'
];
/** Литерал ключа словаря; префикс `'ovw.err.'` (кончается точкой) сюда не попадает. */
const KEY_LITERAL = /'(ovw\.[A-Za-z0-9_.]*[A-Za-z0-9_]|nav\.ovw_[a-z0-9_]+)'/g;
/** Код ошибки контракта: текст берётся по ключу `ovw.err.<код>`. */
const CODE_LITERAL = /'(OVW_[A-Z0-9_]+)'/g;
/** Литералы того же вида, которые ключами словаря не являются: код формы в каталоге прав. */
const NOT_KEYS = new Set(['ovw.data']);
/** Коды ошибок `OvwErrors` из контракта «Обзора данных», раздел 6. */
const CONTRACT_CODES = [
  'OVW_QUERY_INVALID',
  'OVW_SOURCE_NOT_FOUND',
  'OVW_SHEET_UNKNOWN',
  'OVW_COLUMN_UNKNOWN',
  'OVW_FILTER_OP',
  'OVW_FILTER_VALUE',
  'OVW_FILTER_TOO_MANY',
  'OVW_PAGE_INVALID',
  'OVW_MODULE_DISABLED',
  'OVW_QUERY_TIMEOUT'
];

function sourceFiles(): string[] {
  const own = readdirSync(OVW_DIR, { recursive: true })
    .map(name => `${OVW_DIR}/${name.replace(/\\/g, '/')}`)
    .filter(name => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts'));
  return [...own, ...SHELL_FILES];
}

function literals(texts: string[], pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      found.add(match[1]);
    }
  }
  return [...found].sort();
}

function missingKeys(texts: string[], dictionary: Readonly<Record<string, string>>): string[] {
  const keys = literals(texts, KEY_LITERAL).filter(key => !NOT_KEYS.has(key));
  const codes = literals(texts, CODE_LITERAL).map(code => `ovw.err.${code}`);
  return [...keys, ...codes].filter(key => !(key in dictionary));
}

describe('ovw dictionary keys', () => {
  const texts = sourceFiles().map(file => readFileSync(file, 'utf8'));

  it('reads the ovw sources and the application shell', () => {
    expect(texts.length).toBeGreaterThanOrEqual(5);
  });

  it('has every ovw key and every error code of the code in the packaged Russian dictionary', () => {
    expect(missingKeys(texts, PACKAGED_RUSSIAN)).toEqual([]);
  });

  it('has a Russian text for every error code of the contract', () => {
    expect(CONTRACT_CODES.map(code => `ovw.err.${code}`).filter(key => !(key in PACKAGED_RUSSIAN))).toEqual([]);
  });

  it('reports a key and an error code that the dictionary lacks', () => {
    const code = [
      "const a = 'ovw.filter.no_such_key';",
      "if (detail === 'OVW_NO_SUCH_CODE') {}",
      "const p = 'ovw.err.' + code;",
      "const form = 'ovw.data';"
    ];
    expect(missingKeys(code, PACKAGED_RUSSIAN)).toEqual(['ovw.filter.no_such_key', 'ovw.err.OVW_NO_SUCH_CODE']);
  });
});
