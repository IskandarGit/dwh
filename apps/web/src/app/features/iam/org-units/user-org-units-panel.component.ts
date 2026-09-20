import { ChangeDetectorRef, Component, DestroyRef, effect, EventEmitter, HostListener, inject, Input, OnChanges, Output, signal, SimpleChanges } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { ProblemDetail } from '../../../core/models/common.models';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { PermissionService } from '../../../core/services/permission.service';
import { safeNumericRecordId } from '../../../core/services/search-target';
import { ToastService } from '../../../core/services/toast.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import { OrgUnitDraft } from './org-unit-draft';
import { OrgUnitTreeComponent } from './org-unit-tree.component';
import { OrgUnitsApiService } from './org-units-api.service';
import { OrgUnit, UserScope } from './org-units.models';

@Component({
  selector: 'app-user-org-units-panel', standalone: true,
  imports: [TranslatePipe, UiButtonComponent, UiModalComponent, OrgUnitTreeComponent],
  templateUrl: './user-org-units-panel.component.html', styleUrl: './user-org-units-panel.component.css'
})
export class UserOrgUnitsPanelComponent implements OnChanges {
  @Input({ required: true }) userId = 0;
  @Output() busyChange = new EventEmitter<boolean>();
  readonly permissions = inject(PermissionService);
  private readonly api = inject(OrgUnitsApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly writes = new Subscription();
  private treeRequest?: Subscription;
  private assignmentsRequest?: Subscription;
  private scopeRequest?: Subscription;
  private activeTarget: number | null = null;
  private deferredTarget: number | null = null;
  private viewEpoch = 0;
  private originalOrgUnitIds: readonly number[] = [];

  readonly selectedOrgUnitIds = signal<readonly number[]>([]);
  units: OrgUnit[] = [];
  legacyOrgUnitId: number | null = null;
  effectiveScope: UserScope | null = null;
  pending = false;
  treeLoading = false;
  treeLoaded = false;
  treeError: ProblemDetail | null = null;
  assignmentsLoading = false;
  assignmentsLoaded = false;
  assignmentsError: ProblemDetail | null = null;
  scopeLoading = false;
  scopeLoaded = false;
  scopeError: ProblemDetail | null = null;
  saveError: ProblemDetail | null = null;
  savedRefreshFailed = false;
  readonly discard = new OrgUnitDraft(() => this.dirty, () => this.pending, () => this.restoreDraft());

  constructor() {
    effect(() => {
      const canView = this.permissions.hasPermission('iam.org_units', 'view');
      this.permissions.hasPermission('iam.org_units', 'assign');
      if (!canView) this.clearRevokedView();
    });
    inject(DestroyRef).onDestroy(() => {
      this.discard.cancel(); this.cancelReads(); this.writes.unsubscribe(); this.setPending(false);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['userId'] || changes['userId'].currentValue === this.activeTarget) return;
    this.activateTarget(this.userId);
  }

  can(action: 'view' | 'assign'): boolean {
    return this.permissions.hasPermission('iam.org_units', 'view') && this.permissions.hasPermission('iam.org_units', action);
  }
  get dirty(): boolean { return this.assignmentsLoaded && !sameIds(this.selectedOrgUnitIds(), this.originalOrgUnitIds); }
  get inactiveAssignments(): OrgUnit[] {
    const selected = new Set(this.selectedOrgUnitIds());
    return this.units.filter(unit => selected.has(unit.id) && unit.state === 'P');
  }
  get unresolvedAssignmentIds(): number[] {
    if (!this.treeLoaded) return [];
    const known = new Set(this.units.map(unit => unit.id));
    return this.selectedOrgUnitIds().filter(id => !known.has(id));
  }

  toggleAssignment(unit: OrgUnit): void {
    if (!this.can('assign') || !this.assignmentsLoaded || this.pending || !safeNumericRecordId(unit.id)) return;
    const selected = new Set(this.selectedOrgUnitIds());
    selected.has(unit.id) ? selected.delete(unit.id) : selected.add(unit.id);
    this.selectedOrgUnitIds.set([...selected].sort((a, b) => a - b)); this.saveError = null;
  }

  save(): void {
    const target = this.activeTarget;
    const ids = [...this.selectedOrgUnitIds()];
    if (!this.can('assign') || !this.assignmentsLoaded || !this.dirty || this.pending
      || target === null || target !== this.userId || !safeNumericRecordId(target) || !ids.every(safeNumericRecordId)) return;
    const epoch = this.viewEpoch;
    this.setPending(true); this.saveError = null; this.changeDetector.markForCheck();
    this.writes.add(this.api.saveAssignments(target, ids).subscribe({
      next: () => {
        this.setPending(false);
        if (!this.currentView(epoch, target)) { this.loadDeferredTarget(); return; }
        this.originalOrgUnitIds = [...ids]; this.selectedOrgUnitIds.set([...ids]); this.assignmentsLoaded = true;
        this.toast.success(this.i18n.translate('iam.org_units.assignments_saved')); this.reloadScope(true);
      },
      error: error => {
        this.setPending(false);
        if (this.currentView(epoch, target)) this.saveError = error;
        else this.loadDeferredTarget();
        this.changeDetector.markForCheck();
      }
    }));
  }

  reloadAll(): void {
    if (this.pending || !this.can('view')) return;
    if (this.activeTarget !== this.userId) { this.activateTarget(this.userId); return; }
    this.reloadTree(); this.reloadAssignments(); this.reloadScope();
  }
  reloadTree(): void {
    const target = this.activeTarget;
    if (!this.can('view') || this.pending || target === null || !safeNumericRecordId(target)) return;
    const epoch = this.viewEpoch;
    this.treeRequest?.unsubscribe(); this.treeLoading = true; this.treeLoaded = false; this.treeError = null;
    this.treeRequest = this.api.list().subscribe({
      next: units => {
        if (!this.currentView(epoch, target)) return;
        this.units = units; this.treeLoading = false; this.treeLoaded = true; this.changeDetector.markForCheck();
      },
      error: error => {
        if (this.currentView(epoch, target)) { this.treeLoading = false; this.treeLoaded = false; this.treeError = error; this.changeDetector.markForCheck(); }
      }
    });
  }
  reloadAssignments(): void {
    const target = this.activeTarget;
    if (!this.can('view') || this.pending || this.dirty || target === null || !safeNumericRecordId(target)) return;
    const epoch = this.viewEpoch;
    this.assignmentsRequest?.unsubscribe(); this.assignmentsLoading = true; this.assignmentsLoaded = false; this.assignmentsError = null; this.saveError = null;
    this.assignmentsRequest = this.api.assignments(target).subscribe({
      next: snapshot => {
        if (!this.currentView(epoch, target)) return;
        this.assignmentsLoading = false;
        if (snapshot.userId !== target || !snapshot.orgUnitIds.every(safeNumericRecordId)) {
          this.assignmentsError = this.unavailable(); this.assignmentsLoaded = false; this.changeDetector.markForCheck(); return;
        }
        const ids = normalizedIds(snapshot.orgUnitIds);
        this.originalOrgUnitIds = ids; this.selectedOrgUnitIds.set([...ids]);
        this.legacyOrgUnitId = snapshot.legacyOrgUnitId ?? null; this.assignmentsLoaded = true; this.changeDetector.markForCheck();
      },
      error: error => {
        if (this.currentView(epoch, target)) { this.assignmentsLoading = false; this.assignmentsLoaded = false; this.assignmentsError = error; this.changeDetector.markForCheck(); }
      }
    });
  }
  reloadScope(afterSave = false): void {
    const target = this.activeTarget;
    if (!this.can('view') || this.pending || target === null || !safeNumericRecordId(target)) return;
    const epoch = this.viewEpoch;
    this.scopeRequest?.unsubscribe(); this.scopeLoading = true; this.scopeLoaded = false; this.scopeError = null;
    this.scopeRequest = this.api.scope(target).subscribe({
      next: scope => {
        if (!this.currentView(epoch, target)) return;
        this.effectiveScope = scope; this.scopeLoading = false; this.scopeLoaded = true; this.savedRefreshFailed = false; this.changeDetector.markForCheck();
      },
      error: error => {
        if (this.currentView(epoch, target)) {
          this.scopeLoading = false; this.scopeLoaded = false; this.scopeError = error;
          this.savedRefreshFailed = afterSave || this.savedRefreshFailed; this.changeDetector.markForCheck();
        }
      }
    });
  }

  unitLabel(id: number): string {
    const unit = this.units.find(item => item.id === id);
    return unit ? `${unit.code} · ${unit.name}` : String(id);
  }
  scopeRuleKey(): string { return `iam.data_scope.rule_${this.effectiveScope?.rule.toLowerCase() ?? 'all'}`; }
  emptyScopeKey(): string {
    if (this.effectiveScope?.rule === 'ALL') return 'iam.data_scope.all_empty';
    if (this.effectiveScope?.rule === 'SELF') return 'iam.data_scope.self_empty';
    return 'iam.data_scope.units_empty';
  }
  cancelEdits(): void { this.discard.request(() => this.restoreDraft()); }
  canLeave(): boolean | Observable<boolean> { return this.discard.canLeave(); }
  hasUnsavedWork(): boolean { return this.pending || this.dirty; }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedWork()) { event.preventDefault(); event.returnValue = ''; }
  }

  private activateTarget(target: number): void {
    this.viewEpoch++; this.cancelReads(); this.discard.cancel(); this.resetProtectedState(); this.activeTarget = target;
    if (this.pending) { this.deferredTarget = target; this.changeDetector.markForCheck(); return; }
    this.deferredTarget = null; this.loadActiveTarget();
  }
  private loadActiveTarget(): void {
    const target = this.activeTarget;
    if (target === null) return;
    if (!this.can('view') || !safeNumericRecordId(target)) {
      if (this.can('view')) this.assignmentsError = this.unavailable();
      this.changeDetector.markForCheck(); return;
    }
    this.reloadTree(); this.reloadAssignments(); this.reloadScope();
  }
  private clearRevokedView(): void {
    this.viewEpoch++; this.deferredTarget = null; this.cancelReads(); this.discard.cancel(); this.resetProtectedState(); this.changeDetector.markForCheck();
  }
  private resetProtectedState(): void {
    this.units = []; this.treeLoading = false; this.treeLoaded = false; this.treeError = null;
    this.originalOrgUnitIds = []; this.selectedOrgUnitIds.set([]); this.legacyOrgUnitId = null;
    this.assignmentsLoading = false; this.assignmentsLoaded = false; this.assignmentsError = null;
    this.effectiveScope = null; this.scopeLoading = false; this.scopeLoaded = false; this.scopeError = null;
    this.saveError = null; this.savedRefreshFailed = false;
  }
  private restoreDraft(): void {
    this.selectedOrgUnitIds.set([...this.originalOrgUnitIds]); this.saveError = null; this.changeDetector.markForCheck();
  }
  private cancelReads(): void {
    this.treeRequest?.unsubscribe(); this.assignmentsRequest?.unsubscribe(); this.scopeRequest?.unsubscribe();
    this.treeRequest = undefined; this.assignmentsRequest = undefined; this.scopeRequest = undefined;
  }
  private currentView(epoch: number, target: number): boolean {
    return this.can('view') && epoch === this.viewEpoch && target === this.activeTarget && target === this.userId;
  }
  private loadDeferredTarget(): void {
    if (this.deferredTarget === null || this.deferredTarget !== this.activeTarget || this.deferredTarget !== this.userId) return;
    this.deferredTarget = null; this.loadActiveTarget();
  }
  private setPending(value: boolean): void {
    if (this.pending === value) return;
    this.pending = value; this.busyChange.emit(value); this.changeDetector.markForCheck();
  }
  private unavailable(): ProblemDetail {
    return { status: 400, code: 'ORG_UNIT_UNSAFE_ID', title: this.i18n.translate('iam.org_units.unavailable'), detail: this.i18n.translate('iam.org_units.readonly_id') };
  }
}

function normalizedIds(ids: readonly number[]): number[] { return [...new Set(ids)].sort((a, b) => a - b); }
function sameIds(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
