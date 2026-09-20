import { FieldErrorItem, ProblemDetail } from '../../../core/models/common.models';
import { uplErrorKey } from '../upl-labels';

/** Ошибка сервера с адресом: sheet/column — индексы с нуля из `sheets[i].columns[j].<поле>`; null — уровень выше. */
export interface UplFieldError {
  sheet: number | null;
  column: number | null;
  field: string;
  code: string;
  key: string;
  message: string;
}

const ADDRESS_PATTERN = /^sheets\[(\d+)\](?:\.columns\[(\d+)\])?(?:\.(.+))?$/;

const DEFAULT_CODE = 'VALIDATION_FAILED';

interface UplErrorAddress {
  sheet: number | null;
  column: number | null;
  field: string;
}

function parseAddress(address: string): UplErrorAddress {
  const match = ADDRESS_PATTERN.exec(address);
  if (!match) {
    return { sheet: null, column: null, field: address };
  }
  return {
    sheet: Number(match[1]),
    column: match[2] === undefined ? null : Number(match[2]),
    field: match[3] ?? ''
  };
}

function toFieldError(address: string, code: string, message: string): UplFieldError {
  const normalizedCode = code || DEFAULT_CODE;
  return {
    ...parseAddress(address),
    code: normalizedCode,
    key: uplErrorKey(normalizedCode),
    message: message ?? ''
  };
}

function dedupeKey(error: UplFieldError): string {
  return `${error.sheet}|${error.column}|${error.field}|${error.code}`;
}

/** Ошибки поля из `errors[]` problem+json в адресном виде. */
export function parseUplFieldErrors(errors: FieldErrorItem[] | null | undefined): UplFieldError[] {
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.map(item => toFieldError(item.field ?? '', item.code ?? '', item.message ?? ''));
}

/** Все адресные ошибки ответа: `errors[]` плюс `invalid_params`, без дубликатов «адрес + код». */
export function parseUplProblem(problem: ProblemDetail): UplFieldError[] {
  const fromErrors = parseUplFieldErrors(problem?.errors);
  const fromParams = Array.isArray(problem?.invalid_params)
    ? problem.invalid_params!.map(param => toFieldError(param.name ?? '', param.code ?? '', param.reason ?? ''))
    : [];

  const seen = new Set<string>();
  const result: UplFieldError[] = [];
  for (const error of [...fromErrors, ...fromParams]) {
    const key = dedupeKey(error);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(error);
  }
  return result;
}

/**
 * Текст ошибки поля: ключ словаря, а если его нет — сообщение сервера и код в скобках
 * (сырой ключ в UI не попадает); без сообщения сервера — только код.
 */
export function uplFieldErrorText(error: UplFieldError, translate: (key: string) => string): string {
  const translated = translate(error.key);
  if (translated !== error.key) {
    return translated;
  }
  return error.message ? `${error.message} (${error.code})` : error.code;
}

/** Ошибка конкретной ячейки колонки. */
export function uplCellError(list: UplFieldError[], sheet: number, column: number, field: string): UplFieldError | null {
  return list.find(error => error.sheet === sheet && error.column === column && error.field === field) ?? null;
}

/** Ошибка поля самого листа (не колонки). */
export function uplSheetError(list: UplFieldError[], sheet: number, field: string): UplFieldError | null {
  return list.find(error => error.sheet === sheet && error.column === null && error.field === field) ?? null;
}

/** Есть ли у листа хоть одна ошибка — своя или в колонке. */
export function uplSheetHasErrors(list: UplFieldError[], sheet: number): boolean {
  return list.some(error => error.sheet === sheet);
}
