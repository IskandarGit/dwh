import { Task, Project, TaskStatus, TaskType, TaskMember } from '../../core/models/task.models';
import { CustomField } from '../../core/models/custom-field.models';
import { User } from '../../core/models/auth.models';
import { SelectOption } from '../../shared/ui/ui-searchable-select.component';
import { I18nService } from '../../core/services/i18n.service';

export interface TaskDeadlineInfo {
  state: 'none' | 'overdue' | 'today' | 'tomorrow' | 'upcoming';
  label: string;
  detail?: string;
}

export interface TaskCreateFormValue {
  title: string;
  taskType: string;
  descriptionMarkdown: string;
  projectId: number | null;
  priority: string;
  responsibleUserId: number | null;
  parentTaskId: number | null;
  executorUserIds: number[];
  observerUserIds: number[];
  beginTime: string;
  endTime: string;
  attributes: Record<string, any>;
}

export interface TaskEditFormValue {
  title: string;
  taskType: string;
  descriptionMarkdown: string;
  projectId: number | null;
  priority: string;
  responsibleUserId: number | null;
  parentTaskId: number | null;
  executorUserIds: number[];
  observerUserIds: number[];
  beginTime: string;
  endTime: string;
  attributes: Record<string, any>;
}

export interface GroupedTaskMembers {
  responsible: TaskMember | null;
  executors: TaskMember[];
  observers: TaskMember[];
  author: TaskMember | null;
  others: TaskMember[];
}

export function groupMembersByRole(members: TaskMember[]): GroupedTaskMembers {
  const result: GroupedTaskMembers = {
    responsible: null,
    executors: [],
    observers: [],
    author: null,
    others: []
  };

  for (const m of members) {
    const kind = m.involveKind || m.involvementKind;
    if (kind === 'R') {
      result.responsible = m;
    } else if (kind === 'E') {
      result.executors.push(m);
    } else if (kind === 'O') {
      result.observers.push(m);
    } else if (kind === 'A') {
      result.author = m;
    } else {
      result.others.push(m);
    }
  }

  return result;
}

export function createDefaultTaskCreateForm(projectId: number | null = null, defaultType = 'task'): TaskCreateFormValue {
  return {
    title: '',
    taskType: defaultType,
    descriptionMarkdown: '',
    projectId,
    priority: 'medium',
    responsibleUserId: null,
    parentTaskId: null,
    executorUserIds: [],
    observerUserIds: [],
    beginTime: '',
    endTime: '',
    attributes: {}
  };
}

export function getTypeObj(task: Task, taskTypes: TaskType[]): TaskType | null {
  const code = (task.attributes && task.attributes['task_type']) || 'task';
  return taskTypes.find(ty => ty.code === code) || null;
}

export function getTypeLabel(task: Task, taskTypes: TaskType[], uiI18n: I18nService): string {
  const obj = getTypeObj(task, taskTypes);
  return obj ? obj.name : uiI18n.translate('tasks.zadacha');
}

export function getTypeIcon(task: Task, taskTypes: TaskType[]): string {
  const obj = getTypeObj(task, taskTypes);
  return obj ? obj.icon : 'task_alt';
}

export function getTypeColor(task: Task, taskTypes: TaskType[]): string {
  const obj = getTypeObj(task, taskTypes);
  return obj ? obj.color : 'var(--primary)';
}

export function getTypeBg(task: Task, taskTypes: TaskType[]): string {
  const obj = getTypeObj(task, taskTypes);
  if (!obj) return 'var(--bg-hover)';
  return `${obj.color}18`;
}

export function getProjectName(projectId: number | null | undefined, projects: Project[]): string | null {
  if (!projectId) return null;
  const p = projects.find(x => x.id === projectId);
  return p ? p.name : `#${projectId}`;
}

export function getStatusName(statusId: number | null | undefined, statuses: TaskStatus[], uiI18n: I18nService): string {
  if (!statusId) return uiI18n.translate('tasks.novaya');
  const s = statuses.find(x => x.id === statusId);
  return s ? s.name : uiI18n.translate('tasks.v_rabote');
}

export function getStatusColor(statusId: number | null | undefined, statuses: TaskStatus[]): string {
  if (!statusId) return 'var(--primary)';
  const s = statuses.find(x => x.id === statusId);
  return s?.color || 'var(--primary)';
}

export function getPriorityLabel(priority: string, uiI18n: I18nService): string {
  switch (priority) {
    case 'critical':
    case 'urgent':
      return uiI18n.translate('tasks.kriticheskiy');
    case 'high':
      return uiI18n.translate('task.priority.high');
    case 'medium':
    case 'normal':
      return uiI18n.translate('tasks.sredniy');
    default:
      return uiI18n.translate('task.priority.low');
  }
}

export function isOverdue(endTime: string | null | undefined, statusId: number, statuses: TaskStatus[]): boolean {
  if (!endTime) return false;
  const s = statuses.find(x => x.id === statusId);
  if (s && s.isTerminal) return false;
  return new Date(endTime).getTime() < Date.now();
}

export function getDeadlineInfo(endTime: string | null | undefined, statusId: number, statuses: TaskStatus[], uiI18n: I18nService): TaskDeadlineInfo {
  if (!endTime) return { state: 'none', label: '—' };
  const s = statuses.find(x => x.id === statusId);
  if (s && s.isTerminal) {
    const d = new Date(endTime);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return { state: 'upcoming', label: `${day}.${month}.${d.getFullYear()}` };
  }

  const targetDate = new Date(endTime);
  const now = new Date();
  const diffMs = targetDate.getTime() - now.getTime();

  const isToday = targetDate.getFullYear() === now.getFullYear() &&
                  targetDate.getMonth() === now.getMonth() &&
                  targetDate.getDate() === now.getDate();
  if (isToday) {
    const hours = String(targetDate.getHours()).padStart(2, '0');
    const mins = String(targetDate.getMinutes()).padStart(2, '0');
    return {
      state: 'today',
      label: `${uiI18n.translate('tasks.deadline_today')}, ${hours}:${mins}`
    };
  }

  if (diffMs < 0) {
    const overdueDays = Math.max(1, Math.floor(Math.abs(diffMs) / (1000 * 60 * 60 * 24)));
    const day = String(targetDate.getDate()).padStart(2, '0');
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    return {
      state: 'overdue',
      label: uiI18n.translate('tasks.deadline_overdue_days', { days: overdueDays }),
      detail: `${day}.${month}.${targetDate.getFullYear()}`
    };
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = targetDate.getFullYear() === tomorrow.getFullYear() &&
                    targetDate.getMonth() === tomorrow.getMonth() &&
                    targetDate.getDate() === tomorrow.getDate();
  if (isTomorrow) {
    return {
      state: 'tomorrow',
      label: uiI18n.translate('tasks.deadline_tomorrow')
    };
  }

  const day = String(targetDate.getDate()).padStart(2, '0');
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  return {
    state: 'upcoming',
    label: `${day}.${month}.${targetDate.getFullYear()}`
  };
}

export function getInvolveKindLabel(kind: string | undefined, uiI18n: I18nService): string {
  switch (kind) {
    case 'R': return uiI18n.translate('task.responsible');
    case 'E': return uiI18n.translate('tasks.ispolnitel');
    case 'O': return uiI18n.translate('tasks.nablyudatel');
    case 'A': return uiI18n.translate('tasks.avtor');
    default: return uiI18n.translate('tasks.uchastnik');
  }
}

export function getInitials(name: string | undefined): string {
  if (!name) return 'U';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

export function hasAttributes(attrs: any): boolean {
  if (!attrs || typeof attrs !== 'object') return false;
  const keys = Object.keys(attrs).filter(k => k !== 'task_type');
  return keys.length > 0;
}

export function formatAttributes(
  attrs: any,
  taskCustomFields: CustomField[],
  responsibleUsers: User[],
  observerUsers: User[],
  uiI18n: I18nService
): Array<{ key: string; value: string }> {
  if (!hasAttributes(attrs)) return [];
  return Object.entries(attrs)
    .filter(([k]) => k !== 'task_type')
    .map(([k, v]) => {
      const field = taskCustomFields.find(f => f.code === k);
      const keyLabel = field ? field.name : k;
      let valueStr = String(v ?? '');
      if (field?.fieldType === 'boolean') {
        valueStr = v === true || v === 'true'
          ? uiI18n.translate('common.yes')
          : uiI18n.translate('common.no');
      } else if (field?.fieldType === 'user_ref') {
        const user = responsibleUsers.find(u => u.id === Number(v))
          || observerUsers.find(u => u.id === Number(v));
        if (user) {
          valueStr = user.name || user.login;
        }
      } else if (field?.fieldType === 'select' && field.optionsJson) {
        try {
          const opts = JSON.parse(field.optionsJson);
          if (Array.isArray(opts)) {
            const matched = opts.find(o => typeof o === 'object' && o !== null ? o.value === v : o === v);
            if (matched && typeof matched === 'object' && matched.label) {
              valueStr = matched.label;
            }
          }
        } catch {
          // ignore
        }
      }
      return { key: keyLabel, value: valueStr };
    });
}

export function sameIdSet(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every(id => rightIds.has(id));
}

export function mergeOptions(existing: SelectOption[], incoming: SelectOption[]): SelectOption[] {
  const merged = new Map<string, SelectOption>();
  [...existing, ...incoming].forEach(option => merged.set(String(option.id), option));
  return [...merged.values()];
}

export function mergeUserResults(existing: User[], incoming: User[], selectedIds: number[], retainedUsers: Map<number, User>): User[] {
  incoming.forEach(user => retainedUsers.set(user.id, user));
  const selected = selectedIds.map(id => retainedUsers.get(id)).filter((user): user is User => !!user);
  const merged = new Map<number, User>();
  [...existing, ...incoming, ...selected].forEach(user => merged.set(user.id, user));
  return [...merged.values()];
}
