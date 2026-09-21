import { ProblemDetail } from '../../../core/models/common.models';
import {
  SearchEntityType,
  SearchJobAction,
  SearchQueryPolicy,
  SearchRetryJobRequest,
  SearchSettingsSnapshot,
  SearchStartJobRequest
} from '../../../core/models/search-management.models';

export type PendingMutation =
  | { kind: 'start'; request: SearchStartJobRequest }
  | { kind: 'retry'; jobId: string; request: SearchRetryJobRequest }
  | { kind: 'cancel'; jobId: string };

export interface MaintenanceConfirmation {
  action: Extract<SearchJobAction, 'REBUILD' | 'ROLLBACK'>;
  generationId?: string;
}

export function validateSearchPolicy(policy: SearchQueryPolicy | null, entities: readonly SearchEntityType[]): string[] {
  if (!policy) return ['settings.search.validation.unavailable'];
  const errors: string[] = [];
  if (!Number.isInteger(policy.globalLimit) || policy.globalLimit < 1 || policy.globalLimit > 50)
    errors.push('settings.search.validation.global_limit');
  if (!Number.isInteger(policy.requestsPerMinute) || policy.requestsPerMinute < 30 || policy.requestsPerMinute > 600)
    errors.push('settings.search.validation.rate');
  if (!Number.isInteger(policy.burst) || policy.burst < 10 || policy.burst > 60 || policy.burst > policy.requestsPerMinute)
    errors.push('settings.search.validation.burst');
  for (const entity of entities) {
    const fields = policy.fields[entity] ?? [];
    if (fields.length === 0) {
      if (entity === 'NOTE') continue;
      errors.push('settings.search.validation.searchable_field');
      continue;
    }
    if (!fields.some(field => Number.isInteger(field.weight) && field.weight > 0))
      errors.push('settings.search.validation.searchable_field');
    if (fields.some(field => !Number.isInteger(field.weight) || field.weight < 0 || field.weight > 127))
      errors.push('settings.search.validation.weight');
    if (fields.some(field => !Number.isInteger(field.numTypos) || field.numTypos < 0 || field.numTypos > 2))
      errors.push('settings.search.validation.typos');
  }
  return [...new Set(errors)];
}

export function cloneSearchSnapshot(snapshot: SearchSettingsSnapshot): SearchSettingsSnapshot {
  return { version: snapshot.version, policy: cloneSearchPolicy(snapshot.policy) };
}

export function cloneSearchPolicy(policy: SearchQueryPolicy): SearchQueryPolicy {
  return structuredClone(policy);
}

export function toProblemDetail(error: unknown, fallbackTitle: string, fallbackDetail: string): ProblemDetail {
  if (error && typeof error === 'object' && 'status' in error && 'detail' in error) return error as ProblemDetail;
  return {
    title: fallbackTitle,
    status: 0,
    code: 'NETWORK_ERROR',
    detail: fallbackDetail
  };
}

export function formatBytes(value: number | null | undefined, unknownLabel: string): string {
  if (value === null || value === undefined) return unknownLabel;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GiB`;
}

export function formatJobError(code: string | null | undefined, translate: (key: string) => string): string {
  if (!code) return '';
  const known: Record<string, string> = {
    DEPENDENCY_UNAVAILABLE: 'settings.search.error.dependency_unavailable',
    COLLECTION_MISSING: 'settings.search.error.collection_missing',
    STORAGE_CAPACITY_EXCEEDED: 'settings.search.error.storage_capacity',
    GENERATION_CAPACITY_EXCEEDED: 'settings.search.error.generation_capacity',
    VERIFICATION_FAILED: 'settings.search.error.verification_failed'
  };
  return translate(known[code] ?? 'settings.search.error.generic_job');
}
