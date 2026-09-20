import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { TranslatePipe, I18nService } from '../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { ModuleService, InstalledModule } from '../../../core/services/module.service';

export type { InstalledModule };

export type ModuleFilterTab = 'all' | 'active' | 'system' | 'custom';

@Component({
  selector: 'app-modules',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, UiButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="modules-page" aria-labelledby="modules-title">
      <!-- Header -->
      <header class="view-header">
        <div>
          <p class="eyebrow">{{ 'modules.subtitle' | t }}</p>
          <h1 id="modules-title">{{ 'modules.title' | t }}</h1>
          <p class="subtitle">{{ 'modules.description' | t }}</p>
        </div>
        <div class="header-actions">
          <ui-button
            variant="secondary"
            icon="refresh"
            [loading]="isLoading()"
            [ariaLabel]="'common.refresh' | t"
            (onClick)="loadModules()"
          >
            {{ 'common.refresh' | t }}
          </ui-button>
        </div>
      </header>

      <!-- Stats overview cards -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon-wrapper primary">
            <span class="material-symbols-outlined">extension</span>
          </div>
          <div class="stat-content">
            <span class="stat-value">{{ modules().length }}</span>
            <span class="stat-label">{{ 'modules.stat.total' | t }}</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon-wrapper success">
            <span class="material-symbols-outlined">check_circle</span>
          </div>
          <div class="stat-content">
            <span class="stat-value">{{ activeCount() }}</span>
            <span class="stat-label">{{ 'modules.stat.active' | t }}</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon-wrapper info">
            <span class="material-symbols-outlined">verified_user</span>
          </div>
          <div class="stat-content">
            <span class="stat-value">{{ systemCount() }}</span>
            <span class="stat-label">{{ 'modules.stat.system' | t }}</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon-wrapper neutral">
            <span class="material-symbols-outlined">widgets</span>
          </div>
          <div class="stat-content">
            <span class="stat-value">{{ customCount() }}</span>
            <span class="stat-label">{{ 'modules.stat.custom' | t }}</span>
          </div>
        </div>
      </div>

      <!-- Controls: search and tabs -->
      <div class="toolbar">
        <div class="search-box">
          <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
          <input
            type="search"
            class="form-input search-input"
            [placeholder]="'modules.search_placeholder' | t"
            [value]="searchQuery()"
            (input)="onSearchChange($event)"
            [attr.aria-label]="'modules.search_placeholder' | t"
          />
          <button
            *ngIf="searchQuery()"
            type="button"
            class="search-clear-btn"
            [attr.aria-label]="'search.clear_query' | t"
            (click)="clearSearch()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">cancel</span>
          </button>
        </div>

        <div class="status-tabs" role="tablist" [attr.aria-label]="'modules.filter_tabs' | t">
          <button
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="filterTab() === 'all'"
            [attr.aria-selected]="filterTab() === 'all'"
            (click)="filterTab.set('all')"
          >
            {{ 'modules.tab.all' | t }} ({{ modules().length }})
          </button>
          <button
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="filterTab() === 'active'"
            [attr.aria-selected]="filterTab() === 'active'"
            (click)="filterTab.set('active')"
          >
            {{ 'modules.tab.active' | t }} ({{ activeCount() }})
          </button>
          <button
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="filterTab() === 'system'"
            [attr.aria-selected]="filterTab() === 'system'"
            (click)="filterTab.set('system')"
          >
            {{ 'modules.tab.system' | t }} ({{ systemCount() }})
          </button>
          <button
            type="button"
            role="tab"
            class="status-tab"
            [class.active]="filterTab() === 'custom'"
            [attr.aria-selected]="filterTab() === 'custom'"
            (click)="filterTab.set('custom')"
          >
            {{ 'modules.tab.custom' | t }} ({{ customCount() }})
          </button>
        </div>
      </div>

      <!-- Modules Table -->
      <div class="table-container">
        <table class="data-table" [attr.aria-label]="'modules.title' | t">
          <thead>
            <tr>
              <th scope="col">{{ 'modules.col.module' | t }}</th>
              <th scope="col">{{ 'modules.col.code' | t }}</th>
              <th scope="col">{{ 'modules.col.version' | t }}</th>
              <th scope="col">{{ 'modules.col.type' | t }}</th>
              <th scope="col">{{ 'modules.col.status' | t }}</th>
              <th scope="col" class="actions-col" *ngIf="canManage()">{{ 'modules.col.actions' | t }}</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngIf="isLoading() && filteredModules().length === 0">
              <td colspan="6" class="state-cell">
                <div class="loading-state">
                  <span class="material-symbols-outlined spin" aria-hidden="true">sync</span>
                  <span>{{ 'common.loading' | t }}</span>
                </div>
              </td>
            </tr>

            <tr *ngIf="!isLoading() && filteredModules().length === 0">
              <td colspan="6" class="state-cell">
                <div class="empty-state">
                  <span class="material-symbols-outlined empty-icon" aria-hidden="true">extension_off</span>
                  <p class="empty-title">{{ 'modules.empty_title' | t }}</p>
                  <p class="empty-desc">{{ 'modules.empty_desc' | t }}</p>
                </div>
              </td>
            </tr>

            <tr *ngFor="let mod of filteredModules(); trackBy: trackByModuleCode">
              <td>
                <div class="module-info">
                  <span class="module-name">{{ mod.name }}</span>
                  <span class="module-desc" *ngIf="mod.description">{{ mod.description }}</span>
                </div>
              </td>
              <td>
                <code class="code-badge">{{ mod.code }}</code>
              </td>
              <td>
                <span class="version-badge">v{{ mod.version }}</span>
              </td>
              <td>
                <span class="badge" [class.badge-primary]="mod.isSystem" [class.badge-neutral]="!mod.isSystem">
                  {{ (mod.isSystem ? 'modules.type.system' : 'modules.type.custom') | t }}
                </span>
              </td>
              <td>
                <span class="badge" [class.badge-active]="mod.isActive" [class.badge-inactive]="!mod.isActive">
                  {{ (mod.isActive ? 'modules.status.active' : 'modules.status.disabled') | t }}
                </span>
              </td>
              <td class="actions-col" *ngIf="canManage()">
                <div class="action-cell">
                  <label class="switch-toggle" [class.disabled]="mod.isSystem || togglingCode() === mod.code" [title]="mod.isSystem ? ('modules.system_cannot_disable' | t) : ''">
                    <input
                      type="checkbox"
                      [checked]="mod.isActive"
                      [disabled]="mod.isSystem || togglingCode() === mod.code"
                      (change)="toggleModule(mod, $event)"
                      [attr.aria-label]="(mod.isActive ? 'modules.action.disable' : 'modules.action.enable') | t:{name: mod.name}"
                    />
                    <span class="toggle-slider"></span>
                  </label>
                  <span class="system-locked-hint" *ngIf="mod.isSystem" [title]="'modules.system_cannot_disable' | t">
                    <span class="material-symbols-outlined lock-icon">lock</span>
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Developer Info / CLI Help Banner -->
      <div class="developer-info-card">
        <div class="dev-card-header">
          <span class="material-symbols-outlined dev-icon">terminal</span>
          <div>
            <h3 class="dev-card-title">{{ 'modules.cli_title' | t }}</h3>
            <p class="dev-card-desc">{{ 'modules.cli_desc' | t }}</p>
          </div>
        </div>
        <div class="dev-card-body">
          <p class="cli-command-label">{{ 'modules.cli_example_label' | t }}</p>
          <pre class="cli-command-box"><code>powershell -ExecutionPolicy Bypass -File scripts/dev/create-module.ps1 -ModuleCode "crm" -ModuleName "CRM & Deals" -ModuleDescription "Customer relationships and deal pipeline" -Subpackage "crm"</code></pre>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .modules-page {
      display: flex;
      flex-direction: column;
      gap: 20px;
      max-width: 1200px;
      margin: 0 auto;
      padding-bottom: 40px;
    }

    .view-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }

    .eyebrow {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--primary);
      margin: 0 0 4px 0;
    }

    #modules-title {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-main);
      margin: 0 0 6px 0;
    }

    .subtitle {
      font-size: 14px;
      color: var(--text-light);
      margin: 0;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }

    .stat-card {
      display: flex;
      align-items: center;
      gap: 14px;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md, 10px);
      padding: 16px 20px;
    }

    .stat-icon-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 8px;
    }

    .stat-icon-wrapper.primary { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }
    .stat-icon-wrapper.success { background: rgba(34, 197, 94, 0.12); color: #22c55e; }
    .stat-icon-wrapper.info { background: rgba(168, 85, 247, 0.12); color: #a855f7; }
    .stat-icon-wrapper.neutral { background: rgba(100, 116, 139, 0.12); color: #64748b; }

    .stat-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .stat-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--text-main);
    }

    .stat-label {
      font-size: 12px;
      color: var(--text-light);
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .search-box {
      position: relative;
      min-width: 260px;
      flex: 1;
      max-width: 380px;
    }

    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 18px;
      color: var(--text-light);
      pointer-events: none;
    }

    .search-input {
      padding-left: 38px;
      padding-right: 32px;
      width: 100%;
    }

    .search-clear-btn {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--text-light);
      cursor: pointer;
      display: flex;
      align-items: center;
      padding: 0;
    }
    .search-clear-btn:hover {
      color: var(--text-main);
    }
    .search-clear-btn .material-symbols-outlined {
      font-size: 18px;
    }

    .status-tabs {
      display: flex;
      gap: 4px;
      background: var(--bg-hover);
      padding: 4px;
      border-radius: var(--radius-sm, 6px);
      border: 1px solid var(--border-subtle);
    }

    .status-tab {
      padding: 6px 14px;
      border: none;
      background: transparent;
      border-radius: 4px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-light);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .status-tab:hover {
      color: var(--text-main);
    }

    .status-tab.active {
      background: var(--bg-surface);
      color: var(--text-main);
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      font-weight: 600;
    }

    .table-container {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md, 10px);
      overflow-x: auto;
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .data-table th, .data-table td {
      padding: 14px 18px;
      text-align: left;
      border-bottom: 1px solid var(--border-subtle);
    }

    .data-table th {
      font-weight: 600;
      color: var(--text-light);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      background: var(--bg-hover);
    }

    .data-table tbody tr:hover {
      background: var(--bg-hover);
    }

    .module-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .module-name {
      font-weight: 600;
      color: var(--text-main);
      font-size: 14px;
    }

    .module-desc {
      font-size: 12px;
      color: var(--text-light);
    }

    .code-badge {
      display: inline-block;
      padding: 3px 8px;
      font-family: monospace;
      font-size: 12px;
      background: var(--bg-hover);
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      color: var(--text-main);
    }

    .version-badge {
      font-size: 12px;
      color: var(--text-light);
      font-weight: 500;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }

    .badge-primary { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
    .badge-neutral { background: rgba(100, 116, 139, 0.15); color: #64748b; }
    .badge-active { background: rgba(34, 197, 94, 0.15); color: #16a34a; }
    .badge-inactive { background: rgba(239, 68, 68, 0.12); color: #dc2626; }

    .actions-col {
      text-align: right;
      width: 120px;
    }

    .action-cell {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }

    /* Switch toggle */
    .switch-toggle {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 22px;
      cursor: pointer;
    }

    .switch-toggle.disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }

    .switch-toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .toggle-slider {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: #cbd5e1;
      border-radius: 22px;
      transition: 0.2s;
    }

    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      border-radius: 50%;
      transition: 0.2s;
    }

    input:checked + .toggle-slider {
      background-color: #22c55e;
    }

    input:checked + .toggle-slider:before {
      transform: translateX(18px);
    }

    .lock-icon {
      font-size: 16px;
      color: var(--text-light);
    }

    .state-cell {
      padding: 40px !important;
      text-align: center;
    }

    .loading-state, .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      color: var(--text-light);
    }

    .spin {
      animation: spin 1s linear infinite;
      font-size: 28px;
    }

    @keyframes spin {
      100% { transform: rotate(360deg); }
    }

    .empty-icon {
      font-size: 40px;
      color: var(--text-light);
      opacity: 0.6;
    }

    .empty-title {
      font-weight: 600;
      color: var(--text-main);
      margin: 0;
    }

    .empty-desc {
      font-size: 13px;
      margin: 0;
    }

    /* Developer info card */
    .developer-info-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md, 10px);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .dev-card-header {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .dev-icon {
      font-size: 28px;
      color: var(--primary);
    }

    .dev-card-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-main);
      margin: 0;
    }

    .dev-card-desc {
      font-size: 13px;
      color: var(--text-light);
      margin: 2px 0 0 0;
    }

    .cli-command-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-light);
      margin: 0 0 6px 0;
    }

    .cli-command-box {
      background: #0f172a;
      color: #e2e8f0;
      padding: 12px 16px;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 12px;
      margin: 0;
      font-family: monospace;
    }
  `]
})
export class ModulesComponent implements OnInit {
  private readonly moduleService = inject(ModuleService);
  private readonly permissions = inject(PermissionService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  readonly modules = this.moduleService.modules;
  readonly isLoading = this.moduleService.isLoading;
  readonly togglingCode = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly filterTab = signal<ModuleFilterTab>('all');

  readonly activeCount = computed(() => this.modules().filter(m => m.isActive).length);
  readonly systemCount = computed(() => this.modules().filter(m => m.isSystem).length);
  readonly customCount = computed(() => this.modules().filter(m => !m.isSystem).length);

  readonly filteredModules = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const tab = this.filterTab();
    return this.modules().filter(m => {
      if (tab === 'active' && !m.isActive) return false;
      if (tab === 'system' && !m.isSystem) return false;
      if (tab === 'custom' && m.isSystem) return false;

      if (!q) return true;
      const code = (m.code || m.moduleCode || '').toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        code.includes(q) ||
        (m.description && m.description.toLowerCase().includes(q))
      );
    });
  });

  ngOnInit(): void {
    this.loadModules();
  }

  canManage(): boolean {
    return this.permissions.canManage('platform.modules');
  }

  loadModules(): void {
    this.moduleService.loadAllModules().subscribe({ error: () => {} });
  }

  onSearchChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  toggleModule(mod: InstalledModule, event: Event): void {
    if (mod.isSystem) {
      this.toast.error(this.i18n.translate('modules.system_cannot_disable'));
      return;
    }
    const input = event.target as HTMLInputElement;
    const targetActive = input.checked;
    const code = mod.code || mod.moduleCode || '';
    if (!code) return;

    this.togglingCode.set(code);
    this.moduleService.toggleModule(code, targetActive).subscribe({
      next: () => {
        this.togglingCode.set(null);
        this.toast.success(
          this.i18n.translate(
            targetActive ? 'modules.msg.activated' : 'modules.msg.deactivated',
            { name: mod.name }
          )
        );
      },
      error: () => {
        this.togglingCode.set(null);
        // revert visual state in case of error
        input.checked = !targetActive;
      }
    });
  }

  trackByModuleCode(_index: number, mod: InstalledModule): string {
    return mod.code || mod.moduleCode || '';
  }
}
