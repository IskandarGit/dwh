import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../../core/services/i18n.service';
import { ProjectStateFilter } from '../projects.models';

@Component({
  selector: 'app-project-filter-bar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe
  ],
  template: `
    <div class="toolbar">
      <div class="search-field">
        <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
        <label class="sr-only" for="project-search">{{ 'projects.poisk_proektov' | t }}</label>
        <input
          id="project-search"
          name="projectSearch"
          type="text"
          class="search-input"
          [placeholder]="'projects.poisk_po_nazvaniyu_ili_opisaniyu' | t"
          [ngModel]="searchQuery"
          (ngModelChange)="searchChange.emit($event)"
        />
        <button *ngIf="searchQuery" type="button" class="btn-icon project-search-clear" style="position: absolute; right: 6px;" [attr.aria-label]="'projects.ochistit_poisk_proektov' | t" (click)="clearSearch.emit()">
          <span class="material-symbols-outlined" style="font-size: 16px;" aria-hidden="true">close</span>
        </button>
      </div>

      <div class="status-tabs" role="group" [attr.aria-label]="'projects.filtr_proektov_po_statusu' | t">
        <button
          type="button"
          class="status-tab"
          data-testid="project-state-filter"
          [class.active]="selectedState === 'all'"
          [attr.aria-pressed]="selectedState === 'all'"
          (click)="stateChange.emit('all')"
        >
          {{ 'common.all' | t }}
        </button>
        <button
          type="button"
          class="status-tab"
          data-testid="project-state-filter"
          [class.active]="selectedState === 'A'"
          [attr.aria-pressed]="selectedState === 'A'"
          (click)="stateChange.emit('A')"
        >
          <span class="status-tab-dot" style="background-color: var(--success);" aria-hidden="true"></span>
          {{ 'iam.aktivnye' | t }}
        </button>
        <button
          type="button"
          class="status-tab"
          data-testid="project-state-filter"
          [class.active]="selectedState === 'P'"
          [attr.aria-pressed]="selectedState === 'P'"
          (click)="stateChange.emit('P')"
        >
          <span class="status-tab-dot" style="background-color: var(--text-light);" aria-hidden="true"></span>
          {{ 'projects.arhiv' | t }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 8px 12px;
    }
    .search-field {
      position: relative;
      display: flex;
      align-items: center;
      min-width: 260px;
      flex: 1;
      max-width: 400px;
    }
    .search-icon {
      position: absolute;
      left: 10px;
      color: var(--text-muted);
      font-size: 18px;
      pointer-events: none;
    }
    .search-input {
      width: 100%;
      height: 34px;
      padding: 6px 32px 6px 34px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background-color: var(--bg-hover);
      color: var(--text-main);
      font-size: 13px;
      outline: none;
      transition: all 0.15s ease;
    }
    .search-input:focus {
      border-color: var(--primary);
      background-color: var(--bg-surface);
    }
    .btn-icon {
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      border-radius: 4px;
    }
    .btn-icon:hover { color: var(--text-main); background-color: var(--bg-hover); }
    .status-tabs {
      display: inline-flex;
      align-items: center;
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 2px;
      gap: 2px;
    }
    .status-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
      border-radius: var(--radius-xs);
      cursor: pointer;
      transition: all 0.1s ease;
    }
    .status-tab:hover { color: var(--text-main); }
    .status-tab.active {
      background-color: var(--bg-surface);
      color: var(--text-main);
      box-shadow: var(--shadow-sm);
    }
    .status-tab-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border-width: 0;
    }
  `]
})
export class ProjectFilterBarComponent {
  @Input() searchQuery = '';
  @Input() selectedState: ProjectStateFilter = 'all';
  @Output() searchChange = new EventEmitter<string>();
  @Output() clearSearch = new EventEmitter<void>();
  @Output() stateChange = new EventEmitter<ProjectStateFilter>();
}
