import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { NavigationSettingsComponent } from './navigation-settings.component';
import { NavigationService } from '../../../core/services/navigation.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/services/i18n.service';
import { translateTest } from '../../../../testing/i18n-test.stub';
import { CustomNavigationItem } from '../../../core/models/navigation.models';

describe('NavigationSettingsComponent', () => {
  const sampleItems: CustomNavigationItem[] = [
    {
      id: 1,
      code: 'superset-sales',
      title: 'Отчет по продажам (Superset)',
      sectionId: 'custom-reports',
      icon: 'bar_chart',
      targetType: 'EMBEDDED_IFRAME',
      url: 'https://superset.example.com/sales',
      openInIframe: true,
      sortOrder: 10,
      state: 'A',
      createdAt: '2026-09-09T10:00:00Z',
      modifiedAt: '2026-09-09T10:00:00Z'
    },
    {
      id: 2,
      code: 'crm-link',
      title: 'Внешняя CRM',
      sectionId: 'custom',
      icon: 'open_in_new',
      targetType: 'EXTERNAL_LINK',
      url: 'https://crm.example.com',
      openInIframe: false,
      sortOrder: 20,
      state: 'P',
      createdAt: '2026-09-09T10:00:00Z',
      modifiedAt: '2026-09-09T10:00:00Z'
    }
  ];

  function setup(items = sampleItems) {
    const navService = {
      loadAllItems: vi.fn().mockReturnValue(of([...items])),
      createItem: vi.fn().mockReturnValue(of({ ...items[0], id: 3 })),
      updateItem: vi.fn().mockReturnValue(of({ ...items[0], title: 'Updated' })),
      toggleItem: vi.fn().mockReturnValue(of({ ...items[0], state: 'P' })),
      deleteItem: vi.fn().mockReturnValue(of(undefined))
    };

    const toast = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    };

    const i18n = {
      translate: translateTest
    };

    TestBed.configureTestingModule({
      imports: [NavigationSettingsComponent],
      providers: [
        { provide: NavigationService, useValue: navService },
        { provide: ToastService, useValue: toast },
        { provide: I18nService, useValue: i18n }
      ]
    });

    const fixture = TestBed.createComponent(NavigationSettingsComponent);
    return { fixture, navService, toast, i18n };
  }

  it('loads and renders navigation items on initialization', () => {
    const { fixture, navService } = setup();
    fixture.detectChanges();

    expect(navService.loadAllItems).toHaveBeenCalled();
    expect(fixture.componentInstance.items()).toHaveLength(2);

    const rows = fixture.nativeElement.querySelectorAll('.nav-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('Отчет по продажам (Superset)');
    expect(fixture.nativeElement.textContent).toContain('Внешняя CRM');
  });

  it('opens create modal with default values', () => {
    const { fixture } = setup();
    fixture.detectChanges();

    expect(fixture.componentInstance.isModalOpen()).toBe(false);

    fixture.componentInstance.openCreateModal();
    expect(fixture.componentInstance.isModalOpen()).toBe(true);
    expect(fixture.componentInstance.editingItem()).toBeNull();
    expect(fixture.componentInstance.formTargetType).toBe('EMBEDDED_IFRAME');
    expect(fixture.componentInstance.formSortOrder).toBe(30);
  });

  it('opens edit modal and populates form fields with item data', () => {
    const { fixture } = setup();
    fixture.detectChanges();

    fixture.componentInstance.openEditModal(sampleItems[0]);

    expect(fixture.componentInstance.isModalOpen()).toBe(true);
    expect(fixture.componentInstance.editingItem()).toEqual(sampleItems[0]);
    expect(fixture.componentInstance.formCode).toBe('superset-sales');
    expect(fixture.componentInstance.formTitle).toBe('Отчет по продажам (Superset)');
    expect(fixture.componentInstance.formUrl).toBe('https://superset.example.com/sales');
  });

  it('creates new navigation item and notifies success', () => {
    const { fixture, navService, toast } = setup();
    fixture.detectChanges();

    fixture.componentInstance.openCreateModal();
    fixture.componentInstance.formTitle = 'Финансовый дашборд';
    fixture.componentInstance.formCode = 'finance-bi';
    fixture.componentInstance.formUrl = 'https://bi.corp.com/dash';
    fixture.componentInstance.formTargetType = 'EMBEDDED_IFRAME';

    fixture.componentInstance.saveItem();

    expect(navService.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'finance-bi',
        title: 'Финансовый дашборд',
        url: 'https://bi.corp.com/dash'
      })
    );
    expect(toast.success).toHaveBeenCalled();
    expect(fixture.componentInstance.isModalOpen()).toBe(false);
  });

  it('updates existing navigation item when saving in edit mode', () => {
    const { fixture, navService, toast } = setup();
    fixture.detectChanges();

    fixture.componentInstance.openEditModal(sampleItems[0]);
    fixture.componentInstance.formTitle = 'Обновленный отчет';

    fixture.componentInstance.saveItem();

    expect(navService.updateItem).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        title: 'Обновленный отчет'
      })
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('toggles item state and refreshes list', () => {
    const { fixture, navService } = setup();
    fixture.detectChanges();

    fixture.componentInstance.toggleItem(sampleItems[0]);

    expect(navService.toggleItem).toHaveBeenCalledWith(1);
    expect(navService.loadAllItems).toHaveBeenCalledTimes(2);
  });

  it('opens delete confirmation and executes deletion', () => {
    const { fixture, navService, toast } = setup();
    fixture.detectChanges();

    fixture.componentInstance.confirmDelete(sampleItems[0]);
    expect(fixture.componentInstance.deleteTarget()).toEqual(sampleItems[0]);

    fixture.componentInstance.executeDelete();

    expect(navService.deleteItem).toHaveBeenCalledWith(1);
    expect(toast.success).toHaveBeenCalled();
    expect(fixture.componentInstance.deleteTarget()).toBeNull();
  });
});
