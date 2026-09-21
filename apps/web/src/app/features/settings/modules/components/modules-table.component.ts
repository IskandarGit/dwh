import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { InstalledModule } from '../modules.models';

@Component({
  selector: 'app-modules-table',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
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
          <tr *ngIf="isLoading() && modules().length === 0">
            <td colspan="6" class="state-cell">
              <div class="loading-state">
                <span class="material-symbols-outlined spin" aria-hidden="true">sync</span>
                <span>{{ 'common.loading' | t }}</span>
              </div>
            </td>
          </tr>

          <tr *ngIf="!isLoading() && modules().length === 0">
            <td colspan="6" class="state-cell">
              <div class="empty-state">
                <span class="material-symbols-outlined empty-icon" aria-hidden="true">extension_off</span>
                <p class="empty-title">{{ 'modules.empty_title' | t }}</p>
                <p class="empty-desc">{{ 'modules.empty_desc' | t }}</p>
              </div>
            </td>
          </tr>

          <tr *ngFor="let mod of modules(); trackBy: trackByModuleCode">
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
                    (change)="toggle.emit({ module: mod, event: $event })"
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
  `,
  styles: [`
    :host { display: block; }
    .table-container {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      overflow-x: auto;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }
    .data-table th {
      padding: 12px 16px;
      background: var(--bg-surface-alt, var(--bg-hover));
      color: var(--text-muted);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
    }
    .data-table td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-main);
      vertical-align: middle;
    }
    .data-table tbody tr:last-child td {
      border-bottom: none;
    }
    .data-table tbody tr:hover td {
      background: var(--bg-hover);
    }
    .module-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .module-name {
      font-weight: 600;
      color: var(--text-main);
    }
    .module-desc {
      font-size: 12px;
      color: var(--text-muted);
      max-width: 320px;
    }
    .code-badge {
      padding: 2px 6px;
      background: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      color: var(--primary);
    }
    .version-badge {
      font-size: 12px;
      color: var(--text-muted);
      font-family: var(--font-mono, monospace);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-primary {
      background: var(--primary-subtle);
      color: var(--primary);
    }
    .badge-neutral {
      background: var(--bg-hover);
      color: var(--text-muted);
    }
    .badge-active {
      background: rgba(16, 185, 129, 0.12);
      color: #059669;
    }
    .badge-inactive {
      background: var(--bg-hover);
      color: var(--text-muted);
    }
    .actions-col {
      width: 80px;
      text-align: center;
    }
    .action-cell {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .switch-toggle {
      position: relative;
      display: inline-block;
      width: 36px;
      height: 20px;
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
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--border-color);
      transition: 0.2s ease;
      border-radius: 20px;
    }
    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 14px;
      width: 14px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: 0.2s ease;
      border-radius: 50%;
    }
    .switch-toggle input:checked + .toggle-slider {
      background-color: var(--primary);
    }
    .switch-toggle input:checked + .toggle-slider:before {
      transform: translateX(16px);
    }
    .system-locked-hint {
      display: flex;
      align-items: center;
      color: var(--text-muted);
    }
    .lock-icon {
      font-size: 14px;
    }
    .state-cell {
      padding: 40px !important;
      text-align: center;
    }
    .loading-state, .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--text-muted);
    }
    .empty-icon {
      font-size: 36px;
      color: var(--text-muted);
      opacity: 0.5;
    }
    .empty-title {
      font-weight: 600;
      color: var(--text-main);
      margin: 0;
    }
    .empty-desc {
      font-size: 12px;
      margin: 0;
    }
    .spin {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      100% { transform: rotate(360deg); }
    }
  `]
})
export class ModulesTableComponent {
  readonly modules = input.required<InstalledModule[]>();
  readonly isLoading = input.required<boolean>();
  readonly canManage = input.required<boolean>();
  readonly togglingCode = input<string | null>(null);

  readonly toggle = output<{ module: InstalledModule; event: Event }>();

  trackByModuleCode(_index: number, item: InstalledModule): string {
    return item.code;
  }
}
