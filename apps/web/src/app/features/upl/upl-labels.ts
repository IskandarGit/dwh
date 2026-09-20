import { ProblemDetail } from '../../core/models/common.models';
import {
  UplDataType,
  UplEncoding,
  UplFileKind,
  UplMatchBy,
  UplPeriodicity,
  UplStrictness,
  UplVersionStatus
} from './upl-api';

/** Справочник «значение контракта → ключ i18n»: подписи живут в словарях, не в коде. */
export const UPL_PERIODICITY_KEY: Record<UplPeriodicity, string> = {
  month: 'upl.periodicity.month',
  quarter: 'upl.periodicity.quarter',
  year: 'upl.periodicity.year',
  adhoc: 'upl.periodicity.adhoc'
};

export const UPL_STRICTNESS_KEY: Record<UplStrictness, string> = {
  error: 'upl.strictness.error',
  warning: 'upl.strictness.warning'
};

export const UPL_VERSION_STATUS_KEY: Record<UplVersionStatus, string> = {
  draft: 'upl.version.status.draft',
  published: 'upl.version.status.published',
  superseded: 'upl.version.status.superseded'
};

export const UPL_DATA_TYPE_KEY: Record<UplDataType, string> = {
  text: 'upl.format.type.text',
  integer: 'upl.format.type.integer',
  number: 'upl.format.type.number',
  date: 'upl.format.type.date',
  object_key: 'upl.format.type.object_key',
  ref_code: 'upl.format.type.ref_code'
};

export const UPL_FILE_KIND_KEY: Record<UplFileKind, string> = {
  xlsx: 'upl.format.file_kind.xlsx',
  csv: 'upl.format.file_kind.csv'
};

export const UPL_ENCODING_KEY: Record<UplEncoding, string> = {
  'utf-8': 'upl.format.encoding.utf_8',
  'windows-1251': 'upl.format.encoding.windows_1251'
};

export const UPL_MATCH_BY_KEY: Record<UplMatchBy, string> = {
  header: 'upl.format.match_by.header',
  position: 'upl.format.match_by.position'
};

/** Код ошибки контракта (`UPL_*`, `STALE_VERSION`, `FND_VERSION_*`, `VALIDATION_FAILED`, `PERMISSION_DENIED`) → ключ словаря. */
export function uplErrorKey(code: string): string {
  return 'upl.err.' + code;
}

/** Текст ошибки сервера: подкод (`detail`) → ключ `upl.err.*`; неизвестный код не прячем — `detail (code)`. */
export function uplProblemText(problem: ProblemDetail | null | undefined, translate: (key: string) => string): string {
  const detail = problem?.detail ?? '';
  const key = uplErrorKey(detail);
  const text = translate(key);
  return text === key ? `${detail} (${problem?.code ?? ''})` : text;
}
