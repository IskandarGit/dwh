import { createHash } from 'node:crypto';

import {
  devices,
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { loginToInstance } from '../../../support/auth.js';
import { loadE2eEnv } from '../../../support/env.mjs';
import { clearSecret, fillSecret } from '../../../support/secret.js';

const environment = loadE2eEnv();
const desktopViewport = { width: 1366, height: 900 } as const;
const mobileViewport = { width: 390, height: 844 } as const;
const rotatedInstancePassword = `E2e!${createHash('sha256')
  .update(environment.instance.password)
  .digest('base64url')
  .slice(0, 24)}`;

type LoginOutcome = 'alert' | 'mandatory-change' | 'tasks';

function deriveSecret(label: string, seed: string): string {
  return `${label}!${createHash('sha256').update(seed).digest('base64url').slice(0, 24)}`;
}

function collectConsoleHealth(page: Page, allowedForbiddenPaths: readonly string[] = []): () => void {
  const unexpected: string[] = [];
  const forbiddenResponses: string[] = [];
  const allowedForbidden = new Set(allowedForbiddenPaths);
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/^Failed to load resource: the server responded with a status of (?:401|422) \(\)$/u.test(text)) return;
    if (allowedForbidden.size > 0
      && /^Failed to load resource: the server responded with a status of 403 \(\)$/u.test(text)) return;
    unexpected.push(text);
  });
  page.on('pageerror', error => unexpected.push(error.message));
  page.on('response', response => {
    if (response.status() === 403) {
      const identity = `${response.request().method()} ${new URL(response.url()).pathname}`;
      if (!allowedForbidden.has(identity)) forbiddenResponses.push(identity);
    }
  });
  return () => {
    expect(forbiddenResponses, 'unexpected HTTP 403 responses').toEqual([]);
    expect(unexpected, 'unexpected browser console/page errors').toEqual([]);
  };
}

async function expectNoFrameworkOverlay(page: Page): Promise<void> {
  await expect(page.locator([
    'vite-error-overlay',
    'webpack-dev-server-client-overlay',
    '#webpack-dev-server-client-overlay',
    'nextjs-portal',
  ].join(','))).toHaveCount(0);
}

async function expectLoginSurface(page: Page): Promise<void> {
  await expect(page).toHaveTitle('SmartupCMS');
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/u);
  await expect(page.getByRole('heading', { name: 'Корпоративный вход' })).toBeVisible();
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveValue('');
  await expect.poll(() => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual(await page.evaluate(() => ({
    clientWidth: window.innerWidth,
    scrollWidth: window.innerWidth,
  })));
  await expectNoFrameworkOverlay(page);
}

async function submitCredentials(page: Page, login: string, passwordValue: string, expectedAlert?: RegExp): Promise<LoginOutcome> {
  await page.goto('/login');
  await page.getByLabel('Логин или Email').fill(login);
  const password = page.getByLabel('Пароль', { exact: true });
  try {
    await fillSecret(password, passwordValue);
    await page.getByRole('button', { name: 'Войти в систему' }).click();
    await expect.poll(async () => {
      if (/\/tasks(?:\?.*)?$/u.test(page.url())) return 'tasks';
      if (await page.getByText('Смена временного пароля', { exact: true }).isVisible().catch(() => false)) {
        return 'mandatory-change';
      }
      if (await page.getByRole('alert').first().isVisible().catch(() => false)) return 'alert';
      return 'pending';
    }).not.toBe('pending');
    // Secret cleanup is an input edit, which clears stale inline feedback.
    if (expectedAlert) await expect(page.getByRole('alert').first()).toContainText(expectedAlert);
  } finally {
    await clearSecret(password);
  }

  if (/\/tasks(?:\?.*)?$/u.test(page.url())) return 'tasks';
  if (await page.getByText('Смена временного пароля', { exact: true }).isVisible().catch(() => false)) {
    return 'mandatory-change';
  }
  return 'alert';
}

async function expectStatus(response: APIResponse, expected: number, operation: string): Promise<void> {
  const actual = response.status();
  await response.dispose();
  if (actual !== expected) throw new Error(`${operation} returned HTTP ${actual}, expected ${expected}`);
}

async function csrfHeaders(context: BrowserContext): Promise<Record<string, string>> {
  const cookies = await context.cookies(environment.instance.baseURL);
  const csrf = cookies.find(cookie => cookie.name === 'XSRF-TOKEN');
  if (!csrf?.value) throw new Error('Authenticated browser context has no CSRF cookie');
  return { 'X-XSRF-TOKEN': csrf.value };
}

async function createSyntheticUser(
  adminContext: BrowserContext,
  roleId: number,
  user: { name: string; login: string; email: string; password: string },
): Promise<number> {
  const response = await adminContext.request.post('/api/v1/iam/users', {
    headers: await csrfHeaders(adminContext),
    data: {
      name: user.name,
      login: user.login,
      email: user.email,
      password: user.password,
      language: 'ru',
      timezone: 'Asia/Tashkent',
      is2faEnabled: false,
      forcePasswordChange: false,
      roleIds: [roleId],
      attributes: {},
    },
  });
  const status = response.status();
  if (status !== 201) {
    await response.dispose();
    throw new Error(`Synthetic user setup returned HTTP ${status}, expected 201`);
  }
  const body = await response.json() as { id?: unknown };
  await response.dispose();
  if (!Number.isInteger(body.id)) throw new Error('Synthetic user setup returned no numeric id');
  return Number(body.id);
}

async function createApiToken(context: BrowserContext, name: string): Promise<string> {
  const response = await context.request.post('/api/v1/iam/profile/tokens', {
    headers: await csrfHeaders(context),
    data: { name },
  });
  const status = response.status();
  if (status !== 201) {
    await response.dispose();
    throw new Error(`API token setup returned HTTP ${status}, expected 201`);
  }
  const body = await response.json() as { rawSecretToken?: unknown };
  await response.dispose();
  if (typeof body.rawSecretToken !== 'string' || !body.rawSecretToken.startsWith('dwh_')) {
    throw new Error('API token setup returned no usable raw token');
  }
  return body.rawSecretToken;
}

async function loginSyntheticUser(page: Page, login: string, password: string): Promise<void> {
  expect(await submitCredentials(page, login, password)).toBe('tasks');
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
}

function profilePasswordFields(page: Page): readonly [Locator, Locator, Locator] {
  return [
    page.locator('#profile-current-password'),
    page.locator('#profile-new-password'),
    page.locator('#profile-confirm-password'),
  ] as const;
}

async function fillProfilePasswordForm(
  fields: readonly [Locator, Locator, Locator],
  currentValue: string,
  newValue: string,
): Promise<void> {
  const [current, next, confirmation] = fields;
  await fillSecret(current, currentValue);
  await fillSecret(next, newValue);
  await fillSecret(confirmation, newValue);
}

async function clearPasswordFields(fields: readonly Locator[]): Promise<void> {
  await Promise.all(fields.map(field => clearSecret(field)));
}

async function screenshotClearedLogin(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await expectLoginSurface(page);
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: false });
}

test.describe.serial('authentication generation password-change acceptance', () => {
  test('bootstrap mandatory change returns to login and requires explicit second credentials', async ({ page }, testInfo) => {
    const assertConsoleHealthy = collectConsoleHealth(page);
    const initialOutcome = await submitCredentials(
      page,
      environment.instance.login,
      environment.instance.password,
    );

    if (initialOutcome === 'mandatory-change') {
      const next = page.getByLabel('Новый пароль', { exact: true });
      const confirmation = page.getByLabel('Повторите новый пароль', { exact: true });
      try {
        await fillSecret(next, rotatedInstancePassword);
        await fillSecret(confirmation, rotatedInstancePassword);
        await page.getByRole('button', { name: 'Сменить пароль', exact: true }).click();
        await expect(page.getByText(
          'Пароль изменён. Войдите снова с новым паролем.',
          { exact: true },
        )).toBeVisible();
        await screenshotClearedLogin(page, testInfo, 'bootstrap-password-changed-desktop.png');
      } finally {
        await clearPasswordFields([next, confirmation]);
      }
    } else {
      expect(initialOutcome, 'a reused candidate must reject the original bootstrap password').toBe('alert');
      await expectLoginSurface(page);
    }

    expect(await submitCredentials(page, environment.instance.login, rotatedInstancePassword)).toBe('tasks');
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    assertConsoleHealthy();
  });

  test('profile change rejects bad attempts, revokes two sessions and two tokens, and leaves another user active', async ({ browser, page }, testInfo) => {
    test.slow();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const subject = {
      name: `Password subject ${suffix}`,
      login: `pw-subject-${suffix}`,
      email: `pw-subject-${suffix}@example.test`,
      password: deriveSecret('Start', suffix),
    };
    const unaffected = {
      name: `Password unaffected ${suffix}`,
      login: `pw-unaffected-${suffix}`,
      email: `pw-unaffected-${suffix}@example.test`,
      password: deriveSecret('Other', suffix),
    };
    const nextPassword = deriveSecret('Next', suffix);
    const wrongCurrentPassword = deriveSecret('Wrong', suffix);
    const policyRejectedPassword = 'password1234';
    const createdUserIds: number[] = [];
    const subjectContexts: BrowserContext[] = [];
    let unaffectedContext: BrowserContext | undefined;
    const tokenContexts: APIRequestContext[] = [];

    await loginToInstance(page);
    const assertAdminConsoleHealthy = collectConsoleHealth(page);
    const rolesResponse = await page.context().request.get('/api/v1/iam/roles');
    if (rolesResponse.status() !== 200) {
      const status = rolesResponse.status();
      await rolesResponse.dispose();
      throw new Error(`Role lookup returned HTTP ${status}, expected 200`);
    }
    const roles = await rolesResponse.json() as Array<{ id: number; pcode: string }>;
    await rolesResponse.dispose();
    const nonAdminRole = roles.find(role => role.pcode === 'manager');
    if (!nonAdminRole) throw new Error('Built-in non-admin manager role is unavailable');

    try {
      createdUserIds.push(await createSyntheticUser(page.context(), nonAdminRole.id, subject));
      createdUserIds.push(await createSyntheticUser(page.context(), nonAdminRole.id, unaffected));

      for (let index = 0; index < 2; index++) {
        const context = await browser.newContext({
          ...devices['Desktop Chrome'],
          baseURL: environment.instance.baseURL,
          locale: 'ru-RU',
          timezoneId: 'Asia/Tashkent',
          reducedMotion: 'reduce',
          viewport: desktopViewport,
        });
        subjectContexts.push(context);
        await loginSyntheticUser(await context.newPage(), subject.login, subject.password);
      }

      unaffectedContext = await browser.newContext({
        ...devices['Desktop Chrome'],
        baseURL: environment.instance.baseURL,
        locale: 'ru-RU',
        timezoneId: 'Asia/Tashkent',
        reducedMotion: 'reduce',
        viewport: desktopViewport,
      });
      const unaffectedPage = await unaffectedContext.newPage();
      await loginSyntheticUser(unaffectedPage, unaffected.login, unaffected.password);
      const assertUnaffectedConsoleHealthy = collectConsoleHealth(
        unaffectedPage,
        ['GET /api/v1/custom-fields'],
      );

      const rawTokens = [
        await createApiToken(subjectContexts[0], `first-${suffix}`),
        await createApiToken(subjectContexts[1], `second-${suffix}`),
      ];
      for (const rawToken of rawTokens) {
        const tokenContext = await playwrightRequest.newContext({
          baseURL: environment.instance.baseURL,
          extraHTTPHeaders: { Authorization: `Bearer ${rawToken}` },
        });
        tokenContexts.push(tokenContext);
        await expectStatus(await tokenContext.get('/api/v1/auth/me'), 200, 'Pre-change API token check');
      }
      for (const context of subjectContexts) {
        await expectStatus(await context.request.get('/api/v1/auth/me'), 200, 'Pre-change session check');
      }
      await expectStatus(
        await unaffectedContext.request.get('/api/v1/auth/me'),
        200,
        'Pre-change unaffected-user check',
      );

      const subjectPage = subjectContexts[0].pages()[0];
      const assertSubjectConsoleHealthy = collectConsoleHealth(
        subjectPage,
        ['GET /api/v1/custom-fields'],
      );
      await subjectPage.goto('/iam/profile');
      await expect(subjectPage).toHaveTitle('SmartupCMS');
      await expect(subjectPage.getByRole('heading', { name: 'Мой профиль' })).toBeVisible();
      await expectNoFrameworkOverlay(subjectPage);

      const fields = profilePasswordFields(subjectPage);
      try {
        await fillProfilePasswordForm(fields, wrongCurrentPassword, nextPassword);
        const wrongCurrentResponse = subjectPage.waitForResponse(response =>
          response.request().method() === 'POST'
            && response.url().endsWith('/api/v1/iam/users/me/password'),
        { timeout: 10_000 });
        await subjectPage.getByRole('button', { name: 'Обновить пароль', exact: true }).click({ timeout: 10_000 });
        expect((await wrongCurrentResponse).status(), 'Wrong-current-password HTTP status').toBe(401);
        await expect(subjectPage.getByText('Неверный текущий пароль', { exact: true }).first()).toBeVisible();
        expect(await Promise.all(fields.map(field => field.evaluate(input => Boolean((input as HTMLInputElement).value)))))
          .toEqual([true, true, true]);
      } finally {
        await clearPasswordFields(fields);
      }

      try {
        await fillProfilePasswordForm(fields, subject.password, policyRejectedPassword);
        const policyResponse = subjectPage.waitForResponse(response =>
          response.request().method() === 'POST'
            && response.url().endsWith('/api/v1/iam/users/me/password'),
        { timeout: 10_000 });
        await subjectPage.getByRole('button', { name: 'Обновить пароль', exact: true }).click({ timeout: 10_000 });
        expect((await policyResponse).status(), 'Password-policy HTTP status').toBe(422);
        await expect(subjectPage.getByText(/слишком прост/u).first()).toBeVisible();
        expect(await Promise.all(fields.map(field => field.evaluate(input => Boolean((input as HTMLInputElement).value)))))
          .toEqual([true, true, true]);
      } finally {
        await clearPasswordFields(fields);
      }

      try {
        await fillProfilePasswordForm(fields, subject.password, nextPassword);
        const successResponse = subjectPage.waitForResponse(response =>
          response.request().method() === 'POST'
            && response.url().endsWith('/api/v1/iam/users/me/password'),
        { timeout: 10_000 });
        await subjectPage.getByRole('button', { name: 'Обновить пароль', exact: true }).click({ timeout: 10_000 });
        expect((await successResponse).status(), 'Successful profile password-change HTTP status').toBe(204);
        await expect(subjectPage.getByText(
          'Пароль изменён. Войдите снова с новым паролем.',
          { exact: true },
        )).toBeVisible();
        await expect(subjectPage.locator('.toast-error')).toHaveCount(0);
        await expect(subjectPage.locator('.toast-item')).toHaveCount(1);
        await screenshotClearedLogin(subjectPage, testInfo, 'profile-password-changed-desktop.png');
        await subjectPage.setViewportSize(mobileViewport);
        await screenshotClearedLogin(subjectPage, testInfo, 'profile-password-changed-mobile.png');
        await subjectPage.setViewportSize(desktopViewport);
      } finally {
        await clearPasswordFields(fields);
      }

      for (const context of subjectContexts) {
        await expectStatus(await context.request.get('/api/v1/auth/me'), 401, 'Revoked old session check');
      }
      for (const tokenContext of tokenContexts) {
        await expectStatus(await tokenContext.get('/api/v1/auth/me'), 401, 'Revoked old API token check');
      }
      await expectStatus(
        await unaffectedContext.request.get('/api/v1/auth/me'),
        200,
        'Post-change unaffected-user check',
      );
      await unaffectedPage.goto('/tasks');
      await expect(unaffectedPage.getByRole('heading', { name: 'Задачи', exact: true })).toBeVisible();

      expect(await submitCredentials(subjectPage, subject.login, subject.password, /Неверн/u)).toBe('alert');
      expect(await submitCredentials(subjectPage, subject.login, nextPassword)).toBe('tasks');
      await expect(subjectPage.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();

      assertSubjectConsoleHealthy();
      assertUnaffectedConsoleHealthy();
    } finally {
      for (const tokenContext of tokenContexts) await tokenContext.dispose();
      for (const context of subjectContexts) await context.close();
      if (unaffectedContext) await unaffectedContext.close();
      for (const userId of createdUserIds) {
        const response = await page.context().request.delete(`/api/v1/iam/users/${userId}`, {
          headers: await csrfHeaders(page.context()),
        });
        await expectStatus(response, 204, 'Synthetic user cleanup');
      }
      assertAdminConsoleHealthy();
    }
  });
});
