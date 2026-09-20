import { SearchHit } from '../models/search.models';
import { UrlMatcher } from '@angular/router';

export function canonicalRecordId(id: unknown): id is string {
  return typeof id === 'string' && /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;
}

// Keep each list and its detail on one route config: Angular retains the page's
// filters and still runs CanDeactivate when the path/record parameter changes.
export const taskRecordMatcher: UrlMatcher = segments => {
  if (segments[0]?.path !== 'tasks') return null;
  if (segments.length === 1) return { consumed: segments };
  if (segments[1]?.path !== 'items' || segments.length > 3) return null;
  return { consumed: segments, ...(segments[2] ? { posParams: { id: segments[2] } } : {}) };
};

export const projectRecordMatcher: UrlMatcher = segments => {
  if (segments[0]?.path !== 'tasks' || segments[1]?.path !== 'projects' || segments.length > 3) return null;
  return { consumed: segments, ...(segments[2] ? { posParams: { id: segments[2] } } : {}) };
};

export const userRecordMatcher: UrlMatcher = segments => {
  if (segments[0]?.path !== 'iam' || segments[1]?.path !== 'users' || segments.length > 3) return null;
  return { consumed: segments, ...(segments[2] ? { posParams: { id: segments[2] } } : {}) };
};

export function safeNumericRecordId(id: unknown): id is number {
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
}

// Legacy JSON numbers can round bigint IDs. The GET URL remains authoritative;
// this check only rejects inconsistent responses, never reconstructs an ID.
export function recordResponseMatches(id: unknown, requestedId: string): boolean {
  return canonicalRecordId(requestedId) && (id === requestedId ||
    (typeof id === 'number' && id === Number(requestedId)));
}

export function searchTarget(hit: SearchHit): string[] | null {
  if (!canonicalRecordId(hit.id)) return null;
  switch (hit.entityType) {
    case 'TASK': return ['/tasks/items', hit.id];
    case 'PROJECT': return ['/tasks/projects', hit.id];
    case 'USER': return ['/iam/users', hit.id];
    case 'NOTE': return ['/notes'];
    default: return null;
  }
}
