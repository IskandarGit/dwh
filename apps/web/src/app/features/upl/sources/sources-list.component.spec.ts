import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { KeysetPage, ProblemDetail } from '../../../core/models/common.models';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { PACKAGED_RUSSIAN } from '../../../core/i18n/packaged-russian';
import { UplApiService, UplSource, UplSourceItem } from '../upl-api';
import { SourcesListComponent } from './sources-list.component';

function page(items: UplSourceItem[], hasMore = false, nextCursor: string | null = null): KeysetPage<UplSourceItem> {
  return { items, nextCursor, hasMore, totalReturned: items.length };
}

const firstItem: UplSourceItem = {
  id: 1,
  code: 'cement.output',
  name: 'Vypusk cementa',
  periodicity: 'month',
  lastPublishedVersion: 2,
  hasDraft: false
};

const secondItem: UplSourceItem = {
  id: 5,
  code: 'brick.output',
  name: 'Vypusk kirpicha',
  periodicity: 'quarter',
  lastPublishedVersion: null,
  hasDraft: true
};

const createdSource = { id: 7, code: 'cement.output', name: 'Vypusk cementa' } as UplSource;

interface FixtureOptions {
  pages?: Array<Observable<KeysetPage<UplSourceItem>>>;
  createResult?: Observable<UplSource>;
  canCreate?: boolean;
}

async function createFixture(options: FixtureOptions = {}) {
  const pages = options.pages ?? [of(page([firstItem, secondItem]))];
  let call = 0;
  const api = {
    listSources: vi.fn(() => pages[Math.min(call++, pages.length - 1)]),
    createSource: vi.fn(() => options.createResult ?? of(createdSource))
  };
  const permissions = { hasPermission: vi.fn(() => options.canCreate !== false) };
  const toast = { success: vi.fn(), error: vi.fn() };
  await TestBed.configureTestingModule({
    imports: [SourcesListComponent],
    providers: [
      provideRouter([]),
      { provide: UplApiService, useValue: api },
      { provide: PermissionService, useValue: permissions },
      { provide: ToastService, useValue: toast }
    ]
  }).compileComponents();
  const fixture = TestBed.createComponent(SourcesListComponent);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  fixture.detectChanges();
  return { fixture, api, permissions, toast, navigate };
}

function testId(fixture: ComponentFixture<SourcesListComponent>, id: string): HTMLElement[] {
  return fixture.debugElement.queryAll(By.css(`[data-testid="${id}"]`)).map(node => node.nativeElement as HTMLElement);
}

function click(fixture: ComponentFixture<SourcesListComponent>, id: string): void {
  fixture.debugElement.query(By.css(`[data-testid="${id}"]`)).triggerEventHandler('onClick', null);
  fixture.detectChanges();
}

async function openCreateForm(
  fixture: ComponentFixture<SourcesListComponent>,
  values: Partial<SourcesListComponent['form']>
): Promise<void> {
  fixture.componentInstance.openCreate();
  fixture.detectChanges();
  Object.assign(fixture.componentInstance.form, values);
  fixture.debugElement.query(By.css('#upl-source-create')).triggerEventHandler('ngSubmit', null);
  fixture.detectChanges();
}

describe('SourcesListComponent', () => {
  it('показывает строки источников со ссылкой на карточку и бейджем черновика', async () => {
    const { fixture } = await createFixture();

    const rows = testId(fixture, 'upl-source-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/upl/sources/1');
    expect(rows[0].querySelector('ui-badge')).toBeNull();
    expect(rows[1].querySelector('ui-badge')).not.toBeNull();
  });

  it('показывает пустое состояние, когда источников нет', async () => {
    const { fixture } = await createFixture({ pages: [of(page([]))] });

    expect(testId(fixture, 'upl-empty')).toHaveLength(1);
    expect(testId(fixture, 'upl-source-row')).toHaveLength(0);
  });

  it('показывает ошибку загрузки, «Повторить» перезапрашивает список', async () => {
    const { fixture, api } = await createFixture({
      pages: [throwError(() => ({ status: 503 })), of(page([firstItem]))]
    });

    expect(testId(fixture, 'upl-load-error')).toHaveLength(1);

    click(fixture, 'upl-retry');

    expect(api.listSources).toHaveBeenCalledTimes(2);
    expect(testId(fixture, 'upl-source-row')).toHaveLength(1);
  });

  it('догружает следующую страницу по курсору', async () => {
    const { fixture, api } = await createFixture({
      pages: [of(page([firstItem], true, 'cursor-1')), of(page([secondItem]))]
    });

    expect(testId(fixture, 'upl-more')).toHaveLength(1);

    click(fixture, 'upl-more');

    expect(api.listSources).toHaveBeenLastCalledWith(50, 'cursor-1');
    expect(testId(fixture, 'upl-source-row')).toHaveLength(2);
    expect(testId(fixture, 'upl-more')).toHaveLength(0);
  });

  it('при hasMore без курсора кнопку «Загрузить ещё» не показывает и страницу не повторяет', async () => {
    const { fixture, api } = await createFixture({
      pages: [of(page([firstItem], true, null)), of(page([secondItem]))]
    });

    expect(testId(fixture, 'upl-more')).toHaveLength(0);

    fixture.componentInstance.loadMore();
    fixture.detectChanges();

    expect(api.listSources).toHaveBeenCalledTimes(1);
    expect(testId(fixture, 'upl-source-row')).toHaveLength(1);
  });

  it('кнопку «Новый источник» показывает только при праве create', async () => {
    const withoutRight = await createFixture({ canCreate: false });
    expect(testId(withoutRight.fixture, 'upl-new-source')).toHaveLength(0);

    TestBed.resetTestingModule();
    const withRight = await createFixture({ canCreate: true });
    expect(testId(withRight.fixture, 'upl-new-source')).toHaveLength(1);
    expect(withRight.permissions.hasPermission).toHaveBeenCalledWith('upl.sources', 'create');
  });

  it('не отправляет запрос при неверном коде', async () => {
    const { fixture, api } = await createFixture();

    await openCreateForm(fixture, { code: 'Cement Output', name: 'Vypusk', ownerOrg: 'Org' });

    expect(api.createSource).not.toHaveBeenCalled();
    expect(testId(fixture, 'upl-err-code')).toHaveLength(1);
  });

  it('создаёт источник и переходит на карточку', async () => {
    const { fixture, api, toast, navigate } = await createFixture();

    await openCreateForm(fixture, { code: 'cement.output', name: ' Vypusk ', ownerOrg: ' Org ', ownerContact: '  ' });

    expect(api.createSource).toHaveBeenCalledWith({
      code: 'cement.output',
      name: 'Vypusk',
      ownerOrg: 'Org',
      ownerContact: null,
      periodicity: 'month',
      slaDays: 0,
      sourceType: 'file',
      reconciliationStrictness: 'error',
      lockVersion: null
    });
    expect(navigate).toHaveBeenCalledWith(['/upl/sources', 7]);
    expect(toast.success).toHaveBeenCalled();
    expect(fixture.componentInstance.isCreateOpen()).toBe(false);
  });

  it('показывает занятый код под полем «Код», окно остаётся открытым', async () => {
    const problem: ProblemDetail = {
      title: 'Bad Request',
      status: 400,
      code: 'code_already_exists',
      detail: 'UPL_SOURCE_CODE_TAKEN'
    };
    const { fixture } = await createFixture({ createResult: throwError(() => problem) });

    await openCreateForm(fixture, { code: 'cement.output', name: 'Vypusk', ownerOrg: 'Org' });

    expect(testId(fixture, 'upl-err-code')).toHaveLength(1);
    expect(fixture.componentInstance.isCreateOpen()).toBe(true);
  });

  it('«код занят» узнаётся по коду каркаса, даже если detail переведён', async () => {
    const problem: ProblemDetail = {
      title: 'Bad Request',
      status: 400,
      code: 'CODE_ALREADY_EXISTS',
      detail: 'Такой код уже существует'
    };
    const { fixture } = await createFixture({ createResult: throwError(() => problem) });

    await openCreateForm(fixture, { code: 'cement.output', name: 'Vypusk', ownerOrg: 'Org' });

    expect(testId(fixture, 'upl-err-code')).toHaveLength(1);
    expect(fixture.componentInstance.isCreateOpen()).toBe(true);
  });

  it('раскладывает ошибки 422 по полям', async () => {
    const problem: ProblemDetail = {
      title: 'Unprocessable Entity',
      status: 422,
      code: 'validation_failed',
      detail: 'VALIDATION_FAILED: name',
      errors: [{ field: 'name', code: 'Size', message: 'x' }]
    };
    const { fixture } = await createFixture({ createResult: throwError(() => problem) });

    await openCreateForm(fixture, { code: 'cement.output', name: 'Vypusk', ownerOrg: 'Org' });

    expect(testId(fixture, 'upl-err-name')).toHaveLength(1);
    expect(testId(fixture, 'upl-err-name')[0].textContent).toContain(PACKAGED_RUSSIAN['upl.err.Size']);
    expect(testId(fixture, 'upl-create-error')).toHaveLength(1);
  });

  it('пока список грузится, показывает пять строк-заглушек', async () => {
    const { fixture } = await createFixture({ pages: [NEVER] });

    expect(testId(fixture, 'upl-skeleton')).toHaveLength(5);
    expect(testId(fixture, 'upl-empty')).toHaveLength(0);
    expect(testId(fixture, 'upl-source-row')).toHaveLength(0);
  });

  it('в пустом списке без права create нет кнопки «Новый источник»', async () => {
    const withoutRight = await createFixture({ pages: [of(page([]))], canCreate: false });

    expect(testId(withoutRight.fixture, 'upl-empty')).toHaveLength(1);
    expect(testId(withoutRight.fixture, 'upl-empty-new')).toHaveLength(0);
    expect(testId(withoutRight.fixture, 'upl-new-source')).toHaveLength(0);

    TestBed.resetTestingModule();
    const withRight = await createFixture({ pages: [of(page([]))], canCreate: true });

    expect(testId(withRight.fixture, 'upl-empty-new')).toHaveLength(1);
  });

  it('отказ в праве при создании показывает текстом, окно остаётся открытым', async () => {
    const problem: ProblemDetail = {
      title: 'Forbidden',
      status: 403,
      code: 'permission_denied',
      detail: 'PERMISSION_DENIED'
    };
    const { fixture, navigate } = await createFixture({ createResult: throwError(() => problem) });

    await openCreateForm(fixture, { code: 'cement.output', name: 'Vypusk', ownerOrg: 'Org' });

    const errors = testId(fixture, 'upl-create-error');
    expect(errors).toHaveLength(1);
    expect(errors[0].textContent).toContain(PACKAGED_RUSSIAN['upl.err.PERMISSION_DENIED']);
    expect(fixture.componentInstance.isCreateOpen()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('неизвестную ошибку сервера не прячет', async () => {
    const problem: ProblemDetail = {
      title: 'Bad Request',
      status: 400,
      code: 'bad_request',
      detail: 'UPL_SOMETHING_NEW'
    };
    const { fixture, navigate } = await createFixture({ createResult: throwError(() => problem) });

    await openCreateForm(fixture, { code: 'cement.output', name: 'Vypusk', ownerOrg: 'Org' });

    const errors = testId(fixture, 'upl-create-error');
    expect(errors).toHaveLength(1);
    expect(errors[0].textContent).toContain('UPL_SOMETHING_NEW (bad_request)');
    expect(fixture.componentInstance.isCreateOpen()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('не показывает ошибку загрузки вместе с таблицей', async () => {
    const { fixture } = await createFixture();

    expect(testId(fixture, 'upl-load-error')).toHaveLength(0);
    expect(testId(fixture, 'upl-skeleton')).toHaveLength(0);
    expect(testId(fixture, 'upl-source-row')).toHaveLength(2);
  });
});
