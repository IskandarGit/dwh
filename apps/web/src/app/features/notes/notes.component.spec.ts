import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../core/services/api.service';
import { PermissionService } from '../../core/services/permission.service';
import { ToastService } from '../../core/services/toast.service';
import { NotesComponent, Note } from './notes.component';

describe('NotesComponent', () => {
  const mockNote: Note = {
    id: 1,
    title: 'Модульный манифест',
    contentMd: 'Чистая архитектура',
    color: 'blue',
    isPinned: false,
    attributes: {},
    createdBy: 1,
    createdAt: '2026-09-08T00:00:00Z',
    modifiedAt: '2026-09-08T00:00:00Z'
  };

  async function createFixture() {
    await TestBed.configureTestingModule({
      imports: [NotesComponent],
      providers: [
        provideRouter([]),
        {
          provide: ApiService,
          useValue: {
            get: vi.fn(() => of([mockNote])),
            post: vi.fn(() => of(mockNote)),
            put: vi.fn(() => of(mockNote)),
            delete: vi.fn(() => of({}))
          }
        },
        { provide: PermissionService, useValue: { hasPermission: () => true } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(NotesComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders notes list and card details', async () => {
    const fixture = await createFixture();
    expect(fixture.componentInstance.notes().length).toBe(1);

    const titleEl = fixture.nativeElement.querySelector('.note-title');
    expect(titleEl.textContent).toContain('Модульный манифест');

    const contentEl = fixture.nativeElement.querySelector('.note-content');
    expect(contentEl.textContent).toContain('Чистая архитектура');
  });

  it('opens create modal when clicking create button', async () => {
    const fixture = await createFixture();
    fixture.componentInstance.openCreateModal();
    fixture.detectChanges();

    expect(fixture.componentInstance.isModalOpen()).toBe(true);
    expect(fixture.componentInstance.editingNote()).toBeNull();
  });
});
