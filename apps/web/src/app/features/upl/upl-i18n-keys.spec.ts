import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PACKAGED_RUSSIAN } from '../../core/i18n/packaged-russian';

const UPL_DIR = 'src/app/features/upl';
const SHELL_FILES = [
  'src/app/layout/app-shell/app-shell.component.ts',
  'src/app/layout/app-shell/app-shell.models.ts'
];
/** Литерал ключа словаря; префикс `'upl.err.'` (кончается точкой) сюда не попадает. */
const KEY_LITERAL = /'(upl\.[A-Za-z0-9_.]*[A-Za-z0-9_]|nav\.upl_[a-z0-9_]+)'/g;
/** Подкод ошибки контракта: текст берётся по ключу `upl.err.<подкод>`. */
const CODE_LITERAL = /'(UPL_[A-Z0-9_]+|FND_VERSION_[A-Z0-9_]+|STALE_VERSION|PERMISSION_DENIED|VALIDATION_FAILED)'/g;
/** Литералы того же вида, которые ключами словаря не являются: код формы в каталоге прав. */
const NOT_KEYS = new Set(['upl.sources', 'upl.packages']);
/** Коды Bean Validation, которые сервер отдаёт в `errors[].code`; текст — по ключу `upl.err.<код>`. */
const VALIDATOR_CODES = ['NotBlank', 'NotNull', 'Pattern', 'Min', 'Max', 'Size', 'Positive', 'PositiveOrZero'];

function sourceFiles(): string[] {
  const own = readdirSync(UPL_DIR, { recursive: true })
    .map(name => `${UPL_DIR}/${name.replace(/\\/g, '/')}`)
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
  const codes = literals(texts, CODE_LITERAL).map(code => `upl.err.${code}`);
  return [...keys, ...codes].filter(key => !(key in dictionary));
}

describe('upl dictionary keys (Р-10)', () => {
  const texts = sourceFiles().map(file => readFileSync(file, 'utf8'));

  it('reads the upl sources and the application shell', () => {
    expect(texts.length).toBeGreaterThanOrEqual(8);
    expect(literals(texts, KEY_LITERAL)).toContain('nav.upl_sources');
    expect(literals(texts, KEY_LITERAL).length).toBeGreaterThanOrEqual(140);
  });

  it('has every upl key and every error subcode of the code in the packaged Russian dictionary', () => {
    expect(missingKeys(texts, PACKAGED_RUSSIAN)).toEqual([]);
  });

  it('has a Russian text for every Bean Validation code the server can send', () => {
    expect(VALIDATOR_CODES.map(code => `upl.err.${code}`).filter(key => !(key in PACKAGED_RUSSIAN))).toEqual([]);
  });

  it('reports a key and an upper case error subcode that the dictionary lacks', () => {
    const code = ["const a = 'upl.list.no_such_key';", "if (detail === 'UPL_NO_SUCH_CODE') {}", "const p = 'upl.err.' + code;"];
    expect(missingKeys(code, PACKAGED_RUSSIAN)).toEqual(['upl.list.no_such_key', 'upl.err.UPL_NO_SUCH_CODE']);
  });
});
