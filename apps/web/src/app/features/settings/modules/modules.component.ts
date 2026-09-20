import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../../core/services/api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { TranslatePipe, I18nService } from '../../../core/services/i18n.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';

import { InstalledModule, ModuleFilterTab } from './modules.models';
import { ModulesStatsComponent } from './components/modules-stats.component';
import { ModulesToolbarComponent } from './components/modules-toolbar.component';
import { ModulesTableComponent } from './components/modules-table.component';

export type { InstalledModule, ModuleFilterTab };

@Component({
  selector: 'app-modules',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    UiButtonComponent,
    ModulesStatsComponent,
    ModulesToolbarComponent,
    ModulesTableComponent
  ],
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
      <app-modules-stats
        [totalCount]="modules().length"
        [activeCount]="activeCount()"
        [systemCount]="systemCount()"
        [customCount]="customCount()"
      />

      <!-- Controls: search and tabs -->
      <app-modules-toolbar
        [searchQuery]="searchQuery()"
        [filterTab]="filterTab()"
        [totalCount]="modules().length"
        [activeCount]="activeCount()"
        [systemCount]="systemCount()"
        [customCount]="customCount()"
        (searchChange)="searchQuery.set($event)"
        (clearSearch)="clearSearch()"
        (filterTabChange)="filterTab.set($event)"
      />

      <!-- Modules Table -->
      <app-modules-table
        [modules]="filteredModules()"
        [isLoading]="isLoading()"
        [canManage]="canManage()"
        [togglingCode]="togglingCode()"
        (toggle)="toggleModule($event.module, $event.event)"
      />

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
    :host { display: block; }
    .modules-page {
      display: flex;
      flex-direction: column;
      gap: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }
    .view-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    .eyebrow {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--primary);
      margin: 0 0 4px;
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-main);
      margin: 0 0 6px;
      line-height: 1.2;
    }
    .subtitle {
      font-size: 13px;
      color: var(--text-muted);
      margin: 0;
      line-height: 1.4;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .developer-info-card {
      background: var(--bg-surface);
      border: 1px dashed var(--border-color);
      border-radius: var(--radius-md);
      padding: 16px 20px;
    }
    .dev-card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    .dev-icon {
      font-size: 24px;
      color: var(--primary);
      background: var(--primary-subtle);
      padding: 6px;
      border-radius: var(--radius-sm);
    }
    .dev-card-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-main);
      margin: 0 0 2px;
    }
    .dev-card-desc {
      font-size: 12px;
      color: var(--text-muted);
      margin: 0;
    }
    .cli-command-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      margin: 0 0 6px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .cli-command-box {
      background: var(--bg-surface-alt, var(--bg-hover));
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 10px 14px;
      margin: 0;
      overflow-x: auto;
    }
    .cli-command-box code {
      font-family: var(--font-mono, monospace);
      font-size: 12px;
      color: var(--text-main);
      white-space: pre;
    }
  `]
})
export class ModulesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly permissions = inject(PermissionService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  readonly modules = signal<InstalledModule[]>([]);
  readonly isLoading = signal(false);
  readonly togglingCode = signal<string | null>(null);

  readonly searchQuery = signal('');
  readonly filterTab = signal<ModuleFilterTab>('all');

  readonly activeCount = computed(() =>
    this.modules().filter(m => m.isActive).length
  );

  readonly systemCount = computed(() =>
    this.modules().filter(m => m.isSystem).length
  );

  readonly customCount = computed(() =>
    this.modules().filter(m => !m.isSystem).length
  );

  readonly filteredModules = computed(() => {
    let list = this.modules();
    const tab = this.filterTab();
    if (tab === 'active') {
      list = list.filter(m => m.isActive);
    } else if (tab === 'system') {
      list = list.filter(m => m.isSystem);
    } else if (tab === 'custom') {
      list = list.filter(m => !m.isSystem);
    }

    const q = this.searchQuery().trim().toLowerCase();
    if (q) {
      list = list.filter(m => {
        const code = (m.code || m.moduleCode || '').toLowerCase();
        return (
          m.name.toLowerCase().includes(q) ||
          code.includes(q) ||
          (m.description && m.description.toLowerCase().includes(q))
        );
      });
    }

    return list;
  });

  ngOnInit(): void {
    this.loadModules();
  }

  canManage(): boolean {
    return this.permissions.canManage('platform.modules');
  }

  loadModules(): void {
    this.isLoading.set(true);
    this.api.get<InstalledModule[]>('/modules').subscribe({
      next: (data) => {
        this.modules.set(data || []);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.toast.error(this.i18n.translate('modules.load_error'));
      }
    });
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
    this.api.post<InstalledModule>(`/modules/${code}/toggle`, { enabled: targetActive }).subscribe({
      next: (updated) => {
        this.togglingCode.set(null);
        this.modules.update(list =>
          list.map(m => (m.code === code || m.moduleCode === code)
            ? { ...m, ...updated, isActive: updated.isActive ?? (updated.status === 'ACTIVE') }
            : m
          )
        );
        this.toast.success(
          this.i18n.translate(
            targetActive ? 'modules.msg.activated' : 'modules.msg.deactivated',
            { name: mod.name }
          )
        );
      },
      error: () => {
        this.togglingCode.set(null);
        input.checked = !targetActive;
        this.toast.error(this.i18n.translate('modules.toggle_error'));
      }
    });
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  trackByModuleCode(_index: number, item: InstalledModule): string {
    return item.code || item.moduleCode || '';
  }
}
