import { ProblemDetail } from '../../../core/models/common.models';
import { uplErrorKey, uplProblemText } from '../upl-labels';
import { UplPackageParams } from './packages-api';

/** Все коды ошибок загрузки из контракта (раздел 8): у каждого есть ключ `upl.err.<КОД>` в словаре. */
export const UPL_PACKAGE_CODES = [
  'UPL_PKG_SOURCE_REQUIRED',
  'UPL_PKG_PERIOD_REQUIRED',
  'UPL_PKG_PERIOD_ORDER',
  'UPL_PKG_FILE_REQUIRED',
  'UPL_PKG_FILE_EMPTY',
  'UPL_PKG_FILE_NOT_XLSX',
  'UPL_PKG_NO_FORMAT_AT_DATE',
  'UPL_PKG_FILE_TOO_LARGE',
  'UPL_PKG_NOT_FOUND',
  'UPL_PKG_STRUCTURE',
  'UPL_PKG_UNREADABLE',
  'UPL_PKG_TOO_MANY_CELLS',
  'UPL_PKG_INTERNAL',
  'UPL_PKG_NOT_VERIFIED',
  'UPL_PKG_NOTHING_TO_APPLY',
  'UPL_PKG_RECONCILIATION',
  'UPL_PKG_RAW_WRITE_FAILED',
  'UPL_STRUCT_SHEET_MISSING',
  'UPL_STRUCT_COLUMN_MISSING',
  'UPL_STRUCT_COLUMN_UNKNOWN',
  'UPL_CELL_REQUIRED',
  'UPL_CELL_NOT_INTEGER',
  'UPL_CELL_NOT_NUMBER',
  'UPL_CELL_NOT_DATE',
  'UPL_CELL_KEY_MASK'
] as const;

/** Перевод с параметрами: `I18nService.translate` либо его заглушка в тестах. */
export type UplTranslate = (key: string, params?: UplPackageParams) => string;

/** Русский текст кода ошибки; перевода нет — показываем сам код, а не пустую строку. */
export function uplPackageCodeText(
  code: string,
  params: UplPackageParams | null | undefined,
  translate: UplTranslate
): string {
  const key = uplErrorKey(code);
  const text = translate(key, params ?? undefined);
  return text === key ? code : text;
}

/** Места формы «Новая загрузка», под которые ложатся отказы сервера. */
export interface UplPackageFormErrors {
  source: string[];
  period: string[];
  file: string[];
  form: string[];
}

type UplFormPlace = keyof UplPackageFormErrors;

/** Поле ответа сервера → место формы; неизвестное поле уходит полосой над формой. */
const FIELD_PLACE: Record<string, UplFormPlace> = {
  sourceId: 'source',
  periodFrom: 'period',
  periodTo: 'period',
  file: 'file'
};

/** Отказы по размеру приходят с этим кодом и от нашей проверки, и от каркаса. */
const FILE_SIZE_CODE = 'file_size_exceeded';

/** Подкоды, которые относятся к выбранному источнику. */
const SOURCE_DETAILS = ['UPL_SOURCE_NOT_FOUND', 'UPL_PKG_NO_FORMAT_AT_DATE'];

function emptyErrors(): UplPackageFormErrors {
  return { source: [], period: [], file: [], form: [] };
}

function add(errors: UplPackageFormErrors, place: UplFormPlace, text: string): void {
  if (!errors[place].includes(text)) {
    errors[place].push(text);
  }
}

function fieldText(code: string, message: string, translate: UplTranslate): string {
  const key = uplErrorKey(code);
  const text = translate(key);
  return text === key ? `${message} (${code})` : text;
}

/** Отказ сервера → тексты по местам формы; неизвестный код не прячем — он уходит полосой над формой. */
export function mapUplUploadProblem(
  problem: ProblemDetail | null | undefined,
  translate: UplTranslate
): UplPackageFormErrors {
  const errors = emptyErrors();
  if (problem && (problem.code ?? '').toLowerCase() === FILE_SIZE_CODE) {
    add(errors, 'file', translate(uplErrorKey('UPL_PKG_FILE_TOO_LARGE')));
    return errors;
  }
  const fields = problem?.status === 422 ? problem.errors ?? [] : [];
  if (fields.length > 0) {
    for (const field of fields) {
      add(errors, FIELD_PLACE[field.field] ?? 'form', fieldText(field.code, field.message, translate));
    }
    return errors;
  }
  const detail = problem?.detail ?? '';
  if (SOURCE_DETAILS.includes(detail)) {
    add(errors, 'source', translate(uplErrorKey(detail)));
    return errors;
  }
  add(errors, 'form', uplProblemText(problem, translate));
  return errors;
}

export function hasUplFormErrors(errors: UplPackageFormErrors): boolean {
  return errors.source.length > 0 || errors.period.length > 0 || errors.file.length > 0 || errors.form.length > 0;
}
