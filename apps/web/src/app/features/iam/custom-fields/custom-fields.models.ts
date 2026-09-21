export type { CustomField } from '../../../core/models/custom-field.models';

export interface CustomFieldFormData {
  entityType: string;
  code: string;
  name: string;
  fieldType: string;
  isRequired: boolean;
  defaultValue: string;
  orderNo: number;
  optionsText: string;
}

export type EntityTypeOption = 'ALL' | 'USER' | 'PROJECT' | 'TASK' | 'NOTE';
