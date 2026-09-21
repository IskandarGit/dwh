import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, I18nService } from '../../../../core/services/i18n.service';

@Component({
  selector: 'app-custom-fields-toolbar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe
  ],
  template: `
    <div class="toolbar-container">
      <!-- Entity Type Filter Tabs -->
      <div class="filter-tabs" role="group" [attr.aria-label]="'iam.filtr_po_tipu_suschnosti' | t">
        <button
          *ngFor="let ent of availableEntities"
          type="button"
          class="tab-btn"
          [class.active]="selectedEntity === ent"
          [attr.aria-pressed]="selectedEntity === ent"
          (click)="entityChange.emit(ent)"
        >
          <span class="material-symbols-outlined tab-icon" aria-hidden="true">{{ getEntityIcon(ent) }}</span>
          <span class="tab-label">{{ getEntityLabel(ent) }}</span>
          <span class="tab-count">{{ entityCounts[ent] || 0 }}</span>
        </button>
      </div>

      <!-- Quick Search -->
      <div class="search-box">
        <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
        <input
          type="text"
          class="search-input"
          [ngModel]="searchQuery"
          (ngModelChange)="searchQueryChange.emit($event)"
          [placeholder]="'iam.poisk_poley' | t"
          [attr.aria-label]="'iam.poisk_poley' | t"
        />
        <button
          *ngIf="searchQuery"
          type="button"
          class="clear-search-btn"
          (click)="clearSearch.emit()"
          [attr.aria-label]="'iam.sbrosit_poisk' | t"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .toolbar-container {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .filter-tabs {
      display: flex;
      gap: 6px;
      background: var(--bg-hover);
      padding: 4px;
      border-radius: 10px;
      border: 1px solid var(--border-subtle);
      overflow-x: auto;
      max-width: 100%;
    }

    .tab-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: 7px;
      border: none;
      background: transparent;
      color: var(--text-light);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s;
    }

    .tab-btn:hover {
      color: var(--text-main);
      background: var(--bg-surface);
    }

    .tab-btn.active {
      background: var(--bg-surface);
      color: var(--primary);
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }

    .tab-icon {
      font-size: 17px;
      opacity: 0.85;
    }

    .tab-count {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.08);
      font-weight: 600;
    }

    .tab-btn.active .tab-count {
      background: var(--primary-subtle, rgba(59, 130, 246, 0.15));
      color: var(--primary);
    }

    .search-box {
      position: relative;
      display: flex;
      align-items: center;
      min-width: 240px;
    }

    .search-icon {
      position: absolute;
      left: 10px;
      font-size: 18px;
      color: var(--text-light);
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      height: 38px;
      padding: 0 32px 0 34px;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-size: 13px;
      color: var(--text-main);
      outline: none;
      transition: all 0.2s;
    }

    .search-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
    }

    .clear-search-btn {
      position: absolute;
      right: 8px;
      background: transparent;
      border: none;
      color: var(--text-light);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2px;
    }

    .clear-search-btn:hover {
      color: var(--text-main);
    }

    .clear-search-btn .material-symbols-outlined {
      font-size: 16px;
    }

    @media (max-width: 640px) {
      .toolbar-container {
        flex-direction: column;
        align-items: stretch;
      }
      .search-box {
        min-width: 100%;
      }
    }
  `]
})
export class CustomFieldsToolbarComponent {
  private readonly uiI18n = inject(I18nService);

  @Input() availableEntities: string[] = ['ALL', 'USER', 'PROJECT', 'TASK', 'NOTE'];
  @Input() selectedEntity = 'ALL';
  @Input() searchQuery = '';
  @Input() entityCounts: Record<string, number> = {};

  @Output() entityChange = new EventEmitter<string>();
  @Output() searchQueryChange = new EventEmitter<string>();
  @Output() clearSearch = new EventEmitter<void>();

  getEntityLabel(ent: string): string {
    switch (ent) {
      case 'ALL': return this.uiI18n.translate('iam.vse_suschnosti');
      case 'USER': return this.uiI18n.translate('nav.users');
      case 'PROJECT': return this.uiI18n.translate('nav.projects');
      case 'TASK': return this.uiI18n.translate('nav.tasks');
      case 'NOTE': return this.uiI18n.translate('iam.zametka_note');
      default: return ent;
    }
  }

  getEntityIcon(ent: string): string {
    switch (ent.toUpperCase()) {
      case 'ALL': return 'apps';
      case 'USER': return 'person';
      case 'PROJECT': return 'folder';
      case 'TASK': return 'task_alt';
      case 'NOTE': return 'description';
      case 'ORGANIZATION_UNIT': return 'corporate_fare';
      default: return 'data_object';
    }
  }
}
