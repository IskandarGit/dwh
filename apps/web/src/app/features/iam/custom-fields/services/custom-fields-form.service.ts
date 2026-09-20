import { Injectable, inject } from '@angular/core';
import { I18nService } from '../../../../core/services/i18n.service';
import { CustomField, CustomFieldFormData } from '../custom-fields.models';

export const RESERVED_CODES = new Set<string>([
  'id', 'code', 'name', 'title', 'state', 'status', 'created_at', 'modified_at',
  'created_by', 'modified_by', 'login', 'email', 'password', 'task_type', 'priority',
  'description', 'attributes', 'options', 'values'
]);

export interface FormValidationResult {
  isValid: boolean;
  errorMessage?: string;
  fieldErrors: {
    code?: string;
    name?: string;
    optionsText?: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class CustomFieldsFormService {
  private readonly uiI18n = inject(I18nService);

  createInitialFormData(selectedEntity: string, totalCount: number): CustomFieldFormData {
    return {
      entityType: selectedEntity !== 'ALL' ? selectedEntity : 'USER',
      code: '',
      name: '',
      fieldType: 'string',
      isRequired: false,
      defaultValue: '',
      orderNo: (totalCount + 1) * 10,
      optionsText: ''
    };
  }

  fromCustomField(field: CustomField): CustomFieldFormData {
    return {
      entityType: field.entityType,
      code: field.code,
      name: field.name,
      fieldType: field.fieldType,
      isRequired: field.isRequired,
      defaultValue: field.defaultValue || '',
      orderNo: field.orderNo || 0,
      optionsText: this.optionsToText(field.optionsJson)
    };
  }

  sanitizeCode(value: string): string {
    if (!value) return '';
    return value
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_');
  }

  validateForm(formData: CustomFieldFormData, isEditing: boolean): FormValidationResult {
    const fieldErrors: FormValidationResult['fieldErrors'] = {};

    const name = (formData.name || '').trim();
    if (!name) {
      fieldErrors.name = this.uiI18n.translate('iam.ukazhite_nazvanie_polya');
    }

    const code = (formData.code || '').trim();
    if (!code) {
      fieldErrors.code = this.uiI18n.translate('iam.ukazhite_kod_polya');
    } else if (!isEditing) {
      const codePattern = /^[a-z][a-z0-9_]{1,63}$/;
      if (!codePattern.test(code)) {
        fieldErrors.code = this.uiI18n.translate('iam.invalid_code_slug');
      } else if (RESERVED_CODES.has(code.toLowerCase())) {
        fieldErrors.code = this.uiI18n.translate('iam.kod_polya_rezervirovan');
      }
    }

    if (formData.fieldType === 'select') {
      const options = this.parseOptionsText(formData.optionsText);
      if (options.length === 0) {
        fieldErrors.optionsText = this.uiI18n.translate('iam.dobavte_hotya_by_odin_variant_spiska');
      }
    }

    const isValid = Object.keys(fieldErrors).length === 0;
    let errorMessage: string | undefined;
    if (!isValid) {
      errorMessage = fieldErrors.name || fieldErrors.code || fieldErrors.optionsText ||
        this.uiI18n.translate('iam.zapolnite_obyazatelnye_polya');
    }

    return { isValid, errorMessage, fieldErrors };
  }

  parseOptionsText(value: string | undefined): Array<string | { value: string; label: string }> {
    return (value || '')
      .split(/\r?\n/)
      .map(option => option.trim())
      .filter((option, index, all) => option.length > 0 && all.indexOf(option) === index)
      .map(option => {
        const separatorIndex = option.indexOf('|');
        if (separatorIndex < 0) return option;

        const optionValue = option.slice(0, separatorIndex).trim();
        const optionLabel = option.slice(separatorIndex + 1).trim();
        return optionValue && optionLabel
          ? { value: optionValue, label: optionLabel }
          : option;
      });
  }

  optionsToText(optionsJson: string | undefined): string {
    if (!optionsJson) return '';
    try {
      const options: unknown = JSON.parse(optionsJson);
      if (!Array.isArray(options)) return '';
      return options
        .map(option => {
          if (typeof option !== 'object' || option === null) return String(option);
          if (!('value' in option)) return '';

          const optionValue = String((option as { value: unknown }).value);
          const optionLabel = 'label' in option
            ? String((option as { label: unknown }).label)
            : optionValue;
          return optionValue === optionLabel ? optionValue : `${optionValue} | ${optionLabel}`;
        })
        .filter(Boolean)
        .join('\n');
    } catch {
      return '';
    }
  }
}
