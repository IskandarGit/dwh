import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PACKAGED_RUSSIAN } from '../../../core/i18n/packaged-russian';
import { ProblemDetail } from '../../../core/models/common.models';
import { RptApiService, RptDefinition, RptDefinitionInput, RptSourceItem, RptSourceLayout } from '../shared/rpt-api';
import { RptEditPage } from './rpt-edit.page';

const sourceList: RptSourceItem[] = [
  { id: 1, code: 'vyd', name: 'Vydachi TEST' },
  { id: 2, code: 'otd', name: 'Otdeleniya TEST' },
  { id: 3, code: 'nod', name: 'Bez dat TEST' }
];

const layouts: Record<number, RptSourceLayout> = {
  1: {
    sourceId: 1,
    sheets: [{ ordinal: 1, name: 'List1' }],
    sheet: 1,
    columns: [
      { field: 'date_out', label: 'Data vydachi', type: 'date' },
      { field: 'amount', label: 'Summa', type: 'number' },
      { field: 'qty', label: 'Kolichestvo', type: 'integer' },
      { field: 'branch', label: 'Filial', type: 'text' },
      { field: 'region', label: 'Oblast', type: 'object_key' }
    ]
  },
  2: {
    sourceId: 2,
    sheets: [{ ordinal: 1, name: 'List1' }, { ordinal: 2, name: 'List2' }],
    sheet: 1,
    columns: [
      { field: 'code', label: 'Kod', type: 'ref_code' },
      { field: 'title', label: 'Nazvanie', type: 'text' },
      { field: 'opened', label: 'Otkryto', type: 'date' }
    ]
  },
  3: {
    sourceId: 3,
    sheets: [{ ordinal: 1, name: 'List1' }],
    sheet: 1,
    columns: [
      { field: 'name', label: 'Imya', type: 'text' },
      { field: 'value', label: 'Znachenie', type: 'number' }
    ]
  }
};

const allLabels: Record<string, string> = {
  'source:date_out': 'Data vydachi',
  'source:amount': 'Summa',
  'source:branch': 'Filial',
  'source:region': 'Oblast',
  'ref:code': 'Kod',
  'ref:title': 'Nazvanie'
};

function savedReport(labels: Record<string, string> = allLabels): RptDefinition {
  return {
    id: 7,
    name: 'Svod TEST',
    sourceId: 1,
    sourceSheet: 1,
    dateField: 'date_out',
    measure: { kind: 'total', field: 'amount' },
    measureName: null,
    monthFields: null,
    second: null,
    divisor: 1000000,
    decimals: 2,
    ref: { sourceId: 2, sheet: 1, keys: [{ field: 'branch', refField: 'code' }] },
    level1: { origin: 'ref', field: 'title' },
    level2: { origin: 'source', field: 'region' },
    lockVersion: 4,
    modifiedAt: '2026-09-23T10:00:00Z',
    modifiedBy: 'TEST',
    labels
  };
}

interface FixtureOptions {
  id?: number;
  report?: () => Observable<RptDefinition>;
  save?: () => Observable<RptDefinition>;
}

async function createFixture(options: FixtureOptions = {}) {
  const saved = savedReport();
  const api = {
    sources: vi.fn(() => of(sourceList)),
    layout: vi.fn((sourceId: number, _sheet: number | null) => of(layouts[sourceId])),
    report: vi.fn(options.report ?? (() => of(savedReport()))),
    create: vi.fn((_input: RptDefinitionInput) => (options.save ? options.save() : of({ ...saved, id: 11 }))),
    update: vi.fn((_id: number, _input: RptDefinitionInput) => (options.save ? options.save() : of(saved)))
  };
  const router = { navigate: vi.fn(() => Promise.resolve(true)) };
  const params = options.id === undefined ? {} : { id: String(options.id) };
  await TestBed.configureTestingModule({
    imports: [RptEditPage],
    providers: [
      { provide: RptApiService, useValue: api },
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(params) } } }
    ]
  }).compileComponents();
  const fixture = TestBed.createComponent(RptEditPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, api, router, page: fixture.componentInstance };
}

function byTestId(fixture: ComponentFixture<RptEditPage>, id: string): HTMLElement[] {
  return fixture.debugElement.queryAll(By.css(`[data-testid="${id}"]`)).map(node => node.nativeElement as HTMLElement);
}

function optionTexts(fixture: ComponentFixture<RptEditPage>, id: string, index = 0): string[] {
  const select = byTestId(fixture, id)[index] as HTMLSelectElement;
  return Array.from(select.options).map(option => option.textContent?.trim() ?? '');
}

async function choose(fixture: ComponentFixture<RptEditPage>, id: string, text: string, index = 0): Promise<void> {
  const select = byTestId(fixture, id)[index] as HTMLSelectElement;
  const option = Array.from(select.options).find(item => item.textContent?.trim() === text);
  if (!option) {
    throw new Error(`No option "${text}" in ${id}`);
  }
  select.value = option.value;
  select.dispatchEvent(new Event('change'));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

async function typeName(fixture: ComponentFixture<RptEditPage>, value: string): Promise<void> {
  const input = byTestId(fixture, 'rpt-edit-name')[0] as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
  await fixture.whenStable();
}

async function click(fixture: ComponentFixture<RptEditPage>, id: string, index = 0): Promise<void> {
  const host = byTestId(fixture, id)[index];
  (host.querySelector('button') ?? host).click();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function saveButton(fixture: ComponentFixture<RptEditPage>): HTMLButtonElement {
  return byTestId(fixture, 'rpt-edit-save')[0].querySelector('button') as HTMLButtonElement;
}

function ru(key: string, params: Record<string, string> = {}): string {
  return Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, value), PACKAGED_RUSSIAN[key]);
}

async function fillCountReport(fixture: ComponentFixture<RptEditPage>): Promise<void> {
  await typeName(fixture, 'Svod TEST');
  await choose(fixture, 'rpt-edit-source', 'Vydachi TEST (vyd)');
  await choose(fixture, 'rpt-edit-date', 'Data vydachi');
  await click(fixture, 'rpt-edit-measure-count');
  await choose(fixture, 'rpt-edit-level1', ru('rpt.edit.origin_source', { label: 'Filial' }));
}

describe('RptEditPage', () => {
  it('opens an empty form with the sources as "name (code)" and the new report title', async () => {
    const { fixture, api } = await createFixture();

    expect(api.sources).toHaveBeenCalledTimes(1);
    expect(api.report).not.toHaveBeenCalled();
    expect(byTestId(fixture, 'rpt-edit-title')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.edit.new_title']);
    expect(byTestId(fixture, 'rpt-edit-back')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.view.back']);
    expect(optionTexts(fixture, 'rpt-edit-source')).toEqual([
      PACKAGED_RUSSIAN['rpt.edit.choose'],
      'Vydachi TEST (vyd)',
      'Otdeleniya TEST (otd)',
      'Bez dat TEST (nod)'
    ]);
    expect(byTestId(fixture, 'rpt-edit-block-name')).toHaveLength(1);
    expect(byTestId(fixture, 'rpt-edit-block-levels')).toHaveLength(1);
    expect(byTestId(fixture, 'rpt-edit-ref-block')).toHaveLength(0);
  });

  it('loads the layout of the chosen source and filters the date, measure and level lists', async () => {
    const { fixture, api } = await createFixture();

    await choose(fixture, 'rpt-edit-source', 'Vydachi TEST (vyd)');

    expect(api.layout).toHaveBeenCalledWith(1, null);
    expect(optionTexts(fixture, 'rpt-edit-date').slice(1)).toEqual(['Data vydachi']);
    expect(optionTexts(fixture, 'rpt-edit-measure-field').slice(1)).toEqual(['Summa', 'Kolichestvo']);
    await choose(fixture, 'rpt-edit-measure-field', 'Summa');
    expect(optionTexts(fixture, 'rpt-edit-level1').slice(1)).toEqual([
      ru('rpt.edit.origin_source', { label: 'Kolichestvo' }),
      ru('rpt.edit.origin_source', { label: 'Filial' }),
      ru('rpt.edit.origin_source', { label: 'Oblast' })
    ]);
    expect(byTestId(fixture, 'rpt-edit-source-sheet')).toHaveLength(0);
  });

  it('clears the dependent fields when the source changes and asks to choose them again', async () => {
    const { fixture, page } = await createFixture();
    await choose(fixture, 'rpt-edit-source', 'Vydachi TEST (vyd)');
    await choose(fixture, 'rpt-edit-date', 'Data vydachi');
    await choose(fixture, 'rpt-edit-measure-field', 'Summa');
    await choose(fixture, 'rpt-edit-level1', ru('rpt.edit.origin_source', { label: 'Filial' }));

    await choose(fixture, 'rpt-edit-source', 'Bez dat TEST (nod)');

    const state = page.form();
    expect(state.dateField).toBeNull();
    expect(state.measureField).toBeNull();
    expect(state.level1).toBeNull();
    expect(byTestId(fixture, 'rpt-edit-again-measureField')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.edit.choose_again']);
    expect(byTestId(fixture, 'rpt-edit-again-level1')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.edit.choose_again']);
    expect(byTestId(fixture, 'rpt-edit-again-sourceSheet')).toHaveLength(0);
  });

  it('shows the hint and blocks saving when the source has no date column', async () => {
    const { fixture } = await createFixture();

    await choose(fixture, 'rpt-edit-source', 'Bez dat TEST (nod)');

    expect(byTestId(fixture, 'rpt-edit-no-date')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.edit.no_date_columns']);
    expect(byTestId(fixture, 'rpt-edit-date')).toHaveLength(0);
    expect(saveButton(fixture).disabled).toBe(true);
  });

  it('shows the reference block with one pair, adds the second pair and removes it, never more than two', async () => {
    const { fixture, api } = await createFixture();
    await choose(fixture, 'rpt-edit-source', 'Vydachi TEST (vyd)');

    await click(fixture, 'rpt-edit-use-ref');
    expect(byTestId(fixture, 'rpt-edit-ref-block')).toHaveLength(1);
    expect(byTestId(fixture, 'rpt-edit-pair')).toHaveLength(1);
    expect(byTestId(fixture, 'rpt-edit-remove-pair')).toHaveLength(0);
    expect(optionTexts(fixture, 'rpt-edit-ref').slice(1)).toEqual(['Otdeleniya TEST (otd)', 'Bez dat TEST (nod)']);

    await choose(fixture, 'rpt-edit-ref', 'Otdeleniya TEST (otd)');
    expect(api.layout).toHaveBeenCalledWith(2, null);
    expect(byTestId(fixture, 'rpt-edit-ref-sheet')).toHaveLength(1);
    expect(optionTexts(fixture, 'rpt-edit-key-field').slice(1)).toEqual(['Summa', 'Kolichestvo', 'Filial', 'Oblast']);
    expect(optionTexts(fixture, 'rpt-edit-key-ref-field').slice(1)).toEqual(['Kod', 'Nazvanie']);
    expect(optionTexts(fixture, 'rpt-edit-level1')).toContain(ru('rpt.edit.origin_ref', { label: 'Nazvanie' }));

    await click(fixture, 'rpt-edit-add-pair');
    expect(byTestId(fixture, 'rpt-edit-pair')).toHaveLength(2);
    expect(byTestId(fixture, 'rpt-edit-add-pair')).toHaveLength(0);
    expect(byTestId(fixture, 'rpt-edit-remove-pair')).toHaveLength(1);

    await click(fixture, 'rpt-edit-remove-pair');
    expect(byTestId(fixture, 'rpt-edit-pair')).toHaveLength(1);
    expect(byTestId(fixture, 'rpt-edit-add-pair')).toHaveLength(1);
  });

  it('switching the reference off hides the block and drops the reference levels', async () => {
    const { fixture, page } = await createFixture({ id: 7 });

    await click(fixture, 'rpt-edit-use-ref');

    expect(byTestId(fixture, 'rpt-edit-ref-block')).toHaveLength(0);
    expect(page.form().level1).toBeNull();
    expect(page.form().level2).toEqual({ origin: 'source', field: 'region' });
    expect(byTestId(fixture, 'rpt-edit-again-level1')).toHaveLength(1);
  });

  it('sends the description exactly by the contract and opens the new report', async () => {
    const { fixture, api, router } = await createFixture();
    await fillCountReport(fixture);

    await click(fixture, 'rpt-edit-save');

    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create.mock.calls[0][0]).toEqual({
      name: 'Svod TEST',
      sourceId: 1,
      sourceSheet: 1,
      dateField: 'date_out',
      measure: { kind: 'count', field: null },
      measureName: null,
      monthFields: null,
      second: null,
      divisor: 1,
      decimals: 0,
      ref: null,
      level1: { origin: 'source', field: 'branch' },
      level2: null
    });
    expect(router.navigate).toHaveBeenCalledWith(['/rpt/reports', 11]);
  });

  it('shows the server errors at the name and at the reference column of the first pair', async () => {
    const problem: ProblemDetail = {
      title: 'TEST',
      status: 422,
      code: 'TEST',
      detail: 'RPT_DEFINITION_INVALID',
      errors: [
        { field: 'name', code: 'RPT_NAME_TAKEN', message: 'RPT_NAME_TAKEN' },
        { field: 'ref.keys[0].refField', code: 'RPT_COLUMN_TYPE', message: 'RPT_COLUMN_TYPE' }
      ]
    };
    const { fixture, router } = await createFixture({ id: 7, save: () => throwError(() => problem) });

    await click(fixture, 'rpt-edit-save');

    expect(byTestId(fixture, 'rpt-edit-error-name')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.err.RPT_NAME_TAKEN']);
    expect(byTestId(fixture, 'rpt-edit-error-key-ref-field')[0].textContent?.trim()).toBe(
      ru('rpt.err.RPT_COLUMN_TYPE', { label: 'Kod', need: PACKAGED_RUSSIAN['rpt.edit.need.not_date'] })
    );
    expect(byTestId(fixture, 'rpt-edit-save-error')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.err.RPT_DEFINITION_INVALID']);
    expect(router.navigate).not.toHaveBeenCalled();

    await typeName(fixture, 'Svod 2 TEST');
    fixture.detectChanges();
    expect(byTestId(fixture, 'rpt-edit-error-name')).toHaveLength(0);
    expect(byTestId(fixture, 'rpt-edit-error-key-ref-field')).toHaveLength(1);
  });

  it('shows the strip about another user and reopens the report', async () => {
    const problem: ProblemDetail = { title: 'TEST', status: 409, code: 'TEST', detail: 'RPT_CONFLICT' };
    const { fixture, api } = await createFixture({ id: 7, save: () => throwError(() => problem) });

    await click(fixture, 'rpt-edit-save');
    expect(byTestId(fixture, 'rpt-edit-conflict')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.edit.conflict']);

    await click(fixture, 'rpt-edit-reopen');
    expect(api.report).toHaveBeenCalledTimes(2);
    expect(byTestId(fixture, 'rpt-edit-conflict')).toHaveLength(0);
  });

  it('opens a saved report with its fields filled and sends its lock version on save', async () => {
    const { fixture, api, page, router } = await createFixture({ id: 7 });

    expect(api.report).toHaveBeenCalledWith(7);
    expect(api.layout).toHaveBeenCalledWith(1, 1);
    expect(api.layout).toHaveBeenCalledWith(2, 1);
    expect(byTestId(fixture, 'rpt-edit-title')[0].textContent).toContain('Svod TEST');
    expect(byTestId(fixture, 'rpt-edit-back')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.edit.back']);
    expect((byTestId(fixture, 'rpt-edit-name')[0] as HTMLInputElement).value).toBe('Svod TEST');
    expect(page.levelValue('level1')).toBe('ref:title');
    expect(byTestId(fixture, 'rpt-edit-pair')).toHaveLength(1);
    expect(page.canLeaveRecordPage()).toBe(true);

    await click(fixture, 'rpt-edit-save');

    expect(api.create).not.toHaveBeenCalled();
    const [id, input] = api.update.mock.calls[0];
    expect(id).toBe(7);
    expect(input.lockVersion).toBe(4);
    expect(input.ref).toEqual({ sourceId: 2, sheet: 1, keys: [{ field: 'branch', refField: 'code' }] });
    expect(input.measure).toEqual({ kind: 'total', field: 'amount' });
    expect(router.navigate).toHaveBeenCalledWith(['/rpt/reports', 7]);
  });

  it('asks to choose again a column that is gone from the current form', async () => {
    const labels = { ...allLabels };
    delete labels['source:region'];
    const { fixture, page } = await createFixture({ id: 7, report: () => of(savedReport(labels)) });

    expect(page.form().level2).toBeNull();
    expect(byTestId(fixture, 'rpt-edit-again-level2')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.edit.choose_again']);
  });

  it('does not offer level 2 equal to level 1', async () => {
    const { fixture } = await createFixture({ id: 7 });

    const select = byTestId(fixture, 'rpt-edit-level2')[0] as HTMLSelectElement;
    const blocked = Array.from(select.options).filter(option => option.disabled).map(option => option.textContent?.trim());
    expect(blocked).toEqual([ru('rpt.edit.origin_ref', { label: 'Nazvanie' })]);
    expect(optionTexts(fixture, 'rpt-edit-level2')[0]).toBe(PACKAGED_RUSSIAN['rpt.edit.no_level2']);
  });

  it('lets the user leave without a question when nothing changed and asks when something did', async () => {
    const { fixture, page } = await createFixture();
    expect(page.canLeaveRecordPage()).toBe(true);

    await typeName(fixture, 'Svod TEST');
    const decision = page.canLeaveRecordPage();
    expect(decision).not.toBe(true);

    const answers: boolean[] = [];
    (decision as Observable<boolean>).subscribe(answer => answers.push(answer));
    fixture.detectChanges();
    expect(page.isLeaveOpen()).toBe(true);
    await click(fixture, 'rpt-edit-leave-yes');
    expect(answers).toEqual([true]);
  });

  it('cancel goes back to the list for a new report and to the report for a saved one', async () => {
    const created = await createFixture();
    await click(created.fixture, 'rpt-edit-cancel');
    expect(created.router.navigate).toHaveBeenCalledWith(['/rpt/reports']);

    TestBed.resetTestingModule();
    const opened = await createFixture({ id: 7 });
    await click(opened.fixture, 'rpt-edit-cancel');
    expect(opened.router.navigate).toHaveBeenCalledWith(['/rpt/reports', 7]);
  });
});

const NO_MONTHS: (string | null)[] = Array.from({ length: 12 }, () => null);

function months(...fields: (string | null)[]): (string | null)[] {
  return NO_MONTHS.map((empty, index) => fields[index] ?? empty);
}

function twoMeasureReport(): RptDefinition {
  return {
    ...savedReport(),
    dateField: null,
    measure: null,
    measureName: 'Fakt TEST',
    monthFields: months('amount', 'qty', 'amount', 'qty'),
    ref: null,
    level1: { origin: 'source', field: 'branch' },
    level2: { origin: 'source', field: 'region' },
    second: {
      name: 'Plan TEST',
      sourceId: 3,
      sourceSheet: 1,
      dateField: null,
      monthFields: months('value'),
      measure: null,
      divisor: 1000,
      decimals: 1,
      ref: null,
      level1: { origin: 'source', field: 'name' },
      level2: null
    },
    labels: {
      ...allLabels,
      'source:qty': 'Kolichestvo',
      'second.source:value': 'Znachenie',
      'second.source:name': 'Imya'
    }
  };
}

async function typeInto(fixture: ComponentFixture<RptEditPage>, id: string, value: string): Promise<void> {
  const input = byTestId(fixture, id)[0] as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function isChecked(fixture: ComponentFixture<RptEditPage>, id: string): boolean {
  return (byTestId(fixture, id)[0] as HTMLInputElement).checked;
}

describe('RptEditPage — measure name, month columns, second measure', () => {
  it('switching to month columns hides "what we add up", keeps the divisor and offers number columns for every month', async () => {
    const { fixture } = await createFixture();
    await choose(fixture, 'rpt-edit-source', 'Vydachi TEST (vyd)');
    expect(byTestId(fixture, 'rpt-edit-measure-kind')).toHaveLength(1);

    await click(fixture, 'rpt-edit-period-months');

    expect(byTestId(fixture, 'rpt-edit-measure-kind')).toHaveLength(0);
    expect(byTestId(fixture, 'rpt-edit-measure-field')).toHaveLength(0);
    expect(byTestId(fixture, 'rpt-edit-date')).toHaveLength(0);
    expect(byTestId(fixture, 'rpt-edit-block-measure')[0].textContent).not.toContain(PACKAGED_RUSSIAN['rpt.edit.block_measure']);
    expect(byTestId(fixture, 'rpt-edit-divisor')).toHaveLength(1);
    expect(byTestId(fixture, 'rpt-edit-decimals')).toHaveLength(1);
    expect(byTestId(fixture, 'rpt-edit-month')).toHaveLength(12);
    expect(byTestId(fixture, 'rpt-edit-months')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.month.12']);
    expect(optionTexts(fixture, 'rpt-edit-month', 11)).toEqual([PACKAGED_RUSSIAN['rpt.edit.month_none'], 'Summa', 'Kolichestvo']);

    await click(fixture, 'rpt-edit-period-date');
    expect(byTestId(fixture, 'rpt-edit-measure-kind')).toHaveLength(1);
    expect(byTestId(fixture, 'rpt-edit-months')).toHaveLength(0);
  });

  it('shows the measure name hint for measure 1 only while its period is a date column', async () => {
    const { fixture } = await createFixture();
    await choose(fixture, 'rpt-edit-source', 'Vydachi TEST (vyd)');
    expect(byTestId(fixture, 'rpt-edit-measure-name-hint')).toHaveLength(1);
    expect(byTestId(fixture, 'rpt-edit-measure-name-hint')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.edit.measure_name_hint']);

    await click(fixture, 'rpt-edit-period-months');
    expect(byTestId(fixture, 'rpt-edit-measure-name-hint')).toHaveLength(0);

    await click(fixture, 'rpt-edit-period-date');
    expect(byTestId(fixture, 'rpt-edit-measure-name-hint')).toHaveLength(1);
  });

  it('fills the months in order from January and sends a measure by month columns without date and measure', async () => {
    const { fixture, api, page } = await createFixture();
    await typeName(fixture, 'Plan TEST');
    await choose(fixture, 'rpt-edit-source', 'Bez dat TEST (nod)');
    expect(saveButton(fixture).disabled).toBe(true);
    await click(fixture, 'rpt-edit-period-months');
    expect(saveButton(fixture).disabled).toBe(false);

    await choose(fixture, 'rpt-edit-source', 'Vydachi TEST (vyd)');
    const fill = byTestId(fixture, 'rpt-edit-fill-months')[0].querySelector('button') as HTMLButtonElement;
    expect(fill.disabled).toBe(true);
    await choose(fixture, 'rpt-edit-month', 'Summa', 0);
    await click(fixture, 'rpt-edit-fill-months');

    expect(page.form().monthFields).toEqual(months('amount', 'qty'));
    await choose(fixture, 'rpt-edit-level1', ru('rpt.edit.origin_source', { label: 'Filial' }));
    await click(fixture, 'rpt-edit-save');

    expect(api.create.mock.calls[0][0]).toEqual({
      name: 'Plan TEST',
      measureName: null,
      sourceId: 1,
      sourceSheet: 1,
      dateField: null,
      monthFields: months('amount', 'qty'),
      measure: null,
      divisor: 1,
      decimals: 0,
      ref: null,
      level1: { origin: 'source', field: 'branch' },
      level2: null,
      second: null
    });
  });

  it('the checkbox opens the second measure block and sends it; unticked the body has no second measure', async () => {
    const { fixture, api } = await createFixture();
    await fillCountReport(fixture);
    expect(isChecked(fixture, 'rpt-edit-use-second')).toBe(false);
    expect(byTestId(fixture, 'rpt-edit-measure2')).toHaveLength(0);

    await click(fixture, 'rpt-edit-use-second');
    expect(byTestId(fixture, 'rpt-edit-measure2')).toHaveLength(1);
    expect(byTestId(fixture, 'rpt-edit-m2-measure-title')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.edit.block_measure2']);
    expect(byTestId(fixture, 'rpt-edit-m2-hint-levels')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.edit.hint_levels']);
    expect(byTestId(fixture, 'rpt-edit-m2-hint-ratio')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.edit.hint_ratio']);

    await typeInto(fixture, 'rpt-edit-m2-measure-name', 'Plan TEST');
    await choose(fixture, 'rpt-edit-m2-source', 'Bez dat TEST (nod)');
    await click(fixture, 'rpt-edit-m2-period-months');
    await choose(fixture, 'rpt-edit-m2-month', 'Znachenie', 0);
    await choose(fixture, 'rpt-edit-m2-level1', ru('rpt.edit.origin_source', { label: 'Imya' }));
    expect(byTestId(fixture, 'rpt-edit-m2-match-level1')[0].textContent?.trim()).toBe(
      ru('rpt.edit.level_matches', { label: 'Filial' })
    );
    await click(fixture, 'rpt-edit-save');

    expect(api.create.mock.calls[0][0].second).toEqual({
      name: 'Plan TEST',
      sourceId: 3,
      sourceSheet: 1,
      dateField: null,
      monthFields: months('value'),
      measure: null,
      divisor: 1,
      decimals: 0,
      ref: null,
      level1: { origin: 'source', field: 'name' },
      level2: null
    });

    await click(fixture, 'rpt-edit-use-second');
    expect(byTestId(fixture, 'rpt-edit-measure2')).toHaveLength(0);
    await click(fixture, 'rpt-edit-save');
    expect(api.create.mock.calls[1][0].second).toBeNull();
  });

  it('shows level 2 of the second measure only when the first measure has level 2', async () => {
    const { fixture, page } = await createFixture();
    await fillCountReport(fixture);
    await click(fixture, 'rpt-edit-use-second');
    await choose(fixture, 'rpt-edit-m2-source', 'Vydachi TEST (vyd)');
    expect(byTestId(fixture, 'rpt-edit-m2-level1')).toHaveLength(1);
    expect(byTestId(fixture, 'rpt-edit-m2-level2')).toHaveLength(0);

    await choose(fixture, 'rpt-edit-level2', ru('rpt.edit.origin_source', { label: 'Oblast' }));
    expect(byTestId(fixture, 'rpt-edit-m2-level2')).toHaveLength(1);
    expect(byTestId(fixture, 'rpt-edit-m2-match-level2')[0].textContent?.trim()).toBe(
      ru('rpt.edit.level_matches', { label: 'Oblast' })
    );
    await choose(fixture, 'rpt-edit-m2-level2', ru('rpt.edit.origin_source', { label: 'Oblast' }));
    expect(page.form().second.level2).toEqual({ origin: 'source', field: 'region' });

    await choose(fixture, 'rpt-edit-level2', PACKAGED_RUSSIAN['rpt.edit.no_level2']);
    expect(byTestId(fixture, 'rpt-edit-m2-level2')).toHaveLength(0);
    expect(page.form().second.level2).toBeNull();
  });

  it('shows the level count error inside the second measure block and a month error at its own month', async () => {
    const problem: ProblemDetail = {
      title: 'TEST',
      status: 422,
      code: 'TEST',
      detail: 'RPT_DEFINITION_INVALID',
      errors: [
        { field: 'second.level2', code: 'RPT_LEVELS_MISMATCH', message: 'RPT_LEVELS_MISMATCH' },
        { field: 'monthFields[3]', code: 'RPT_COLUMN_TYPE', message: 'RPT_COLUMN_TYPE' }
      ]
    };
    const { fixture } = await createFixture({
      id: 7,
      report: () => of(twoMeasureReport()),
      save: () => throwError(() => problem)
    });

    await click(fixture, 'rpt-edit-save');

    const secondBlock = byTestId(fixture, 'rpt-edit-measure2')[0];
    const levelError = secondBlock.querySelector('[data-testid="rpt-edit-m2-error-level2"]');
    expect(levelError?.textContent?.trim()).toBe(PACKAGED_RUSSIAN['rpt.err.RPT_LEVELS_MISMATCH']);
    expect(byTestId(fixture, 'rpt-edit-error-level2')).toHaveLength(0);
    expect(byTestId(fixture, 'rpt-edit-error-month-3')[0].textContent?.trim()).toBe(
      ru('rpt.err.RPT_COLUMN_TYPE', { label: 'Kolichestvo', need: PACKAGED_RUSSIAN['rpt.edit.need.number'] })
    );
    expect(byTestId(fixture, 'rpt-edit-error-month-2')).toHaveLength(0);
    expect(byTestId(fixture, 'rpt-edit-m2-error-month-3')).toHaveLength(0);
  });

  it('shows the server error about a missing name of the first measure under its name field', async () => {
    const problem: ProblemDetail = {
      title: 'TEST',
      status: 422,
      code: 'TEST',
      detail: 'RPT_DEFINITION_INVALID',
      errors: [{ field: 'measureName', code: 'RPT_MEASURE_NAME_INVALID', message: 'RPT_MEASURE_NAME_INVALID' }]
    };
    const { fixture } = await createFixture({
      id: 7,
      report: () => of(twoMeasureReport()),
      save: () => throwError(() => problem)
    });

    await click(fixture, 'rpt-edit-save');

    const error = byTestId(fixture, 'rpt-edit-error-measureName');
    expect(error).toHaveLength(1);
    expect(error[0].textContent?.trim()).toBe(PACKAGED_RUSSIAN['rpt.err.RPT_MEASURE_NAME_INVALID']);
    expect(byTestId(fixture, 'rpt-edit-m2-error-measureName')).toHaveLength(0);
  });

  it('opens a saved report with two measures; a gone column of the second measure asks to choose again in its block', async () => {
    const report = twoMeasureReport();
    delete report.labels['second.source:name'];
    const { fixture, api, page } = await createFixture({ id: 7, report: () => of(report) });

    expect(api.layout).toHaveBeenCalledWith(3, 1);
    expect(isChecked(fixture, 'rpt-edit-use-second')).toBe(true);
    expect(isChecked(fixture, 'rpt-edit-period-months')).toBe(true);
    expect(isChecked(fixture, 'rpt-edit-m2-period-months')).toBe(true);
    expect((byTestId(fixture, 'rpt-edit-measure-name')[0] as HTMLInputElement).value).toBe('Fakt TEST');
    expect((byTestId(fixture, 'rpt-edit-m2-measure-name')[0] as HTMLInputElement).value).toBe('Plan TEST');
    expect(page.form().monthFields).toEqual(months('amount', 'qty', 'amount', 'qty'));
    expect(page.form().second.level1).toBeNull();
    expect(byTestId(fixture, 'rpt-edit-m2-again-level1')).toHaveLength(1);
    expect(byTestId(fixture, 'rpt-edit-again-level1')).toHaveLength(0);
  });

  it('opens an old report without the new fields as before: one measure by a date column, the checkbox unticked', async () => {
    const old: Partial<RptDefinition> = savedReport();
    delete old.measureName;
    delete old.monthFields;
    delete old.second;
    const { fixture, api } = await createFixture({ id: 7, report: () => of(old as RptDefinition) });

    expect(isChecked(fixture, 'rpt-edit-use-second')).toBe(false);
    expect(byTestId(fixture, 'rpt-edit-measure2')).toHaveLength(0);
    expect(isChecked(fixture, 'rpt-edit-period-date')).toBe(true);
    expect(byTestId(fixture, 'rpt-edit-measure-kind')).toHaveLength(1);
    expect(byTestId(fixture, 'rpt-edit-months')).toHaveLength(0);
    expect((byTestId(fixture, 'rpt-edit-measure-name')[0] as HTMLInputElement).value).toBe('');
    expect(byTestId(fixture, 'rpt-edit-measure-title')[0].textContent).toContain(PACKAGED_RUSSIAN['rpt.edit.block_measure1']);

    await click(fixture, 'rpt-edit-save');

    const input = api.update.mock.calls[0][1];
    expect(input.second).toBeNull();
    expect(input.monthFields).toBeNull();
    expect(input.measureName).toBeNull();
    expect(input.dateField).toBe('date_out');
    expect(input.measure).toEqual({ kind: 'total', field: 'amount' });
  });
});
