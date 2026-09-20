import { PACKAGED_RUSSIAN } from '../app/core/i18n/packaged-russian';

export function translateTest(
  key: string,
  params?: Record<string, string | number>
): string {
  const template = PACKAGED_RUSSIAN[key] ?? key;
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder: string, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder
  );
}
