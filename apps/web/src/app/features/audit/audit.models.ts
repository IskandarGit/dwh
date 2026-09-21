export interface AuditRecord {
  id: number;
  tableName: string;
  rowPk: string;
  event: 'I' | 'U' | 'D';
  changedBy?: number;
  sessionId?: number;
  isApi: boolean;
  changedAt: string;
  changedColumns: string[];
  oldRow?: Record<string, any>;
  newRow?: Record<string, any>;
  changedByName?: string;
  changedByLogin?: string;
}

export interface SecurityEventRecord {
  id: number;
  eventType: string;
  userId?: number;
  ip: string;
  userAgent?: string;
  details: Record<string, any>;
  createdAt: string;
  userName?: string;
  userLogin?: string;
}

export interface AuditStats {
  totalAuditLogs: number;
  totalSecurityEvents: number;
  securityEventsLast24h: number;
  failedLoginsLast24h: number;
}

export interface AuditPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  totalEstimated: number;
}
