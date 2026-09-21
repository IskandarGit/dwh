import { Component, Input, OnInit, OnChanges, SimpleChanges, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { TranslatePipe, I18nService } from '../../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../../shared/ui/ui-button.component';
import { FormTreeItem } from '../../../../core/models/rbac.models';
import { MODULE_ICON_MAP, MODULE_NAME_KEY_MAP } from '../../roles/roles.models';
import { EffectivePermissionItem, PersonalGrant, EffectivePermissionsResponse, PersonalPermissionsResponse } from '../users.models';

export interface GroupedPermissionAction {
  action: string;
  source: 'role' | 'personal';
}

export interface GroupedPermissionForm {
  formCode: string;
  formName: string;
  actions: GroupedPermissionAction[];
}

export interface GroupedPermissionModule {
  moduleCode: string;
  moduleName: string;
  icon: string;
  forms: GroupedPermissionForm[];
}

@Component({
  selector: 'app-user-effective-permissions-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, UiButtonComponent],
  template: `
    <div class="effective-perms-container">
      <!-- Loading State -->
      <div *ngIf="isLoading()" class="perms-loading" role="status">
        <span class="material-symbols-outlined spin-icon" aria-hidden="true">sync</span>
        <span>{{ 'common.loading' | t }}</span>
      </div>

      <!-- Error State -->
      <div *ngIf="!isLoading() && loadError()" class="perms-error" role="alert">
        <span class="material-symbols-outlined error-icon" aria-hidden="true">error</span>
        <p>{{ 'common.error' | t }}</p>
        <ui-button variant="secondary" size="sm" icon="refresh" (onClick)="loadAll()">
          {{ 'common.retry' | t }}
        </ui-button>
      </div>

      <!-- Content -->
      <div *ngIf="!isLoading() && !loadError()" class="perms-content">
        <!-- Overview Stats & Roles -->
        <div class="overview-section">
          <div class="user-roles-banner" *ngIf="userRoleNames.length > 0">
            <span class="banner-lbl">{{ 'iam.roli' | t }}:</span>
            <div class="roles-chips">
              <span *ngFor="let roleName of userRoleNames" class="role-chip">
                <span class="material-symbols-outlined" aria-hidden="true">shield</span>
                {{ roleName }}
              </span>
            </div>
          </div>

          <div class="stats-grid">
            <div class="stat-card">
              <span class="stat-lbl">{{ 'iam.vsego_razresheniy' | t }}</span>
              <span class="stat-val primary">{{ effectiveItems().length }}</span>
            </div>
            <div class="stat-card">
              <span class="stat-lbl">{{ 'iam.iz_roley' | t }}</span>
              <span class="stat-val role">{{ roleCount() }}</span>
            </div>
            <div class="stat-card">
              <span class="stat-lbl">{{ 'iam.personalnyh' | t }}</span>
              <span class="stat-val personal">{{ personalCount() }}</span>
            </div>
          </div>
        </div>

        <!-- Add Personal Grant Section (when canAssign) -->
        <div *ngIf="canAssign" class="add-grant-card">
          <div class="add-grant-header">
            <span class="material-symbols-outlined" aria-hidden="true">add_moderator</span>
            <h4>{{ 'iam.dobavit_isklyuchenie' | t }}</h4>
          </div>

          <div class="add-grant-form">
            <div class="form-group">
              <label for="select-grant-form" class="sr-only">{{ 'iam.forma' | t }}</label>
              <select
                id="select-grant-form"
                class="grant-select"
                [ngModel]="selectedFormCode()"
                (ngModelChange)="onFormSelect($event)"
              >
                <option value="">{{ 'iam.vyberite_formu' | t }}</option>
                <option *ngFor="let f of uniqueForms()" [value]="f.formCode">
                  {{ f.formName }} ({{ f.formCode }})
                </option>
              </select>
            </div>

            <div class="form-group">
              <label for="select-grant-action" class="sr-only">{{ 'iam.deystvie' | t }}</label>
              <select
                id="select-grant-action"
                class="grant-select"
                [ngModel]="selectedAction()"
                (ngModelChange)="selectedAction.set($event)"
                [disabled]="!selectedFormCode()"
              >
                <option value="">{{ 'iam.vyberite_deystvie' | t }}</option>
                <option *ngFor="let act of availableActionsForSelectedForm()" [value]="act.action">
                  {{ act.actionName }} ({{ act.action }})
                </option>
              </select>
            </div>

            <ui-button
              variant="secondary"
              size="sm"
              icon="add"
              [disabled]="!selectedFormCode() || !selectedAction()"
              (onClick)="addPersonalGrant()"
            >
              {{ 'common.add' | t }}
            </ui-button>
          </div>

          <div *ngIf="hasUnsavedChanges()" class="unsaved-banner">
            <span class="material-symbols-outlined warning-icon" aria-hidden="true">warning</span>
            <span>{{ 'settings.search.unsaved' | t }}</span>
            <ui-button
              variant="primary"
              size="sm"
              icon="save"
              [loading]="isSaving()"
              (onClick)="savePersonalGrants()"
            >
              {{ 'iam.sohranit_prava' | t }}
            </ui-button>
          </div>
        </div>

        <!-- Filter & Search Toolbar -->
        <div class="perms-toolbar">
          <div class="search-input-wrap">
            <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
            <input
              type="search"
              class="search-input"
              [placeholder]="'iam.poisk_po_pravam' | t"
              [ngModel]="searchQuery()"
              (ngModelChange)="searchQuery.set($event)"
              [attr.aria-label]="'iam.poisk_po_pravam' | t"
            />
          </div>

          <div class="source-pills" role="group" [attr.aria-label]="'iam.istochnik_prava' | t">
            <button
              type="button"
              class="pill-btn"
              [class.active]="sourceFilter() === 'all'"
              (click)="sourceFilter.set('all')"
            >
              {{ 'iam.vse_istochniki' | t }} ({{ effectiveItems().length }})
            </button>
            <button
              type="button"
              class="pill-btn"
              [class.active]="sourceFilter() === 'role'"
              (click)="sourceFilter.set('role')"
            >
              {{ 'iam.istochnik_rol' | t }} ({{ roleCount() }})
            </button>
            <button
              type="button"
              class="pill-btn"
              [class.active]="sourceFilter() === 'personal'"
              (click)="sourceFilter.set('personal')"
            >
              {{ 'iam.istochnik_personal' | t }} ({{ personalCount() }})
            </button>
          </div>
        </div>

        <!-- Empty State -->
        <div *ngIf="groupedModules().length === 0" class="perms-empty">
          <span class="material-symbols-outlined empty-icon" aria-hidden="true">vpn_key_off</span>
          <p>{{ 'iam.net_effektivnyh_prav' | t }}</p>
        </div>

        <!-- Grouped Permissions Modules -->
        <div *ngIf="groupedModules().length > 0" class="modules-accordion">
          <div *ngFor="let mod of groupedModules()" class="module-group-card">
            <div class="module-group-header">
              <span class="material-symbols-outlined mod-icon" aria-hidden="true">{{ mod.icon }}</span>
              <span class="mod-name">{{ mod.moduleName }}</span>
              <span class="mod-count font-mono">{{ mod.forms.length }}</span>
            </div>

            <div class="module-forms-list">
              <div *ngFor="let form of mod.forms" class="form-row">
                <div class="form-info">
                  <span class="form-name">{{ form.formName }}</span>
                  <span class="form-code font-mono text-xs">{{ form.formCode }}</span>
                </div>

                <div class="form-actions-wrap">
                  <div *ngFor="let act of form.actions" class="action-tag" [class.personal]="act.source === 'personal'">
                    <span class="action-name font-mono">{{ act.action }}</span>
                    <span class="source-badge" [class.role]="act.source === 'role'" [class.personal]="act.source === 'personal'">
                      {{ (act.source === 'role' ? 'iam.istochnik_rol' : 'iam.istochnik_personal') | t }}
                    </span>
                    <button
                      *ngIf="canAssign && act.source === 'personal'"
                      type="button"
                      class="remove-grant-btn"
                      [title]="'iam.udalit_isklyuchenie' | t"
                      [attr.aria-label]="'iam.udalit_isklyuchenie' | t"
                      (click)="removePersonalGrant(form.formCode, act.action)"
                    >
                      <span class="material-symbols-outlined" style="font-size: 14px;">close</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .effective-perms-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 4px 0;
    }

    .perms-loading, .perms-error, .perms-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px;
      gap: 12px;
      color: var(--text-muted);
      text-align: center;
    }

    .spin-icon {
      font-size: 28px;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .error-icon, .empty-icon {
      font-size: 36px;
      color: var(--text-muted);
    }

    .overview-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .user-roles-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 8px 12px;
      background: var(--bg-hover, rgba(0, 0, 0, 0.03));
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm, 6px);
    }
    .banner-lbl {
      font-weight: 600;
      font-size: 0.82rem;
      color: var(--text-secondary, #64748b);
    }
    .roles-chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .role-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      background: rgba(59, 130, 246, 0.1);
      color: #2563eb;
      border-radius: 9999px;
      font-size: 0.78rem;
      font-weight: 500;
    }
    .role-chip .material-symbols-outlined { font-size: 14px; }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .stat-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm, 6px);
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .stat-lbl {
      font-size: 0.75rem;
      color: var(--text-secondary, #64748b);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .stat-val {
      font-size: 1.35rem;
      font-weight: 700;
      font-family: var(--font-mono, monospace);
    }
    .stat-val.primary { color: var(--primary, #0284c7); }
    .stat-val.role { color: #3b82f6; }
    .stat-val.personal { color: #f59e0b; }

    .add-grant-card {
      background: var(--bg-surface);
      border: 1px dashed var(--primary, #0284c7);
      border-radius: var(--radius-md, 8px);
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .add-grant-header {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--primary, #0284c7);
    }
    .add-grant-header h4 {
      margin: 0;
      font-size: 0.88rem;
      font-weight: 600;
    }
    .add-grant-form {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .grant-select {
      height: 34px;
      padding: 0 10px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      font-size: 0.82rem;
      min-width: 180px;
    }
    .grant-select:focus {
      outline: none;
      border-color: var(--primary);
    }

    .unsaved-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.3);
      border-radius: var(--radius-sm, 6px);
      font-size: 0.82rem;
      color: #b45309;
    }
    .warning-icon { font-size: 18px; color: #f59e0b; }

    .perms-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .search-input-wrap {
      position: relative;
      flex: 1;
      min-width: 200px;
    }
    .search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 18px;
      color: var(--text-muted);
      pointer-events: none;
    }
    .search-input {
      width: 100%;
      height: 34px;
      padding: 0 10px 0 34px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      font-size: 0.82rem;
    }
    .search-input:focus {
      outline: none;
      border-color: var(--primary);
    }

    .source-pills {
      display: flex;
      gap: 4px;
      background: var(--bg-hover, rgba(0, 0, 0, 0.04));
      padding: 3px;
      border-radius: var(--radius-sm, 6px);
    }
    .pill-btn {
      padding: 4px 10px;
      border: none;
      border-radius: 4px;
      background: transparent;
      font-size: 0.78rem;
      font-weight: 500;
      color: var(--text-secondary, #64748b);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .pill-btn:hover { color: var(--text-primary); }
    .pill-btn.active {
      background: var(--bg-surface);
      color: var(--primary, #0284c7);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    }

    .modules-accordion {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .module-group-card {
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md, 8px);
      overflow: hidden;
      background: var(--bg-surface);
    }
    .module-group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      background: var(--bg-hover, rgba(0, 0, 0, 0.02));
      border-bottom: 1px solid var(--border-color);
      font-weight: 600;
      font-size: 0.82rem;
    }
    .mod-icon {
      font-size: 18px;
      color: var(--primary);
    }
    .mod-name { flex: 1; }
    .mod-count {
      font-size: 0.75rem;
      padding: 2px 6px;
      background: rgba(0, 0, 0, 0.06);
      border-radius: 10px;
      color: var(--text-muted);
    }

    .module-forms-list {
      display: flex;
      flex-direction: column;
    }
    .form-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
    }
    .form-row:last-child { border-bottom: none; }
    .form-info {
      display: flex;
      flex-direction: column;
      min-width: 140px;
    }
    .form-name {
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--text-primary);
    }
    .form-code {
      color: var(--text-muted);
    }

    .form-actions-wrap {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }
    .action-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      background: var(--bg-hover, rgba(0, 0, 0, 0.04));
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm, 6px);
      font-size: 0.78rem;
    }
    .action-tag.personal {
      border-color: rgba(245, 158, 11, 0.4);
      background: rgba(245, 158, 11, 0.05);
    }
    .source-badge {
      font-size: 0.68rem;
      padding: 1px 4px;
      border-radius: 3px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .source-badge.role {
      background: rgba(59, 130, 246, 0.15);
      color: #1d4ed8;
    }
    .source-badge.personal {
      background: rgba(245, 158, 11, 0.2);
      color: #b45309;
    }

    .remove-grant-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      color: var(--danger, #ef4444);
      cursor: pointer;
      padding: 1px;
      border-radius: 2px;
      margin-left: 2px;
    }
    .remove-grant-btn:hover {
      background: rgba(239, 68, 68, 0.1);
    }
  `]
})
export class UserEffectivePermissionsPanelComponent implements OnInit, OnChanges {
  @Input({ required: true }) userId!: number;
  @Input() canAssign: boolean = false;
  @Input() userRoleNames: string[] = [];

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly uiI18n = inject(I18nService);

  readonly isLoading = signal<boolean>(false);
  readonly isSaving = signal<boolean>(false);
  readonly loadError = signal<boolean>(false);
  readonly hasUnsavedChanges = signal<boolean>(false);

  readonly effectiveItems = signal<EffectivePermissionItem[]>([]);
  readonly personalGrants = signal<PersonalGrant[]>([]);
  readonly formCatalog = signal<FormTreeItem[]>([]);

  readonly searchQuery = signal<string>('');
  readonly sourceFilter = signal<'all' | 'role' | 'personal'>('all');

  readonly selectedFormCode = signal<string>('');
  readonly selectedAction = signal<string>('');

  readonly roleCount = computed(() => this.effectiveItems().filter(i => i.source === 'role').length);
  readonly personalCount = computed(() => this.effectiveItems().filter(i => i.source === 'personal').length);

  readonly uniqueForms = computed(() => {
    const map = new Map<string, { formCode: string; formName: string }>();
    for (const f of this.formCatalog()) {
      if (!map.has(f.formCode)) {
        map.set(f.formCode, { formCode: f.formCode, formName: f.formName });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.formName.localeCompare(b.formName));
  });

  readonly availableActionsForSelectedForm = computed(() => {
    const code = this.selectedFormCode();
    if (!code) return [];
    return this.formCatalog().filter(f => f.formCode === code);
  });

  readonly filteredItems = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const sf = this.sourceFilter();
    return this.effectiveItems().filter(item => {
      if (sf !== 'all' && item.source !== sf) return false;
      if (!q) return true;
      return item.form.toLowerCase().includes(q) || item.action.toLowerCase().includes(q);
    });
  });

  readonly groupedModules = computed<GroupedPermissionModule[]>(() => {
    const items = this.filteredItems();
    const catalog = this.formCatalog();

    // Map formCode to metadata
    const metaMap = new Map<string, { formName: string; module: string }>();
    for (const cat of catalog) {
      if (!metaMap.has(cat.formCode)) {
        metaMap.set(cat.formCode, { formName: cat.formName, module: cat.module });
      }
    }

    const modMap = new Map<string, Map<string, GroupedPermissionAction[]>>();

    for (const item of items) {
      const meta = metaMap.get(item.form) || { formName: item.form, module: 'system' };
      const modCode = meta.module;
      if (!modMap.has(modCode)) {
        modMap.set(modCode, new Map());
      }
      const formsMap = modMap.get(modCode)!;
      if (!formsMap.has(item.form)) {
        formsMap.set(item.form, []);
      }
      formsMap.get(item.form)!.push({ action: item.action, source: item.source });
    }

    const result: GroupedPermissionModule[] = [];
    for (const [modCode, formsMap] of modMap.entries()) {
      const forms: GroupedPermissionForm[] = [];
      for (const [formCode, actions] of formsMap.entries()) {
        const meta = metaMap.get(formCode);
        forms.push({
          formCode,
          formName: meta ? meta.formName : formCode,
          actions
        });
      }
      forms.sort((a, b) => a.formName.localeCompare(b.formName));

      const nameKey = MODULE_NAME_KEY_MAP[modCode];
      const moduleName = nameKey ? this.uiI18n.translate(nameKey) : modCode.toUpperCase();
      const icon = MODULE_ICON_MAP[modCode] || 'widgets';

      result.push({ moduleCode: modCode, moduleName, icon, forms });
    }

    result.sort((a, b) => a.moduleName.localeCompare(b.moduleName));
    return result;
  });

  ngOnInit(): void {
    this.loadAll();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['userId'] && !changes['userId'].isFirstChange()) {
      this.hasUnsavedChanges.set(false);
      this.loadAll();
    }
  }

  loadAll(): void {
    if (!this.userId) return;
    this.isLoading.set(true);
    this.loadError.set(false);

    // 1. Effective permissions
    this.api.get<EffectivePermissionsResponse>(`/iam/users/${this.userId}/effective-permissions`).subscribe({
      next: (res) => {
        this.effectiveItems.set(res?.items || []);
        this.isLoading.set(false);
      },
      error: () => {
        this.loadError.set(true);
        this.isLoading.set(false);
      }
    });

    // 2. Personal grants
    this.api.get<PersonalPermissionsResponse>(`/iam/users/${this.userId}/permissions`).subscribe({
      next: (res) => {
        this.personalGrants.set(res?.grants || []);
      },
      error: () => {}
    });

    // 3. Form catalog (if empty)
    if (this.formCatalog().length === 0) {
      this.api.get<FormTreeItem[]>('/iam/roles/forms').subscribe({
        next: (catalog) => {
          if (Array.isArray(catalog)) {
            this.formCatalog.set(catalog);
          }
        },
        error: () => {}
      });
    }
  }

  onFormSelect(formCode: string): void {
    this.selectedFormCode.set(formCode);
    this.selectedAction.set('');
  }

  addPersonalGrant(): void {
    const form = this.selectedFormCode();
    const action = this.selectedAction();
    if (!form || !action) return;

    const currentGrants = [...this.personalGrants()];
    const exists = currentGrants.some(g => g.form === form && g.action === action);
    if (exists) return;

    const updated = [...currentGrants, { form, action }];
    this.personalGrants.set(updated);
    this.hasUnsavedChanges.set(true);

    // Also optimistically add to effective items if not present
    const currentEffective = [...this.effectiveItems()];
    const effectiveIndex = currentEffective.findIndex(i => i.form === form && i.action === action);
    if (effectiveIndex < 0) {
      this.effectiveItems.set([...currentEffective, { form, action, source: 'personal' }]);
    }

    this.selectedAction.set('');
  }

  removePersonalGrant(form: string, action: string): void {
    const updatedGrants = this.personalGrants().filter(g => !(g.form === form && g.action === action));
    this.personalGrants.set(updatedGrants);
    this.hasUnsavedChanges.set(true);

    // Update effective items
    const updatedEffective = this.effectiveItems().filter(i => !(i.form === form && i.action === action && i.source === 'personal'));
    this.effectiveItems.set(updatedEffective);
  }

  savePersonalGrants(): void {
    this.isSaving.set(true);
    this.api.put<void>(`/iam/users/${this.userId}/permissions`, { grants: this.personalGrants() }).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.hasUnsavedChanges.set(false);
        this.toast.success(this.uiI18n.translate('iam.prava_uspeshno_sohraneny'));
        this.loadAll();
      },
      error: () => {
        this.isSaving.set(false);
        this.toast.error(this.uiI18n.translate('iam.oshibka_sohraneniya_prav'));
      }
    });
  }
}

