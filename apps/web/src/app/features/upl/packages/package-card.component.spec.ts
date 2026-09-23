import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PACKAGED_RUSSIAN } from '../../../core/i18n/packaged-russian';
import { ProblemDetail } from '../../../core/models/common.models';
import {
  UplPackageErrorItem,
  UplPackageErrors,
  UplPackageItem,
  UplPackageStatus,
  UplPackagesApiService
} from './packages-api';
import { PackageCardComponent } from './package-card.component';

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

function cell(patch: Partial<UplPackageErrorItem> = {}): UplPackageErrorItem {
  return {
    sheet: 'Sheet1',
    rowNo: 17,
    columnName: 'STIR',
    value: '12AB',
    code: 'UPL_CELL_REQUIRED',
    params: null,
    ...patch
  };
}

function struct(code: string, params: Record<string, string | number>): UplPackageErrorItem {
  return { sheet: null, rowNo: null, columnName: null, value: null, code, params };
}

function errorsPage(items: UplPackageErrorItem[], total = items.length, shown = items.length): UplPackageErrors {
  return { total, shown, items };
}

async function createFixture(
  value: UplPackageItem,
  results: Array<Observable<UplPackageErrors>> = [of(errorsPage([]))],
  canApply?: boolean
) {
  let call = 0;
  const api = {
    errors: vi.fn(() => results[Math.min(call++, results.length - 1)]),
    apply: vi.fn()
  };
  await TestBed.configureTestingModule({
    imports: [PackageCardComponent],
    providers: [{ provide: UplPackagesApiService, useValue: api }]
  }).compileComponents();
  const fixture = TestBed.createComponent(PackageCardComponent);
  fixture.componentRef.setInput('item', value);
  if (canApply !== undefined) {
    fixture.componentRef.setInput('canApply', canApply);
  }
  fixture.detectChanges();
  return { fixture, api };
}

function testId(fixture: ComponentFixture<PackageCardComponent>, id: string): HTMLElement[] {
  return fixture.debugElement.queryAll(By.css(`[data-testid="${id}"]`)).map(node => node.nativeElement as HTMLElement);
}

function text(fixture: ComponentFixture<PackageCardComponent>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function click(fixture: ComponentFixture<PackageCardComponent>, id: string): void {
  fixture.debugElement.query(By.css(`[data-testid="${id}"]`)).triggerEventHandler('onClick', null);
  fixture.detectChanges();
}

function problem(status: number, detail: string, code = 'not_found'): ProblemDetail {
  return { title: 'error', status, code, detail };
}

describe('PackageCardComponent', () => {
  it('статус «получен»: показывает ожидание проверки и ошибок не запрашивает', async () => {
    const { fixture, api } = await createFixture(item({ status: 'received', rowsTotal: null, rowsAccepted: null, rowsRejected: null }));

    expect(testId(fixture, 'upl-pkg-checking')).toHaveLength(1);
    expect(text(fixture)).toContain(PACKAGED_RUSSIAN['upl.pkg.card.checking']);
    expect(api.errors).not.toHaveBeenCalled();
    expect(testId(fixture, 'upl-pkg-counters')).toHaveLength(0);
  });

  it('шапка показывает файл, статус и строку источник · период · версия · кто · когда', async () => {
    const { fixture } = await createFixture(item());

    const meta = testId(fixture, 'upl-pkg-card-meta')[0].textContent ?? '';
    expect(text(fixture)).toContain('a_jan.xlsx');
    expect(text(fixture)).toContain(PACKAGED_RUSSIAN['upl.pkg.status.verified']);
    expect(meta).toContain('Nalogi TEST');
    expect(meta).toContain('01.01.2026–31.01.2026');
    expect(meta).toContain('анкета, версия 2');
    expect(meta).toContain('загрузил Ivanov TEST');
  });

  it('статус «проверен» с ошибками: три числа и таблица с адресом и русским текстом без кода', async () => {
    const rows = [
      cell(),
      cell({ rowNo: 48, columnName: 'Summa', value: 'sto', code: 'UPL_CELL_NOT_NUMBER' })
    ];
    const { fixture, api } = await createFixture(item(), [of(errorsPage(rows))]);

    expect(api.errors).toHaveBeenCalledWith(item().id);
    const counters = testId(fixture, 'upl-pkg-counters')[0].textContent ?? '';
    expect(counters).toContain('120');
    expect(counters).toContain('117');
    expect(counters).toContain('3');
    const tableRows = testId(fixture, 'upl-pkg-error-row');
    expect(tableRows).toHaveLength(2);
    expect(tableRows[0].textContent).toContain('Sheet1');
    expect(tableRows[0].textContent).toContain('17');
    expect(tableRows[0].textContent).toContain('STIR');
    expect(tableRows[0].textContent).toContain('12AB');
    expect(tableRows[0].textContent).toContain(PACKAGED_RUSSIAN['upl.err.UPL_CELL_REQUIRED']);
    expect(tableRows[1].textContent).toContain(PACKAGED_RUSSIAN['upl.err.UPL_CELL_NOT_NUMBER']);
    expect(text(fixture)).not.toContain('UPL_CELL_');
    expect(testId(fixture, 'upl-pkg-errors-shown')).toHaveLength(0);
  });

  it('статус «проверен» без ошибок: вместо таблицы «Ошибок нет»', async () => {
    const { fixture } = await createFixture(item({ rowsRejected: 0, errorsTotal: 0 }), [of(errorsPage([]))]);

    expect(testId(fixture, 'upl-pkg-no-errors')).toHaveLength(1);
    expect(text(fixture)).toContain(PACKAGED_RUSSIAN['upl.pkg.card.no_errors']);
    expect(testId(fixture, 'upl-pkg-errors-table')).toHaveLength(0);
    expect(testId(fixture, 'upl-pkg-counters')).toHaveLength(1);
  });

  it('статус «отклонён»: причина с числом расхождений, каждое расхождение строкой, подсказка, без чисел', async () => {
    const rows = [
      struct('UPL_STRUCT_SHEET_MISSING', { sheet: 'Sheet1' }),
      struct('UPL_STRUCT_COLUMN_MISSING', { sheet: 'Sheet2', column: 'Summa', headerRow: 4 })
    ];
    const rejected = item({
      status: 'rejected',
      rowsTotal: null,
      rowsAccepted: null,
      rowsRejected: null,
      errorsTotal: 2,
      rejectCode: 'UPL_PKG_STRUCTURE',
      rejectParams: { count: 2 }
    });
    const { fixture } = await createFixture(rejected, [of(errorsPage(rows))]);

    const bar = testId(fixture, 'upl-pkg-rejected')[0].textContent ?? '';
    expect(bar).toContain(PACKAGED_RUSSIAN['upl.pkg.card.rejected']);
    expect(bar).toContain('Расхождений: 2');
    const structRows = testId(fixture, 'upl-pkg-struct-row');
    expect(structRows).toHaveLength(2);
    expect(structRows[0].textContent).toContain('Sheet1');
    expect(structRows[1].textContent).toContain('Summa');
    expect(bar).toContain(PACKAGED_RUSSIAN['upl.pkg.card.rejected_hint']);
    expect(testId(fixture, 'upl-pkg-counters')).toHaveLength(0);
    expect(testId(fixture, 'upl-pkg-errors-table')).toHaveLength(0);
  });

  it('статус «отклонён»: сервер не передаёт пустые поля — расхождение без поля rowNo всё равно показано строкой', async () => {
    // так запись выглядит в настоящем ответе сервера: полей sheet-адреса строки и value нет вовсе
    const fromServer = {
      sheet: 'Sheet2',
      columnName: 'Summa',
      code: 'UPL_STRUCT_COLUMN_MISSING',
      params: { sheet: 'Sheet2', column: 'Summa', headerRow: 4 }
    } as unknown as UplPackageErrorItem;
    const rejected = item({
      status: 'rejected',
      rowsTotal: null,
      rowsAccepted: null,
      rowsRejected: null,
      errorsTotal: 1,
      rejectCode: 'UPL_PKG_STRUCTURE',
      rejectParams: { count: 1 }
    });
    const { fixture } = await createFixture(rejected, [of(errorsPage([fromServer]))]);

    const structRows = testId(fixture, 'upl-pkg-struct-row');
    expect(structRows).toHaveLength(1);
    expect(structRows[0].textContent).toContain('Summa');
    expect(testId(fixture, 'upl-pkg-errors-table')).toHaveLength(0);
  });

  it('статус «отклонён» без записей: только причина и подсказка', async () => {
    const rejected = item({
      status: 'rejected',
      rowsTotal: null,
      rowsAccepted: null,
      rowsRejected: null,
      errorsTotal: 0,
      rejectCode: 'UPL_PKG_UNREADABLE',
      rejectParams: null
    });
    const { fixture } = await createFixture(rejected, [of(errorsPage([]))]);

    expect(testId(fixture, 'upl-pkg-rejected')[0].textContent).toContain(PACKAGED_RUSSIAN['upl.err.UPL_PKG_UNREADABLE']);
    expect(testId(fixture, 'upl-pkg-struct-row')).toHaveLength(0);
    expect(testId(fixture, 'upl-pkg-counters')).toHaveLength(0);
  });

  it('статус «применён»: числа и таблица ошибок остаются', async () => {
    const { fixture } = await createFixture(item({ status: 'applied', loadId: 9, rawRows: 117 }), [of(errorsPage([cell()]))]);

    expect(testId(fixture, 'upl-pkg-counters')).toHaveLength(1);
    expect(testId(fixture, 'upl-pkg-errors-table')).toHaveLength(1);
  });

  it('ошибок больше показанных: строка «Показаны первые 500 из 700»', async () => {
    const { fixture } = await createFixture(item(), [of(errorsPage([cell()], 700, 500))]);

    expect(testId(fixture, 'upl-pkg-errors-shown')[0].textContent).toContain('Показаны первые 500 из 700');
  });

  it('неизвестный код записи показывается как есть', async () => {
    const { fixture } = await createFixture(item(), [of(errorsPage([cell({ code: 'UPL_CELL_FROM_FUTURE' })]))]);

    expect(testId(fixture, 'upl-pkg-error-row')[0].textContent).toContain('UPL_CELL_FROM_FUTURE');
  });

  it('сбой запроса ошибок: полоса и «Повторить» повторяет запрос', async () => {
    const { fixture, api } = await createFixture(item(), [
      throwError(() => problem(500, 'boom', 'internal_error')),
      of(errorsPage([cell()]))
    ]);

    expect(testId(fixture, 'upl-pkg-errors-load-error')[0].textContent).toContain(PACKAGED_RUSSIAN['upl.pkg.load_error']);
    click(fixture, 'upl-pkg-errors-retry');
    expect(api.errors).toHaveBeenCalledTimes(2);
    expect(testId(fixture, 'upl-pkg-errors-load-error')).toHaveLength(0);
    expect(testId(fixture, 'upl-pkg-error-row')).toHaveLength(1);
  });

  it('пакет не найден: в полосе «Загрузка не найдена»', async () => {
    const { fixture } = await createFixture(item(), [throwError(() => problem(404, 'UPL_PKG_NOT_FOUND'))]);

    expect(testId(fixture, 'upl-pkg-errors-load-error')[0].textContent).toContain(PACKAGED_RUSSIAN['upl.err.UPL_PKG_NOT_FOUND']);
  });

  it('смена загрузки перечитывает ошибки', async () => {
    const { fixture, api } = await createFixture(item(), [
      of(errorsPage([cell()])),
      of(errorsPage([cell({ rowNo: 3 }), cell({ rowNo: 9 })]))
    ]);

    fixture.componentRef.setInput('item', item({ id: '6f1b0d1e-0000-4000-8000-000000000002' }));
    fixture.detectChanges();

    expect(api.errors).toHaveBeenCalledTimes(2);
    expect(api.errors).toHaveBeenLastCalledWith('6f1b0d1e-0000-4000-8000-000000000002');
    expect(testId(fixture, 'upl-pkg-error-row')).toHaveLength(2);
  });

  it('кнопки шапки отдают события «к списку» и «обновить»', async () => {
    const { fixture } = await createFixture(item());
    const back = vi.fn();
    const refresh = vi.fn();
    fixture.componentInstance.back.subscribe(back);
    fixture.componentInstance.refresh.subscribe(refresh);

    click(fixture, 'upl-pkg-back');
    click(fixture, 'upl-pkg-card-refresh');

    expect(back).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('AC-13: кнопка «Применить» есть только у «проверен» при праве', async () => {
    const withRight = await createFixture(item(), [of(errorsPage([cell()]))], true);
    expect(testId(withRight.fixture, 'upl-pkg-apply')).toHaveLength(1);
    expect(testId(withRight.fixture, 'upl-pkg-apply')[0].textContent).toContain(PACKAGED_RUSSIAN['upl.pkg.card.apply']);

    TestBed.resetTestingModule();
    const noRight = await createFixture(item(), [of(errorsPage([cell()]))], false);
    expect(testId(noRight.fixture, 'upl-pkg-apply')).toHaveLength(0);

    const otherStatuses: UplPackageStatus[] = ['received', 'rejected', 'applied'];
    for (const status of otherStatuses) {
      TestBed.resetTestingModule();
      const { fixture } = await createFixture(
        item({ status, rejectCode: status === 'rejected' ? 'UPL_PKG_INTERNAL' : null }),
        [of(errorsPage([cell()]))],
        true
      );
      expect(testId(fixture, 'upl-pkg-apply')).toHaveLength(0);
    }

    TestBed.resetTestingModule();
    const nothingAccepted = await createFixture(item({ rowsAccepted: 0 }), [of(errorsPage([cell()]))], true);
    expect(testId(nothingAccepted.fixture, 'upl-pkg-apply')).toHaveLength(0);
  });

  it('AC-13: «Применить» вызывает сервер и отдаёт применённую загрузку', async () => {
    const { fixture, api } = await createFixture(item(), [of(errorsPage([]))], true);
    const result = item({ status: 'applied', loadId: 9, rawRows: 120 });
    api.apply.mockReturnValue(of(result));
    const applied = vi.fn();
    fixture.componentInstance.applied.subscribe(applied);

    click(fixture, 'upl-pkg-apply');

    expect(api.apply).toHaveBeenCalledWith(item().id);
    expect(applied).toHaveBeenCalledWith(result);
    expect(testId(fixture, 'upl-pkg-apply-error')).toHaveLength(0);
  });

  it('AC-13: отказ сервера с кодом загрузки — красная полоса текстом словаря', async () => {
    const { fixture, api } = await createFixture(item(), [of(errorsPage([]))], true);
    api.apply.mockReturnValue(throwError(() => problem(409, 'UPL_PKG_NOT_VERIFIED', 'conflict')));

    click(fixture, 'upl-pkg-apply');

    expect(testId(fixture, 'upl-pkg-apply-error')[0].textContent).toContain('Применить можно только проверенную загрузку');
  });

  it('AC-12: отказ «нечего применять» — красная полоса текстом словаря', async () => {
    const { fixture, api } = await createFixture(item(), [of(errorsPage([]))], true);
    api.apply.mockReturnValue(throwError(() => problem(409, 'UPL_PKG_NOTHING_TO_APPLY', 'conflict')));

    click(fixture, 'upl-pkg-apply');

    expect(testId(fixture, 'upl-pkg-apply-error')[0].textContent).toContain(PACKAGED_RUSSIAN['upl.err.UPL_PKG_NOTHING_TO_APPLY']);
  });

  it('AC-13: отказ без кода загрузки — общий текст «Не удалось применить загрузку»', async () => {
    const { fixture, api } = await createFixture(item(), [of(errorsPage([]))], true);
    api.apply.mockReturnValue(throwError(() => problem(403, 'Access denied', 'forbidden')));

    click(fixture, 'upl-pkg-apply');

    expect(testId(fixture, 'upl-pkg-apply-error')[0].textContent).toContain('Не удалось применить загрузку');
  });

  it('AC-13: применённая загрузка с обоими числами — зелёная строка сверки', async () => {
    const { fixture } = await createFixture(item({ status: 'applied', loadId: 9, rowsTotal: 10, rawRows: 10 }));

    expect(testId(fixture, 'upl-pkg-reconciliation')[0].textContent?.trim()).toBe('В файле 10 строк = в базе 10 строк');
  });

  it('AC-13: применённая загрузка без числа строк в базе — строки сверки нет', async () => {
    const { fixture } = await createFixture(item({ status: 'applied', loadId: 9, rowsTotal: 10, rawRows: null }));

    expect(testId(fixture, 'upl-pkg-reconciliation')).toHaveLength(0);
  });

  it('AC-13: сверка не сошлась — причина отказа словами с обоими числами', async () => {
    const rejected = item({
      status: 'rejected',
      rowsTotal: null,
      rowsAccepted: null,
      rowsRejected: null,
      errorsTotal: 0,
      rejectCode: 'UPL_PKG_RECONCILIATION',
      rejectParams: { fileRows: 10, rawRows: 9 }
    });
    const { fixture } = await createFixture(rejected);

    expect(testId(fixture, 'upl-pkg-rejected')[0].textContent).toContain('Сверка не сошлась: в файле 10 строк, в базе 9');
    expect(testId(fixture, 'upl-pkg-reconciliation')).toHaveLength(0);
  });
});
