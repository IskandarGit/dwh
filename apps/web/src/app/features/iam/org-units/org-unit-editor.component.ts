import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { safeNumericRecordId } from '../../../core/services/search-target';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal.component';
import { orgUnitKindKeys, parentCandidates } from './org-unit-tree';
import { OrgUnit, OrgUnitCreate, OrgUnitPatch } from './org-units.models';
import { ProblemDetail } from '../../../core/models/common.models';
export type OrgUnitSubmission = { mode: 'create'; body: OrgUnitCreate } | { mode: 'edit'; id: number; patch: OrgUnitPatch };
@Component({ selector: 'app-org-unit-editor', standalone: true, imports: [FormsModule, TranslatePipe, UiButtonComponent, UiModalComponent], templateUrl: './org-unit-editor.component.html', styleUrl: './org-unit-editor.component.css' })
export class OrgUnitEditorComponent implements OnInit {
  @Input({ required: true }) initial!: OrgUnit | OrgUnitCreate;
  @Input() units: OrgUnit[] = [];
  @Input() pending = false;
  @Input() error: ProblemDetail | null = null;
  @Output() save = new EventEmitter<OrgUnitSubmission>();
  @Output() cancel = new EventEmitter<void>();
  draft: OrgUnitCreate & { state: 'A' | 'P' } = { parentId: null, code: '', name: '', kind: 'company', orderNo: 0, state: 'A' };
  private static nextId = 0;
  readonly formId = `org-unit-form-${OrgUnitEditorComponent.nextId++}`;
  readonly kindKeys = orgUnitKindKeys;
  readonly kinds = Object.keys(orgUnitKindKeys);
  original!: OrgUnit | OrgUnitCreate;
  attempted = false;
  ngOnInit(): void {
    this.original = { ...this.initial };
    this.draft = { ...this.original, state: 'state' in this.original ? this.original.state : 'A' };
  }
  get editing(): boolean { return 'id' in this.original; }
  get dirty(): boolean {
    return (this.draft.name || '').trim() !== (this.original.name || '').trim() || this.draft.kind !== this.original.kind || this.draft.orderNo !== this.original.orderNo
      || this.draft.parentId !== this.original.parentId || (!this.editing && (this.draft.code || '').trim() !== (this.original.code || '').trim())
      || ('state' in this.original && this.draft.state !== this.original.state);
  }
  get parents(): OrgUnit[] { return this.editing ? parentCandidates(this.units, this.original as OrgUnit) : []; }
  get valid(): boolean {
    return !!this.draft.name.trim() && !!this.draft.code.trim() && !!this.draft.kind.trim()
      && Number.isInteger(this.draft.orderNo) && this.draft.orderNo >= -2147483648 && this.draft.orderNo <= 2147483647
      && (this.draft.parentId === this.original.parentId || this.parents.some(unit => unit.id === this.draft.parentId));
  }
  fieldError(field: string): string | null {
    return this.error?.invalid_params?.find(item => item.name === field)?.reason
      ?? this.error?.errors?.find(item => item.field === field)?.message ?? null;
  }
  impactOpen = false;
  submit(): void {
    if (this.pending || this.impactOpen) return;
    this.attempted = true;
    if (!this.valid || !this.dirty) return;
    if ('state' in this.original && (this.draft.state !== this.original.state || this.draft.parentId !== this.original.parentId)) {
      this.impactOpen = true; return;
    }
    this.emitSave();
  }
  confirmImpact(): void {
    if (!this.impactOpen || this.pending) return;
    this.impactOpen = false;
    if (this.valid && this.dirty) this.emitSave();
  }
  private emitSave(): void {
    if ('id' in this.original) {
      if (!safeNumericRecordId(this.original.id)) return;
      const patch: OrgUnitPatch = {};
      if (this.draft.name.trim() !== this.original.name) patch.name = this.draft.name.trim();
      if (this.draft.parentId !== this.original.parentId) patch.parentId = this.draft.parentId;
      if (this.draft.kind !== this.original.kind) patch.kind = this.draft.kind;
      if (this.draft.state !== this.original.state) patch.state = this.draft.state;
      if (this.draft.orderNo !== this.original.orderNo) patch.orderNo = this.draft.orderNo;
      if (Object.keys(patch).length) this.save.emit({ mode: 'edit', id: this.original.id, patch });
    } else {
      this.save.emit({ mode: 'create', body: { parentId: this.original.parentId, code: this.draft.code.trim(), name: this.draft.name.trim(), kind: this.draft.kind, orderNo: this.draft.orderNo } });
    }
  }
}
