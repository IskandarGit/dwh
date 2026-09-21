import { expect, test } from '@playwright/test';

import { loginToInstance } from '../../../support/auth.js';

test('translation override repaints live, persists across sessions, and keeps Russian fallback', async ({ browser, page }) => {
  const marker = `E2E-Save-${Date.now()}`;
  await loginToInstance(page);
  const languageSelector = page.locator('#app-language-selector');
  const originalLanguage = await languageSelector.inputValue();
  let originalGerman = '';
  let overrideSaved = false;

  const openGermanEditor = async () => {
    await page.goto('/settings');
    await page.locator('#settings-languages-tab').click();
    await page.getByTestId('edit-language-de').click();
    return page.locator('[data-translation-key="common.save"] input');
  };

  const persistLanguageChange = async (language: string, action: () => Promise<unknown>) => {
    // The UI activates the dictionary before the preference PATCH completes.
    // Navigation or context teardown must not cancel persistence (including cleanup).
    const persisted = page.waitForResponse(response =>
      response.request().method() === 'PATCH'
      && response.url().endsWith('/api/v1/settings/user')
      && response.request().postDataJSON()?.['user.language'] === language
    );
    await action();
    const response = await persisted;
    const headers = await response.request().allHeaders();
    const csrfCookies = (headers.cookie ?? '').split(';').map(cookie => cookie.trim())
      .filter(cookie => cookie.startsWith('XSRF-TOKEN='));
    const csrfMatches = csrfCookies.some(cookie => cookie.slice('XSRF-TOKEN='.length) === headers['x-xsrf-token']);
    expect(response.status(), `language preference response; CSRF cookie count=${csrfCookies.length}, header matches cookie=${csrfMatches}`)
      .toBe(204);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
  };

  try {
    const translation = await openGermanEditor();
    originalGerman = await translation.inputValue();
    await translation.fill(marker);
    await page.getByTestId('language-editor-save').click();
    await expect(page.getByText('Переводы успешно сохранены')).toBeVisible();
    overrideSaved = true;

    await page.getByTestId('language-editor-close').click();
    await persistLanguageChange('de', () => languageSelector.selectOption('de'));

    await page.goto('/settings');
    await expect(page.getByRole('button', { name: marker, exact: true })).toBeVisible();
    await page.locator('#settings-languages-tab').click();
    await expect(page.getByRole('heading', {
      name: /Sprachpakete und Lokalisierung verwalten|Управление языковыми пакетами и локализацией/
    })).toBeVisible();

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    try {
      await loginToInstance(secondPage);
      await expect(secondPage.locator('html')).toHaveAttribute('lang', 'de');
      await secondPage.goto('/settings');
      await expect(secondPage.getByRole('button', { name: marker, exact: true })).toBeVisible();
    } finally {
      await secondContext.close();
    }
  } finally {
    if (overrideSaved) {
      const translation = await openGermanEditor();
      await translation.fill(originalGerman);
      await page.getByTestId('language-editor-save').click();
      await expect(page.getByText('Переводы успешно сохранены')).toBeVisible();
    }
    await persistLanguageChange(originalLanguage || 'ru',
      () => page.locator('#app-language-selector').selectOption(originalLanguage || 'ru'));
  }
});
