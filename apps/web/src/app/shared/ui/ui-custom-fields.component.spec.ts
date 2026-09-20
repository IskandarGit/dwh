import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { CustomField } from '../../core/models/custom-field.models';
import { UiCustomFieldsComponent } from './ui-custom-fields.component';

const baseField: Omit<CustomField, 'id' | 'code' | 'name' | 'fieldType'> = {
  entityType: 'TASK',
  isRequired: false,
  orderNo: 0,
  createdAt: '2026-08-30T00:00:00Z'
};

describe('UiCustomFieldsComponent', () => {
  it('connects every visible field label and required state to its control', async () => {
    await TestBed.configureTestingModule({ imports: [UiCustomFieldsComponent] }).compileComponents();
    const fixture = TestBed.createComponent(UiCustomFieldsComponent);
    fixture.componentRef.setInput('fields', [
      { ...baseField, id: 1, code: 'inn', name: 'ИНН', fieldType: 'string', isRequired: true },
      { ...baseField, id: 2, code: 'approved', name: 'Согласовано', fieldType: 'boolean' }
    ] satisfies CustomField[]);
    fixture.detectChanges();

    const controls = Array.from(fixture.nativeElement.querySelectorAll('input, select')) as HTMLInputElement[];

    expect(controls).toHaveLength(2);
    for (const control of controls) {
      expect(control.id).not.toBe('');
      expect(fixture.nativeElement.querySelector(`label.field-label[for="${control.id}"]`)).not.toBeNull();
    }
    expect(controls[0].required).toBe(true);
    expect(controls[0].getAttribute('aria-required')).toBe('true');
  });

  it('renders configured select options and emits the selected value', async () => {
    await TestBed.configureTestingModule({ imports: [UiCustomFieldsComponent] }).compileComponents();
    const fixture = TestBed.createComponent(UiCustomFieldsComponent);
    fixture.componentRef.setInput('fields', [{
      ...baseField,
      id: 3,
      code: 'region',
      name: 'Регион',
      fieldType: 'select',
      optionsJson: '["Ташкент","Самарканд"]'
    }] satisfies CustomField[]);
    let emitted: Record<string, unknown> | undefined;
    fixture.componentInstance.valuesChange.subscribe(value => emitted = value);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(Array.from(select.options).map(option => option.textContent?.trim())).toEqual([
      'Выберите значение',
      'Ташкент',
      'Самарканд'
    ]);

    select.value = select.options[2].value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(emitted).toEqual({ region: 'Самарканд' });
  });

  it('renders configured user_ref dropdown and emits numeric user id', async () => {
    await TestBed.configureTestingModule({ imports: [UiCustomFieldsComponent] }).compileComponents();
    const fixture = TestBed.createComponent(UiCustomFieldsComponent);
    fixture.componentRef.setInput('fields', [{
      ...baseField,
      id: 4,
      code: 'curator_id',
      name: 'Куратор',
      fieldType: 'user_ref'
    }] satisfies CustomField[]);
    fixture.componentRef.setInput('users', [
      { id: 42, name: 'Анна Смирнова', login: 'asmirnova' }
    ]);
    let emitted: Record<string, unknown> | undefined;
    fixture.componentInstance.valuesChange.subscribe(value => emitted = value);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.options.length).toBe(2);
    expect(select.options[1].textContent?.trim()).toContain('Анна Смирнова');

    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(emitted).toEqual({ curator_id: 42 });
  });
});
