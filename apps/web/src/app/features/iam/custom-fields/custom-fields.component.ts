import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { PermissionService } from '../../../core/services/permission.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { TranslatePipe, I18nService } from '../../../core/services/i18n.service';
import { CustomField, CustomFieldFormData } from './custom-fields.models';
import { CustomFieldsToolbarComponent } from './components/custom-fields-toolbar.component';
import { CustomFieldsTableComponent } from './components/custom-fields-table.component';
import { CustomFieldsModalsComponent } from './components/custom-fields-modals.component';
import { CustomFieldsFormService } from './services/custom-fields-form.service';

@Component({
  selector: 'app-custom-fields',
  standalone: true,
  imports: [
    CommonModule,
    UiButtonComponent,
    TranslatePipe,
    CustomFieldsToolbarComponent,
    CustomFieldsTableComponent,
    CustomFieldsModalsComponent
  ],
  template: `
    <div class="custom-fields-page">
      <!-- Header -->
      <div class="view-header">
        <div class="header-left">
          <div class="title-with-badge">
            <h1 class="view-title">{{ 'iam.dinamicheskie_atributy' | t }}</h1>
            <span class="count-badge" [title]="'iam.vsego_poley' | t">{{ filteredFields().length }}</span>
          </div>
          <span class="view-subtitle">{{ 'iam.sohranennye_znacheniya_etogo_atributa_mogut_stat' | t }}</span>
        </div>
        <div class="header-actions">
          <button
            type="button"
            class="icon-refresh-btn"
            [class.spinning]="isLoading"
            [disabled]="isLoading"
            (click)="loadFields()"
            [attr.aria-label]="'iam.obnovit_polya' | t"
            [title]="'common.refresh' | t"
          >
            <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
          </button>
          <ui-button
            *ngIf="canCreate()"
            variant="primary"
            icon="add"
            (onClick)="openCreateModal()"
          >
            {{ 'iam.dobavit_pole' | t }}
          </ui-button>
        </div>
      </div>

      <!-- Toolbar: Filter Tabs and Search -->
      <app-custom-fields-toolbar
        [availableEntities]="availableEntities()"
        [selectedEntity]="selectedEntity()"
        [searchQuery]="searchQuery()"
        [entityCounts]="entityCounts()"
        (entityChange)="filterByEntity($event)"
        (searchQueryChange)="onSearchQueryChange($event)"
        (clearSearch)="clearSearch()"
      ></app-custom-fields-toolbar>

      <!-- Table / Grid -->
      <app-custom-fields-table
        [fields]="filteredFields()"
        [isLoading]="isLoading"
        [canManage]="canCreate()"
        [canEdit]="canEdit()"
        [canDelete]="canDelete()"
        [searchQuery]="searchQuery()"
        [sortColumn]="sortColumn"
        [sortDirection]="sortDirection"
        (copyCode)="copyCode($event)"
        (editField)="openEditModal($event)"
        (deleteField)="requestDeleteField($event)"
        (clearSearch)="clearSearch()"
        (createField)="openCreateModal()"
        (sortChange)="onSortChange($event)"
      ></app-custom-fields-table>

      <!-- Modals (Create/Edit & Delete) -->
      <app-custom-fields-modals
        [showModal]="showModal"
        [editingField]="editingField"
        [fieldToDelete]="fieldToDelete"
        [formData]="formData"
        [formError]="formError"
        [saving]="saving"
        [isDeleting]="isDeleting"
        (closeModal)="closeModal()"
        (saveField)="saveField()"
        (cancelDelete)="fieldToDelete = null"
        (confirmDelete)="confirmDeleteField()"
        (codeInput)="onCodeInput($event)"
      ></app-custom-fields-modals>
    </div>
  `,
  styleUrl: './custom-fields.component.css'
})
export class CustomFieldsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly permService = inject(PermissionService);
  private readonly uiI18n = inject(I18nService);
  private readonly formService = inject(CustomFieldsFormService);

  // --- Reactive state via signals ---
  readonly fields = signal<CustomField[]>([]);
  readonly selectedEntity = signal('ALL');
  readonly searchQuery = signal('');
  sortColumn = 'orderNo';
  sortDirection: 'asc' | 'desc' = 'asc';

  readonly availableEntities = computed(() => {
    const base = ['ALL', 'USER', 'PROJECT', 'TASK', 'NOTE'];
    const dynamic = this.fields()
      .map(f => f.entityType)
      .filter(t => t && !base.includes(t));
    return [...base, ...Array.from(new Set(dynamic))];
  });

  readonly entityCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = { ALL: this.fields().length };
    for (const f of this.fields()) {
      if (f.entityType) {
        counts[f.entityType] = (counts[f.entityType] || 0) + 1;
      }
    }
    return counts;
  });

  readonly filteredFields = computed(() => {
    const q = (this.searchQuery()).trim().toLowerCase();
    const entity = this.selectedEntity();
    let result = [...this.fields()];

    if (entity !== 'ALL') {
      result = result.filter(f => f.entityType === entity);
    }
    if (q) {
      result = result.filter(f =>
        (f.code && f.code.toLowerCase().includes(q)) ||
        (f.name && f.name.toLowerCase().includes(q)) ||
        (f.defaultValue && f.defaultValue.toLowerCase().includes(q)) ||
        (f.fieldType && f.fieldType.toLowerCase().includes(q))
      );
    }
    result.sort((a, b) => {
      const orderDiff = (a.orderNo || 0) - (b.orderNo || 0);
      if (orderDiff !== 0) return orderDiff;
      return (a.name || '').localeCompare(b.name || '');
    });
    return result;
  });

  // --- Non-signal UI state ---
  isLoading = false;
  showModal = false;
  editingField: CustomField | null = null;
  saving = false;
  isDeleting = false;
  formError = '';
  fieldToDelete: CustomField | null = null;
  formData: CustomFieldFormData = this.formService.createInitialFormData('USER', 0);

  ngOnInit() {
    this.loadFields();
  }

  // --- Granular RBAC ---
  canCreate(): boolean {
    return this.permService.hasPermission('md.custom_fields', 'create') ||
           this.permService.hasPermission('system.custom_fields', 'create');
  }

  canEdit(): boolean {
    return this.permService.hasPermission('md.custom_fields', 'update') ||
           this.permService.hasPermission('system.custom_fields', 'update') ||
           this.canCreate();
  }

  canDelete(): boolean {
    return this.permService.hasPermission('md.custom_fields', 'delete') ||
           this.permService.hasPermission('system.custom_fields', 'delete') ||
           this.canCreate();
  }

  /** @deprecated Use canCreate/canEdit/canDelete for granular RBAC; kept for toolbar backward compat */
  canManage(): boolean {
    return this.canCreate() || this.canEdit() || this.canDelete();
  }

  getEntityCount(ent: string): number {
    if (ent === 'ALL') return this.fields().length;
    return this.fields().filter(f => f.entityType === ent).length;
  }

  loadFields() {
    this.isLoading = true;
    this.api.get<CustomField[]>('/custom-fields').subscribe({
      next: data => {
        this.fields.set(data || []);
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.toast.error(this.uiI18n.translate('iam.oshibka_zagruzki_dinamicheskih_poley'));
      }
    });
  }

  filterByEntity(entity: string) {
    this.selectedEntity.set(entity);
  }

  onSearchQueryChange(query: string) {
    this.searchQuery.set(query);
  }

  clearSearch() {
    this.searchQuery.set('');
  }

  onSortChange(column: string) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
  }

  copyCode(code: string) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        this.toast.success(this.uiI18n.translate('iam.kod_skopirovan'));
      }).catch(() => {});
    }
  }

  onCodeInput(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input) return;
    this.formData.code = this.formService.sanitizeCode(input.value);
  }

  openCreateModal() {
    this.editingField = null;
    this.formData = this.formService.createInitialFormData(this.selectedEntity(), this.fields().length);
    this.formError = '';
    this.showModal = true;
  }

  openEditModal(f: CustomField) {
    this.editingField = f;
    this.formData = this.formService.fromCustomField(f);
    this.formError = '';
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
    this.editingField = null;
    this.formError = '';
  }

  saveField() {
    const validation = this.formService.validateForm(this.formData, !!this.editingField);
    if (!validation.isValid) {
      this.formError = validation.errorMessage || '';
      this.toast.error(this.formError);
      return;
    }

    this.formError = '';
    this.saving = true;
    const options = this.formService.parseOptionsText(this.formData.optionsText);

    if (this.editingField) {
      this.api.patch(`/custom-fields/${this.editingField.id}`, {
        name: this.formData.name,
        isRequired: this.formData.isRequired,
        defaultValue: this.formData.defaultValue,
        options,
        orderNo: Number(this.formData.orderNo) || 0
      }).subscribe({
        next: () => {
          this.saving = false;
          this.toast.success(this.uiI18n.translate('iam.pole_uspeshno_obnovleno'));
          this.closeModal();
          this.loadFields();
        },
        error: () => {
          this.saving = false;
          this.toast.error(this.uiI18n.translate('iam.oshibka_sohraneniya_polya'));
        }
      });
    } else {
      this.api.post('/custom-fields', {
        entityType: this.formData.entityType,
        code: this.formData.code,
        name: this.formData.name,
        fieldType: this.formData.fieldType,
        isRequired: this.formData.isRequired,
        defaultValue: this.formData.defaultValue,
        orderNo: Number(this.formData.orderNo) || 0,
        options
      }).subscribe({
        next: () => {
          this.saving = false;
          this.toast.success(this.uiI18n.translate('iam.pole_uspeshno_sozdano'));
          this.closeModal();
          this.loadFields();
        },
        error: () => {
          this.saving = false;
          this.toast.error(this.uiI18n.translate('iam.oshibka_sozdaniya_polya'));
        }
      });
    }
  }

  requestDeleteField(field: CustomField) {
    this.fieldToDelete = field;
  }

  confirmDeleteField() {
    if (!this.fieldToDelete) return;
    const field = this.fieldToDelete;
    this.isDeleting = true;
    this.api.delete(`/custom-fields/${field.id}`).subscribe({
      next: () => {
        this.isDeleting = false;
        this.fieldToDelete = null;
        this.toast.success(this.uiI18n.translate('iam.pole_udaleno'));
        this.loadFields();
      },
      error: () => {
        this.isDeleting = false;
        this.toast.error(this.uiI18n.translate('iam.oshibka_udaleniya_polya'));
      }
    });
  }
}
