import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { CustomField } from '../../../core/models/custom-field.models';
import { CustomFieldsComponent } from './custom-fields.component';

describe('CustomFieldsComponent', () => {
  async function createFixture(initialFields: CustomField[] = []) {
    const toast = { success: vi.fn(), error: vi.fn() };
    const api = {
      get: vi.fn(() => of(initialFields)),
      post: vi.fn(() => of({})),
      patch: vi.fn(() => of({})),
      delete: vi.fn(() => of({}))
    };

    await TestBed.configureTestingModule({
      imports: [CustomFieldsComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: PermissionService, useValue: { hasPermission: () => true } }
      ]
    }).compileComponents();

    return { fixture: TestBed.createComponent(CustomFieldsComponent), api, toast };
  }

  it('opens creation from ui-button and labels every modal control', async () => {
    const { fixture } = await createFixture();
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    const addButton = Array.from(buttons)
      .find(button => button.textContent?.includes('Добавить поле')) as HTMLButtonElement;
    addButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.showModal).toBe(true);
    const controls = Array.from(fixture.nativeElement.querySelectorAll('.modal-form input, .modal-form select')) as Array<HTMLInputElement | HTMLSelectElement>;
    for (const control of controls) {
      expect(control.id).not.toBe('');
      expect(fixture.nativeElement.querySelector(`label[for="${control.id}"]`)).not.toBeNull();
    }
    expect(fixture.nativeElement.querySelector('button[aria-label="Обновить поля"]')).not.toBeNull();
  });

  it('configures select values and sends them to the existing API', async () => {
    const { fixture, api } = await createFixture();
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    const addButton = Array.from(buttons)
      .find(button => button.textContent?.includes('Добавить поле')) as HTMLButtonElement;
    addButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.showModal).toBe(true);

    const code = fixture.nativeElement.querySelector('#custom-field-code') as HTMLInputElement;
    const name = fixture.nativeElement.querySelector('#custom-field-name') as HTMLInputElement;
    code.value = 'status_kind';
    code.dispatchEvent(new Event('input'));
    name.value = 'Тип статуса';
    name.dispatchEvent(new Event('input'));
    const type = fixture.nativeElement.querySelector('#custom-field-type') as HTMLSelectElement;
    type.selectedIndex = 4;
    type.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.formData.fieldType).toBe('select');
    await fixture.whenStable();
    fixture.detectChanges();

    const options = fixture.nativeElement.querySelector('#custom-field-options') as HTMLTextAreaElement;
    expect(options).not.toBeNull();
    options.value = 'Новый\nВ работе\nГотово';
    options.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.formData).toEqual(expect.objectContaining({
      code: 'status_kind',
      name: 'Тип статуса',
      fieldType: 'select',
      optionsText: 'Новый\nВ работе\nГотово'
    }));

    fixture.componentInstance.saveField();

    expect(api.post).toHaveBeenCalledWith('/custom-fields', expect.objectContaining({
      options: ['Новый', 'В работе', 'Готово']
    }));
  });

  it('keeps the table keyboard-scrollable and confirms deletion in-app', async () => {
    const field: CustomField = {
      id: 8,
      entityType: 'TASK',
      code: 'budget',
      name: 'Бюджет',
      fieldType: 'number',
      isRequired: false,
      orderNo: 10,
      createdAt: '2026-08-30T00:00:00Z'
    };
    const { fixture, api, toast } = await createFixture([field]);
    fixture.detectChanges();

    const region = fixture.nativeElement.querySelector('.table-wrapper[role="region"]') as HTMLElement;
    expect(region.tabIndex).toBe(0);
    expect(fixture.componentInstance.filteredFields).toHaveLength(1);
    expect(fixture.componentInstance.canManage()).toBe(true);
    const remove = fixture.nativeElement.querySelector('button.action-btn.danger') as HTMLButtonElement;
    expect(remove?.getAttribute('aria-label')).toBe('Удалить Бюджет');
    remove.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Удалить динамическое поле «Бюджет»');

    fixture.componentInstance.confirmDeleteField();
    expect(api.delete).toHaveBeenCalledWith('/custom-fields/8');
    expect(toast.success).toHaveBeenCalled();
  });

  it('filters fields by search query and clears search', async () => {
    const fields: CustomField[] = [
      { id: 1, entityType: 'USER', code: 'skype_id', name: 'Skype ID', fieldType: 'string', isRequired: false, orderNo: 1, createdAt: '2026-09-01T00:00:00Z' },
      { id: 2, entityType: 'TASK', code: 'cost_usd', name: 'Стоимость USD', fieldType: 'number', isRequired: true, orderNo: 2, createdAt: '2026-09-01T00:00:00Z' },
      { id: 3, entityType: 'USER', code: 'telegram_handle', name: 'Telegram Handle', fieldType: 'string', isRequired: false, orderNo: 3, createdAt: '2026-09-01T00:00:00Z' }
    ];

    const { fixture } = await createFixture(fields);
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredFields).toHaveLength(3);

    // Filter by 'telegram'
    fixture.componentInstance.searchQuery = 'telegram';
    fixture.componentInstance.applyFilter();
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredFields).toHaveLength(1);
    expect(fixture.componentInstance.filteredFields[0].code).toBe('telegram_handle');

    // Clear search
    fixture.componentInstance.clearSearch();
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredFields).toHaveLength(3);
  });

  it('filters by entity tab and displays accurate tab counts', async () => {
    const fields: CustomField[] = [
      { id: 1, entityType: 'USER', code: 'skype_id', name: 'Skype ID', fieldType: 'string', isRequired: false, orderNo: 1, createdAt: '2026-09-01T00:00:00Z' },
      { id: 2, entityType: 'TASK', code: 'cost_usd', name: 'Стоимость USD', fieldType: 'number', isRequired: true, orderNo: 2, createdAt: '2026-09-01T00:00:00Z' },
      { id: 3, entityType: 'USER', code: 'telegram_handle', name: 'Telegram Handle', fieldType: 'string', isRequired: false, orderNo: 3, createdAt: '2026-09-01T00:00:00Z' }
    ];

    const { fixture } = await createFixture(fields);
    fixture.detectChanges();

    expect(fixture.componentInstance.getEntityCount('ALL')).toBe(3);
    expect(fixture.componentInstance.getEntityCount('USER')).toBe(2);
    expect(fixture.componentInstance.getEntityCount('TASK')).toBe(1);
    expect(fixture.componentInstance.getEntityCount('PROJECT')).toBe(0);

    fixture.componentInstance.filterByEntity('TASK');
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredFields).toHaveLength(1);
    expect(fixture.componentInstance.filteredFields[0].code).toBe('cost_usd');
  });

  it('sorts fields by orderNo ascending then by name', async () => {
    const fields: CustomField[] = [
      { id: 1, entityType: 'USER', code: 'field_b', name: 'Поле Б', fieldType: 'string', isRequired: false, orderNo: 30, createdAt: '2026-09-01T00:00:00Z' },
      { id: 2, entityType: 'USER', code: 'field_a', name: 'Поле А', fieldType: 'string', isRequired: false, orderNo: 10, createdAt: '2026-09-01T00:00:00Z' },
      { id: 3, entityType: 'USER', code: 'field_c', name: 'Поле В', fieldType: 'string', isRequired: false, orderNo: 20, createdAt: '2026-09-01T00:00:00Z' }
    ];

    const { fixture } = await createFixture(fields);
    fixture.detectChanges();

    const orderedCodes = fixture.componentInstance.filteredFields.map(f => f.code);
    expect(orderedCodes).toEqual(['field_a', 'field_c', 'field_b']);
  });

  it('sanitizes code input to lowercase and replaces spaces with underscores', async () => {
    const { fixture } = await createFixture();
    fixture.detectChanges();

    fixture.componentInstance.openCreateModal();
    fixture.detectChanges();

    const input = { value: 'My Special Code' } as HTMLInputElement;
    const event = { target: input } as unknown as Event;

    fixture.componentInstance.onCodeInput(event);
    expect(fixture.componentInstance.formData.code).toBe('my_special_code');
  });
});
