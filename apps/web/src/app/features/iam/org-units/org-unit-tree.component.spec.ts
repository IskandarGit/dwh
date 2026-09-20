import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { OrgUnitTreeComponent } from './org-unit-tree.component';

describe('OrgUnitTreeComponent', () => {
  it('uses nested lists with separate named expand and select buttons', () => {
    const fixture = TestBed.createComponent(OrgUnitTreeComponent);
    fixture.componentRef.setInput('units', [
      { id: 1, parentId: null, code: 'ROOT', name: 'Root', kind: 'future-kind', state: 'A', orderNo: 0 },
      { id: 2, parentId: 1, code: 'CHILD', name: 'Child', kind: 'branch', state: 'P', orderNo: 0 }
    ]);
    const selected = vi.fn(); fixture.componentInstance.selectUnit.subscribe(selected);
    fixture.detectChanges();
    const expand = fixture.nativeElement.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(expand?.getAttribute('aria-label') ?? '').toContain('Root');
    expect(fixture.nativeElement.querySelector('ul ul')).not.toBeNull();
    const select = fixture.nativeElement.querySelector('[data-select="2"]') as HTMLButtonElement;
    select.click(); expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    expand.click(); fixture.detectChanges();
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('[data-select="2"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('future-kind');
  });

  it('renders labelled native checkboxes and emits exactly one toggle in opt-in multiple mode', () => {
    const fixture = TestBed.createComponent(OrgUnitTreeComponent);
    fixture.componentRef.setInput('units', [
      { id: 1, parentId: null, code: 'ROOT', name: 'Root', kind: 'company', state: 'A', orderNo: 0, createdAt: '', modifiedAt: '' },
      { id: 2, parentId: 1, code: 'CHILD', name: 'Child', kind: 'branch', state: 'P', orderNo: 0, createdAt: '', modifiedAt: '' }
    ]);
    fixture.componentRef.setInput('multiple', true);
    fixture.componentRef.setInput('checkedIds', [2]);
    const toggled = vi.fn();
    (fixture.componentInstance as unknown as { toggleUnit?: { subscribe: (handler: (value: unknown) => void) => void } }).toggleUnit?.subscribe(toggled);
    fixture.detectChanges();

    const root = fixture.nativeElement.querySelector('input[data-check="1"]') as HTMLInputElement;
    const child = fixture.nativeElement.querySelector('input[data-check="2"]') as HTMLInputElement;
    expect(root?.type).toBe('checkbox'); expect(root?.checked).toBe(false);
    expect(child?.checked).toBe(true);
    expect(child?.closest('label')?.textContent).toContain('CHILD · Child');
    child?.click();
    expect(toggled).toHaveBeenCalledTimes(1);
    expect(toggled).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it('disables multiple-mode checkboxes without changing ordinary selection behavior', () => {
    const fixture = TestBed.createComponent(OrgUnitTreeComponent);
    const unit = { id: 1, parentId: null, code: 'ROOT', name: 'Root', kind: 'company', state: 'A' as const, orderNo: 0, createdAt: '', modifiedAt: '' };
    fixture.componentRef.setInput('units', [unit]); fixture.componentRef.setInput('multiple', true);
    fixture.componentRef.setInput('disabled', true); fixture.detectChanges();
    const toggled = vi.fn();
    (fixture.componentInstance as unknown as { toggleUnit?: { subscribe: (handler: (value: unknown) => void) => void } }).toggleUnit?.subscribe(toggled);
    const checkbox = fixture.nativeElement.querySelector('input[data-check="1"]') as HTMLInputElement;
    expect(checkbox?.disabled).toBe(true); checkbox?.click();
    expect(toggled).not.toHaveBeenCalled();

    fixture.componentRef.setInput('multiple', false); fixture.componentRef.setInput('disabled', false); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type="checkbox"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-select="1"]')).not.toBeNull();
  });
});
