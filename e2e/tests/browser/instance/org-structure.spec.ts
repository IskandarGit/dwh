import { randomBytes } from 'node:crypto';

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
  type TestInfo,
} from '@playwright/test';

import { loginToInstance } from '../../../support/auth.js';
import { clearSecret, fillSecret } from '../../../support/secret.js';

type ScopeRule = 'UNITS' | 'SUBTREE' | 'SELF';
type OrgUnit = {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  kind: string;
  state: string;
  orderNo: number;
};
type Role = { id: number; name: string };
type User = { id: number; name: string; login: string };
type TaskRecord = { id: number; title: string };
type TaskPage = { items: TaskRecord[] };
type UserAssignments = { userId: number; orgUnitIds: number[]; legacyOrgUnitId: number | null };
type Fixture = {
  root: OrgUnit;
  primary: OrgUnit;
  child: OrgUnit;
  other: OrgUnit;
  role: Role;
  actor: User;
  actorPassword: string;
  peer: User;
  childParticipant: User;
  otherParticipant: User;
  tasks: Record<'actor' | 'peer' | 'child' | 'other', TaskRecord>;
};

const runPrefix = `org-e2e-${Date.now()}-${randomBytes(4).toString('hex')}`;
const journeyCode = `${runPrefix}-journey`;
const fixtureNames = {
  journey: 'Тестовый отдел',
  primary: `${runPrefix} Основное подразделение`,
  child: `${runPrefix} Дочернее подразделение`,
  other: `${runPrefix} Другое подразделение`,
  role: `${runPrefix} Ограниченная роль`,
} as const;
const screenshotCases = [
  { width: 1366, height: 900, theme: 'light' },
  { width: 1366, height: 900, theme: 'dark' },
  { width: 390, height: 844, theme: 'light' },
  { width: 390, height: 844, theme: 'dark' },
] as const;

test('candidate-origin guard accepts a separate loopback port and rejects unsafe configuration', () => {
  expect(validatedCandidateOrigin('http://127.0.0.1:15208', 'http://127.0.0.1:15208')).toBe(
    'http://127.0.0.1:15208',
  );
  expect(() => validatedCandidateOrigin(undefined, 'http://127.0.0.1:15208')).toThrow(
    'requires an explicit isolated INSTANCE_BASE_URL',
  );
  expect(() => validatedCandidateOrigin(
    'http://127.0.0.1:15208',
    'http://127.0.0.1:15209',
  )).toThrow('must match the Playwright instance project origin');
  expect(() => validatedCandidateOrigin(
    'https://qa.example.invalid:15208',
    'https://qa.example.invalid:15208',
  )).toThrow('requires a separate loopback QA origin');
  expect(() => validatedCandidateOrigin('http://127.0.0.1:4200', 'http://127.0.0.1:4200')).toThrow(
    'never port 4200',
  );
});

let fixture: Fixture | undefined;
let qaOrigin: string | undefined;

function validatedCandidateOrigin(configured: string | undefined, baseURL: string | undefined): string {
  if (!configured?.trim() || !baseURL?.trim()) {
    throw new Error('Organization structure E2E requires an explicit isolated INSTANCE_BASE_URL');
  }
  let candidate: URL;
  let project: URL;
  try {
    candidate = new URL(configured);
    project = new URL(baseURL);
  } catch {
    throw new Error('Organization structure E2E requires a valid absolute INSTANCE_BASE_URL');
  }
  if (candidate.origin !== project.origin) {
    throw new Error('Organization structure INSTANCE_BASE_URL must match the Playwright instance project origin');
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(candidate.hostname)) {
    throw new Error('Organization structure E2E requires a separate loopback QA origin');
  }
  if (candidate.port === '4200') {
    throw new Error('Organization structure E2E requires a separate loopback QA origin, never port 4200');
  }
  if (!candidate.port
    || candidate.username
    || candidate.password
    || candidate.pathname !== '/'
    || candidate.search
    || candidate.hash) {
    throw new Error('Organization structure E2E requires a bare credential-free loopback origin with an explicit port');
  }
  return candidate.origin;
}

function candidateOrigin(): string {
  if (!qaOrigin) throw new Error('Organization structure candidate origin was not initialized');
  return qaOrigin;
}

test.beforeEach(async ({ baseURL }) => {
  qaOrigin = validatedCandidateOrigin(process.env.INSTANCE_BASE_URL, baseURL);
});

function currentFixture(): Fixture {
  if (!fixture) throw new Error('Organization fixture was not initialized by the serial seed journey');
  return fixture;
}

function browserHealth(page: Page, allowed: readonly RegExp[] = []): () => void {
  const problems: string[] = [];
  page.on('console', message => {
    if (!['warning', 'error'].includes(message.type())) return;
    const value = `${message.type()}: ${message.text()}`;
    if (!allowed.some(pattern => pattern.test(value))) problems.push(value);
  });
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  return () => expect(problems, 'unexpected browser console warnings/errors or page errors').toEqual([]);
}

async function csrfHeaders(context: BrowserContext): Promise<Record<string, string>> {
  const csrf = (await context.cookies(candidateOrigin())).find(cookie => cookie.name === 'XSRF-TOKEN');
  if (!csrf?.value) throw new Error('Authenticated organization fixture has no CSRF cookie');
  return { 'X-XSRF-TOKEN': csrf.value };
}

async function api<T>(
  context: BrowserContext,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  expectedStatus: number,
  data?: unknown,
): Promise<T> {
  const response = await context.request.fetch(`/api/v1${path}`, {
    method,
    maxRedirects: 0,
    maxRetries: 0,
    ...(method === 'GET' ? {} : { headers: await csrfHeaders(context), data }),
  });
  try {
    if (response.status() !== expectedStatus) {
      throw new Error(`Organization fixture ${method} ${path} returned HTTP ${response.status()}, expected ${expectedStatus}`);
    }
    if (expectedStatus === 204) return undefined as T;
    return await response.json() as T;
  } finally {
    await response.dispose();
  }
}

async function createOrgUnit(
  page: Page,
  parentId: number | null,
  suffix: string,
  name: string,
  kind: string,
  orderNo: number,
): Promise<OrgUnit> {
  return api<OrgUnit>(page.context(), 'POST', '/iam/org-units', 201, {
    parentId,
    code: `${runPrefix}-${suffix}`,
    name,
    kind,
    orderNo,
  });
}

async function createRole(page: Page): Promise<Role> {
  const role = await api<Role>(page.context(), 'POST', '/rbac/roles', 201, {
    name: fixtureNames.role,
    orderNo: 9000,
  });
  await api<void>(page.context(), 'PUT', `/rbac/roles/${role.id}/permissions`, 204, [
    { formCode: 'tasks.items', action: 'view' },
    { formCode: 'tasks.projects', action: 'view' },
    { formCode: 'md.custom_fields', action: 'view' },
  ]);
  return role;
}

async function createUser(page: Page, roleId: number, suffix: string): Promise<{ user: User; password: string }> {
  const token = randomBytes(4).toString('hex');
  const login = `oe2e-${Date.now().toString(36)}-${suffix}-${token}`.toLowerCase();
  const password = `Qa!7${randomBytes(22).toString('hex')}`;
  const user = await api<User>(page.context(), 'POST', '/iam/users', 201, {
    name: `${runPrefix} ${suffix}`,
    login,
    email: `${login}@example.invalid`,
    password,
    language: 'ru',
    timezone: 'Asia/Tashkent',
    is2faEnabled: false,
    forcePasswordChange: false,
    roleIds: [roleId],
    attributes: {},
  });
  return { user, password };
}

async function createTask(page: Page, suffix: string, participantId: number): Promise<TaskRecord> {
  return api<TaskRecord>(page.context(), 'POST', '/tasks/items', 201, {
    title: `${runPrefix} task ${suffix}`,
    descriptionMarkdown: 'Synthetic organization-scope browser fixture',
    priority: 'medium',
    responsibleUserId: participantId,
    executorUserIds: [],
    observerUserIds: [],
    attributes: { task_type: 'task' },
  });
}

async function loginSyntheticUser(page: Page, login: string, passwordValue: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Логин или Email').fill(login);
  const password = page.getByLabel('Пароль', { exact: true });
  try {
    await fillSecret(password, passwordValue);
    await page.getByRole('button', { name: 'Войти в систему', exact: true }).click();
    await expect(page).toHaveURL(/\/tasks(?:\?.*)?$/u);
  } finally {
    await clearSecret(password);
  }
}

async function selectOrgUnit(page: Page, name: string): Promise<void> {
  const unit = page.locator('button.select').filter({ hasText: name });
  await expect(unit).toBeVisible();
  await unit.click();
}

async function openActorPanel(page: Page, actorId: number) {
  await page.goto(`/iam/users/${actorId}`);
  const profile = page.getByRole('dialog', { name: 'Профиль пользователя', exact: true });
  await expect(profile).toBeVisible();
  const panel = profile.getByRole('region', { name: 'Подразделения и область данных', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Фактическая область данных', exact: true })).toBeVisible();
  return panel;
}

async function expectEffectiveScope(
  page: Page,
  actorId: number,
  ruleText: string,
  visibleNames: readonly string[],
  hiddenNames: readonly string[],
): Promise<void> {
  const panel = await openActorPanel(page, actorId);
  const card = panel.getByRole('region', { name: 'Фактическая область данных', exact: true });
  await expect(card).toContainText(ruleText);
  for (const name of visibleNames) await expect(card).toContainText(name);
  for (const name of hiddenNames) await expect(card).not.toContainText(name);
}

const scopeLabel: Record<ScopeRule, RegExp> = {
  UNITS: /^Только свои подразделения/u,
  SUBTREE: /^Свои подразделения и подчинённые/u,
  SELF: /^Только связанные со мной данные/u,
};

async function setRoleRuleFromUi(page: Page, role: Role, rule: ScopeRule): Promise<void> {
  await page.goto('/iam/roles');
  await page.getByLabel('Поиск ролей', { exact: true }).fill(role.name);
  await page.getByRole('button', { name: `Выбрать роль ${role.name}`, exact: true }).click();
  const panel = page.getByRole('region', { name: 'Область данных', exact: true });
  await expect(panel).toBeVisible();
  const radio = panel.getByRole('radio', { name: scopeLabel[rule] });
  await expect(radio).toBeVisible();
  if (!(await radio.isChecked())) {
    await radio.click();
    await panel.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Изменение области данных', exact: true });
    await expect(confirmation).toBeVisible();
    const response = page.waitForResponse(value => value.request().method() === 'PUT'
      && new URL(value.url()).pathname === `/api/v1/iam/org-units/roles/${role.id}/rule`);
    await confirmation.getByRole('button', { name: 'Подтвердить сохранение', exact: true }).click();
    expect((await response).status()).toBe(204);
  }
  await expect(radio).toBeChecked();
}

async function taskScopeSnapshot(
  browser: Browser,
  expectedVisible: readonly (keyof Fixture['tasks'])[],
  expectedDetailStatuses: Record<keyof Fixture['tasks'], number>,
  assertPermissionDenial = false,
): Promise<void> {
  const seeded = currentFixture();
  const context = await browser.newContext({ baseURL: candidateOrigin() });
  try {
    const page = await context.newPage();
    const pageFailures: Array<{ method: string; path: string; status: number }> = [];
    page.on('response', response => {
      if ([401, 403].includes(response.status())) pageFailures.push({
        method: response.request().method(),
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
    });
    const assertHealthy = browserHealth(page, [
      /^error: Failed to load resource: the server responded with a status of 401/u,
    ]);
    const dependencyPaths = ['/api/v1/custom-fields', '/api/v1/tasks/projects'] as const;
    const dependencies = Promise.all(dependencyPaths.map(path => page.waitForResponse(value => (
      value.request().method() === 'GET' && new URL(value.url()).pathname === path
    ))));
    await loginSyntheticUser(page, seeded.actor.login, seeded.actorPassword);
    const dependencyResponses = await dependencies;
    expect(dependencyResponses.map(value => ({
      method: value.request().method(),
      path: new URL(value.url()).pathname,
      status: value.status(),
    }))).toEqual(dependencyPaths.map(path => ({ method: 'GET', path, status: 200 })));
    const response = await context.request.get(`/api/v1/tasks/items?limit=50&search=${encodeURIComponent(runPrefix)}`, {
      maxRedirects: 0,
      maxRetries: 0,
    });
    expect(response.status()).toBe(200);
    const listed = await response.json() as TaskPage;
    await response.dispose();
    expect(listed.items.map(item => item.id).sort((a, b) => a - b)).toEqual(
      expectedVisible.map(key => seeded.tasks[key].id).sort((a, b) => a - b),
    );
    for (const key of ['actor', 'peer', 'child', 'other'] as const) {
      const detail = await context.request.get(`/api/v1/tasks/items/${seeded.tasks[key].id}`, {
        maxRedirects: 0,
        maxRetries: 0,
      });
      expect(detail.status(), `${key} task direct-read status`).toBe(expectedDetailStatuses[key]);
      await detail.dispose();
    }
    if (assertPermissionDenial) {
      const denied = await context.request.get('/api/v1/iam/org-units', { maxRedirects: 0, maxRetries: 0 });
      expect(denied.status()).toBe(403);
      await denied.dispose();
    }
    expect(pageFailures, 'restricted shell 401/403 page responses').toEqual([
      { method: 'GET', path: '/api/v1/auth/me', status: 401 },
    ]);
    assertHealthy();
  } finally {
    await context.close();
  }
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Переключить тему', exact: true });
  await expect(toggle).toBeVisible();
  const shouldBePressed = theme === 'dark';
  if ((await toggle.getAttribute('aria-pressed')) !== String(shouldBePressed)) await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function expectViewportHealth(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Оргструктура', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay, .vite-error-overlay, #webpack-dev-server-client-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.innerText.trim().length)).toBeGreaterThan(50);
  expect(await page.evaluate(() => ({
    document: document.documentElement.scrollWidth <= window.innerWidth,
    body: document.body.scrollWidth <= window.innerWidth,
  }))).toEqual({ document: true, body: true });
}

async function primaryButtonContrast(page: Page): Promise<{
  text: string;
  selector: string;
  foreground: string;
  background: string;
  fontSize: string;
  fontWeight: string;
  ratio: number;
}> {
  const button = page.locator('button.btn-primary').filter({ hasText: /Создать/u }).first();
  await expect(button).toBeVisible();
  await page.mouse.move(0, 0);
  await button.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  return button.evaluate(element => {
    const channels = (value: string) => value.match(/\d+(?:\.\d+)?/gu)?.slice(0, 3).map(Number);
    const linear = (value: number) => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (value: string) => {
      const rgb = channels(value);
      if (!rgb || rgb.length !== 3) throw new Error(`Unsupported computed color ${value}`);
      return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
    };
    const style = getComputedStyle(element);
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return {
      text: element.textContent?.trim() ?? '',
      selector: 'button.btn-primary',
      foreground: style.color,
      background: style.backgroundColor,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
    };
  });
}

test.describe.serial('organization structure vertical acceptance', () => {
  test('real UI/API journey creates the tree, synthetic principals, assignments and tasks', async ({ page }) => {
    test.setTimeout(120_000);
    await loginToInstance(page);
    const assertHealthy = browserHealth(page);
    const admin = await api<{ user: { id: number } }>(page.context(), 'GET', '/auth/me', 200);
    await page.goto('/iam/org-units');
    await expect(page).toHaveURL(/\/iam\/org-units$/u);
    await expect(page.getByRole('heading', { level: 1, name: 'Оргструктура', exact: true })).toBeVisible();

    const existing = await api<OrgUnit[]>(page.context(), 'GET', '/iam/org-units', 200);
    const createButtonName = existing.length ? 'Создать дочернее подразделение' : 'Создать корень';
    const createButton = page.getByRole('button', { name: createButtonName, exact: true });
    await expect(createButton).toBeVisible();
    await createButton.click();
    const editor = page.getByRole('dialog', { name: 'Редактор подразделения', exact: true });
    await editor.getByLabel('Код', { exact: true }).fill(journeyCode);
    await editor.getByLabel('Название', { exact: true }).fill(fixtureNames.journey);
    const createdResponse = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v1/iam/org-units');
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const createdHttp = await createdResponse;
    expect(createdHttp.status()).toBe(201);
    expect(new URL(createdHttp.url()).origin).toBe(candidateOrigin());
    const journeyUnit = await createdHttp.json() as OrgUnit;
    await expect(page.locator('button.select').filter({ hasText: journeyCode })).toBeVisible();

    const root = journeyUnit;
    const primary = await createOrgUnit(page, root.id, 'primary', fixtureNames.primary, 'branch', 10);
    const child = await createOrgUnit(page, primary.id, 'child', fixtureNames.child, 'department', 10);
    const other = await createOrgUnit(page, root.id, 'other', fixtureNames.other, 'branch', 20);
    const adminAssignments = await api<UserAssignments>(page.context(), 'GET', `/iam/org-units/users/${admin.user.id}`, 200);
    expect(adminAssignments.orgUnitIds).not.toContain(primary.id);
    expect(adminAssignments.orgUnitIds).not.toContain(child.id);
    expect(adminAssignments.orgUnitIds).not.toContain(other.id);
    expect(adminAssignments.legacyOrgUnitId).not.toBe(primary.id);
    expect(adminAssignments.legacyOrgUnitId).not.toBe(child.id);
    expect(adminAssignments.legacyOrgUnitId).not.toBe(other.id);

    const role = await createRole(page);
    const actorFixture = await createUser(page, role.id, 'actor');
    const peerFixture = await createUser(page, role.id, 'peer');
    const childFixture = await createUser(page, role.id, 'child');
    const otherFixture = await createUser(page, role.id, 'other');
    await api<void>(page.context(), 'PUT', `/iam/org-units/users/${peerFixture.user.id}`, 204, { orgUnitIds: [primary.id] });
    await api<void>(page.context(), 'PUT', `/iam/org-units/users/${childFixture.user.id}`, 204, { orgUnitIds: [child.id] });
    await api<void>(page.context(), 'PUT', `/iam/org-units/users/${otherFixture.user.id}`, 204, { orgUnitIds: [other.id] });

    const actorPanel = await openActorPanel(page, actorFixture.user.id);
    const assignmentsCard = actorPanel.getByRole('region', { name: 'Назначенные подразделения', exact: true });
    const primaryAssignment = assignmentsCard.getByRole('checkbox', { name: new RegExp(fixtureNames.primary, 'u') });
    await expect(primaryAssignment).not.toBeChecked();
    await primaryAssignment.click();
    const assignmentResponse = page.waitForResponse(response => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/v1/iam/org-units/users/${actorFixture.user.id}`);
    await assignmentsCard.getByRole('button', { name: 'Сохранить', exact: true }).click();
    expect((await assignmentResponse).status()).toBe(204);
    await expect(primaryAssignment).toBeChecked();

    await setRoleRuleFromUi(page, role, 'UNITS');
    await expectEffectiveScope(page, actorFixture.user.id, 'Только свои подразделения', [fixtureNames.primary], [fixtureNames.child, fixtureNames.other]);

    const tasks = {
      actor: await createTask(page, 'actor', actorFixture.user.id),
      peer: await createTask(page, 'peer', peerFixture.user.id),
      child: await createTask(page, 'child', childFixture.user.id),
      other: await createTask(page, 'other', otherFixture.user.id),
    };
    fixture = {
      root,
      primary,
      child,
      other,
      role,
      actor: actorFixture.user,
      actorPassword: actorFixture.password,
      peer: peerFixture.user,
      childParticipant: childFixture.user,
      otherParticipant: otherFixture.user,
      tasks,
    };
    assertHealthy();
  });

  test('keyboard discard preserves then removes a draft; delayed real write exposes pending state', async ({ page }) => {
    const seeded = currentFixture();
    await loginToInstance(page);
    const assertHealthy = browserHealth(page);
    await page.goto('/iam/org-units');
    await selectOrgUnit(page, seeded.primary.name);
    const create = page.getByRole('button', { name: 'Создать дочернее подразделение', exact: true });
    await create.click();
    let editor = page.getByRole('dialog', { name: 'Редактор подразделения', exact: true });
    const name = editor.getByLabel('Название', { exact: true });
    await editor.getByLabel('Код', { exact: true }).fill(`${runPrefix}-discard`);
    await name.fill(`${runPrefix} keyboard draft`);
    await page.keyboard.press('Escape');
    const discard = page.getByRole('dialog', { name: 'Несохранённые изменения', exact: true });
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
    await expect(discard).toBeHidden();
    await expect(name).toHaveValue(`${runPrefix} keyboard draft`);
    await expect(name).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: 'Отбросить изменения', exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(create).toBeFocused();

    await create.click();
    editor = page.getByRole('dialog', { name: 'Редактор подразделения', exact: true });
    const pendingName = `${runPrefix} pending real write`;
    await editor.getByLabel('Код', { exact: true }).fill(`${runPrefix}-pending`);
    await editor.getByLabel('Название', { exact: true }).fill(pendingName);
    let release!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    let intercepted!: () => void;
    const observed = new Promise<void>(resolve => intercepted = resolve);
    await page.route('**/api/v1/iam/org-units', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      intercepted();
      await gate;
      return route.continue();
    });
    const response = page.waitForResponse(value => value.request().method() === 'POST'
      && new URL(value.url()).pathname === '/api/v1/iam/org-units');
    const save = editor.locator('button[type="submit"]');
    await save.click();
    await observed;
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Escape');
    await expect(editor).toBeVisible();
    release();
    expect((await response).status()).toBe(201);
    await page.unroute('**/api/v1/iam/org-units');
    await expect(page.locator('button.select').filter({ hasText: pendingName })).toBeVisible();
    assertHealthy();
  });

  test('real restricted actor reads enforce UNITS, SUBTREE and SELF and deny the organization API', async ({ page, browser }) => {
    const seeded = currentFixture();
    await loginToInstance(page);
    const assertHealthy = browserHealth(page);

    await taskScopeSnapshot(browser, ['actor', 'peer'], { actor: 200, peer: 200, child: 404, other: 404 });
    await setRoleRuleFromUi(page, seeded.role, 'SUBTREE');
    await expectEffectiveScope(page, seeded.actor.id, 'Свои подразделения и подчинённые', [seeded.primary.name, seeded.child.name], [seeded.other.name]);
    await taskScopeSnapshot(browser, ['actor', 'peer', 'child'], { actor: 200, peer: 200, child: 200, other: 404 });

    await setRoleRuleFromUi(page, seeded.role, 'SELF');
    await expectEffectiveScope(page, seeded.actor.id, 'Только связанные со мной данные', [], [seeded.primary.name, seeded.child.name, seeded.other.name]);
    await taskScopeSnapshot(browser, ['actor'], { actor: 200, peer: 404, child: 404, other: 404 }, true);
    assertHealthy();
  });

  test('real occupied-unit deletion returns 409 and leaves the unit selected', async ({ page }) => {
    const seeded = currentFixture();
    await loginToInstance(page);
    const expected409 = /^error: Failed to load resource: the server responded with a status of 409/u;
    const assertHealthy = browserHealth(page, [expected409]);
    const conflicts: Response[] = [];
    page.on('response', response => {
      if (response.status() === 409) conflicts.push(response);
    });
    await page.goto('/iam/org-units');
    await selectOrgUnit(page, seeded.other.name);
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Удаление подразделения', exact: true });
    const response = page.waitForResponse(value => value.request().method() === 'DELETE'
      && new URL(value.url()).pathname === `/api/v1/iam/org-units/${seeded.other.id}`);
    await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click();
    expect((await response).status()).toBe(409);
    await expect(confirmation.getByRole('alert')).toBeVisible();
    await expect(page.locator('button.select').filter({ hasText: seeded.other.name })).toHaveAttribute('aria-current', 'true');
    expect(conflicts.map(value => ({ method: value.request().method(), path: new URL(value.url()).pathname }))).toEqual([
      { method: 'DELETE', path: `/api/v1/iam/org-units/${seeded.other.id}` },
    ]);
    assertHealthy();
  });

  test('[controlled HTTP mock] 503 tree load stays local and retry returns to real data', async ({ page }) => {
    await loginToInstance(page);
    const expected503 = /^error: Failed to load resource: the server responded with a status of 503/u;
    const assertHealthy = browserHealth(page, [expected503]);
    let mocked = false;
    await page.route('**/api/v1/iam/org-units', route => {
      if (route.request().method() === 'GET' && !mocked) {
        mocked = true;
        return route.fulfill({
          status: 503,
          json: { status: 503, code: 'SERVICE_UNAVAILABLE', detail: 'Контролируемая недоступность оргструктуры' },
        });
      }
      return route.continue();
    });
    const failure = page.waitForResponse(response => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/v1/iam/org-units'
      && response.status() === 503);
    await page.goto('/iam/org-units');
    expect((await failure).status()).toBe(503);
    await expect(page.getByRole('alert')).toContainText('Контролируемая недоступность оргструктуры');
    await expect(page.locator('.toast-container')).toHaveCount(0);
    const recovery = page.waitForResponse(response => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/v1/iam/org-units'
      && response.status() === 200);
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    expect((await recovery).status()).toBe(200);
    await expect(page.locator('button.select').filter({ hasText: currentFixture().primary.name })).toBeVisible();
    assertHealthy();
  });

  test('1366x900 and 390x844 render both themes without overflow, overlays or browser errors', async ({ page }, testInfo: TestInfo) => {
    const seeded = currentFixture();
    const contrastResults: Array<{
      viewport: `${number}x${number}`;
      theme: 'light' | 'dark';
      reading: Awaited<ReturnType<typeof primaryButtonContrast>>;
    }> = [];
    await loginToInstance(page);
    const assertHealthy = browserHealth(page);
    for (const current of screenshotCases) {
      await page.setViewportSize({ width: current.width, height: current.height });
      await page.goto('/iam/org-units');
      await setTheme(page, current.theme);
      await expect(page).toHaveURL(/\/iam\/org-units$/u);
      expect(await page.title()).not.toBe('');
      await expectViewportHealth(page);
      await selectOrgUnit(page, seeded.primary.name);
      await page.getByRole('heading', { level: 1, name: 'Оргструктура', exact: true }).scrollIntoViewIfNeeded();
      const contrast = await primaryButtonContrast(page);
      await page.screenshot({
        path: testInfo.outputPath(`org-structure-${current.theme}-${current.width}x${current.height}.png`),
        fullPage: false,
      });
      contrastResults.push({
        viewport: `${current.width}x${current.height}`,
        theme: current.theme,
        reading: contrast,
      });
      await page.locator('button.btn-primary').filter({ hasText: /Создать/u }).first().scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`org-structure-detail-${current.theme}-${current.width}x${current.height}.png`),
        fullPage: false,
      });

      const panel = await openActorPanel(page, seeded.actor.id);
      await expect(panel.getByRole('heading', { name: 'Историческая привязка', exact: true })).toBeVisible();
      const modal = page.getByRole('dialog', { name: 'Профиль пользователя', exact: true });
      expect(await modal.evaluate(element => {
        const body = element.querySelector<HTMLElement>('.modal-body');
        const rect = element.getBoundingClientRect();
        return {
          withinViewport: rect.left >= 0 && rect.right <= window.innerWidth,
          bodyContained: !!body && body.scrollWidth <= body.clientWidth,
        };
      })).toEqual({ withinViewport: true, bodyContained: true });
      await page.screenshot({
        path: testInfo.outputPath(`user-scope-${current.theme}-${current.width}x${current.height}.png`),
        fullPage: false,
      });
    }
    assertHealthy();
    expect(
      contrastResults.every(result => result.reading.ratio >= 4.5),
      `normal-text primary-button contrast requires 4.5:1: ${JSON.stringify(contrastResults)}`,
    ).toBe(true);
  });
});
