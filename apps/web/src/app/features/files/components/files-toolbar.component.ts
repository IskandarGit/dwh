import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../core/services/i18n.service';

@Component({
  selector: 'app-files-toolbar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe
  ],
  template: `
    <div class="filter-toolbar">
      <div class="toolbar-left">
        <!-- Scope Tabs -->
        <div class="scope-tabs" role="group" [attr.aria-label]="'files.oblast_faylov' | t">
          <button
            type="button"
            class="tab-btn"
            [class.active]="scope === 'all'"
            [attr.aria-pressed]="scope === 'all'"
            (click)="scopeChange.emit('all')"
          >
            <span class="material-symbols-outlined" aria-hidden="true">folder_shared</span>
            {{ 'files.vse_fayly_kompanii' | t }}
          </button>
          <button
            type="button"
            class="tab-btn"
            [class.active]="scope === 'mine'"
            [attr.aria-pressed]="scope === 'mine'"
            (click)="scopeChange.emit('mine')"
          >
            <span class="material-symbols-outlined" aria-hidden="true">person</span>
            {{ 'files.moi_fayly' | t }}
          </button>
        </div>

        <!-- Search Input -->
        <div class="search-box">
          <span class="material-symbols-outlined search-icon" aria-hidden="true">search</span>
          <label class="sr-only" for="file-search">{{ 'files.poisk_faylov' | t }}</label>
          <input
            id="file-search"
            name="fileSearch"
            type="text"
            class="search-input"
            [placeholder]="'files.poisk_faylov_po_imeni' | t"
            [ngModel]="searchQuery"
            (ngModelChange)="searchQueryChange.emit($event)"
            (keyup.enter)="search.emit()"
          />
          <button type="button" class="clear-btn" [attr.aria-label]="'files.ochistit_poisk_faylov' | t" *ngIf="searchQuery" (click)="clear.emit()">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      </div>

      <div class="toolbar-right">
        <button type="button" class="icon-refresh-btn" [attr.aria-label]="'files.obnovit_spisok_faylov' | t" (click)="refresh.emit()" [title]="'announcements.obnovit_spisok' | t">
          <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .filter-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
      min-width: 0;
      flex-wrap: wrap;
    }

    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .scope-tabs {
      display: flex;
      align-items: center;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 3px;
      gap: 2px;
    }

    .tab-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-light);
      background: transparent;
      border: none;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .tab-btn .material-symbols-outlined {
      font-size: 16px;
    }

    .tab-btn:hover {
      color: var(--text-main);
      background: var(--bg-hover);
    }

    .tab-btn.active {
      background: var(--primary);
      color: #fff;
    }

    .search-box {
      position: relative;
      display: flex;
      align-items: center;
      flex: 1;
      max-width: 380px;
      min-width: 200px;
    }

    .search-icon {
      position: absolute;
      left: 10px;
      font-size: 18px;
      color: var(--text-muted);
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      height: 36px;
      padding: 0 32px 0 34px;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-size: 13px;
      color: var(--text-main);
      outline: none;
      transition: border-color 0.15s ease;
    }

    .search-input:focus {
      border-color: var(--primary);
    }

    .clear-btn {
      position: absolute;
      right: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }

    .clear-btn:hover {
      color: var(--text-main);
      background: var(--bg-hover);
    }

    .clear-btn .material-symbols-outlined {
      font-size: 14px;
    }

    .icon-refresh-btn {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      background: var(--bg-surface);
      color: var(--text-light);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .icon-refresh-btn:hover {
      background: var(--bg-hover);
      color: var(--text-main);
    }

    .icon-refresh-btn .material-symbols-outlined {
      font-size: 18px;
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
      border: 0;
    }
  `]
})
export class FilesToolbarComponent {
  @Input() scope: 'all' | 'mine' = 'all';
  @Input() searchQuery = '';

  @Output() scopeChange = new EventEmitter<'all' | 'mine'>();
  @Output() searchQueryChange = new EventEmitter<string>();
  @Output() search = new EventEmitter<void>();
  @Output() clear = new EventEmitter<void>();
  @Output() refresh = new EventEmitter<void>();
}
