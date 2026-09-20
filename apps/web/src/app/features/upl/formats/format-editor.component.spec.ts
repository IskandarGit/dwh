import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { PACKAGED_RUSSIAN } from '../../../core/i18n/packaged-russian';
import { UplApiService, UplFormatDraftRequest, UplFormatVersion, UplSource, UplUnit, UplVersionItem } from '../upl-api';
import { FormatEditorComponent } from './format-editor.component';

const SOURCE: UplSource = {
  id: 7,
  code: 'SRC',
  name: 'Source A',
  ownerOrg: 'TEST',
  ownerContact: null,
  periodicity: 'month',
  slaDays: 5,
  sourceType: 'file',
  reconciliationStrictness: 'error',
  lockVersion: 2,
  lastPublishedVersion: null,
  hasDraft: true,
  createdAt: '2026-09-01T00:00:00Z',
  modifiedAt: '2026-09-01T00:00:00Z'
};

const UNITS: UplUnit[] = [
  { code: 'ton', name: 'Tonna', baseUnitCode: 'kg' },
  { code: 'kg', name: 'Kilogramm', baseUnitCode: 'kg' },
  { code: 'liter', name: 'Litr', baseUnitCode: 'l' },
  { code: 'l', name: 'Litr', baseUnitCode: 'l' }
];

const VERSION_ITEMS: UplVersionItem[] = [
  { version: 1, status: 'draft', validFrom: null, validTo: null, publishedAt: null, publishedBy: null }
];

function draftVersion(): UplFormatVersion {
  return {
    sourceId: 7,
    version: 1,
    status: 'draft',
    validFrom: null,
    validTo: null,
    publishedAt: null,
    publishedBy: null,
    lockVersion: 4,
    fileKind: 'xlsx',
    encoding: null,
    delimiter: null,
    matchColumnsBy: 'header',
    sheets: [
      {
        id: 11,
        ordinal: 1,
        sheetName: 'Sheet1',
        headerRow: 1,
        totalRowMarker: null,
        columns: [
          {
            id: 21,
            ordinal: 1,
            filePosition: null,
            nameInFile: 'STIR',
            targetField: 'stir',
            dataType: 'object_key',
            required: true,
            sourceUnit: null,
            baseUnit: null,
            keyMask: '^[0-9]{9}$',
            keyPadLength: 9,
            keyPadMax: 9,
            refBookCode: null
          },
          {
            id: 22,
            ordinal: 2,
            filePosition: null,
            nameInFile: 'Volume',
            targetField: 'volume',
            dataType: 'number',
            required: false,
            sourceUnit: 'ton',
            baseUnit: 'kg',
            keyMask: null,
            keyPadLength: null,
            keyPadMax: null,
            refBookCode: null
          }
        ]
      }
    ]
  };
}

interface FixtureOptions {
  version?: UplFormatVersion;
  source?: UplSource;
  actions?: string[];
  saveError?: unknown;
  loadError?: unknown;
  publishError?: unknown;
}

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function createFixture(options: FixtureOptions = {}) {
  const version = options.version ?? draftVersion();
  const source = options.source ?? SOURCE;
  const actions = options.actions ?? ['view', 'edit', 'publish'];
  const api = {
    getSource: vi.fn(() => of(structuredClone(source))),
    getVersion: vi.fn(() => options.loadError ? throwError(() => options.loadError) : of(structuredClone(version))),
    listVersions: vi.fn(() => of(structuredClone(VERSION_ITEMS))),
    listUnits: vi.fn(() => of(structuredClone(UNITS))),
    saveDraft: vi.fn((_id: string, _v: string, body: UplFormatDraftRequest) => options.saveError
      ? throwError(() => options.saveError)
      : of({ ...structuredClone(version), lockVersion: version.lockVersion + 1, sheets: structuredClone(body.sheets) })),
    publish: vi.fn(() => options.publishError ? throwError(() => options.publishError) : of(undefined))
  };
  const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
  const permissions = { hasPermission: vi.fn((_form: string, action: string) => actions.includes(action)) };

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [FormatEditorComponent],
    providers: [
      provideRouter([]),
      { provide: UplApiService, useValue: api },
      { provide: PermissionService, useValue: permissions },
      { provide: ToastService, useValue: toast },
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: '7', v: '1' })) } }
    ]
  }).compileComponents();

  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(FormatEditorComponent);
  fixture.detectChanges();
  return { fixture, api, toast, navigate, component: fixture.componentInstance };
}

function one(fixture: ComponentFixture<FormatEditorComponent>, testId: string): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
}

function many(fixture: ComponentFixture<FormatEditorComponent>, testId: string): HTMLElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testId}"]`));
}

function click(element: HTMLElement | null): void {
  if (!element) {
    throw new Error('element to click not found');
  }
  const target = element.querySelector('button') ?? element;
  target.click();
}

function selectOption(element: HTMLElement | null, match: (option: HTMLOptionElement) => boolean): void {
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error('select not found');
  }
  const option = Array.from(element.options).find(match);
  if (!option) {
    throw new Error('option not found');
  }
  element.value = option.value;
  element.dispatchEvent(new Event('change'));
}

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

/** Грязный черновик: новая колонка, заполненная так, чтобы локальная проверка её пропустила. */
function addValidColumn(fixture: ComponentFixture<FormatEditorComponent>, name = 'Новая', target = 'new_col'): void {
  click(one(fixture, 'upl-add-column'));
  fixture.detectChanges();
  const rows = many(fixture, 'upl-column-row');
  const row = rows[rows.length - 1];
  setInputValue(row.querySelector('[data-testid="upl-cell-name-in-file"]') as HTMLInputElement, name);
  setInputValue(row.querySelector('[data-testid="upl-cell-target-field"]') as HTMLInputElement, target);
  fixture.detectChanges();
}

function twoSheetVersion(): UplFormatVersion {
  const base = draftVersion();
  const second = structuredClone(base.sheets[0]);
  second.id = 12;
  second.ordinal = 2;
  second.sheetName = 'Sheet2';
  return { ...base, sheets: [base.sheets[0], second] };
}

describe('FormatEditorComponent', () => {
  it('loads source, version, sheet tabs and columns', async () => {
    const { fixture } = await createFixture();

    expect(many(fixture, 'upl-sheet-tab').length).toBe(1);
    expect(many(fixture, 'upl-column-row').length).toBe(2);
    expect(one(fixture, 'upl-actions')).not.toBeNull();
  });

  it('shows published version as read only', async () => {
    const published: UplFormatVersion = { ...draftVersion(), status: 'published', validFrom: '2026-01-01' };
    const { fixture } = await createFixture({ version: published, source: { ...SOURCE, hasDraft: false } });

    expect(one(fixture, 'upl-readonly-note')).not.toBeNull();
    expect(one(fixture, 'upl-actions')).toBeNull();
    expect((many(fixture, 'upl-cell-name-in-file')[0] as HTMLInputElement).disabled).toBe(true);
  });

  it('hides save without edit right and publish without publish right', async () => {
    const readOnly = await createFixture({ actions: ['view', 'publish'] });
    expect((many(readOnly.fixture, 'upl-cell-name-in-file')[0] as HTMLInputElement).disabled).toBe(true);
    expect(one(readOnly.fixture, 'upl-save')).toBeNull();

    const withoutPublish = await createFixture({ actions: ['view', 'edit'] });
    expect(one(withoutPublish.fixture, 'upl-publish')).toBeNull();
    expect(one(withoutPublish.fixture, 'upl-save')).not.toBeNull();
  });

  it('adds a column and reverts unsaved changes', async () => {
    const { fixture, component } = await createFixture();

    click(one(fixture, 'upl-add-column'));
    fixture.detectChanges();
    expect(many(fixture, 'upl-column-row').length).toBe(3);
    expect(component.isDirty()).toBe(true);

    click(one(fixture, 'upl-revert'));
    fixture.detectChanges();
    expect(many(fixture, 'upl-column-row').length).toBe(2);
    expect(component.isDirty()).toBe(false);
  });

  it('saves the whole draft with lock version and ordinals', async () => {
    const { fixture, api, toast, component } = await createFixture();

    addValidColumn(fixture);
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();

    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    const [id, v, body] = api.saveDraft.mock.calls[0];
    expect(id).toBe('7');
    expect(v).toBe('1');
    expect(body.lockVersion).toBe(4);
    expect(body.encoding).toBeNull();
    expect(body.delimiter).toBeNull();
    expect(body.sheets.map(sheet => sheet.ordinal)).toEqual([1]);
    expect(body.sheets[0].columns.map(column => column.ordinal)).toEqual([1, 2, 3]);
    expect(component.isDirty()).toBe(false);
    expect(toast.success).toHaveBeenCalled();
  });

  it('moves a column down before saving', async () => {
    const { fixture, api } = await createFixture();

    click(many(fixture, 'upl-column-down')[0]);
    fixture.detectChanges();
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();

    const body = api.saveDraft.mock.calls[0][2];
    expect(body.sheets[0].columns.map(column => column.nameInFile)).toEqual(['Volume', 'STIR']);
    expect(body.sheets[0].columns.map(column => column.ordinal)).toEqual([1, 2]);
  });

  it('clears fields that the new data type has not', async () => {
    const { fixture, toast, component } = await createFixture();

    selectOption(many(fixture, 'upl-cell-type')[0], option => option.value.endsWith('text'));
    fixture.detectChanges();

    expect(component.model.sheets[0].columns[0].keyMask).toBeNull();
    expect(component.model.sheets[0].columns[0].keyPadLength).toBeNull();
    expect(component.model.sheets[0].columns[0].keyPadMax).toBeNull();
    expect(toast.info).toHaveBeenCalledTimes(1);

    selectOption(many(fixture, 'upl-cell-type')[0], option => option.value.endsWith('date'));
    fixture.detectChanges();
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it('fills base unit from the chosen source unit', async () => {
    const { fixture, component } = await createFixture();

    selectOption(one(fixture, 'upl-cell-source-unit'), option => option.textContent!.includes('(liter)'));
    fixture.detectChanges();

    expect(component.model.sheets[0].columns[1].sourceUnit).toBe('liter');
    expect(component.model.sheets[0].columns[1].baseUnit).toBe('l');
    expect(one(fixture, 'upl-cell-base-unit')!.textContent).toContain('Litr (l)');
  });

  it('shows server field errors in the summary, on the tab and in the cell', async () => {
    const { fixture } = await createFixture({
      saveError: {
        status: 422,
        code: 'validation_failed',
        detail: 'UPL_FORMAT_INVALID',
        errors: [{ field: 'sheets[0].columns[1].sourceUnit', code: 'UPL_UNIT_UNKNOWN', message: 'x' }]
      }
    });

    addValidColumn(fixture);
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();

    expect(one(fixture, 'upl-errors-summary')).not.toBeNull();
    expect(one(fixture, 'upl-tab-error')).not.toBeNull();
    const cells = many(fixture, 'upl-column-row')[1].querySelectorAll('td');
    expect(cells[4].classList.contains('upl-cell-error')).toBe(true);
  });

  it('drops the error summary when the addressed column is removed', async () => {
    const { fixture } = await createFixture({
      saveError: {
        status: 422,
        code: 'validation_failed',
        detail: 'UPL_FORMAT_INVALID',
        errors: [{ field: 'sheets[0].columns[1].nameInFile', code: 'Size', message: 'x' }]
      }
    });

    addValidColumn(fixture);
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();
    expect(one(fixture, 'upl-errors-summary')).not.toBeNull();

    click(many(fixture, 'upl-column-remove')[1]);
    fixture.detectChanges();

    expect(one(fixture, 'upl-errors-summary')).toBeNull();
    expect(one(fixture, 'upl-tab-error')).toBeNull();
  });

  it('drops the error summary when a column is moved', async () => {
    const { fixture } = await createFixture({
      saveError: {
        status: 422,
        code: 'validation_failed',
        detail: 'UPL_FORMAT_INVALID',
        errors: [{ field: 'sheets[0].columns[1].nameInFile', code: 'Size', message: 'x' }]
      }
    });

    addValidColumn(fixture);
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();
    expect(one(fixture, 'upl-errors-summary')).not.toBeNull();

    click(many(fixture, 'upl-column-up')[1]);
    fixture.detectChanges();

    expect(one(fixture, 'upl-errors-summary')).toBeNull();
    expect(one(fixture, 'upl-tab-error')).toBeNull();
  });

  it('drops the error summary when a column type change clears its fields', async () => {
    const { fixture, component } = await createFixture({
      saveError: {
        status: 422,
        code: 'validation_failed',
        detail: 'UPL_FORMAT_INVALID',
        errors: [{ field: 'sheets[0].columns[0].targetField', code: 'Pattern', message: 'x' }]
      }
    });

    addValidColumn(fixture);
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();
    expect(one(fixture, 'upl-errors-summary')).not.toBeNull();

    const column = component.model.sheets[0].columns[0];
    column.dataType = 'text';
    component.onTypeChange(column);
    fixture.detectChanges();

    expect(one(fixture, 'upl-errors-summary')).toBeNull();
    expect(one(fixture, 'upl-tab-error')).toBeNull();
  });

  it('names the field in the error summary address', async () => {
    const { fixture } = await createFixture({
      saveError: {
        status: 422,
        code: 'validation_failed',
        detail: 'UPL_FORMAT_INVALID',
        errors: [{ field: 'sheets[0].columns[0].targetField', code: 'Pattern', message: 'x' }]
      }
    });

    addValidColumn(fixture);
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();

    const summary = one(fixture, 'upl-errors-summary')!.textContent!;
    expect(summary).toContain(PACKAGED_RUSSIAN['upl.format.col.target_field']);
    expect(summary).toContain('колонка 1');
  });

  it('does not publish with an empty date and shows the error under the field', async () => {
    const { fixture, component, api } = await createFixture();
    click(one(fixture, 'upl-publish'));
    fixture.detectChanges();

    component.validFrom.set('');
    click(one(fixture, 'upl-publish-confirm'));
    fixture.detectChanges();

    expect(api.publish).not.toHaveBeenCalled();
    expect(component.isPublishOpen()).toBe(true);
    expect(one(fixture, 'upl-publish-date-error')!.textContent).toContain(PACKAGED_RUSSIAN['upl.err.NotNull']);
  });

  it('keeps unsaved edits when the version is stale', async () => {
    const { fixture, component } = await createFixture({
      saveError: { status: 409, code: 'CONFLICT', detail: 'STALE_VERSION' }
    });

    addValidColumn(fixture);
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();

    expect(one(fixture, 'upl-conflict')).not.toBeNull();
    expect(component.model.sheets[0].columns.length).toBe(3);
  });

  it('publishes a clean draft and saves a dirty one first', async () => {
    const clean = await createFixture();
    click(one(clean.fixture, 'upl-publish'));
    clean.fixture.detectChanges();
    expect(clean.component.isPublishOpen()).toBe(true);

    click(one(clean.fixture, 'upl-publish-confirm'));
    clean.fixture.detectChanges();
    expect(clean.api.publish).toHaveBeenCalledWith('7', '1', today());
    expect(clean.navigate).toHaveBeenCalledWith(['/upl/sources', '7']);
    expect(clean.api.saveDraft).not.toHaveBeenCalled();

    const dirty = await createFixture();
    addValidColumn(dirty.fixture);
    click(one(dirty.fixture, 'upl-publish'));
    dirty.fixture.detectChanges();
    expect(dirty.api.saveDraft).toHaveBeenCalledTimes(1);
    expect(dirty.component.isPublishOpen()).toBe(true);
  });

  it('reports publish date and validation errors of publishing', async () => {
    const dateError = await createFixture({
      publishError: { status: 409, code: 'CONFLICT', detail: 'FND_VERSION_NOT_AFTER_PREVIOUS' }
    });
    click(one(dateError.fixture, 'upl-publish'));
    dateError.fixture.detectChanges();
    click(one(dateError.fixture, 'upl-publish-confirm'));
    dateError.fixture.detectChanges();
    expect(one(dateError.fixture, 'upl-publish-date-error')).not.toBeNull();
    expect(dateError.component.isPublishOpen()).toBe(true);

    const invalid = await createFixture({
      publishError: {
        status: 422,
        code: 'validation_failed',
        detail: 'UPL_FORMAT_INVALID',
        errors: [{ field: 'sheets[0].columns[0].targetField', code: 'UPL_TARGET_FIELD_DUPLICATE', message: 'x' }]
      }
    });
    click(one(invalid.fixture, 'upl-publish'));
    invalid.fixture.detectChanges();
    click(one(invalid.fixture, 'upl-publish-confirm'));
    invalid.fixture.detectChanges();
    expect(invalid.component.isPublishOpen()).toBe(false);
    expect(one(invalid.fixture, 'upl-errors-summary')).not.toBeNull();
  });

  it('reloads the version when the draft is already published', async () => {
    const { fixture, api, toast } = await createFixture({
      saveError: { status: 409, code: 'CONFLICT', detail: 'UPL_FORMAT_NOT_DRAFT' }
    });

    addValidColumn(fixture);
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();

    expect(api.getVersion).toHaveBeenCalledTimes(2);
    expect(toast.info).toHaveBeenCalled();
  });

  it('asks before leaving with unsaved changes', async () => {
    const { fixture, component } = await createFixture();

    expect(component.canLeaveRecordPage()).toBe(true);

    click(one(fixture, 'upl-add-column'));
    fixture.detectChanges();
    const decision = component.canLeaveRecordPage();
    expect(typeof decision).not.toBe('boolean');

    let allowed: boolean | null = null;
    (decision as Observable<boolean>).subscribe(value => (allowed = value));
    expect(component.isLeaveOpen()).toBe(true);
    fixture.detectChanges();

    click(one(fixture, 'upl-leave-confirm'));
    expect(allowed).toBe(true);
  });

  it('shows not found with a link to the list on 404', async () => {
    const { fixture } = await createFixture({ loadError: { status: 404, code: 'not_found', detail: 'UPL_FORMAT_NOT_FOUND' } });

    const notFound = one(fixture, 'upl-not-found');
    expect(notFound).not.toBeNull();
    expect(notFound!.querySelector('a')!.getAttribute('href')).toBe('/upl/sources');
    expect(one(fixture, 'upl-load-error')).toBeNull();
    expect(one(fixture, 'upl-actions')).toBeNull();
  });

  it('shows a load error instead of not found on a server failure', async () => {
    const { fixture } = await createFixture({ loadError: { status: 503 } });

    expect(one(fixture, 'upl-load-error')).not.toBeNull();
    expect(one(fixture, 'upl-not-found')).toBeNull();
  });

  it('shows a superseded version as read only without edit controls', async () => {
    const superseded: UplFormatVersion = {
      ...draftVersion(),
      status: 'superseded',
      validFrom: '2026-01-01',
      validTo: '2026-03-31'
    };
    const { fixture } = await createFixture({ version: superseded, source: { ...SOURCE, hasDraft: false } });

    expect(one(fixture, 'upl-readonly-note')).not.toBeNull();
    for (const testId of ['upl-actions', 'upl-add-column', 'upl-add-sheet', 'upl-remove-sheet', 'upl-column-remove']) {
      expect(one(fixture, testId)).toBeNull();
    }
    expect((many(fixture, 'upl-cell-name-in-file')[0] as HTMLInputElement).disabled).toBe(true);
  });

  it('offers a new draft from a read only version only with edit right and without a draft', async () => {
    const published: UplFormatVersion = { ...draftVersion(), status: 'published', validFrom: '2026-01-01' };

    const editor = await createFixture({ version: published, source: { ...SOURCE, hasDraft: false } });
    expect(one(editor.fixture, 'upl-readonly-note')!.querySelector('a')).not.toBeNull();

    const withDraft = await createFixture({ version: published, source: { ...SOURCE, hasDraft: true } });
    expect(one(withDraft.fixture, 'upl-readonly-note')!.querySelector('a')).toBeNull();

    const viewer = await createFixture({
      version: published,
      source: { ...SOURCE, hasDraft: false },
      actions: ['view']
    });
    expect(one(viewer.fixture, 'upl-readonly-note')!.querySelector('a')).toBeNull();
  });

  it('shows a draft to a viewer without any edit controls', async () => {
    const { fixture } = await createFixture({ actions: ['view'] });

    const hidden = [
      'upl-save',
      'upl-publish',
      'upl-revert',
      'upl-add-column',
      'upl-add-sheet',
      'upl-remove-sheet',
      'upl-column-remove',
      'upl-column-up'
    ];
    for (const testId of hidden) {
      expect(one(fixture, testId)).toBeNull();
    }
    expect((many(fixture, 'upl-cell-name-in-file')[0] as HTMLInputElement).disabled).toBe(true);
    expect((many(fixture, 'upl-cell-type')[0] as HTMLSelectElement).disabled).toBe(true);
    expect((one(fixture, 'upl-file-kind') as HTMLSelectElement).disabled).toBe(true);
    expect(one(fixture, 'upl-actions')).toBeNull();
    expect(many(fixture, 'upl-column-row').length).toBe(2);
  });

  it('shows permission denied of saving as text and keeps edits', async () => {
    const { fixture, component } = await createFixture({
      saveError: { status: 403, code: 'permission_denied', detail: 'PERMISSION_DENIED' }
    });

    addValidColumn(fixture);
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();

    expect(one(fixture, 'upl-action-error')!.textContent).toContain(PACKAGED_RUSSIAN['upl.err.PERMISSION_DENIED']);
    expect(component.model.sheets[0].columns.length).toBe(3);
    expect(one(fixture, 'upl-errors-summary')).toBeNull();
    expect(one(fixture, 'upl-conflict')).toBeNull();
  });

  it('does not hide an unknown server error', async () => {
    const { fixture } = await createFixture({
      saveError: { status: 400, code: 'bad_request', detail: 'UPL_SOMETHING_NEW' }
    });

    addValidColumn(fixture);
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();

    expect(one(fixture, 'upl-action-error')!.textContent).toContain('UPL_SOMETHING_NEW (bad_request)');
  });

  it('shows all server errors at once including a sheet level address', async () => {
    const { fixture } = await createFixture({
      saveError: {
        status: 422,
        code: 'validation_failed',
        detail: 'UPL_FORMAT_INVALID',
        errors: [
          { field: 'sheets[0].headerRow', code: 'UPL_HEADER_ROW_INVALID', message: 'x' },
          { field: 'sheets[0].columns[0].keyMask', code: 'UPL_KEY_MASK_INVALID', message: 'x' },
          { field: 'sheets[0].columns[1].sourceUnit', code: 'UPL_UNIT_UNKNOWN', message: 'x' }
        ]
      }
    });

    addValidColumn(fixture);
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();

    expect(one(fixture, 'upl-errors-summary')!.querySelectorAll('li').length).toBe(3);
    expect(fixture.nativeElement.querySelector('#upl-header-row').classList.contains('upl-cell-error')).toBe(true);
    expect(many(fixture, 'upl-tab-error').length).toBe(1);
  });

  it('opens the sheet that has the first addressed error', async () => {
    const { fixture, component } = await createFixture({
      version: twoSheetVersion(),
      saveError: {
        status: 422,
        code: 'validation_failed',
        detail: 'UPL_FORMAT_INVALID',
        errors: [{ field: 'sheets[1].columns[0].targetField', code: 'UPL_TARGET_FIELD_DUPLICATE', message: 'x' }]
      }
    });

    expect(component.activeSheet()).toBe(0);

    addValidColumn(fixture);
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();

    expect(component.activeSheet()).toBe(1);
    expect(many(fixture, 'upl-sheet-tab').length).toBe(2);
    expect(many(fixture, 'upl-tab-error').length).toBe(1);
  });

  it('reloads and drops edits when the stale version alert is confirmed', async () => {
    const { fixture, api, component } = await createFixture({
      saveError: { status: 409, code: 'CONFLICT', detail: 'STALE_VERSION' }
    });

    addValidColumn(fixture);
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();
    expect(one(fixture, 'upl-conflict')).not.toBeNull();

    click(one(fixture, 'upl-conflict'));
    fixture.detectChanges();

    expect(api.getVersion).toHaveBeenCalledTimes(2);
    expect(one(fixture, 'upl-conflict')).toBeNull();
    expect(component.model.sheets[0].columns.length).toBe(2);
  });

  it('shows csv fields and the file position column only when they apply', async () => {
    const xlsx = await createFixture();
    expect(one(xlsx.fixture, 'upl-encoding')).toBeNull();
    expect(one(xlsx.fixture, 'upl-sheet-name')).not.toBeNull();
    expect(many(xlsx.fixture, 'upl-cell-file-position').length).toBe(0);

    const csv = await createFixture({
      version: {
        ...draftVersion(),
        fileKind: 'csv',
        encoding: 'utf-8',
        delimiter: ';',
        matchColumnsBy: 'position'
      }
    });
    expect(one(csv.fixture, 'upl-encoding')).not.toBeNull();
    expect(one(csv.fixture, 'upl-sheet-name')).toBeNull();
    expect(many(csv.fixture, 'upl-cell-file-position').length).toBe(2);
  });
  it('shows the publish rejection of a draft without sheets', async () => {
    const { fixture, component } = await createFixture({
      version: { ...draftVersion(), sheets: [] },
      publishError: {
        status: 422,
        code: 'validation_failed',
        detail: 'UPL_FORMAT_INVALID',
        errors: [{ field: 'sheets', code: 'UPL_NO_SHEETS', message: '' }]
      }
    });

    click(one(fixture, 'upl-publish'));
    fixture.detectChanges();
    click(one(fixture, 'upl-publish-confirm'));
    fixture.detectChanges();

    expect(component.isPublishOpen()).toBe(false);
    expect(one(fixture, 'upl-errors-summary')!.textContent).toContain(PACKAGED_RUSSIAN['upl.err.UPL_NO_SHEETS']);
    expect(one(fixture, 'upl-no-sheets')).not.toBeNull();
  });

  it('does not send a column without names and shows Russian texts', async () => {
    const { fixture, api } = await createFixture();

    click(one(fixture, 'upl-add-column'));
    fixture.detectChanges();
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();

    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(one(fixture, 'upl-errors-summary')!.textContent).toContain(PACKAGED_RUSSIAN['upl.err.NotBlank']);
    const cells = many(fixture, 'upl-column-row')[2].querySelectorAll('td');
    expect(cells[0].classList.contains('upl-cell-error')).toBe(true);
    expect(cells[1].classList.contains('upl-cell-error')).toBe(true);
  });

  it('rejects a target field that does not match the pattern before sending', async () => {
    const { fixture, api } = await createFixture();

    addValidColumn(fixture, 'A', 'Поле 1');
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();

    expect(api.saveDraft).not.toHaveBeenCalled();
    const summary = one(fixture, 'upl-errors-summary')!.textContent!;
    expect(summary).toContain(PACKAGED_RUSSIAN['upl.err.Pattern']);
    expect(summary).not.toContain('[a-z]');
  });

  it('shows a server validator code with a Russian text', async () => {
    const { fixture, api } = await createFixture({
      saveError: {
        status: 422,
        code: 'validation_failed',
        detail: 'UPL_FORMAT_INVALID',
        errors: [{ field: 'sheets[0].columns[0].nameInFile', code: 'Size', message: 'size must be between 0 and 200' }]
      }
    });

    addValidColumn(fixture);
    click(one(fixture, 'upl-save'));
    fixture.detectChanges();

    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    const summary = one(fixture, 'upl-errors-summary')!.textContent!;
    expect(summary).toContain(PACKAGED_RUSSIAN['upl.err.Size']);
    expect(summary).not.toContain('size must be');
  });
});
