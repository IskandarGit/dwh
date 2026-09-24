import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PACKAGED_RUSSIAN } from '../../core/i18n/packaged-russian';

const RPT_DIR = 'src/app/features/rpt';
const SHELL_FILES = [
  'src/app/layout/app-shell/app-shell.component.ts',
  'src/app/layout/app-shell/app-shell.models.ts'
];
/** Литерал ключа словаря; префикс `'rpt.err.'` (кончается точкой) сюда не попадает. */
const KEY_LITERAL = /'(rpt\.[A-Za-z0-9_.]*[A-Za-z0-9_]|nav\.rpt_[a-z0-9_]+)'/g;
/** Код ошибки контракта: текст берётся по ключу `rpt.err.<код>`. */
const CODE_LITERAL = /'(RPT_[A-Z0-9_]+)'/g;
/** Литералы того же вида, которые ключами словаря не являются: код формы в каталоге прав. */
const NOT_KEYS = new Set(['rpt.reports']);
/** Коды ошибок из контракта «Отчётов», раздел 7. */
const CONTRACT_CODES = [
  'RPT_REPORT_NOT_FOUND',
  'RPT_DEFINITION_INVALID',
  'RPT_NAME_TAKEN',
  'RPT_SOURCE_UNKNOWN',
  'RPT_COLUMN_UNKNOWN',
  'RPT_COLUMN_TYPE',
  'RPT_KEYS_INVALID',
  'RPT_LEVEL_INVALID',
  'RPT_FORMAT_INVALID',
  'RPT_DEFINITION_STALE',
  'RPT_CONFLICT',
  'RPT_TOO_MANY_LINES',
  'RPT_CELL_INVALID',
  'RPT_MODULE_DISABLED',
  'RPT_QUERY_TIMEOUT'
];
const DIVISORS = ['1', '1000', '1000000'];
const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1));
/** Ключи экрана «Отчёты»: меню, список, отчёт, единицы, месяцы, панель, форма. */
const SCREEN_KEYS = [
  'nav.rpt_reports',
  'rpt.title',
  'rpt.list.name',
  'rpt.list.source',
  'rpt.list.modified',
  'rpt.list.new',
  'rpt.list.empty',
  'rpt.list.empty_hint',
  'rpt.list.loading',
  'rpt.view.back',
  'rpt.view.edit',
  'rpt.view.year',
  'rpt.view.digits',
  'rpt.view.measure',
  'rpt.view.count_measure',
  'rpt.view.expand_all',
  'rpt.view.collapse_all',
  'rpt.view.grand',
  'rpt.view.total',
  'rpt.view.no_name',
  'rpt.view.undated',
  'rpt.view.show_rows',
  'rpt.view.ref_duplicates',
  'rpt.view.loading',
  'rpt.view.no_data',
  'rpt.view.stale_ask_admin',
  'rpt.view.stale_field',
  ...DIVISORS.map(divisor => `rpt.unit_short.${divisor}`),
  ...DIVISORS.map(divisor => `rpt.unit.${divisor}`),
  ...MONTHS.map(month => `rpt.month.${month}`),
  'rpt.month_year',
  'rpt.panel.title',
  'rpt.panel.close',
  'rpt.panel.summary',
  'rpt.panel.summary_plain',
  'rpt.panel.from',
  'rpt.panel.date',
  'rpt.panel.rows_count',
  'rpt.panel.year_total',
  'rpt.panel.undated',
  'rpt.panel.page',
  'rpt.edit.new_title',
  'rpt.edit.back',
  'rpt.edit.cancel',
  'rpt.edit.save',
  'rpt.edit.name',
  'rpt.edit.block_source',
  'rpt.edit.source',
  'rpt.edit.sheet',
  'rpt.edit.block_date',
  'rpt.edit.date_field',
  'rpt.edit.no_date_columns',
  'rpt.edit.block_measure',
  'rpt.edit.measure_total',
  'rpt.edit.measure_count',
  'rpt.edit.show_in',
  'rpt.edit.decimals',
  'rpt.edit.block_ref',
  'rpt.edit.use_ref',
  'rpt.edit.ref',
  'rpt.edit.link',
  'rpt.edit.add_pair',
  'rpt.edit.remove_pair',
  'rpt.edit.block_levels',
  'rpt.edit.level1',
  'rpt.edit.level2',
  'rpt.edit.no_level2',
  'rpt.edit.origin_source',
  'rpt.edit.origin_ref',
  'rpt.edit.choose',
  'rpt.edit.choose_again',
  'rpt.edit.conflict',
  'rpt.edit.reopen',
  'rpt.edit.leave_title',
  'rpt.edit.leave_yes',
  'rpt.edit.leave_no',
  'rpt.edit.source_option'
];

function sourceFiles(): string[] {
  const own = readdirSync(RPT_DIR, { recursive: true })
    .map(name => `${RPT_DIR}/${name.replace(/\\/g, '/')}`)
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
  const codes = literals(texts, CODE_LITERAL).map(code => `rpt.err.${code}`);
  return [...keys, ...codes].filter(key => !(key in dictionary));
}

function emptyOrMissing(keys: string[], dictionary: Readonly<Record<string, string>>): string[] {
  return keys.filter(key => !(key in dictionary) || dictionary[key].trim() === '');
}

describe('rpt dictionary keys', () => {
  const texts = sourceFiles().map(file => readFileSync(file, 'utf8'));

  it('reads the rpt sources and the application shell', () => {
    expect(texts.length).toBeGreaterThanOrEqual(6);
  });

  it('has a non-empty Russian text for every key of the screen', () => {
    expect(emptyOrMissing(SCREEN_KEYS, PACKAGED_RUSSIAN)).toEqual([]);
  });

  it('has a non-empty Russian text for all 15 error codes of the contract', () => {
    expect(CONTRACT_CODES).toHaveLength(15);
    expect(emptyOrMissing(CONTRACT_CODES.map(code => `rpt.err.${code}`), PACKAGED_RUSSIAN)).toEqual([]);
  });

  it('has every rpt key and every error code of the code in the packaged Russian dictionary', () => {
    expect(missingKeys(texts, PACKAGED_RUSSIAN)).toEqual([]);
  });

  it('reports a key and an error code that the dictionary lacks', () => {
    const code = [
      "const a = 'rpt.view.no_such_key';",
      "if (detail === 'RPT_NO_SUCH_CODE') {}",
      "const p = 'rpt.err.' + code;",
      "const form = 'rpt.reports';"
    ];
    expect(missingKeys(code, PACKAGED_RUSSIAN)).toEqual(['rpt.view.no_such_key', 'rpt.err.RPT_NO_SUCH_CODE']);
  });
});
