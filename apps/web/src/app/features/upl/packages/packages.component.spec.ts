import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PACKAGED_RUSSIAN } from '../../../core/i18n/packaged-russian';
import { KeysetPage, ProblemDetail } from '../../../core/models/common.models';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { UplSourceItem } from '../upl-api';
import { PackageCardComponent } from './package-card.component';
import { PackagesComponent } from './packages.component';
import { UplPackageErrors, UplPackageItem, UplPackageUpload, UplPackagesApiService } from './packages-api';

function item(patch: Partial<UplPackageItem> = {}): UplPackageItem {
  return {
    id: '6f1b0d1e-0000-4000-8000-000000000001',
    sourceId: 3,
    sourceCode: 'cement.output',
    sourceName: 'Nalogi TEST',
    formatVersion: 2,
    periodFrom: '2026-01-01',
    periodTo: '2026-01-31',
    fileName: 'a_jan.xlsx',
    fileSizeBytes: 2048,
    uploadedBy: 'Ivanov TEST',
    uploadedAt: '2026-09-21T08:40:00Z',
    status: 'verified',
    rowsTotal: 120,
    rowsAccepted: 117,
    rowsRejected: 3,
    errorsTotal: 3,
    rejectCode: null,
    rejectParams: null,
    loadId: null,
    rawRows: null,
    ...patch
  };
}

function page(items: UplPackageItem[], hasMore = false, nextCursor: string | null = null): KeysetPage<UplPackageItem> {
  return { items, nextCursor, hasMore, totalReturned: items.length };
}

const noErrors: UplPackageErrors = { total: 0, shown: 0, items: [] };

const sourceList: UplSourceItem[] = [
  { id: 3, code: 'cement.output', name: 'Nalogi TEST', periodicity: 'month', lastPublishedVersion: 2, hasDraft: false },
  { id: 5, code: 'brick.output', name: 'Baza TEST', periodicity: 'quarter', lastPublishedVersion: 1, hasDraft: false }
];

interface FixtureOptions {
  pages?: Array<Observable<KeysetPage<UplPackageItem>>>;
  uploadResult?: Observable<UplPackageItem>;
  sourcesResult?: Array<Observable<UplSourceItem[]>>;
  canUpload?: boolean;
  canApply?: boolean;
}

async function createFixture(options: FixtureOptions = {}) {
  const pages = options.pages ?? [of(page([item()]))];
  const sourcesResults = options.sourcesResult ?? [of(sourceList)];
  let listCall = 0;
  let sourcesCall = 0;
  const api = {
    list: vi.fn(() => pages[Math.min(listCall++, pages.length - 1)]),
    upload: vi.fn((request: UplPackageUpload) => options.uploadResult ?? of(item({ sourceId: request.sourceId }))),
    errors: vi.fn(() => of(noErrors)),
    allSources: vi.fn(() => sourcesResults[Math.min(sourcesCall++, sourcesResults.length - 1)])
  };
  const permissions = {
    hasPermission: vi.fn((form: string, action: string) =>
      action === 'apply' ? options.canApply === true : options.canUpload !== false
    )
  };
  const toast = { success: vi.fn(), error: vi.fn() };
  await TestBed.configureTestingModule({
    imports: [PackagesComponent],
    providers: [
      { provide: UplPackagesApiService, useValue: api },
      { provide: PermissionService, useValue: permissions },
      { provide: ToastService, useValue: toast }
    ]
  }).compileComponents();
  const fixture = TestBed.createComponent(PackagesComponent);
  fixture.detectChanges();
  return { fixture, api, permissions, toast };
}

function testId(fixture: ComponentFixture<PackagesComponent>, id: string): HTMLElement[] {
  return fixture.debugElement.queryAll(By.css(`[data-testid="${id}"]`)).map(node => node.nativeElement as HTMLElement);
}

function text(fixture: ComponentFixture<PackagesComponent>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function click(fixture: ComponentFixture<PackagesComponent>, id: string): void {
  fixture.debugElement.query(By.css(`[data-testid="${id}"]`)).triggerEventHandler('onClick', null);
  fixture.detectChanges();
}

function clickRow(fixture: ComponentFixture<PackagesComponent>, index = 0): void {
  fixture.debugElement.queryAll(By.css('[data-testid="upl-pkg-row"]'))[index].triggerEventHandler('click', {});
  fixture.detectChanges();
}

function submitButton(fixture: ComponentFixture<PackagesComponent>): HTMLButtonElement {
  return fixture.debugElement.query(By.css('[data-testid="upl-pkg-submit"] button')).nativeElement as HTMLButtonElement;
}

/** Поля заполняем как человек — событиями, иначе `OnPush` не перерисует форму. */
function selectSource(fixture: ComponentFixture<PackagesComponent>, index: number): void {
  const select = testId(fixture, 'upl-pkg-source')[0] as HTMLSelectElement;
  select.selectedIndex = index;
  select.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function typeDate(fixture: ComponentFixture<PackagesComponent>, id: string, value: string): void {
  const input = testId(fixture, id)[0] as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

/** `input type="file"` в jsdom не заполнить обычным путём — подменяем список файлов. */
function attachFile(fixture: ComponentFixture<PackagesComponent>, name = 'a_jan.xlsx'): void {
  const input = testId(fixture, 'upl-pkg-file')[0] as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [new File(['x'], name)], configurable: true });
  input.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function fillForm(fixture: ComponentFixture<PackagesComponent>): void {
  selectSource(fixture, 1);
  typeDate(fixture, 'upl-pkg-period-from', '2026-01-01');
  typeDate(fixture, 'upl-pkg-period-to', '2026-01-31');
  attachFile(fixture);
}

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLInputElement | HTMLSelectElement).disabled;
}

function problem(status: number, code: string, detail: string, errors?: ProblemDetail['errors']): ProblemDetail {
  return { title: 'error', status, code, detail, errors };
}

describe('PackagesComponent', () => {
  it('без права загрузки формы нет, источники не запрашиваются, пустой текст короткий', async () => {
    const { fixture, api } = await createFixture({ canUpload: false, pages: [of(page([]))] });

    expect(testId(fixture, 'upl-pkg-form')).toHaveLength(0);
    expect(api.allSources).not.toHaveBeenCalled();
    expect(text(fixture)).toContain(PACKAGED_RUSSIAN['upl.pkg.empty']);
    expect(text(fixture)).not.toContain(PACKAGED_RUSSIAN['upl.pkg.empty_hint']);
  });

  it('с правом загрузки форма есть, источники в списке, пустой текст подсказывает что делать', async () => {
    const { fixture, api } = await createFixture({ pages: [of(page([]))] });

    expect(testId(fixture, 'upl-pkg-form')).toHaveLength(1);
    expect(api.allSources).toHaveBeenCalledTimes(1);
    const options = fixture.debugElement.queryAll(By.css('[data-testid="upl-pkg-source"] option'));
    expect(options).toHaveLength(3);
    expect(options[0].nativeElement.textContent).toContain(PACKAGED_RUSSIAN['upl.pkg.form.source_placeholder']);
    expect(options[1].nativeElement.textContent).toContain('cement.output');
    expect(text(fixture)).toContain(PACKAGED_RUSSIAN['upl.pkg.empty_hint']);
  });

  it('кнопка «Загрузить» неактивна, пока не заполнены все четыре поля', async () => {
    const { fixture } = await createFixture();

    expect(submitButton(fixture).disabled).toBe(true);
    selectSource(fixture, 1);
    typeDate(fixture, 'upl-pkg-period-from', '2026-01-01');
    typeDate(fixture, 'upl-pkg-period-to', '2026-01-31');
    expect(submitButton(fixture).disabled).toBe(true);

    fillForm(fixture);
    expect(submitButton(fixture).disabled).toBe(false);
  });

  it('успешная отправка: запрос с четырьмя значениями, тост, файл очищен, список перечитан', async () => {
    const { fixture, api, toast } = await createFixture();
    fillForm(fixture);

    click(fixture, 'upl-pkg-submit');

    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(api.upload.mock.calls[0][0]).toMatchObject({
      sourceId: 3,
      periodFrom: '2026-01-01',
      periodTo: '2026-01-31'
    });
    expect(api.upload.mock.calls[0][0].file.name).toBe('a_jan.xlsx');
    expect(toast.success).toHaveBeenCalledWith(PACKAGED_RUSSIAN['upl.pkg.toast.accepted']);
    expect(fixture.componentInstance.form.file).toBeNull();
    expect(fixture.componentInstance.form.sourceId).toBe(3);
    expect(fixture.componentInstance.form.periodFrom).toBe('2026-01-01');
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('во время отправки поля и кнопка заблокированы', async () => {
    const { fixture } = await createFixture({ uploadResult: NEVER });
    fillForm(fixture);

    click(fixture, 'upl-pkg-submit');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(submitButton(fixture).disabled).toBe(true);
    expect(isDisabled(testId(fixture, 'upl-pkg-source')[0])).toBe(true);
    expect(isDisabled(testId(fixture, 'upl-pkg-period-from')[0])).toBe(true);
    expect(isDisabled(testId(fixture, 'upl-pkg-period-to')[0])).toBe(true);
    expect(isDisabled(testId(fixture, 'upl-pkg-file')[0])).toBe(true);
  });

  it('отказ 422 по трём полям: каждая ошибка у своего поля, все разом', async () => {
    const rejection = problem(422, 'validation_error', 'invalid', [
      { field: 'sourceId', code: 'UPL_PKG_SOURCE_REQUIRED', message: 'source' },
      { field: 'periodTo', code: 'UPL_PKG_PERIOD_ORDER', message: 'period' },
      { field: 'file', code: 'UPL_PKG_FILE_NOT_XLSX', message: 'file' }
    ]);
    const { fixture } = await createFixture({ uploadResult: throwError(() => rejection) });
    fillForm(fixture);

    click(fixture, 'upl-pkg-submit');

    expect(testId(fixture, 'upl-pkg-err-source')[0].textContent).toContain(
      PACKAGED_RUSSIAN['upl.err.UPL_PKG_SOURCE_REQUIRED']
    );
    expect(testId(fixture, 'upl-pkg-err-period')[0].textContent).toContain(
      PACKAGED_RUSSIAN['upl.err.UPL_PKG_PERIOD_ORDER']
    );
    expect(testId(fixture, 'upl-pkg-err-file')[0].textContent).toContain(
      PACKAGED_RUSSIAN['upl.err.UPL_PKG_FILE_NOT_XLSX']
    );
    expect(testId(fixture, 'upl-pkg-err-form')).toHaveLength(0);
  });

  it('источник не найден (404) показан под полем «Источник»', async () => {
    const { fixture } = await createFixture({
      uploadResult: throwError(() => problem(404, 'not_found', 'UPL_SOURCE_NOT_FOUND'))
    });
    fillForm(fixture);

    click(fixture, 'upl-pkg-submit');

    expect(testId(fixture, 'upl-pkg-err-source')[0].textContent).toContain(
      PACKAGED_RUSSIAN['upl.err.UPL_SOURCE_NOT_FOUND']
    );
  });

  it('нет анкеты на дату начала периода (409) показано под полем «Источник»', async () => {
    const { fixture } = await createFixture({
      uploadResult: throwError(() => problem(409, 'conflict', 'UPL_PKG_NO_FORMAT_AT_DATE'))
    });
    fillForm(fixture);

    click(fixture, 'upl-pkg-submit');

    expect(testId(fixture, 'upl-pkg-err-source')[0].textContent).toContain(
      PACKAGED_RUSSIAN['upl.err.UPL_PKG_NO_FORMAT_AT_DATE']
    );
  });

  it('наш отказ по размеру (413) показан под полем «Файл»', async () => {
    const { fixture } = await createFixture({
      uploadResult: throwError(() => problem(413, 'file_size_exceeded', 'UPL_PKG_FILE_TOO_LARGE'))
    });
    fillForm(fixture);

    click(fixture, 'upl-pkg-submit');

    expect(testId(fixture, 'upl-pkg-err-file')[0].textContent).toContain(
      PACKAGED_RUSSIAN['upl.err.UPL_PKG_FILE_TOO_LARGE']
    );
  });

  it('отказ по размеру от каркаса (413 с чужим подкодом) тоже под полем «Файл»', async () => {
    const { fixture } = await createFixture({
      uploadResult: throwError(() => problem(413, 'FILE_SIZE_EXCEEDED', 'file too large'))
    });
    fillForm(fixture);

    click(fixture, 'upl-pkg-submit');

    expect(testId(fixture, 'upl-pkg-err-file')[0].textContent).toContain(
      PACKAGED_RUSSIAN['upl.err.UPL_PKG_FILE_TOO_LARGE']
    );
    expect(testId(fixture, 'upl-pkg-err-form')).toHaveLength(0);
  });

  it('неизвестный код уходит полосой над формой вместе с кодом', async () => {
    const { fixture } = await createFixture({
      uploadResult: throwError(() => problem(503, 'service_unavailable', 'UPL_PKG_FROM_FUTURE'))
    });
    fillForm(fixture);

    click(fixture, 'upl-pkg-submit');

    const bar = testId(fixture, 'upl-pkg-err-form')[0].textContent ?? '';
    expect(bar).toContain('UPL_PKG_FROM_FUTURE');
    expect(bar).toContain('(service_unavailable)');
  });

  it('сбой списка источников: полоса в форме и «Повторить» запрашивает снова', async () => {
    const { fixture, api } = await createFixture({
      sourcesResult: [throwError(() => ({ status: 503 })), of(sourceList)]
    });

    expect(testId(fixture, 'upl-pkg-sources-error')).toHaveLength(1);
    click(fixture, 'upl-pkg-sources-retry');

    expect(api.allSources).toHaveBeenCalledTimes(2);
    expect(testId(fixture, 'upl-pkg-sources-error')).toHaveLength(0);
  });

  it('пока список грузится, видны строки-скелетоны', async () => {
    const { fixture } = await createFixture({ pages: [NEVER] });

    expect(testId(fixture, 'upl-pkg-skeleton')).toHaveLength(5);
    expect(testId(fixture, 'upl-pkg-row')).toHaveLength(0);
  });

  it('сбой списка: полоса и «Повторить» перезапрашивает', async () => {
    const { fixture, api } = await createFixture({
      pages: [throwError(() => ({ status: 503 })), of(page([item()]))]
    });

    expect(testId(fixture, 'upl-pkg-load-error')[0].textContent).toContain(PACKAGED_RUSSIAN['upl.pkg.load_error']);
    click(fixture, 'upl-pkg-retry');

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(testId(fixture, 'upl-pkg-row')).toHaveLength(1);
  });

  it('«Загрузить ещё» дописывает строки и передаёт курсор', async () => {
    const { fixture, api } = await createFixture({
      pages: [
        of(page([item()], true, 'cursor-2')),
        of(page([item({ id: '6f1b0d1e-0000-4000-8000-000000000002' })]))
      ]
    });

    expect(testId(fixture, 'upl-pkg-more')).toHaveLength(1);
    click(fixture, 'upl-pkg-more');

    expect(api.list).toHaveBeenLastCalledWith(50, 'cursor-2');
    expect(testId(fixture, 'upl-pkg-row')).toHaveLength(2);
    expect(testId(fixture, 'upl-pkg-more')).toHaveLength(0);
  });

  it('сбой дозагрузки показывает тост', async () => {
    const { fixture, toast } = await createFixture({
      pages: [of(page([item()], true, 'cursor-2')), throwError(() => ({ status: 503 }))]
    });

    click(fixture, 'upl-pkg-more');

    expect(toast.error).toHaveBeenCalledWith(PACKAGED_RUSSIAN['upl.pkg.load_error']);
  });

  it('строка списка показывает дату, источник, период, файл, статус и строки', async () => {
    const { fixture } = await createFixture();

    const row = testId(fixture, 'upl-pkg-row')[0].textContent ?? '';
    expect(row).toContain('Nalogi TEST');
    expect(row).toContain('01.01.2026–31.01.2026');
    expect(row).toContain('a_jan.xlsx');
    expect(row).toContain(PACKAGED_RUSSIAN['upl.pkg.status.verified']);
    expect(row).toContain('120 / 117 / 3');
  });

  it('у непроверенных и отклонённых загрузок вместо строк прочерк', async () => {
    const unchecked = item({
      id: 'a',
      status: 'received',
      rowsTotal: null,
      rowsAccepted: null,
      rowsRejected: null,
      errorsTotal: null
    });
    const rejected = item({
      id: 'b',
      status: 'rejected',
      rowsTotal: null,
      rowsAccepted: null,
      rowsRejected: null,
      rejectCode: 'UPL_PKG_UNREADABLE'
    });
    const { fixture } = await createFixture({ pages: [of(page([unchecked, rejected]))] });

    const rows = testId(fixture, 'upl-pkg-row');
    expect(rows[0].textContent).toContain('—');
    expect(rows[0].textContent).not.toContain('120');
    expect(rows[1].textContent).toContain(PACKAGED_RUSSIAN['upl.pkg.status.rejected']);
    expect(rows[1].textContent).toContain('—');
  });

  it('у бейджа «получен» подсказка о проверке', async () => {
    const received = item({ status: 'received', rowsTotal: null, rowsAccepted: null, rowsRejected: null });
    const { fixture } = await createFixture({ pages: [of(page([received, item({ id: 'c' })]))] });

    const badges = fixture.debugElement.queryAll(By.css('[data-testid="upl-pkg-row"] ui-badge'));
    expect(badges[0].nativeElement.getAttribute('title')).toBe(PACKAGED_RUSSIAN['upl.pkg.status.received_hint']);
    expect(badges[1].nativeElement.getAttribute('title')).toBeNull();
  });

  it('щелчок по строке открывает карточку вместо формы и списка', async () => {
    const { fixture } = await createFixture();

    clickRow(fixture);

    expect(fixture.debugElement.query(By.css('app-upl-package-card'))).not.toBeNull();
    expect(testId(fixture, 'upl-pkg-row')).toHaveLength(0);
    expect(testId(fixture, 'upl-pkg-form')).toHaveLength(0);
    expect(testId(fixture, 'upl-pkg-card-meta')[0].textContent).toContain('Nalogi TEST');
  });

  it('«К списку загрузок» возвращает список', async () => {
    const { fixture } = await createFixture();
    clickRow(fixture);

    click(fixture, 'upl-pkg-back');

    expect(fixture.debugElement.query(By.css('app-upl-package-card'))).toBeNull();
    expect(testId(fixture, 'upl-pkg-row')).toHaveLength(1);
    expect(testId(fixture, 'upl-pkg-form')).toHaveLength(1);
  });

  it('«Обновить» в карточке перечитывает список и обновляет саму карточку', async () => {
    const { fixture, api } = await createFixture({
      pages: [of(page([item({ status: 'received', rowsTotal: null, rowsAccepted: null, rowsRejected: null })])), of(page([item()]))]
    });
    clickRow(fixture);
    expect(testId(fixture, 'upl-pkg-checking')).toHaveLength(1);

    click(fixture, 'upl-pkg-card-refresh');

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(testId(fixture, 'upl-pkg-checking')).toHaveLength(0);
    expect(testId(fixture, 'upl-pkg-counters')).toHaveLength(1);
  });

  it('пропавшая из порции загрузка остаётся в карточке прежней', async () => {
    const { fixture } = await createFixture({
      pages: [of(page([item()])), of(page([item({ id: 'other', fileName: 'b_q1.xlsx' })]))]
    });
    clickRow(fixture);

    click(fixture, 'upl-pkg-card-refresh');

    expect(fixture.debugElement.query(By.css('app-upl-package-card'))).not.toBeNull();
    expect(text(fixture)).toContain('a_jan.xlsx');
    expect(text(fixture)).not.toContain('b_q1.xlsx');
  });

  it('открытая карточка получает право «Применить» только при праве apply', async () => {
    const withRight = await createFixture({ canApply: true });
    clickRow(withRight.fixture);
    const cardWithRight = withRight.fixture.debugElement.query(By.directive(PackageCardComponent));
    expect(cardWithRight.componentInstance.canApply).toBe(true);

    TestBed.resetTestingModule();
    const withoutRight = await createFixture();
    clickRow(withoutRight.fixture);
    const cardWithoutRight = withoutRight.fixture.debugElement.query(By.directive(PackageCardComponent));
    expect(cardWithoutRight.componentInstance.canApply).toBe(false);
  });

  it('применённый пакет из карточки показывается в ней, а список перечитывается', async () => {
    const appliedAfterReload = item({ status: 'applied', rowsTotal: 10, rawRows: 10 });
    const { fixture, api } = await createFixture({
      canApply: true,
      pages: [of(page([item()])), of(page([appliedAfterReload]))]
    });
    clickRow(fixture);
    const listCallsBefore = api.list.mock.calls.length;
    const card = fixture.debugElement.query(By.directive(PackageCardComponent));

    card.triggerEventHandler('applied', item({ status: 'applied', loadId: 42, rawRows: 120 }));
    fixture.detectChanges();

    const cardAfter = fixture.debugElement.query(By.directive(PackageCardComponent));
    expect(cardAfter.componentInstance.item.status).toBe('applied');
    expect(api.list).toHaveBeenCalledTimes(listCallsBefore + 1);
  });
});
