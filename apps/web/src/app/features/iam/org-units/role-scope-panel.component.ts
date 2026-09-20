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
import { OrgUnitsApiService } from './org-units-api.service';
import { ScopeRule } from './org-units.models';

export interface ScopeRuleOption { value: ScopeRule; labelKey: string; descriptionKey: string; }

@Component({
  selector: 'app-role-scope-panel', standalone: true,
  imports: [TranslatePipe, UiButtonComponent, UiModalComponent],
  templateUrl: './role-scope-panel.component.html', styleUrl: './role-scope-panel.component.css'
})
export class RoleScopePanelComponent implements OnChanges {
  @Input({ required: true }) roleId = 0;
  @Output() busyChange = new EventEmitter<boolean>();
  readonly permissions = inject(PermissionService);
  private readonly api = inject(OrgUnitsApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly writes = new Subscription();
  private readRequest?: Subscription;
  private activeTarget: number | null = null;
  private deferredTarget: number | null = null;
  private viewEpoch = 0;
  private originalRule: ScopeRule | null = null;

  readonly options: readonly ScopeRuleOption[] = [
    { value: 'ALL', labelKey: 'iam.data_scope.rule_all', descriptionKey: 'iam.data_scope.rule_all_help' },
    { value: 'SUBTREE', labelKey: 'iam.data_scope.rule_subtree', descriptionKey: 'iam.data_scope.rule_subtree_help' },
    { value: 'UNITS', labelKey: 'iam.data_scope.rule_units', descriptionKey: 'iam.data_scope.rule_units_help' },
    { value: 'SELF', labelKey: 'iam.data_scope.rule_self', descriptionKey: 'iam.data_scope.rule_self_help' }
  ];
  readonly selectedRule = signal<ScopeRule>('ALL');
  loaded = false;
  loading = false;
  pending = false;
  loadError: ProblemDetail | null = null;
  saveError: ProblemDetail | null = null;
  savedRefreshFailed = false;
  confirmationOpen = false;
  readonly discard = new OrgUnitDraft(() => this.dirty, () => this.pending, () => this.restoreDraft());

  constructor() {
    effect(() => {
      const canView = this.permissions.hasPermission('iam.org_units', 'view');
      this.permissions.hasPermission('iam.org_units', 'assign');
      if (!canView) this.clearRevokedView();
    });
    inject(DestroyRef).onDestroy(() => {
      this.discard.cancel(); this.readRequest?.unsubscribe(); this.writes.unsubscribe(); this.setPending(false);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['roleId'] || changes['roleId'].currentValue === this.activeTarget) return;
    this.activateTarget(this.roleId);
  }

  can(action: 'view' | 'assign'): boolean {
    return this.permissions.hasPermission('iam.org_units', 'view') && this.permissions.hasPermission('iam.org_units', action);
  }
  get dirty(): boolean { return this.loaded && this.originalRule !== null && this.selectedRule() !== this.originalRule; }

  selectRule(rule: ScopeRule): void {
    if (!this.can('assign') || !this.loaded || this.pending || !isScopeRule(rule)) return;
    this.selectedRule.set(rule); this.saveError = null; this.confirmationOpen = false;
  }

  save(): void {
    if (!this.can('assign') || !this.loaded || !this.dirty || this.pending || this.confirmationOpen
      || this.activeTarget === null || this.activeTarget !== this.roleId || !safeNumericRecordId(this.activeTarget)) return;
    this.confirmationOpen = true; this.changeDetector.markForCheck();
  }

  closeConfirmation(): void {
    if (!this.pending) { this.confirmationOpen = false; this.changeDetector.markForCheck(); }
  }

  confirmSave(): void {
    const target = this.activeTarget;
    const rule = this.selectedRule();
    if (!this.confirmationOpen || !this.can('assign') || !this.loaded || !this.dirty || this.pending
      || target === null || target !== this.roleId || !safeNumericRecordId(target) || !isScopeRule(rule)) return;
    const epoch = this.viewEpoch;
    this.confirmationOpen = false; this.setPending(true); this.saveError = null;
    this.writes.add(this.api.saveRoleRule(target, rule).subscribe({
      next: () => {
        this.setPending(false);
        if (!this.currentView(epoch, target)) { this.loadDeferredTarget(); return; }
        this.originalRule = rule; this.selectedRule.set(rule); this.loaded = true;
        this.toast.success(this.i18n.translate('iam.data_scope.saved')); this.reload(true);
      },
      error: error => {
        this.setPending(false);
        if (this.currentView(epoch, target)) this.saveError = error;
        else this.loadDeferredTarget();
        this.changeDetector.markForCheck();
      }
    }));
  }

  reload(afterSave = false): void {
    const target = this.activeTarget;
    if (!this.can('view') || this.pending || this.dirty || target === null || !safeNumericRecordId(target)) return;
    const epoch = this.viewEpoch;
    this.readRequest?.unsubscribe(); this.loading = true; this.loaded = false; this.loadError = null; this.confirmationOpen = false;
    this.readRequest = this.api.roleRule(target).subscribe({
      next: snapshot => {
        if (!this.currentView(epoch, target)) return;
        this.loading = false;
        if (snapshot.roleId !== target || !isScopeRule(snapshot.rule)) {
          this.loadError = this.unavailable(); this.loaded = false; this.changeDetector.markForCheck(); return;
        }
        this.originalRule = snapshot.rule; this.selectedRule.set(snapshot.rule); this.loaded = true; this.savedRefreshFailed = false;
        this.changeDetector.markForCheck();
      },
      error: error => {
        if (this.currentView(epoch, target)) {
          this.loading = false; this.loaded = false; this.loadError = error;
          this.savedRefreshFailed = afterSave || this.savedRefreshFailed; this.changeDetector.markForCheck();
        }
      }
    });
  }

  originalRuleKey(): string { return this.ruleKey(this.originalRule ?? 'ALL'); }
  selectedRuleKey(): string { return this.ruleKey(this.selectedRule()); }
  cancelEdits(): void { this.discard.request(() => this.restoreDraft()); }
  canLeave(): boolean | Observable<boolean> { return this.discard.canLeave(); }
  hasUnsavedWork(): boolean { return this.pending || this.dirty; }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedWork()) { event.preventDefault(); event.returnValue = ''; }
  }

  private activateTarget(target: number): void {
    this.viewEpoch++; this.readRequest?.unsubscribe(); this.discard.cancel(); this.resetProtectedState(); this.activeTarget = target;
    if (this.pending) { this.deferredTarget = target; this.changeDetector.markForCheck(); return; }
    this.deferredTarget = null; this.loadActiveTarget();
  }
  private loadActiveTarget(): void {
    const target = this.activeTarget;
    if (target === null) return;
    if (!this.can('view') || !safeNumericRecordId(target)) {
      if (this.can('view')) this.loadError = this.unavailable();
      this.changeDetector.markForCheck(); return;
    }
    this.reload();
  }
  private clearRevokedView(): void {
    this.viewEpoch++; this.deferredTarget = null; this.readRequest?.unsubscribe(); this.readRequest = undefined; this.discard.cancel(); this.resetProtectedState();
    this.changeDetector.markForCheck();
  }
  private resetProtectedState(): void {
    this.originalRule = null; this.selectedRule.set('ALL'); this.loaded = false; this.loading = false;
    this.loadError = null; this.saveError = null; this.savedRefreshFailed = false; this.confirmationOpen = false;
  }
  private restoreDraft(): void {
    if (this.originalRule !== null) this.selectedRule.set(this.originalRule);
    this.confirmationOpen = false; this.saveError = null; this.changeDetector.markForCheck();
  }
  private currentView(epoch: number, target: number): boolean {
    return this.can('view') && epoch === this.viewEpoch && target === this.activeTarget && target === this.roleId;
  }
  private loadDeferredTarget(): void {
    if (this.deferredTarget === null || this.deferredTarget !== this.activeTarget || this.deferredTarget !== this.roleId) return;
    this.deferredTarget = null; this.loadActiveTarget();
  }
  private setPending(value: boolean): void {
    if (this.pending === value) return;
    this.pending = value; this.busyChange.emit(value); this.changeDetector.markForCheck();
  }
  private ruleKey(rule: ScopeRule): string { return `iam.data_scope.rule_${rule.toLowerCase()}`; }
  private unavailable(): ProblemDetail {
    return { status: 400, code: 'ORG_UNIT_UNSAFE_ID', title: this.i18n.translate('iam.org_units.unavailable'), detail: this.i18n.translate('iam.org_units.readonly_id') };
  }
}

function isScopeRule(rule: unknown): rule is ScopeRule {
  return rule === 'ALL' || rule === 'SUBTREE' || rule === 'UNITS' || rule === 'SELF';
}
