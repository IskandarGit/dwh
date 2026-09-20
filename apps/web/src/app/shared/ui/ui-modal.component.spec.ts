import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiModalComponent } from './ui-modal.component';
import { UiSearchableSelectComponent } from './ui-searchable-select.component';

describe('UiModalComponent', () => {
  it('labels the dialog with its visible title', async () => {
    await TestBed.configureTestingModule({ imports: [UiModalComponent] }).compileComponents();
    const fixture = TestBed.createComponent(UiModalComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('title', 'Восстановление пароля');
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    const title = fixture.nativeElement.querySelector('h3') as HTMLElement;
    expect(title.id).not.toBe('');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('does not close a non-dismissible dialog on Escape', async () => {
    await TestBed.configureTestingModule({ imports: [UiModalComponent] }).compileComponents();
    const fixture = TestBed.createComponent(UiModalComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('dismissible', false);
    let closes = 0;
    fixture.componentInstance.close.subscribe(() => closes++);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closes).toBe(0);
  });

  it('does not claim an already prevented Escape event', async () => {
    await TestBed.configureTestingModule({ imports: [UiModalComponent] }).compileComponents();
    const fixture = TestBed.createComponent(UiModalComponent);
    fixture.componentRef.setInput('isOpen', true);
    let closes = 0;
    fixture.componentInstance.close.subscribe(() => closes++);
    fixture.detectChanges();

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    escape.preventDefault();
    document.dispatchEvent(escape);

    expect(closes).toBe(0);
  });

  it('closes for an ordinary expanded disclosure inside the dialog', async () => {
    await TestBed.configureTestingModule({ imports: [UiModalComponent] }).compileComponents();
    const fixture = TestBed.createComponent(UiModalComponent);
    fixture.componentRef.setInput('isOpen', true);
    let closes = 0;
    fixture.componentInstance.close.subscribe(() => closes++);
    fixture.detectChanges();
    const expandedControl = document.createElement('div');
    expandedControl.setAttribute('aria-expanded', 'true');
    fixture.nativeElement.append(expandedControl);

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    document.dispatchEvent(escape);

    expect(closes).toBe(1);
    expect(escape.defaultPrevented).toBe(true);
  });

  it('lets an actual open searchable select consume Escape before its dialog', async () => {
    await TestBed.configureTestingModule({ imports: [UiModalComponent, UiSearchableSelectComponent] }).compileComponents();
    const fixture = TestBed.createComponent(UiModalComponent);
    const select = TestBed.createComponent(UiSearchableSelectComponent);
    fixture.componentRef.setInput('isOpen', true);
    select.componentRef.setInput('options', [{ id: 1, label: 'Первый' }]);
    let closes = 0;
    fixture.componentInstance.close.subscribe(() => closes++);
    fixture.detectChanges();
    select.detectChanges();
    fixture.nativeElement.append(select.nativeElement);
    select.componentInstance.toggleDropdown();
    select.detectChanges();

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    document.dispatchEvent(escape);

    expect(select.componentInstance.isOpen()).toBe(false);
    expect(closes).toBe(0);
    expect(escape.defaultPrevented).toBe(true);
  });

  it('locks background scrolling only while open', async () => {
    await TestBed.configureTestingModule({ imports: [UiModalComponent] }).compileComponents();
    const fixture = TestBed.createComponent(UiModalComponent);

    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    expect(document.body.classList.contains('modal-open')).toBe(true);

    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });

  it('lets only the topmost open dialog handle Escape', async () => {
    await TestBed.configureTestingModule({ imports: [UiModalComponent] }).compileComponents();
    const lower = TestBed.createComponent(UiModalComponent);
    const upper = TestBed.createComponent(UiModalComponent);
    lower.componentRef.setInput('isOpen', true);
    upper.componentRef.setInput('isOpen', true);
    let lowerCloses = 0;
    let upperCloses = 0;
    lower.componentInstance.close.subscribe(() => lowerCloses++);
    upper.componentInstance.close.subscribe(() => upperCloses++);
    lower.detectChanges();
    upper.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(lowerCloses).toBe(0);
    expect(upperCloses).toBe(1);
  });

  it('consumes Escape before a close handler opens a new topmost dialog', async () => {
    await TestBed.configureTestingModule({ imports: [UiModalComponent] }).compileComponents();
    const owner = TestBed.createComponent(UiModalComponent);
    const confirmation = TestBed.createComponent(UiModalComponent);
    owner.componentRef.setInput('isOpen', true);
    confirmation.componentRef.setInput('isOpen', false);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    let ownerCloses = 0;
    let confirmationCloses = 0;
    let preventedBeforeOwnerClose = false;
    owner.componentInstance.close.subscribe(() => {
      ownerCloses++;
      preventedBeforeOwnerClose = escape.defaultPrevented;
      confirmation.componentRef.setInput('isOpen', true);
      confirmation.detectChanges();
    });
    confirmation.componentInstance.close.subscribe(() => confirmationCloses++);
    owner.detectChanges();
    confirmation.detectChanges();

    document.dispatchEvent(escape);

    expect(ownerCloses).toBe(1);
    expect(preventedBeforeOwnerClose).toBe(true);
    expect(confirmationCloses).toBe(0);
    expect(escape.defaultPrevented).toBe(true);
  });

  it('does not let reverse listener order close two existing stacked dialogs', async () => {
    await TestBed.configureTestingModule({ imports: [UiModalComponent] }).compileComponents();
    const upper = TestBed.createComponent(UiModalComponent);
    const lower = TestBed.createComponent(UiModalComponent);
    let lowerCloses = 0;
    let upperCloses = 0;
    lower.componentInstance.close.subscribe(() => {
      lowerCloses++;
      lower.componentRef.setInput('isOpen', false);
      lower.detectChanges();
    });
    upper.componentInstance.close.subscribe(() => {
      upperCloses++;
      upper.componentRef.setInput('isOpen', false);
      upper.detectChanges();
    });
    lower.componentRef.setInput('isOpen', true);
    lower.detectChanges();
    upper.componentRef.setInput('isOpen', true);
    upper.detectChanges();

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(escape);

    expect(upperCloses).toBe(1);
    expect(lowerCloses).toBe(0);
    expect(escape.defaultPrevented).toBe(true);
  });
});
