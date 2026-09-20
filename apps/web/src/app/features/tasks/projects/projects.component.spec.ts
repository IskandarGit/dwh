import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Project, ProjectTaskStats } from '../../../core/models/task.models';
import { ApiService } from '../../../core/services/api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import { ProjectsComponent } from './projects.component';

interface ApiDouble {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
}

const emptyApi = (): ApiDouble => ({
  get: vi.fn(() => of([])),
  post: vi.fn(() => of({})),
  patch: vi.fn(() => of({}))
});

describe('ProjectsComponent UI contracts', () => {
  async function createFixture(options: {
    api?: ApiDouble;
    permissions?: string[];
  } = {}) {
    const api = options.api ?? emptyApi();
    const router = { navigate: vi.fn() };
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [ProjectsComponent],
      providers: [
        { provide: ApiService, useValue: api },
        PermissionService,
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: router }
      ]
    }).compileComponents();
    TestBed.inject(PermissionService).setPermissions(options.permissions ?? ['*.*']);
    const fixture = TestBed.createComponent(ProjectsComponent);
    fixture.detectChanges();
    return { fixture, api, router, toast };
  }

  const project = (id: number, state: 'A' | 'P' = 'A'): Project => ({
    id,
    name: `Project ${id}`,
    state,
    createdAt: '2026-09-06T00:00:00Z'
  });

  it('labels filters and keeps the projects table inside a named scroll region', async () => {
    const { fixture } = await createFixture();

    const search = fixture.nativeElement.querySelector('#project-search') as HTMLInputElement;
    const region = fixture.nativeElement.querySelector('.table-wrapper[role="region"]') as HTMLElement;

    expect(fixture.nativeElement.querySelector(`label[for="${search.id}"]`)).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="group"][aria-label="Режим отображения проектов"]')).not.toBeNull();
    expect(region.tabIndex).toBe(0);
    expect(region.querySelector('table')?.getAttribute('aria-label')).toBe('Список проектов');
  });

  it('connects project modal labels, required state and validation message', async () => {
    const { fixture } = await createFixture();
    fixture.componentInstance.openCreateModal();
    fixture.componentInstance.isCreateSubmitted = true;
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('#project-create-name') as HTMLInputElement;
    const error = fixture.nativeElement.querySelector('#project-create-name-error') as HTMLElement;

    expect(fixture.nativeElement.querySelector(`label[for="${name.id}"]`)).not.toBeNull();
    expect(name.required).toBe(true);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBe(error.id);
    expect(fixture.nativeElement.querySelector('#project-create-description')).not.toBeNull();
  });

  it('renders plain project state copy while retaining A and P option values', async () => {
    const api = emptyApi();
    api.get.mockImplementation((url: string) => {
      if (url === '/tasks/projects') return of([project(1), project(2, 'P')]);
      if (url === '/tasks/projects/1') return of(project(1));
      return of([]);
    });
    const { fixture } = await createFixture({ api });
    const host = fixture.nativeElement as HTMLElement;

    expect(Array.from(host.querySelectorAll('.status-pill')).map(node => node.textContent?.trim()))
      .toEqual(['Активен', 'В архиве']);

    fixture.componentInstance.viewMode = 'cards';
    fixture.detectChanges();
    expect(Array.from(host.querySelectorAll('.status-pill')).map(node => node.textContent?.trim()))
      .toEqual(['Активен', 'В архиве']);

    fixture.componentInstance.openEditModal(project(1));
    fixture.detectChanges();
    const options = Array.from(host.querySelectorAll('#project-edit-state option')) as HTMLOptionElement[];
    expect(options.map(option => ({ value: option.value, label: option.textContent?.trim() }))).toEqual([
      { value: 'A', label: 'Активен' },
      { value: 'P', label: 'В архиве' }
    ]);
  });

  it('submits entered create values through the native form only once while pending', async () => {
    const pendingSave = new Subject<Project>();
    const api = emptyApi();
    api.post.mockReturnValue(pendingSave);
    const { fixture } = await createFixture({ api });
    const host = fixture.nativeElement as HTMLElement;

    fixture.componentInstance.openCreateModal();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const name = host.querySelector('#project-create-name') as HTMLInputElement;
    const description = host.querySelector('#project-create-description') as HTMLTextAreaElement;
    name.value = '  Native create  ';
    name.dispatchEvent(new Event('input'));
    description.value = '  Submitted from the form  ';
    description.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form = host.querySelector('#project-create-form') as HTMLFormElement;
    expect(form).not.toBeNull();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/tasks/projects', {
      name: 'Native create',
      description: 'Submitted from the form'
    });
  });

  it('keeps an entered create draft visible when Cancel or Escape requests dismissal', async () => {
    const { fixture } = await createFixture();
    const host = fixture.nativeElement as HTMLElement;

    (host.querySelector('.header-right ui-button button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const name = host.querySelector('#project-create-name') as HTMLInputElement;
    name.value = 'Unsaved project';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const createButtons = host.querySelectorAll('.modal-backdrop .modal-footer button');
    (createButtons[0] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(host.querySelectorAll('.modal-backdrop')).toHaveLength(2);
    expect((host.querySelector('#project-create-name') as HTMLInputElement).value).toBe('Unsaved project');

    const confirmation = host.querySelectorAll('.modal-backdrop')[1] as HTMLElement;
    (confirmation.querySelector('.modal-footer button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.querySelectorAll('.modal-backdrop')).toHaveLength(1);
    expect((host.querySelector('#project-create-name') as HTMLInputElement).value).toBe('Unsaved project');

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(escape);
    fixture.detectChanges();
    expect(escape.defaultPrevented).toBe(true);
    expect(host.querySelectorAll('.modal-backdrop')).toHaveLength(2);
    expect((host.querySelector('#project-create-name') as HTMLInputElement).value).toBe('Unsaved project');
  });

  it('renders fresh project detail instead of the list row when Edit is clicked', async () => {
    const summary = { ...project(5), name: 'List name', description: 'Версия из списка' };
    const freshDetail = new Subject<Project>();
    const api = emptyApi();
    api.get.mockImplementation((url: string) => {
      if (url === '/tasks/projects') return of([summary]);
      if (url === '/tasks/projects/5') return freshDetail;
      return of([]);
    });
    const { fixture } = await createFixture({ api });
    const host = fixture.nativeElement as HTMLElement;

    (host.querySelector('.icon-ghost-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="project-edit-loading"][role="status"]')).not.toBeNull();
    expect(host.querySelector('#project-edit-name')).toBeNull();

    freshDetail.next({ ...project(5), name: 'Fresh name', description: 'Актуальное описание с сервера' });
    freshDetail.complete();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect((host.querySelector('#project-edit-name') as HTMLInputElement).value).toBe('Fresh name');
    expect((host.querySelector('#project-edit-description') as HTMLTextAreaElement).value)
      .toBe('Актуальное описание с сервера');
  });

  it('submits one sparse edit PATCH through the native form while pending', async () => {
    const pendingPatch = new Subject<void>();
    const api = emptyApi();
    api.get.mockImplementation((url: string) => url === '/tasks/projects/3'
      ? of({ ...project(3), name: 'Current', description: 'Current description' })
      : of([]));
    api.patch.mockReturnValue(pendingPatch);
    const { fixture } = await createFixture({ api });
    const host = fixture.nativeElement as HTMLElement;

    fixture.componentInstance.openEditModal(project(3));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const name = host.querySelector('#project-edit-name') as HTMLInputElement;
    name.value = '  Native rename  ';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.editForm.name).toBe('  Native rename  ');

    const form = host.querySelector('#project-edit-form') as HTMLFormElement;
    expect(form).not.toBeNull();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith('/tasks/projects/3', { name: 'Native rename' });
  });

  it('issues one create request and locks every dismissal path when Save is activated twice while pending', async () => {
    const pendingSave = new Subject<Project>();
    const api = emptyApi();
    api.post.mockReturnValue(pendingSave);
    const { fixture } = await createFixture({ api });
    const host = fixture.nativeElement as HTMLElement;

    (host.querySelector('.header-right ui-button button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const name = host.querySelector('#project-create-name') as HTMLInputElement;
    name.value = 'Pending project';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const footerButtons = host.querySelectorAll('.modal-backdrop .modal-footer button');
    const save = footerButtons[1] as HTMLButtonElement;
    save.click();
    save.click();
    fixture.detectChanges();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect((host.querySelector('fieldset.project-create-form') as HTMLFieldSetElement).disabled).toBe(true);
    expect((host.querySelectorAll('.modal-backdrop .modal-footer button')[0] as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelectorAll('.modal-backdrop .modal-footer button')[1] as HTMLButtonElement).disabled).toBe(true);
    expect(host.querySelector('.modal-backdrop .modal-close')).toBeNull();
  });

  it('guards create drafts for Cancel and modal dismissal while pristine drafts close directly', async () => {
    const { fixture, api } = await createFixture();
    const component = fixture.componentInstance;

    component.openCreateModal();
    component.requestCloseCreate();
    expect(component.isCreateModalOpen()).toBe(false);

    component.openCreateModal();
    component.createForm.name = 'Unsaved project';
    component.requestCloseCreate();
    expect(component.isCreateModalOpen()).toBe(true);
    expect(component.isCreateDiscardConfirmationOpen()).toBe(true);
    component.submitCreateProject();
    expect(api.post).not.toHaveBeenCalled();

    component.isCreateDiscardConfirmationOpen.set(false);
    expect(component.createForm.name).toBe('Unsaved project');
    const createModal = fixture.debugElement.queryAll(By.directive(UiModalComponent))[0]
      .componentInstance as UiModalComponent;
    createModal.close.emit();
    expect(component.isCreateModalOpen()).toBe(true);
    expect(component.isCreateDiscardConfirmationOpen()).toBe(true);

    component.confirmDiscardCreate();
    expect(component.isCreateModalOpen()).toBe(false);
    expect(component.isCreateDiscardConfirmationOpen()).toBe(false);
  });

  it('prevents duplicate create submits and preserves a failed draft with one inline normalized error', async () => {
    const firstSave = new Subject<Project>();
    const retrySave = new Subject<Project>();
    const saves = [firstSave, retrySave];
    const api = emptyApi();
    api.post.mockImplementation(() => saves.shift()!);
    const { fixture, toast } = await createFixture({ api });
    const component = fixture.componentInstance;
    component.openCreateModal();
    component.createForm = { name: '  New project  ', description: '  Draft description  ' };

    component.submitCreateProject();
    component.submitCreateProject();
    fixture.detectChanges();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/tasks/projects', {
      name: 'New project',
      description: 'Draft description'
    });
    expect(fixture.nativeElement.querySelector('.project-create-form')?.disabled).toBe(true);
    expect(fixture.debugElement.queryAll(By.directive(UiModalComponent))[0].componentInstance.dismissible).toBe(false);
    component.requestCloseCreate();
    expect(component.isCreateModalOpen()).toBe(true);

    firstSave.error({ status: 422, title: 'Invalid', code: 'VALIDATION_ERROR', detail: 'Normalized create detail' });
    fixture.detectChanges();
    expect(component.createForm.name).toBe('  New project  ');
    expect(component.isSubmitting()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="project-create-save-error"][role="alert"]')?.textContent)
      .toContain('Normalized create detail');
    expect(toast.error).not.toHaveBeenCalled();

    component.submitCreateProject();
    expect(api.post).toHaveBeenCalledTimes(2);
    retrySave.next(project(10));
    retrySave.complete();
    expect(component.isCreateModalOpen()).toBe(false);
  });

  it('loads a fresh project before editing and exposes mismatch, error and retry states', async () => {
    const mismatch = new Subject<Project>();
    const failed = new Subject<Project>();
    const fresh = new Subject<Project>();
    const detailReads = [mismatch, failed, fresh];
    const api = emptyApi();
    api.get.mockImplementation((url: string) => {
      if (url === '/tasks/projects/7') return detailReads.shift()!;
      return of([]);
    });
    const { fixture } = await createFixture({ api });
    const component = fixture.componentInstance;

    component.openEditModal(project(7));
    fixture.detectChanges();
    expect(api.get).toHaveBeenCalledWith('/tasks/projects/7', undefined, { notifyError: false });
    expect(component.editLoading()).toBe(true);
    expect(component.editingProject).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="project-edit-loading"][role="status"]')).not.toBeNull();

    mismatch.next({ ...project(8), name: 'Wrong project' });
    mismatch.complete();
    fixture.detectChanges();
    expect(component.editLoadError()).toBe(true);
    expect(component.editingProject).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="project-edit-load-error"][role="alert"]')).not.toBeNull();

    component.retryEditLoad();
    failed.error({ status: 503, title: 'Unavailable', code: 'API_ERROR', detail: 'Unavailable' });
    fixture.detectChanges();
    expect(component.editLoadError()).toBe(true);

    (fixture.nativeElement.querySelector('.project-edit-retry button') as HTMLButtonElement).click();
    fresh.next({ ...project(7), name: ' Current ', description: ' Current description ' });
    fresh.complete();
    fixture.detectChanges();
    expect(component.editLoading()).toBe(false);
    expect(component.editLoadError()).toBe(false);
    expect(component.editForm).toEqual({ name: 'Current', description: 'Current description', state: 'A' });
    expect(fixture.nativeElement.querySelector('.project-edit-form')).not.toBeNull();
  });

  it('cancels obsolete edit detail reads on close and prevents another modal from resetting a live draft', async () => {
    const oldDetail = new Subject<Project>();
    const currentDetail = new Subject<Project>();
    const api = emptyApi();
    api.get.mockImplementation((url: string) => {
      if (url === '/tasks/projects/1') return oldDetail;
      if (url === '/tasks/projects/2') return currentDetail;
      return of([]);
    });
    const { fixture } = await createFixture({ api });
    const component = fixture.componentInstance;

    component.openEditModal(project(1));
    component.requestCloseEdit();
    component.openEditModal(project(2));
    oldDetail.next({ ...project(1), name: 'Obsolete' });
    currentDetail.next({ ...project(2), name: 'Current' });
    expect(component.editingProject?.id).toBe(2);
    expect(component.editForm.name).toBe('Current');

    component.editForm.name = 'Live draft';
    component.openEditModal(project(1));
    component.openCreateModal();
    expect(component.editingProject?.id).toBe(2);
    expect(component.editForm.name).toBe('Live draft');
    expect(component.isCreateModalOpen()).toBe(false);
  });

  it('guards whitespace-only edit draft changes and discards only after confirmation', async () => {
    const api = emptyApi();
    api.get.mockImplementation((url: string) => url === '/tasks/projects/1'
      ? of({ ...project(1), name: 'Current', description: 'Description' })
      : of([]));
    const { fixture } = await createFixture({ api });
    const component = fixture.componentInstance;
    component.openEditModal(project(1));
    component.editForm.name = 'Current ';

    component.requestCloseEdit();
    expect(component.isEditModalOpen()).toBe(true);
    expect(component.isEditDiscardConfirmationOpen()).toBe(true);
    component.submitEditProject();
    expect(api.patch).not.toHaveBeenCalled();
    expect(component.isEditModalOpen()).toBe(true);
    component.isEditDiscardConfirmationOpen.set(false);
    expect(component.editForm.name).toBe('Current ');

    component.requestCloseEdit();
    component.confirmDiscardEdit();
    expect(component.isEditModalOpen()).toBe(false);
    expect(component.isEditDiscardConfirmationOpen()).toBe(false);
  });

  it('sends only changed normalized fields and closes a no-change edit without PATCH or success toast', async () => {
    const api = emptyApi();
    api.get.mockImplementation((url: string) => /^\/tasks\/projects\/\d+$/.test(url)
      ? of({ ...project(Number(url.split('/').at(-1))), name: 'Current', description: 'Current description' })
      : of([]));
    const { fixture, toast } = await createFixture({ api });
    const component = fixture.componentInstance;

    component.openEditModal(project(1));
    component.editForm.name = ' Renamed ';
    component.submitEditProject();
    expect(api.patch).toHaveBeenLastCalledWith('/tasks/projects/1', { name: 'Renamed' });

    component.openEditModal(project(2));
    component.editForm.description = '   ';
    component.submitEditProject();
    expect(api.patch).toHaveBeenLastCalledWith('/tasks/projects/2', { description: '' });

    component.openEditModal(project(3));
    const patchCount = api.patch.mock.calls.length;
    const successCount = toast.success.mock.calls.length;
    component.submitEditProject();
    expect(api.patch).toHaveBeenCalledTimes(patchCount);
    expect(toast.success).toHaveBeenCalledTimes(successCount);
    expect(component.isEditModalOpen()).toBe(false);
  });

  it('prevents duplicate edit saves, keeps a failed draft retryable and ignores mutation callbacks after destroy', async () => {
    const pendingPatch = new Subject<void>();
    const api = emptyApi();
    api.get.mockImplementation((url: string) => url === '/tasks/projects/1'
      ? of({ ...project(1), name: 'Current', description: 'Description' })
      : of([]));
    api.patch.mockReturnValue(pendingPatch);
    const { fixture, toast } = await createFixture({ api });
    const component = fixture.componentInstance;
    component.openEditModal(project(1));
    component.editForm.name = 'Changed';

    component.submitEditProject();
    component.submitEditProject();
    fixture.detectChanges();
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.project-edit-form')?.disabled).toBe(true);
    component.requestCloseEdit();
    component.confirmDiscardEdit();
    expect(component.isEditModalOpen()).toBe(true);

    pendingPatch.error({ status: 409, title: 'Conflict', code: 'CONFLICT', detail: 'Normalized edit detail' });
    fixture.detectChanges();
    expect(component.editForm.name).toBe('Changed');
    expect(fixture.nativeElement.querySelector('[data-testid="project-edit-save-error"][role="alert"]')?.textContent)
      .toContain('Normalized edit detail');
    expect(toast.error).not.toHaveBeenCalled();

    const lateCreate = new Subject<Project>();
    api.post.mockReturnValue(lateCreate);
    component.requestCloseEdit();
    component.confirmDiscardEdit();
    component.openCreateModal();
    component.createForm.name = 'Late';
    component.submitCreateProject();
    fixture.destroy();
    lateCreate.next(project(99));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('resets pagination when search and status filters change or search is cleared', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => project(index + 1, index === 20 ? 'P' : 'A'));
    const api = emptyApi();
    api.get.mockImplementation((url: string) => of(url.endsWith('/stats') ? [] : rows));
    const { fixture } = await createFixture({ api });
    const component = fixture.componentInstance;
    const search = fixture.nativeElement.querySelector('#project-search') as HTMLInputElement;

    component.currentPage = 2;
    search.value = 'Project 21';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component.currentPage).toBe(1);
    expect(fixture.nativeElement.querySelector('.project-row')?.textContent).toContain('Project 21');

    component.currentPage = 2;
    (fixture.nativeElement.querySelector('.project-search-clear') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.currentPage).toBe(1);

    const statusButtons = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid="project-state-filter"]') as NodeListOf<HTMLButtonElement>
    );
    for (const [label, visibleProject] of [
      ['Архив', 'Project 21'],
      ['Активные', 'Project 1'],
      ['Все', 'Project 1']
    ] as const) {
      component.currentPage = 2;
      statusButtons.find(button => button.textContent?.includes(label))?.click();
      fixture.detectChanges();
      expect(component.currentPage).toBe(1);
      expect(fixture.nativeElement.querySelector('.project-row')?.textContent).toContain(visibleProject);
    }
  });

  it('clamps the page to filtered results after successful reloads', async () => {
    const api = emptyApi();
    const responses: Project[][] = [
      Array.from({ length: 25 }, (_, index) => project(index + 1)),
      Array.from({ length: 15 }, (_, index) => project(index + 1)),
      Array.from({ length: 21 }, (_, index) => project(index + 1, index === 20 ? 'P' : 'A')),
      []
    ];
    api.get.mockImplementation((url: string) => url.includes('/custom-fields') ? of([]) : of(url.endsWith('/stats') ? [] : responses.shift() ?? []));
    const { fixture } = await createFixture({ api });
    const component = fixture.componentInstance;

    component.currentPage = 3;
    component.loadProjects();
    expect(component.currentPage).toBe(2);

    component.selectedState = 'A';
    component.currentPage = 1;
    component.loadProjects(21);
    expect(component.currentPage).toBe(1);

    component.currentPage = 3;
    component.loadProjects();
    expect(component.currentPage).toBe(1);
  });

  it('shows recoverable list loading and error states without empty results in list and cards', async () => {
    const first = new Subject<Project[]>();
    const retry = new Subject<Project[]>();
    const listReads = [first, retry];
    const api = emptyApi();
    api.get.mockImplementation((url: string): Observable<Project[] | ProjectTaskStats[]> =>
      url.includes('/custom-fields') ? of([]) : (url.endsWith('/stats') ? of([]) : (listReads.shift() ?? of([])))
    );
    const { fixture } = await createFixture({ api });

    expect(fixture.nativeElement.querySelector('[data-testid="projects-list-loading"][role="status"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Проекты не найдены');
    expect(fixture.nativeElement.querySelector('ui-pagination')).toBeNull();
    expect(api.get).toHaveBeenCalledWith('/tasks/projects', undefined, { notifyError: false });

    fixture.componentInstance.viewMode = 'cards';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Проекты не найдены');
    expect(fixture.nativeElement.querySelector('.project-card')).toBeNull();

    first.error({ status: 503, title: 'Unavailable', code: 'API_ERROR', detail: 'Unavailable' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="projects-list-error"][role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('ui-pagination')).toBeNull();

    const retryButton = fixture.nativeElement.querySelector('.projects-list-retry') as HTMLButtonElement;
    expect(retryButton.textContent).toContain('Повторить загрузку проектов');
    retryButton.click();
    fixture.detectChanges();
    retry.next([project(1)]);
    retry.complete();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="projects-list-error"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.project-card')?.textContent).toContain('Project 1');
  });

  it('describes terminal project tasks as closed in list and card progress', async () => {
    const api = emptyApi();
    api.get.mockImplementation((url: string) => of(url.endsWith('/stats')
      ? [{ projectId: 1, totalTasks: 4, activeTasks: 2, doneTasks: 2 }]
      : [project(1)]));
    const { fixture } = await createFixture({ api });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.progress-count')?.textContent?.trim()).toBe('2 / 4 закрыто');
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label'))
      .toBe('Доля закрытых задач проекта Project 1');
    expect(host.querySelector('[data-testid="projects-stats-scope"]')?.textContent)
      .toContain('конечных статусах, включая выполненные и отменённые');

    fixture.componentInstance.viewMode = 'cards';
    fixture.detectChanges();

    expect(host.querySelector('.progress-count')?.textContent?.trim()).toBe('2 / 4 закрыто');
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label'))
      .toBe('Доля закрытых задач проекта Project 1');
  });

  it('renders task statistics only for real successful rows and recovers independently', async () => {
    const pending = new Subject<ProjectTaskStats[]>();
    const retry = new Subject<ProjectTaskStats[]>();
    const explicitZero = new Subject<ProjectTaskStats[]>();
    const missing = new Subject<ProjectTaskStats[]>();
    const statsReads = [pending, retry, explicitZero, missing];
    const api = emptyApi();
    api.get.mockImplementation((url: string) => url.endsWith('/stats') ? (statsReads.shift() ?? of([])) : of([project(1)]));
    const { fixture } = await createFixture({ api });
    const component = fixture.componentInstance;

    expect(fixture.nativeElement.querySelector('[data-testid="projects-stats-loading"][role="status"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="progressbar"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('0 / 0');
    expect(api.get).toHaveBeenCalledWith('/tasks/projects/stats', undefined, { notifyError: false });

    component.viewMode = 'cards';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.project-card')?.textContent).toContain('Project 1');
    expect(fixture.nativeElement.querySelector('[role="progressbar"]')).toBeNull();

    pending.error({ status: 503, title: 'Unavailable', code: 'API_ERROR', detail: 'Unavailable' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="projects-stats-error"][role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="progressbar"]')).toBeNull();

    (fixture.nativeElement.querySelector('.projects-stats-retry') as HTMLButtonElement).click();
    fixture.detectChanges();
    retry.next([{ projectId: 1, totalTasks: 4, activeTasks: 2, doneTasks: 2 }]);
    retry.complete();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(fixture.nativeElement.textContent).toContain('2 / 4');

    component.loadStats();
    explicitZero.next([{ projectId: 1, totalTasks: 0, activeTasks: 0, doneTasks: 0 }]);
    explicitZero.complete();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0');
    expect(fixture.nativeElement.textContent).toContain('0 / 0');

    component.loadStats();
    missing.next([]);
    missing.complete();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="progressbar"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Статистика недоступна');
  });

  it('keeps project-view-only users on plain project data without task statistics or drilldowns', async () => {
    const api = emptyApi();
    api.get.mockImplementation((url: string) => of(url.endsWith('/stats') ? [] : [project(1)]));
    const { fixture, router } = await createFixture({ api, permissions: ['tasks.projects.view'] });

    expect(fixture.nativeElement.querySelector('.project-name')).toBeNull();
    expect(fixture.nativeElement.querySelector('.project-name-text')?.textContent).toContain('Project 1');
    expect(fixture.nativeElement.querySelector('[role="progressbar"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Задачи (');
    expect(fixture.nativeElement.querySelector('[data-testid="projects-stats-permission"][role="status"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.projects-stats-retry')).toBeNull();
    expect(api.get.mock.calls.filter(([url]) => String(url).endsWith('/stats'))).toHaveLength(0);

    fixture.componentInstance.viewMode = 'cards';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.project-title-btn')).toBeNull();
    expect(fixture.nativeElement.querySelector('.project-name-text')?.textContent).toContain('Project 1');
    expect(fixture.nativeElement.querySelector('.view-tasks-link')).toBeNull();
    expect(fixture.nativeElement.querySelector('.card-progress')).toBeNull();

    fixture.componentInstance.viewProjectTasks(project(1));
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not let task create or update permissions grant project actions', async () => {
    const api = emptyApi();
    api.get.mockImplementation((url: string) => of(url.endsWith('/stats') ? [] : [project(1)]));
    const { fixture } = await createFixture({
      api,
      permissions: ['tasks.projects.view', 'tasks.items.create', 'tasks.items.update']
    });
    const component = fixture.componentInstance;

    expect(component.canCreateProject()).toBe(false);
    expect(component.canUpdateProject()).toBe(false);
    component.openCreateModal();
    component.createForm = { name: 'Disallowed', description: '' };
    component.submitCreateProject();
    component.openEditModal(project(1));
    component.editingProject = project(1);
    component.editForm = { name: 'Disallowed edit', description: '', state: 'A' };
    component.submitEditProject();

    expect(component.isCreateModalOpen()).toBe(false);
    expect(component.isEditModalOpen()).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('retains project create and update actions for scoped users and wildcard administrators', async () => {
    const api = emptyApi();
    api.get.mockImplementation((url: string) => {
      if (url === '/tasks/projects/1') return of(project(1));
      return of(url.endsWith('/stats') ? [] : [project(1)]);
    });
    api.post.mockReturnValue(of(project(2)));
    const { fixture } = await createFixture({
      api,
      permissions: ['tasks.projects.view', 'tasks.projects.create', 'tasks.projects.update', 'tasks.items.view']
    });
    expect(fixture.componentInstance.canCreateProject()).toBe(true);
    expect(fixture.componentInstance.canUpdateProject()).toBe(true);
    expect(fixture.nativeElement.querySelector('ui-button')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.icon-ghost-btn')).not.toBeNull();

    fixture.componentInstance.openCreateModal();
    fixture.componentInstance.createForm = { name: 'Created', description: '' };
    fixture.componentInstance.submitCreateProject();
    expect(api.post).toHaveBeenCalledTimes(1);

    fixture.componentInstance.openEditModal(project(1));
    fixture.componentInstance.editForm.name = 'Updated';
    fixture.componentInstance.submitEditProject();
    expect(api.patch).toHaveBeenCalledTimes(1);

    TestBed.inject(PermissionService).setPermissions(['*.*']);
    fixture.detectChanges();
    expect(fixture.componentInstance.canCreateProject()).toBe(true);
    expect(fixture.componentInstance.canUpdateProject()).toBe(true);
  });

  it('cancels replaced reads and ignores list or statistics responses after destroy', async () => {
    const firstList = new Subject<Project[]>();
    const latestList = new Subject<Project[]>();
    const afterDestroyList = new Subject<Project[]>();
    const firstStats = new Subject<ProjectTaskStats[]>();
    const latestStats = new Subject<ProjectTaskStats[]>();
    const afterDestroyStats = new Subject<ProjectTaskStats[]>();
    const listReads = [firstList, latestList, afterDestroyList];
    const statsReads = [firstStats, latestStats, afterDestroyStats];
    const api = emptyApi();
    api.get.mockImplementation((url: string) => {
      if (url.includes('/custom-fields')) return of([]);
      return url.endsWith('/stats') ? statsReads.shift()! : listReads.shift()!;
    });
    const { fixture } = await createFixture({ api });
    const component = fixture.componentInstance;

    component.loadProjects();
    component.loadStats();
    latestList.next([project(2)]);
    latestStats.next([{ projectId: 2, totalTasks: 5, activeTasks: 1, doneTasks: 4 }]);
    firstList.next([project(1)]);
    firstStats.next([{ projectId: 1, totalTasks: 99, activeTasks: 99, doneTasks: 99 }]);

    expect(component.projects().map(row => row.id)).toEqual([2]);
    expect(component.projectStats()[2]?.totalTasks).toBe(5);
    expect(component.projectStats()[1]).toBeUndefined();

    component.loadProjects();
    component.loadStats();
    fixture.destroy();
    afterDestroyList.next([project(3)]);
    afterDestroyStats.next([{ projectId: 3, totalTasks: 3, activeTasks: 3, doneTasks: 0 }]);

    expect(component.projects().map(row => row.id)).toEqual([]);
    expect(component.projectStats()).toEqual({});
  });

  it('reveals a newly created project even when it belongs on a later page', async () => {
    const existing = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      name: `Project ${index + 1}`,
      state: 'A' as const,
      createdAt: '2026-08-30T00:00:00Z'
    }));
    const created = {
      id: 11,
      name: 'Newly created project',
      state: 'A' as const,
      createdAt: '2026-08-30T00:00:00Z'
    };
    let wasCreated = false;
    const api = emptyApi();
    api.get.mockImplementation((url: string) => of(url.endsWith('/stats') ? [] : wasCreated ? [...existing, created] : existing));
    api.post.mockImplementation(() => {
      wasCreated = true;
      return of(created);
    });
    const { fixture } = await createFixture({ api });
    const component = fixture.componentInstance;
    component.searchQuery = 'old filter';
    component.selectedState = 'P';
    component.openCreateModal();
    component.createForm = { name: created.name, description: '' };

    component.submitCreateProject();

    expect(component.searchQuery).toBe('');
    expect(component.selectedState).toBe('all');
    expect(component.currentPage).toBe(2);
    expect(component.paginatedProjects().map(row => row.id)).toContain(created.id);
  });
});
