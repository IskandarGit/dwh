import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { OrgUnitEditorComponent } from './org-unit-editor.component';
import { OrgUnit } from './org-units.models';

const root: OrgUnit = { id: 1, parentId: null, code: 'ROOT', name: 'Root', kind: 'company', state: 'A', orderNo: 0, createdAt: '', modifiedAt: '' };
const child: OrgUnit = { ...root, id: 2, parentId: 1, code: 'CHILD', name: 'Child', kind: 'custom-kind' };
describe('OrgUnitEditorComponent', () => {
  function setup(initial = child, units = [root, child]) {
    const fixture = TestBed.createComponent(OrgUnitEditorComponent);
    fixture.componentRef.setInput('initial', initial); fixture.componentRef.setInput('units', units); fixture.detectChanges();
    const save = vi.fn(); fixture.componentInstance.save.subscribe(save);
    return { fixture, editor: fixture.componentInstance, save };
  }
  it('keeps unknown kinds and immutable code; sends name-only sparse PATCH through native form', async () => {
    const { fixture, editor, save } = setup();
    expect(editor.draft.kind).toBe('custom-kind');
    editor.draft.name = ' Renamed ';
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(save).toHaveBeenCalledWith({ mode: 'edit', id: 2, patch: { name: 'Renamed' } });
    expect(fixture.nativeElement.querySelector('input[name="code"]').readOnly).toBe(true);
  });
  it('does not submit pristine, blank or pending forms', () => {
    const { editor, save, fixture } = setup();
    editor.submit(); editor.draft.name = ' '; editor.submit();
    editor.draft.name = 'New'; fixture.componentRef.setInput('pending', true); fixture.detectChanges(); editor.submit();
    expect(save).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('fieldset')?.disabled).toBe(true);
  });
  it('treats surrounding name whitespace as pristine and keeps Save disabled', () => {
    const { editor, save, fixture } = setup();
    editor.draft.name = '  Child  ';
    fixture.detectChanges();
    expect(editor.dirty).toBe(false);
    expect((fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    editor.submit();
    expect(save).not.toHaveBeenCalled();
  });
  it('excludes malformed parents and requires impact confirmation for state/move changes', () => {
    const { editor, save } = setup(child, [root, child, { ...root, id: 3, parentId: 90 }]);
    expect(editor.parents.map(u => u.id)).toEqual([1]);
    editor.draft.state = 'P'; editor.submit();
    expect(save).not.toHaveBeenCalled(); expect(editor.impactOpen).toBe(true);
    editor.confirmImpact(); expect(save).toHaveBeenCalledWith({ mode: 'edit', id: 2, patch: { state: 'P' } });
  });
  it('locks root parent and associates field errors without losing the draft', () => {
    const { editor, fixture } = setup(root);
    editor.draft.name = 'Preserved';
    fixture.componentRef.setInput('error', { status: 409, title: 'Conflict', code: 'CONFLICT', detail: 'Try again', invalid_params: [{ name: 'name', reason: 'Field conflict' }] });
    fixture.detectChanges();
    expect(editor.draft.name).toBe('Preserved');
    const input = fixture.nativeElement.querySelector('input[name="name"]') as HTMLInputElement;
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.querySelector('#' + input.getAttribute('aria-describedby')).textContent).toContain('Field conflict');
    expect(fixture.nativeElement.querySelector('select[name="parentId"]')).toBeNull();
  });
  it('preserves an unknown kind even when its name matches an object prototype property', () => {
    const { fixture, editor } = setup({ ...child, kind: 'constructor' });
    const option = Array.from(fixture.nativeElement.querySelectorAll('option')) as HTMLOptionElement[];
    expect(option.some(item => item.value === 'constructor' && item.textContent === 'constructor')).toBe(true);
    expect(editor.draft.kind).toBe('constructor');
  });
});
