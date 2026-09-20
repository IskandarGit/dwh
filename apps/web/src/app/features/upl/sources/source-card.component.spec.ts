import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { PACKAGED_RUSSIAN } from '../../../core/i18n/packaged-russian';
import { UplApiService, UplFormatVersion, UplSource, UplVersionItem } from '../upl-api';
import { SourceCardComponent } from './source-card.component';

describe('SourceCardComponent', () => {
  const source: UplSource = {
    id: 7,
    code: 'sqb_output',
    name: 'Source A',
    ownerOrg: 'Org TEST',
    ownerContact: 'contact TEST',
    periodicity: 'month',
    slaDays: 10,
    sourceType: 'file',
    reconciliationStrictness: 'error',
    lockVersion: 5,
    lastPublishedVersion: 2,
    hasDraft: false,
    createdAt: '2026-09-01T08:00:00Z',
    modifiedAt: '2026-09-02T08:00:00Z'
  };

  const publishedVersions: UplVersionItem[] = [
    { version: 1, status: 'superseded', validFrom: '2026-01-01', validTo: '2026-06-30', publishedAt: '2025-12-20T10:00:00Z', publishedBy: 'admin' },
    { version: 2, status: 'published', validFrom: '2026-07-01', validTo: null, publishedAt: '2026-06-25T10:00:00Z', publishedBy: 'admin' }
  ];

  const draftVersion: UplVersionItem = {
    version: 3, status: 'draft', validFrom: null, validTo: null, publishedAt: null, publishedBy: null
  };

  const createdDraft: UplFormatVersion = {
    sourceId: 7,
    version: 3,
    status: 'draft',
    validFrom: null,
    validTo: null,
    publishedAt: null,
    publishedBy: null,
    lockVersion: 0,
    fileKind: null,
    encoding: null,
    delimiter: null,
    matchColumnsBy: null,
    sheets: []
  };

  interface Options {
    versions?: UplVersionItem[];
    loadError?: unknown;
    updateError?: unknown;
    createDraftError?: unknown;
    canEdit?: boolean;
    query?: Record<string, string>;
  }

  async function createFixture(options: Options = {}) {
    const api = {
      getSource: vi.fn(() => options.loadError ? throwError(() => options.loadError) : of({ ...source })),
      listVersions: vi.fn(() => of(options.versions ?? publishedVersions)),
      updateSource: vi.fn(() => options.updateError
        ? throwError(() => options.updateError)
        : of({ ...source, name: 'Source B', lockVersion: 6 })),
      createDraft: vi.fn(() => options.createDraftError
        ? throwError(() => options.createDraftError)
        : of(createdDraft))
    };
    const permissions = { hasPermission: vi.fn(() => options.canEdit ?? true) };
    const toast = { success: vi.fn(), error: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [SourceCardComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: vi.fn(() => of([])), post: vi.fn(() => of({})), put: vi.fn(() => of({})) } },
        { provide: UplApiService, useValue: api },
        { provide: PermissionService, useValue: permissions },
        { provide: ToastService, useValue: toast },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: '7' })),
            snapshot: { queryParamMap: convertToParamMap(options.query ?? {}) }
          }
        }
      ]
    }).compileComponents();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(SourceCardComponent);
    fixture.detectChanges();
    return { fixture, api, toast, navigate };
  }

  function el(fixture: ComponentFixture<SourceCardComponent>, testid: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  }

  function clickUiButton(fixture: ComponentFixture<SourceCardComponent>, testid: string): void {
    const button = fixture.debugElement.query(By.css(`[data-testid="${testid}"]`));
    expect(button).not.toBeNull();
    button.componentInstance.onClick.emit();
    fixture.detectChanges();
  }

  function setInput(fixture: ComponentFixture<SourceCardComponent>, testid: string, value: string): void {
    const input = el(fixture, testid) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('loads source with versions and links to the version screen', async () => {
    const { fixture, api } = await createFixture();
    expect(api.getSource).toHaveBeenCalledWith('7');
    expect(api.listVersions).toHaveBeenCalledWith('7');
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="upl-version-row"]');
    expect(rows.length).toBe(2);
    const link = rows[0].querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/upl/sources/7/formats/1');
  });

  it('shows not found message on 404', async () => {
    const { fixture } = await createFixture({ loadError: { status: 404, code: 'NOT_FOUND', detail: 'UPL_SOURCE_NOT_FOUND' } });
    expect(el(fixture, 'upl-not-found')).not.toBeNull();
  });

  it('hides edit controls without upl.sources.edit', async () => {
    const { fixture } = await createFixture({ canEdit: false });
    expect((el(fixture, 'upl-field-name') as HTMLInputElement).disabled).toBe(true);
    expect((el(fixture, 'upl-field-slaDays') as HTMLInputElement).disabled).toBe(true);
    expect(el(fixture, 'upl-save-source')).toBeNull();
    expect(el(fixture, 'upl-new-draft')).toBeNull();
  });

  it('saves requisites with lockVersion and unchanged code', async () => {
    const { fixture, api, toast } = await createFixture();
    setInput(fixture, 'upl-field-name', 'Source B');
    clickUiButton(fixture, 'upl-save-source');
    expect(api.updateSource).toHaveBeenCalledWith('7', expect.objectContaining({
      code: 'sqb_output',
      name: 'Source B',
      sourceType: 'file',
      lockVersion: 5
    }));
    expect(toast.success).toHaveBeenCalled();
  });

  it('keeps user input and offers refresh on 409 STALE_VERSION', async () => {
    const { fixture, api } = await createFixture({
      updateError: { status: 409, code: 'CONFLICT', detail: 'STALE_VERSION' }
    });
    setInput(fixture, 'upl-field-name', 'Edited TEST');
    clickUiButton(fixture, 'upl-save-source');
    expect(el(fixture, 'upl-conflict')).not.toBeNull();
    expect((el(fixture, 'upl-field-name') as HTMLInputElement).value).toBe('Edited TEST');
    clickUiButton(fixture, 'upl-conflict-refresh');
    expect(api.getSource).toHaveBeenCalledTimes(2);
  });

  it('does not send the request when name is empty', async () => {
    const { fixture, api } = await createFixture();
    setInput(fixture, 'upl-field-name', '');
    clickUiButton(fixture, 'upl-save-source');
    expect(api.updateSource).not.toHaveBeenCalled();
    expect(el(fixture, 'upl-err-name')).not.toBeNull();
  });

  it('offers open draft instead of new draft when a draft exists', async () => {
    const { fixture } = await createFixture({ versions: [...publishedVersions, draftVersion] });
    expect(el(fixture, 'upl-open-draft')).not.toBeNull();
    expect(el(fixture, 'upl-new-draft')).toBeNull();
  });

  it('creates a draft as a copy of the latest published version and as an empty one', async () => {
    const copy = await createFixture();
    clickUiButton(copy.fixture, 'upl-new-draft');
    (el(copy.fixture, 'upl-draft-mode-copy') as HTMLInputElement).dispatchEvent(new Event('change'));
    copy.fixture.detectChanges();
    clickUiButton(copy.fixture, 'upl-create-draft');
    expect(copy.api.createDraft).toHaveBeenCalledWith('7', 2);
    expect(copy.navigate).toHaveBeenCalledWith(['/upl/sources', '7', 'formats', 3]);

    TestBed.resetTestingModule();
    const empty = await createFixture();
    clickUiButton(empty.fixture, 'upl-new-draft');
    clickUiButton(empty.fixture, 'upl-create-draft');
    expect(empty.api.createDraft).toHaveBeenCalledWith('7', undefined);
  });

  it('offers to open the existing draft on FND_VERSION_DRAFT_EXISTS', async () => {
    const { fixture } = await createFixture({
      createDraftError: { status: 409, code: 'CONFLICT', detail: 'FND_VERSION_DRAFT_EXISTS' }
    });
    clickUiButton(fixture, 'upl-new-draft');
    clickUiButton(fixture, 'upl-create-draft');
    expect(el(fixture, 'upl-open-existing-draft')).not.toBeNull();
  });

  it('opens the new draft dialog when newDraft=1 is in the query', async () => {
    const { fixture } = await createFixture({ query: { newDraft: '1' } });
    expect(fixture.componentInstance.isDraftOpen()).toBe(true);
  });

  it('shows load error instead of not found on a server failure', async () => {
    const { fixture } = await createFixture({ loadError: { status: 503 } });
    expect(el(fixture, 'upl-load-error')).not.toBeNull();
    expect(el(fixture, 'upl-not-found')).toBeNull();
  });

  it('shows the empty versions note and offers the first draft', async () => {
    const { fixture } = await createFixture({ versions: [] });
    expect(el(fixture, 'upl-versions-empty')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="upl-version-row"]').length).toBe(0);
    expect(el(fixture, 'upl-new-draft')).not.toBeNull();
  });

  it('shows the empty versions note to a viewer without the new draft button', async () => {
    const { fixture } = await createFixture({ versions: [], canEdit: false });
    expect(el(fixture, 'upl-versions-empty')).not.toBeNull();
    expect(el(fixture, 'upl-new-draft')).toBeNull();
  });

  it('lets a viewer open the draft but not create one', async () => {
    const { fixture } = await createFixture({ versions: [...publishedVersions, draftVersion], canEdit: false });
    const openDraft = el(fixture, 'upl-open-draft');
    expect(openDraft).not.toBeNull();
    expect(openDraft!.getAttribute('href')).toBe('/upl/sources/7/formats/3');
    expect(el(fixture, 'upl-new-draft')).toBeNull();
    expect(el(fixture, 'upl-save-source')).toBeNull();
  });

  it('ignores newDraft=1 without the edit right', async () => {
    const { fixture } = await createFixture({ query: { newDraft: '1' }, canEdit: false });
    expect(fixture.componentInstance.isDraftOpen()).toBe(false);
  });

  it('puts 422 errors under the fields and keeps the input', async () => {
    const { fixture } = await createFixture({
      updateError: {
        status: 422,
        code: 'validation_failed',
        detail: 'VALIDATION_FAILED: name',
        errors: [{ field: 'name', code: 'Size', message: 'x' }]
      }
    });
    setInput(fixture, 'upl-field-name', 'Edited TEST');
    clickUiButton(fixture, 'upl-save-source');
    expect(el(fixture, 'upl-err-name')).not.toBeNull();
    expect(el(fixture, 'upl-err-name')?.textContent).toContain(PACKAGED_RUSSIAN['upl.err.Size']);
    expect(el(fixture, 'upl-save-error')?.textContent).toContain(PACKAGED_RUSSIAN['upl.err.VALIDATION_FAILED']);
    expect((el(fixture, 'upl-field-name') as HTMLInputElement).value).toBe('Edited TEST');
    expect(el(fixture, 'upl-conflict')).toBeNull();
  });

  it('shows an unknown field code as server message plus code, never a raw dictionary key', async () => {
    const { fixture } = await createFixture({
      updateError: {
        status: 422,
        code: 'validation_failed',
        detail: 'VALIDATION_FAILED: ownerOrg',
        errors: [{ field: 'ownerOrg', code: 'UPL_SOMETHING_NEW', message: 'srv' }]
      }
    });
    setInput(fixture, 'upl-field-name', 'Edited TEST');
    clickUiButton(fixture, 'upl-save-source');
    const shown = el(fixture, 'upl-err-ownerOrg')?.textContent ?? '';
    expect(shown).toContain('srv (UPL_SOMETHING_NEW)');
    expect(shown).not.toContain('upl.err.');
  });

  it('shows permission denied and an unknown error as text', async () => {
    const denied = await createFixture({
      updateError: { status: 403, code: 'permission_denied', detail: 'PERMISSION_DENIED' }
    });
    setInput(denied.fixture, 'upl-field-name', 'Edited TEST');
    clickUiButton(denied.fixture, 'upl-save-source');
    expect(el(denied.fixture, 'upl-save-error')?.textContent).toContain(PACKAGED_RUSSIAN['upl.err.PERMISSION_DENIED']);
    expect(denied.toast.success).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    const unknown = await createFixture({
      updateError: { status: 400, code: 'bad_request', detail: 'UPL_SOMETHING_NEW' }
    });
    setInput(unknown.fixture, 'upl-field-name', 'Edited TEST');
    clickUiButton(unknown.fixture, 'upl-save-source');
    expect(el(unknown.fixture, 'upl-save-error')?.textContent).toContain('UPL_SOMETHING_NEW (bad_request)');
  });
});
