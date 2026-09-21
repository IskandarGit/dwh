import { UplPackageItem, UplPackageStatus } from './packages-api';

/** Статус загрузки → ключ словаря: подписи живут в `ru.json`, не в коде. */
export const UPL_PACKAGE_STATUS_KEY: Record<UplPackageStatus, string> = {
  received: 'upl.pkg.status.received',
  verified: 'upl.pkg.status.verified',
  rejected: 'upl.pkg.status.rejected',
  applied: 'upl.pkg.status.applied'
};

/** Статус загрузки → вариант `ui-badge`. */
export const UPL_PACKAGE_STATUS_VARIANT: Record<UplPackageStatus, string> = {
  received: 'neutral',
  verified: 'success',
  rejected: 'danger',
  applied: 'info'
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `2026-01-31` → `31.01.2026`; строку другого вида возвращаем как есть, чтобы не прятать данные сервера. */
export function formatUplDate(isoDate: string): string {
  const parts = ISO_DATE.exec(isoDate ?? '');
  return parts ? `${parts[3]}.${parts[2]}.${parts[1]}` : isoDate;
}

export function formatUplPeriod(from: string, to: string): string {
  return `${formatUplDate(from)}–${formatUplDate(to)}`;
}

/** Метка времени сервера в поясе браузера: `дд.мм.гггг чч:мм`; нечитаемую дату показываем как пришла. */
export function formatUplDateTime(isoInstant: string): string {
  const moment = new Date(isoInstant);
  if (Number.isNaN(moment.getTime())) return isoInstant;
  const day = `${pad(moment.getDate())}.${pad(moment.getMonth() + 1)}.${moment.getFullYear()}`;
  return `${day} ${pad(moment.getHours())}:${pad(moment.getMinutes())}`;
}

/** Строки загрузки «всего / принято / с ошибками»; пока файл не проверен — прочерк. */
export function uplPackageRowsText(item: UplPackageItem): string {
  const counted = item.status === 'verified' || item.status === 'applied';
  if (!counted || item.rowsTotal === null || item.rowsAccepted === null || item.rowsRejected === null) {
    return '—';
  }
  return `${item.rowsTotal} / ${item.rowsAccepted} / ${item.rowsRejected}`;
}
