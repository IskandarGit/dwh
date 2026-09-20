import { SearchResult } from './search.models';

export type SearchEntityType = 'TASK' | 'PROJECT' | 'USER' | 'NOTE';
export type SearchSchemaProfile = 'MIXED' | 'RU';
export type SearchJobAction = 'CHECK' | 'REBUILD' | 'ROLLBACK';
export type SearchJobState = 'QUEUED' | 'RUNNING' | 'VERIFYING' | 'ACTIVATING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface SearchFieldPolicy {
  field: string;
  weight: number;
  numTypos: number;
  prefix: boolean;
}

export interface SearchQueryPolicy {
  globalLimit: number;
  requestsPerMinute: number;
  burst: number;
  schemaProfile: SearchSchemaProfile;
  fields: {
    TASK: SearchFieldPolicy[];
    PROJECT: SearchFieldPolicy[];
    USER: SearchFieldPolicy[];
    NOTE?: SearchFieldPolicy[];
    [key: string]: SearchFieldPolicy[] | undefined;
  };
}

export interface SearchSettingsSnapshot {
  version: number;
  policy: SearchQueryPolicy;
}

export interface SearchDependencyStatus {
  enabled: boolean;
  healthy: boolean;
  version?: string | null;
  installationDiskUsedBytes?: number | null;
  installationDiskTotalBytes?: number | null;
  errorCode?: string | null;
}

export interface SearchRateBudget {
  perMinute: number;
  capacity: number;
}

export interface SearchEffectiveBudgets {
  user: SearchRateBudget;
  api: SearchRateBudget;
}

export interface SearchTransportBudgets {
  connectTimeoutMs: number;
  readTimeoutMs: number;
  fallbackTimeoutMs: number;
  searchRate?: SearchEffectiveBudgets | null;
}

export interface SearchVerificationSummary {
  missing: number;
  extra: number;
  mismatched: number;
  pending: number;
  schemaMatches: boolean;
}

export interface SearchJobStatus {
  id: string;
  action: SearchJobAction;
  generationId: string;
  state: SearchJobState;
  processedCount: number;
  failedCount: number;
  verification?: SearchVerificationSummary | null;
  errorCode?: string | null;
  retryOfJobId?: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
}

export interface SearchEntityDocumentCounts {
  TASK: number | null;
  PROJECT: number | null;
  USER: number | null;
}

export interface SearchGenerationStatus {
  id: string;
  state: string;
  active: boolean;
  registeredProfile: SearchSchemaProfile;
  documentCount?: number | null;
  entityDocumentCounts: SearchEntityDocumentCounts;
  storageBytes?: number | null;
  schemaMatches?: boolean | null;
  errorCode?: string | null;
  pendingDeliveries: number;
  failedDeliveries: number;
  queueLagSeconds?: number | null;
  createdAt: string;
}

export interface SearchRollbackTarget {
  id: string;
  schemaProfile: SearchSchemaProfile;
  lastVerifiedAt?: string | null;
}

export interface SearchManagementStatus {
  dependency: SearchDependencyStatus;
  initialized: boolean;
  activeProfile?: SearchSchemaProfile | null;
  configuredProfile?: SearchSchemaProfile | null;
  rebuildRequired?: boolean | null;
  settingsDegraded: boolean;
  lastSuccessfulReconciliation?: string | null;
  generations: SearchGenerationStatus[];
  budgets: SearchTransportBudgets;
  jobs: SearchJobStatus[];
  rollbackTargets: SearchRollbackTarget[];
}

export interface SearchJobPage {
  items: SearchJobStatus[];
  nextCursor?: string | null;
  hasMore: boolean;
}

export interface SearchPreviewRequest {
  q: string;
  entity?: SearchEntityType;
  policy?: SearchQueryPolicy;
}

export interface SearchPreviewResult {
  result: SearchResult;
  activeProfile: SearchSchemaProfile;
}

export interface SearchStartJobRequest {
  requestId: string;
  action: SearchJobAction;
  generationId?: string;
}

export interface SearchRetryJobRequest {
  requestId: string;
}

export interface SearchJobReceipt {
  id: string;
  state: SearchJobState;
}
