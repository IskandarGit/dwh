export type CustomFieldEntityType = 'USER' | 'PROJECT' | 'TASK' | 'NOTE' | string;
export type CustomFieldType = 'string' | 'number' | 'boolean' | 'date' | 'select' | 'user_ref';

export interface CustomField {
  id: number;
  entityType: CustomFieldEntityType;
  code: string;
  name: string;
  fieldType: CustomFieldType;
  isRequired: boolean;
  defaultValue?: string;
  optionsJson?: string;
  orderNo: number;
  createdAt: string;
}
