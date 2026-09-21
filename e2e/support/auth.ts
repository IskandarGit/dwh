import { createHash } from 'node:crypto';

import { expect, type Page } from '@playwright/test';

import { loadE2eEnv } from './env.mjs';
import { clearSecret, fillSecret } from './secret.js';

const environment = loadE2eEnv();
const rotatedInstancePassword = `E2e!${createHash('sha256')
  .update(environment.instance.password)
  .digest('base64url')
  .slice(0, 24)}`;
let activeInstancePassword = environment.instance.password;

type LoginOutcome = 'tasks' | 'mandatory-change' | 'alert';

async function submitInstanceCredentials(page: Page, passwordValue: string): Promise<LoginOutcome> {
  await page.goto('/login');
  await page.getByLabel('Логин или Email').fill(environment.instance.login);
  const password = page.getByLabel('Пароль', { exact: true });
  try {
    await fillSecret(password, passwordValue);
    await page.getByRole('button', { name: 'Войти в систему' }).click();
    await Promise.race([
      page.waitForURL(/\/tasks(?:\?.*)?$/u),
      page.getByText('Смена временного пароля', { exact: true }).waitFor(),
      page.locator('#login-error').waitFor(),
    ]);
    // Editing/clearing a field intentionally removes stale inline errors.
    // Capture the outcome before the secret-cleanup input event runs.
    if (/\/tasks(?:\?.*)?$/u.test(page.url())) return 'tasks';
    if (await page.getByText('Смена временного пароля', { exact: true }).isVisible()) return 'mandatory-change';
    return 'alert';
  } finally {
    await clearSecret(password);
  }
}

async function completeMandatoryPasswordChange(page: Page): Promise<void> {
  const newPassword = page.getByLabel('Новый пароль', { exact: true });
  const confirmation = page.getByLabel('Повторите новый пароль', { exact: true });
  try {
    await fillSecret(newPassword, rotatedInstancePassword);
    await fillSecret(confirmation, rotatedInstancePassword);
    await page.getByRole('button', { name: 'Сменить пароль', exact: true }).click();
    await expect(page.getByText('Пароль изменён. Войдите снова с новым паролем.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  } finally {
    await Promise.all([clearSecret(newPassword), clearSecret(confirmation)]);
  }
  activeInstancePassword = rotatedInstancePassword;
  await submitInstanceCredentials(page, activeInstancePassword);
}

export async function loginToInstance(page: Page): Promise<void> {
  const outcome = await submitInstanceCredentials(page, activeInstancePassword);

  if (outcome === 'mandatory-change') {
    await completeMandatoryPasswordChange(page);
  } else if (outcome === 'alert'
    && activeInstancePassword !== rotatedInstancePassword) {
    activeInstancePassword = rotatedInstancePassword;
    await submitInstanceCredentials(page, activeInstancePassword);
  }

  await expect(page).toHaveURL(/\/tasks(?:\?.*)?$/u);
  const isMobile = (page.viewportSize()?.width ?? 1280) < 768;
  if (isMobile) {
    await expect(page.locator('.mobile-menu-btn')).toBeVisible();
  } else {
    await expect(page.locator('nav.sidebar-nav')).toBeVisible();
  }
}
