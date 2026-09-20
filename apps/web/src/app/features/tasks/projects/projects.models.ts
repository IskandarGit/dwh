import { Project, ProjectTaskStats } from '../../../core/models/task.models';
import { CustomField } from '../../../core/models/custom-field.models';

export type ProjectViewState = 'list' | 'cards';
export type ProjectStateFilter = 'all' | 'A' | 'P';

export interface ProjectCreateForm {
  name: string;
  description: string;
  attributes?: Record<string, any>;
}

export interface ProjectEditForm {
  name: string;
  description: string;
  state: 'A' | 'P';
  attributes?: Record<string, any>;
}

export interface ProjectAttributeItem {
  key: string;
  value: string;
}
