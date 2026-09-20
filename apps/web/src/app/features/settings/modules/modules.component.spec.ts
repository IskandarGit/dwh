import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { ModulesComponent, InstalledModule } from './modules.component';

describe('ModulesComponent', () => {
  const mockModules: InstalledModule[] = [
    {
      code: 'iam',
      moduleCode: 'iam',
      name: 'IAM & Security',
      description: 'Identity and access management',
      version: '1.0.0',
      isSystem: true,
      status: 'ACTIVE',
      isActive: true,
      createdAt: '2026-09-08T00:00:00Z',
      modifiedAt: '2026-09-08T00:00:00Z'
    },
    {
      code: 'notes',
      moduleCode: 'notes',
      name: 'Notes & Memos',
      description: 'Personal and team notes',
      version: '1.0.0',
      isSystem: false,
      status: 'ACTIVE',
      isActive: true,
      createdAt: '2026-09-08T00:00:00Z',
      modifiedAt: '2026-09-08T00:00:00Z'
    }
  ];

  async function createFixture(canManage = true) {
    const apiMock = {
      get: vi.fn(() => of(mockModules)),
      post: vi.fn((_url: string, _body: any) => of({ ...mockModules[1], status: 'DISABLED', isActive: false }))
    };

    await TestBed.configureTestingModule({
      imports: [ModulesComponent],
      providers: [
        provideRouter([]),
        {
          provide: ApiService,
          useValue: apiMock
        },
        {
          provide: PermissionService,
          useValue: {
            canManage: () => canManage,
            canView: () => true,
            hasPermission: () => true
          }
        },
        {
          provide: ToastService,
          useValue: { success: vi.fn(), error: vi.fn() }
        }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(ModulesComponent);
    fixture.detectChanges();
    return { fixture, apiMock };
  }

  it('renders installed modules list and statistics', async () => {
    const { fixture } = await createFixture();
    expect(fixture.componentInstance.modules().length).toBe(2);
    expect(fixture.componentInstance.activeCount()).toBe(2);
    expect(fixture.componentInstance.systemCount()).toBe(1);
    expect(fixture.componentInstance.customCount()).toBe(1);

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  it('filters modules by search query', async () => {
    const { fixture } = await createFixture();
    fixture.componentInstance.searchQuery.set('notes');
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredModules().length).toBe(1);
    expect(fixture.componentInstance.filteredModules()[0].code).toBe('notes');
  });

  it('filters modules by tab', async () => {
    const { fixture } = await createFixture();
    fixture.componentInstance.filterTab.set('system');
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredModules().length).toBe(1);
    expect(fixture.componentInstance.filteredModules()[0].code).toBe('iam');
  });

  it('prevents toggling system modules', async () => {
    const { fixture } = await createFixture();
    const toast = TestBed.inject(ToastService);
    const systemModule = mockModules[0];

    const fakeEvent = { target: { checked: false } } as unknown as Event;
    fixture.componentInstance.toggleModule(systemModule, fakeEvent);

    expect(toast.error).toHaveBeenCalled();
  });

  it('toggles application module successfully with correct API payload', async () => {
    const { fixture, apiMock } = await createFixture();
    const appModule = mockModules[1];

    const fakeEvent = { target: { checked: false } } as unknown as Event;
    fixture.componentInstance.toggleModule(appModule, fakeEvent);

    expect(apiMock.post).toHaveBeenCalledWith('/modules/notes/toggle', { enabled: false });
  });
});
