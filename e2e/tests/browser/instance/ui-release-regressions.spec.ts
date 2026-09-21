import { expect, test, type Locator, type Page } from '@playwright/test';

import { loginToInstance } from '../../../support/auth.js';

const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

async function expectInsideViewport(locator: Locator, viewportWidth: number): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth);
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({
    documentFits: document.documentElement.scrollWidth <= window.innerWidth,
    contentFits: Array.from(document.querySelectorAll<HTMLElement>('.page-content'))
      .every(element => element.scrollWidth <= element.clientWidth)
  }))).toEqual({ documentFits: true, contentFits: true });
}

test('login brand keeps its product name outside the fixed mark', async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto('/login');

  const lockup = page.getByLabel('SmartupCMS');
  await expect(lockup.locator('.brand-mark')).toHaveText('S');
  await expect(lockup.locator('.brand-name')).toHaveText('SmartupCMS');
  await expectInsideViewport(lockup, MOBILE_VIEWPORT.width);
});

test('administrator global search uses the server contract and leaves loading state', async ({ page }) => {
  await loginToInstance(page);
  await page.keyboard.press('ControlOrMeta+k');

  const searchResponse = page.waitForResponse(response =>
    response.url().includes('/api/v1/search?') && response.url().includes('entity=ALL'));
  await page.getByRole('combobox', { name: 'Поиск задач, проектов и пользователей' }).fill('admin');

  expect((await searchResponse).ok()).toBe(true);
  await expect(page.locator('.palette-loading')).toBeHidden();
  await expect(page.locator('.palette-error')).toHaveCount(0);
});

test('critical pages and create forms fit a mobile viewport', async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await loginToInstance(page);

  const routes = [
    { path: '/tasks', heading: 'Задачи', action: 'Новая задача' },
    { path: '/analytics', heading: 'Аналитика и дашборды', action: 'Обновить' },
    { path: '/iam/users', heading: 'Пользователи', action: 'Новый пользователь' },
    { path: '/iam/profile', heading: 'Мой профиль' }
  ] as const;

  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
    await expectNoPageOverflow(page);
    if ('action' in route) {
      await expectInsideViewport(page.getByRole('button', { name: route.action, exact: true }), MOBILE_VIEWPORT.width);
    }
  }

  await page.goto('/tasks');
  await page.locator('.view-header').getByRole('button', { name: 'Новая задача', exact: true }).click();
  await page.waitForSelector('.modal-body');
  await expect.poll(() => page.locator('.modal-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.goto('/iam/users');
  await page.getByRole('button', { name: 'Новый пользователь', exact: true }).click();
  await expect.poll(() => page.locator('.modal-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('compact administration actions preserve a 28px minimum hit target', async ({ page }) => {
  await loginToInstance(page);
  await page.goto('/iam/roles');
  await expect(page.getByRole('heading', { level: 1, name: 'Роли и матрица прав' })).toBeVisible();

  for (const selector of ['.mini-btn', '.text-link', '.mod-pill-btn', '.batch-btn']) {
    const control = page.locator(selector).first();
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(28);
  }
});
