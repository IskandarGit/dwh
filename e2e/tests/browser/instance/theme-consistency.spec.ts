import { expect, test, type Locator, type Page } from '@playwright/test';

import { loginToInstance } from '../../../support/auth.js';
import { collectPageErrors } from '../../../support/diagnostics.js';

type CssColorProperty = 'background-color' | 'border-top-color' | 'color';
type ColorContract = Partial<Record<CssColorProperty, string>>;

const LIGHT = {
  surface: 'rgb(255, 255, 255)',
  border: 'rgb(226, 232, 240)',
  text: 'rgb(15, 23, 42)',
  primary: 'rgb(3, 105, 161)',
} as const;

const DARK = {
  surface: 'rgb(19, 27, 46)',
  border: 'rgb(30, 41, 59)',
  text: 'rgb(241, 245, 249)',
} as const;

const ROUTE_SURFACES = [
  { route: '/files', selector: '.metric-card' },
  { route: '/files', selector: '.table-container' },
  { route: '/audit', selector: '.filter-select' },
  { route: '/audit', selector: '.table-container' },
  { route: '/settings', selector: '.settings-card' },
  { route: '/settings', selector: '.settings-card .form-input' },
  { route: '/iam/custom-fields', selector: '.table-card' },
] as const;

test.use({ viewport: { width: 1440, height: 900 } });

async function expectColors(locator: Locator, expected: ColorContract): Promise<void> {
  await expect(locator).toBeVisible();
  const propertyNames = Object.keys(expected) as CssColorProperty[];
  await expect.poll(async () => locator.evaluate((element, properties) => {
    const computed = getComputedStyle(element);
    return Object.fromEntries(properties.map(property => [property, computed.getPropertyValue(property)]));
  }, propertyNames)).toEqual(expected);
}

async function ensureTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Переключить тему' });
  const isDark = await toggle.getAttribute('aria-pressed') === 'true';
  if ((theme === 'dark') !== isDark) {
    await toggle.click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function expectOverlayShadow(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect.poll(async () => locator.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
}

test('light theme keeps every content surface and form control light', async ({ page }, testInfo) => {
  await loginToInstance(page);
  const assertNoPageErrors = collectPageErrors(page);
  await ensureTheme(page, 'light');

  for (const surface of ROUTE_SURFACES) {
    await page.goto(surface.route);
    await ensureTheme(page, 'light');
    await expectColors(page.locator(surface.selector).first(), {
      'background-color': LIGHT.surface,
      'border-top-color': LIGHT.border,
      color: LIGHT.text,
    });
  }

  await page.goto('/iam/custom-fields');
  await ensureTheme(page, 'light');
  await page.locator('.view-header').getByRole('button', { name: 'Добавить поле' }).click();
  await expectColors(page.locator('.modal-form .form-input').first(), {
    'background-color': LIGHT.surface,
    'border-top-color': LIGHT.border,
    color: LIGHT.text,
  });

  await page.goto('/tasks');
  await page.locator('.view-header').getByRole('button', { name: 'Новая задача' }).click();
  await expectColors(page.locator('.custom-fields-empty-tip .tip-icon'), {
    color: LIGHT.primary,
  });
  const parentTaskSelect = page.getByRole('button', { name: 'Родительская задача' });
  await parentTaskSelect.click();
  await expectOverlayShadow(page.locator('.dropdown-popover'));
  await parentTaskSelect.click();
  await expect(page.locator('.dropdown-popover')).toBeHidden();
  await page.getByRole('button', { name: 'Наблюдатели' }).click();
  await expectOverlayShadow(page.locator('.dropdown-panel'));

  await page.goto('/settings');
  await ensureTheme(page, 'light');
  await page.screenshot({ path: testInfo.outputPath('settings-light.png'), fullPage: false });

  assertNoPageErrors();
});

test('theme toggle applies canonical dark surfaces across the affected pages', async ({ page }, testInfo) => {
  await loginToInstance(page);
  const assertNoPageErrors = collectPageErrors(page);
  await page.goto('/settings');
  await ensureTheme(page, 'light');

  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page).toHaveURL(/\/settings$/u);

  for (const surface of ROUTE_SURFACES) {
    await page.goto(surface.route);
    await ensureTheme(page, 'dark');
    await expectColors(page.locator(surface.selector).first(), {
      'background-color': DARK.surface,
      'border-top-color': DARK.border,
      color: DARK.text,
    });
  }

  await page.goto('/iam/custom-fields');
  await ensureTheme(page, 'dark');
  await page.locator('.view-header').getByRole('button', { name: 'Добавить поле' }).click();
  await expectColors(page.locator('.modal-form .form-input').first(), {
    'background-color': DARK.surface,
    'border-top-color': DARK.border,
    color: DARK.text,
  });

  await page.goto('/settings');
  await ensureTheme(page, 'dark');
  await page.screenshot({ path: testInfo.outputPath('settings-dark.png'), fullPage: false });

  assertNoPageErrors();
});
