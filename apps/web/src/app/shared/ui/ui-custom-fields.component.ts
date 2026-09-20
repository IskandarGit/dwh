import { Component, Input, Output, EventEmitter, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CustomField } from '../../core/models/custom-field.models';
import { TranslatePipe } from '../../core/services/i18n.service';
import { ApiService } from '../../core/services/api.service';

export interface UserLookupItem {
  id: number;
  name: string;
  login?: string;
}

@Component({
  selector: 'ui-custom-fields',
  standalone: true,
  imports: [TranslatePipe, CommonModule, FormsModule],
  template: `
    <div class="custom-fields-grid" *ngIf="fields && fields.length > 0">
      <div class="field-item" *ngFor="let f of fields">
        <div class="field-header">
          <label class="field-label" [for]="controlId(f)">{{ f.name }}</label>
          <span *ngIf="f.isRequired" class="req-tag">{{ 'ui.custom_fields.obyazatelno' | t }}</span>
        </div>

        <!-- String Input -->
        <input
          *ngIf="f.fieldType === 'string'"
          [id]="controlId(f)"
          [name]="f.code"
          type="text"
          class="form-control"
          [ngModel]="values[f.code]"
          (ngModelChange)="onValueChange(f.code, $event)"
          [placeholder]="f.defaultValue || ('ui.custom_fields.text_value_placeholder' | t)"
          [required]="f.isRequired"
          [attr.aria-required]="f.isRequired"
        />

        <!-- Number Input -->
        <input
          *ngIf="f.fieldType === 'number'"
          [id]="controlId(f)"
          [name]="f.code"
          type="number"
          class="form-control"
          [ngModel]="values[f.code]"
          (ngModelChange)="onValueChange(f.code, $event)"
          [placeholder]="f.defaultValue || '0'"
          [required]="f.isRequired"
          [attr.aria-required]="f.isRequired"
        />

        <!-- Date Input -->
        <input
          *ngIf="f.fieldType === 'date'"
          [id]="controlId(f)"
          [name]="f.code"
          type="date"
          class="form-control"
          [ngModel]="values[f.code]"
          (ngModelChange)="onValueChange(f.code, $event)"
          [required]="f.isRequired"
          [attr.aria-required]="f.isRequired"
        />

        <!-- Select Input -->
        <select
          *ngIf="f.fieldType === 'select'"
          [id]="controlId(f)"
          [name]="f.code"
          class="form-control"
          [ngModel]="values[f.code] ?? null"
          (ngModelChange)="onValueChange(f.code, $event)"
          [required]="f.isRequired"
          [attr.aria-required]="f.isRequired"
        >
          <option [ngValue]="null">{{ 'ui.custom_fields.vyberite_znachenie' | t }}</option>
          <option *ngFor="let option of getSelectOptions(f)" [ngValue]="option.value">{{ option.label }}</option>
        </select>

        <!-- User Reference Input -->
        <select
          *ngIf="f.fieldType === 'user_ref'"
          [id]="controlId(f)"
          [name]="f.code"
          class="form-control"
          [ngModel]="values[f.code] ?? null"
          (ngModelChange)="onUserRefChange(f.code, $event)"
          [required]="f.isRequired"
          [attr.aria-required]="f.isRequired"
        >
          <option [ngValue]="null">{{ 'ui.custom_fields.vyberite_polzovatelya' | t }}</option>
          <option *ngFor="let u of availableUsers()" [ngValue]="u.id">
            {{ u.name }} ({{ '@' + (u.login || u.name) }})
          </option>
        </select>

        <!-- Boolean Toggle -->
        <label *ngIf="f.fieldType === 'boolean'" class="checkbox-label">
          <input
            [id]="controlId(f)"
            [name]="f.code"
            type="checkbox"
            [ngModel]="values[f.code] === true || values[f.code] === 'true'"
            (ngModelChange)="onValueChange(f.code, $event)"
            [required]="f.isRequired"
            [attr.aria-required]="f.isRequired"
          />
          <span>{{ 'ui.custom_fields.vklyucheno' | t }}</span>
        </label>
      </div>
    </div>
  `,
  styles: [`
    .custom-fields-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
      margin-top: 8px;
    }

    .field-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .field-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .field-label {
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
    }

    .req-tag {
      font-size: 9px;
      font-weight: 500;
      color: var(--danger);
      background-color: var(--danger-bg);
      padding: 1px 4px;
      border-radius: 3px;
    }

    .form-control {
      height: 32px;
      padding: 4px 8px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-size: 13px;
      font-family: inherit;
      transition: border-color 0.15s ease;
    }

    .form-control:focus {
      border-color: var(--primary);
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 32px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text-main);
    }
  `]
})
export class UiCustomFieldsComponent implements OnInit {
  private static nextId = 0;
  private readonly api = inject(ApiService, { optional: true });

  @Input() fields: CustomField[] = [];
  @Input() values: Record<string, any> = {};
  @Input() users: UserLookupItem[] = [];

  @Output() valuesChange = new EventEmitter<Record<string, any>>();

  private readonly componentId = UiCustomFieldsComponent.nextId++;
  readonly loadedUsers = signal<UserLookupItem[]>([]);

  ngOnInit() {
    if (this.users.length === 0 && this.hasUserRefField() && this.api) {
      this.api.get<{ items: UserLookupItem[] }>('/iam/users', { limit: 100, state: 'A' }).subscribe({
        next: res => {
          const items = Array.isArray(res) ? res : (res?.items || []);
          this.loadedUsers.set(items);
        },
        error: () => {}
      });
    }
  }

  hasUserRefField(): boolean {
    return (this.fields || []).some(f => f.fieldType === 'user_ref');
  }

  availableUsers(): UserLookupItem[] {
    if (this.users && this.users.length > 0) {
      return this.users;
    }
    return this.loadedUsers();
  }

  controlId(field: CustomField): string {
    const slug = ((field && field.code) || `field-${(field && field.id) || 'x'}`).replace(/[^a-zA-Z0-9_-]/g, '-');
    return `ui-custom-field-${this.componentId}-${(field && field.id) || 'x'}-${slug}`;
  }

  getSelectOptions(field: CustomField): Array<{ value: string | number | boolean; label: string }> {
    if (!field.optionsJson) return [];

    try {
      const options: unknown = JSON.parse(field.optionsJson);
      if (!Array.isArray(options)) return [];

      return options.flatMap(option => {
        if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') {
          return [{ value: option, label: String(option) }];
        }

        if (option && typeof option === 'object' && 'value' in option) {
          const value = (option as { value: unknown }).value;
          const label = 'label' in option ? (option as { label: unknown }).label : value;
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return [{ value, label: String(label) }];
          }
        }

        return [];
      });
    } catch {
      return [];
    }
  }

  onValueChange(code: string, value: any) {
    this.values[code] = value;
    this.valuesChange.emit({ ...this.values });
  }

  onUserRefChange(code: string, value: any) {
    const num = value != null && value !== '' ? Number(value) : null;
    this.values[code] = num;
    this.valuesChange.emit({ ...this.values });
  }
}
