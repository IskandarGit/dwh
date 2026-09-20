import { signal } from '@angular/core';
import { Observable } from 'rxjs';
import { RecordNavigationDecision } from '../../../core/guards/record-navigation.guard';

/** Shared local discard decision; the host owns its modal and pending/dirty state. */
export class OrgUnitDraft {
  readonly open = signal(false);
  private readonly navigation = new RecordNavigationDecision();
  private action: (() => void) | null = null;

  constructor(private readonly dirty: () => boolean, private readonly pending: () => boolean, private readonly clear: () => void) {}

  request(action: () => void): void {
    if (this.pending()) return;
    this.cancel();
    if (!this.dirty()) { action(); return; }
    this.action = action;
    this.open.set(true);
  }
  canLeave(): boolean | Observable<boolean> {
    if (this.pending()) return false;
    if (!this.dirty()) { this.clear(); return true; }
    this.cancel();
    return this.navigation.request(() => this.open.set(true), () => this.open.set(false));
  }
  confirm(): void {
    if (!this.open() || this.pending()) return;
    const action = this.action;
    this.action = null;
    this.open.set(false);
    this.clear();
    this.navigation.settle(true);
    action?.();
  }
  cancel(): void {
    this.action = null;
    this.open.set(false);
    this.navigation.settle(false);
  }
}
