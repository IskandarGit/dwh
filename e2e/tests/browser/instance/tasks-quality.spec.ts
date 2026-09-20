import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

import { loginToInstance } from '../../../support/auth.js';
import { collectPageErrors, uniqueRunName } from '../../../support/diagnostics.js';
import { loadE2eEnv } from '../../../support/env.mjs';

const environment = loadE2eEnv();

const LIGHT_STATUS_COLORS = {
  backgroundColor: 'rgb(255, 255, 255)',
  color: 'rgb(15, 23, 42)',
} as const;

const DARK_STATUS_COLORS = {
  backgroundColor: 'rgb(19, 27, 46)',
  color: 'rgb(241, 245, 249)',
} as const;

type StatusColors = {
  backgroundColor: string;
  color: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function taskFixture(id: number, title = `Mock task ${String(id).padStart(3, '0')}`) {
  return {
    id,
    projectId: null,
    parentTaskId: null,
    title,
    descriptionMarkdown: '',
    statusId: 1,
    priority: 'medium',
    reporterId: 1,
    attributes: { task_type: 'task' },
    beginTime: null,
    endTime: null,
    resolvedTime: null,
    createdAt: '2026-09-05T12:00:00Z',
    modifiedAt: '2026-09-05T12:00:00Z',
    createdBy: 1,
    modifiedBy: 1,
  };
}

async function ensureTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Переключить тему' });
  const isDark = await toggle.getAttribute('aria-pressed') === 'true';
  if ((theme === 'dark') !== isDark) await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function expectStatusColors(select: Locator, expected: StatusColors): Promise<void> {
  await expect(select).toBeVisible();
  await expect.poll(async () => select.evaluate((element) => {
    const style = getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, color: style.color };
  })).toEqual(expected);
}

async function expectSelectedObserver(dialog: Locator, expectedName: string): Promise<void> {
  const selectedObservers = dialog.locator('.user-tag .user-name');
  await expect(selectedObservers).toHaveCount(1);
  await expect(selectedObservers).toHaveText(expectedName);
}

async function createTaskThroughUi(
  page: Page,
  title: string,
  options: { deadline?: string; observeAsLogin?: string; expectEmptyState?: boolean } = {},
): Promise<string> {
  await page.goto('/tasks');
  if (options.expectEmptyState) {
    await expect(page.locator('.empty-state-cell').getByRole('button', { name: 'Новая задача' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Новая задача' })).toHaveCount(2);
  }
  await page.locator('.view-header').getByRole('button', { name: 'Новая задача' }).click();
  const dialog = page.getByRole('dialog', { name: 'Создание новой задачи' });
  await dialog.getByLabel('Название задачи').fill(title);
  let selectedObserverName = '';

  if (options.deadline) {
    await dialog.locator('#task-create-deadline').fill(options.deadline);
  }

  if (options.observeAsLogin) {
    await dialog.getByRole('button', { name: 'Наблюдатели' }).click();
    const observer = dialog.getByRole('option').filter({ hasText: `@${options.observeAsLogin}` });
    await expect(observer).toBeVisible();
    selectedObserverName = (await observer.locator('.u-name').innerText()).trim();
    expect(selectedObserverName).not.toBe('');
    await observer.click();
    await dialog.getByLabel('Название задачи').click();
  }

  const response = page.waitForResponse(candidate =>
    candidate.request().method() === 'POST' && candidate.url().endsWith('/api/v1/tasks')
  );
  await dialog.getByRole('button', { name: 'Создать задачу' }).click();
  expect((await response).ok()).toBe(true);
  await expect(taskOpenButton(page, title)).toBeVisible();
  return selectedObserverName;
}

function taskOpenButton(page: Page, title: string): Locator {
  return page.getByRole('button', {
    name: new RegExp(`^Открыть задачу #\\d+: ${escapeRegExp(title)}$`, 'u'),
  }).first();
}

async function routeTaskList(page: Page, handler: (route: Route, url: URL) => Promise<void>): Promise<void> {
  await page.route('**/api/v1/tasks?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/v1/tasks') {
      await route.continue();
      return;
    }
    await handler(route, url);
  });
}

test('task edit round-trips and clears a local deadline while retaining observers and named comments', async ({ page }) => {
  const originalTitle = uniqueRunName('E2E tasks quality');
  const editedTitle = `${originalTitle} edited`;
  const comment = uniqueRunName('E2E named author');

  await loginToInstance(page);
  const assertNoPageErrors = collectPageErrors(page);
  const selectedObserverName = await createTaskThroughUi(page, originalTitle, {
    deadline: '2026-09-05T17:00',
    observeAsLogin: environment.instance.login,
  });

  const row = taskOpenButton(page, originalTitle).locator('xpath=ancestor::tr');
  await row.getByRole('button', { name: /Редактировать задачу #\d+/u }).press('Enter');
  const editDialog = page.getByRole('dialog', { name: 'Редактирование задачи' });
  await expect(editDialog).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(editDialog.locator('#task-edit-deadline')).toHaveValue('2026-09-05T17:00');
  await expectSelectedObserver(editDialog, selectedObserverName);

  const titleInput = editDialog.getByLabel('Название задачи');
  await titleInput.fill(editedTitle);
  await editDialog.getByRole('button', { name: 'Отмена' }).click();
  const discardDialog = page.getByRole('dialog', { name: 'Отменить редактирование?' });
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(editDialog).toBeVisible();
  await expect(titleInput).toHaveValue(editedTitle);

  const titlePatch = page.waitForResponse(candidate =>
    candidate.request().method() === 'PATCH' && /\/api\/v1\/tasks\/\d+$/u.test(candidate.url())
  );
  await editDialog.getByRole('button', { name: 'Сохранить изменения' }).click();
  expect((await titlePatch).ok()).toBe(true);
  await expect(taskOpenButton(page, editedTitle)).toBeVisible();

  const editedRow = taskOpenButton(page, editedTitle).locator('xpath=ancestor::tr');
  await editedRow.getByRole('button', { name: /Редактировать задачу #\d+/u }).click();
  await expect(editDialog.locator('#task-edit-deadline')).toHaveValue('2026-09-05T17:00');
  await expectSelectedObserver(editDialog, selectedObserverName);

  await editDialog.locator('#task-edit-deadline').fill('');
  const clearPatch = page.waitForResponse(candidate =>
    candidate.request().method() === 'PATCH' && /\/api\/v1\/tasks\/\d+$/u.test(candidate.url())
  );
  await editDialog.getByRole('button', { name: 'Сохранить изменения' }).click();
  expect((await clearPatch).ok()).toBe(true);
  await expect(taskOpenButton(page, editedTitle)).toBeVisible();

  await taskOpenButton(page, editedTitle).locator('xpath=ancestor::tr')
    .getByRole('button', { name: /Редактировать задачу #\d+/u }).click();
  await expect(editDialog.locator('#task-edit-deadline')).toHaveValue('');
  await expectSelectedObserver(editDialog, selectedObserverName);
  await editDialog.getByRole('button', { name: 'Отмена' }).click();

  await taskOpenButton(page, editedTitle).click();
  const detailDialog = page.getByRole('dialog', { name: /Задача #\d+/u });
  await detailDialog.getByPlaceholder(/Написать комментарий/u).fill(comment);
  const commentResponse = page.waitForResponse(candidate =>
    candidate.request().method() === 'POST' && /\/api\/v1\/tasks\/\d+\/comments$/u.test(candidate.url())
  );
  await detailDialog.getByRole('button', { name: 'Отправить' }).click();
  expect((await commentResponse).ok()).toBe(true);
  const commentCard = detailDialog.locator('.comment-card').filter({ hasText: comment });
  await expect(commentCard).toBeVisible();
  await expect(commentCard.locator('.comment-author')).toContainText(selectedObserverName);
  await expect(commentCard.locator('.comment-author')).toContainText(`@${environment.instance.login}`);
  assertNoPageErrors();
});

test('cursor navigation reaches all 125 transport-controlled tasks exactly once', async ({ page }) => {
  await loginToInstance(page);
  await page.goto('/files');
  const requestedCursors: Array<string | null> = [];

  await routeTaskList(page, async (route, url) => {
    const cursor = url.searchParams.get('cursor');
    requestedCursors.push(cursor);
    const [start, end, nextCursor] = cursor === 'c100'
      ? [101, 125, null]
      : cursor === 'c50'
        ? [51, 100, 'c100']
        : [1, 50, 'c50'];
    await route.fulfill({
      contentType: 'application/json',
      json: {
        items: Array.from({ length: end - start + 1 }, (_, offset) => taskFixture(start + offset)),
        nextCursor,
        hasMore: nextCursor !== null,
      },
    });
  });

  await page.goto('/tasks');
  const seen = new Set<string>();
  const pages = [
    { count: 50, first: 'Mock task 001', last: 'Mock task 050' },
    { count: 50, first: 'Mock task 051', last: 'Mock task 100' },
    { count: 25, first: 'Mock task 101', last: 'Mock task 125' },
  ];
  for (const expectedPage of pages) {
    const visible = page.getByRole('button', { name: /^Открыть задачу #\d+: Mock task \d{3}$/u });
    await expect(taskOpenButton(page, expectedPage.first)).toBeVisible();
    await expect(taskOpenButton(page, expectedPage.last)).toBeVisible();
    await expect(visible).toHaveCount(expectedPage.count);
    for (const label of await visible.allTextContents()) seen.add(label.trim());
    if (expectedPage.count !== 25) {
      await page.getByRole('button', { name: 'Следующая страница' }).click();
    }
  }

  expect(seen.size).toBe(125);
  await expect(taskOpenButton(page, 'Mock task 125')).toBeVisible();
  expect(requestedCursors).toEqual([null, 'c50', 'c100']);
  await expect(page.getByText('Загружено: 25')).toBeVisible();
});

test('task list exposes a retry after an HTTP error and recovers the failed request', async ({ page }) => {
  await loginToInstance(page);
  await page.goto('/files');
  const assertNoPageErrors = collectPageErrors(page, [/503 \(Service Unavailable\)/u]);
  let attempts = 0;
  const requests: Array<{ method: string; path: string; query: string }> = [];

  await routeTaskList(page, async (route, url) => {
    attempts++;
    requests.push({ method: route.request().method(), path: url.pathname, query: url.search });
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', json: { message: 'controlled failure' } });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      json: { items: [taskFixture(901, 'Recovered task')], nextCursor: null, hasMore: false },
    });
  });

  await page.goto('/tasks');
  const alert = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить задачи.' });
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: 'Повторить' }).click();
  await expect(taskOpenButton(page, 'Recovered task')).toBeVisible();
  expect(attempts).toBe(2);
  expect(requests[1]).toEqual(requests[0]);
  assertNoPageErrors();
});

test('a late search response cannot replace the current task query', async ({ page }) => {
  await loginToInstance(page);
  await page.goto('/files');
  let releaseOld: (() => void) | undefined;
  const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
  let markOldStarted: (() => void) | undefined;
  const oldStarted = new Promise<void>(resolve => { markOldStarted = resolve; });
  let markOldCompleted: ((result: { error: unknown | null }) => void) | undefined;
  const oldCompleted = new Promise<{ error: unknown | null }>(resolve => { markOldCompleted = resolve; });

  await routeTaskList(page, async (route, url) => {
    const search = url.searchParams.get('search');
    if (search === 'old') {
      markOldStarted?.();
      await oldGate;
      try {
        await route.fulfill({
          contentType: 'application/json',
          json: { items: [taskFixture(801, 'Old stale task')], nextCursor: null, hasMore: false },
        });
        markOldCompleted?.({ error: null });
      } catch (error) {
        markOldCompleted?.({ error });
      }
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      json: {
        items: [taskFixture(search === 'new' ? 802 : 800, search === 'new' ? 'Current query task' : 'Initial task')],
        nextCursor: null,
        hasMore: false,
      },
    });
  });

  await page.goto('/tasks');
  const search = page.getByRole('textbox', { name: 'Поиск задач' });
  await search.fill('old');
  await oldStarted;
  await search.fill('new');
  await expect(taskOpenButton(page, 'Current query task')).toBeVisible();
  releaseOld?.();
  const oldResult = await oldCompleted;
  if (oldResult.error) throw oldResult.error;
  await expect(taskOpenButton(page, 'Current query task')).toBeVisible();
  await expect(taskOpenButton(page, 'Old stale task')).toHaveCount(0);
});

test('task creation uses the unambiguous header action when the first list is empty', async ({ page }) => {
  const title = uniqueRunName('E2E empty list create');
  await loginToInstance(page);
  await page.goto('/files');
  let taskListRequests = 0;

  await routeTaskList(page, async (route) => {
    taskListRequests++;
    if (taskListRequests === 1) {
      await route.fulfill({
        contentType: 'application/json',
        json: { items: [], nextCursor: null, hasMore: false },
      });
      return;
    }
    await route.continue();
  });

  await createTaskThroughUi(page, title, { expectEmptyState: true });
  expect(taskListRequests).toBeGreaterThanOrEqual(2);
  await expect(taskOpenButton(page, title)).toBeVisible();
});

test('kanban keeps visible filters and the 390px page contains horizontal overflow locally', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginToInstance(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Канбан' }).click();
  await expect(page.getByRole('region', { name: 'Канбан-доска задач' })).toBeVisible();
  const filterGroup = page.getByRole('group', { name: 'Фильтр по статусу' });
  await expect(filterGroup.getByRole('button', { name: 'Активные' })).toBeVisible();
  await expect(filterGroup.getByRole('button', { name: 'Все', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Новая задача' })).toBeVisible();

  await expect.poll(async () => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual({ clientWidth: 390, scrollWidth: 390 });
});

test('the real task status select uses semantic text and surface colors in both themes', async ({ page }) => {
  const title = uniqueRunName('E2E status color');
  await loginToInstance(page);
  await createTaskThroughUi(page, title);
  const statusSelect = taskOpenButton(page, title).locator('xpath=ancestor::tr').locator('.inline-status-select');

  await ensureTheme(page, 'light');
  await expectStatusColors(statusSelect, LIGHT_STATUS_COLORS);
  await ensureTheme(page, 'dark');
  await expectStatusColors(statusSelect, DARK_STATUS_COLORS);
});
