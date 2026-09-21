# SmartupCMS privacy, data protection, and retention annex

**Version:** 2.0  
**Updated:** 2026-09-18  
**Scope:** Authoritative baseline for single-tenant SmartupCMS deployments, covering role responsibilities, personal data inventory, data classifications, retention lifecycle policies, and security incident escalation.

---

## 1. Operational roles and ownership

Every production installation must explicitly designate named individuals or on-call teams for the following operational roles prior to production launch:

| Role | Core responsibilities | Default escalation target |
|---|---|---|
| **Data Protection / Privacy Owner** | Formulates and approves data classification, retention periods, subject access requests (DSAR), and regulatory compliance (GDPR/local privacy laws). | Compliance officer / Legal lead |
| **Security & Incident Lead** | Owns threat response, CVE vulnerability triage, brute-force/rate-limit alerts, secret rotation drills, and breach notifications. | Information Security on-call |
| **Database & Backup Operator** | Manages Flyway migration execution, least-privilege DB roles, monthly partition maintenance, and monthly isolated combined restore drills. | Lead Infrastructure Engineer |
| **Release & Deployment Manager** | Authorizes production deployments, verifies immutable image digests, signatures, SBOMs, and changelog publications. | Technical Lead / Operations Lead |

> [!IMPORTANT]
> The software provides technical guardrails (least privilege roles, redaction, immutable partitions, encryption), but compliance requires that named owners actively execute the operational duties defined in this annex.

---

## 2. Data classification matrix

All data processed and stored by SmartupCMS is classified into four sensitivity tiers:

| Tier | Definition | Examples | Storage location | Protection controls |
|---|---|---|---|---|
| **Public** | Information approved for unauthenticated public access. | OpenAPI schema (`/api/v1/openapi.json`), public documentation, favicon/static web assets. | NGINX, web container | Cache-Control headers, read-only filesystem. |
| **Internal** | Non-sensitive operational data accessible to all authenticated organization users. | Module registry (`md_module_registry`), custom field definitions, system status (`/api/v1/system/info`), organization structure names. | PostgreSQL (`public`) | Scoped RBAC, authentication required. |
| **Confidential** | Business workflows, user tasks, uploaded documents, and communications. | Task details (`ms_tasks`), comments, notes (`ms_notes`), uploaded attachments (`mf_files`). | PostgreSQL, S3/MinIO object store | Data scope RBAC (`ALL`, `SUBTREE`, `UNITS`, `SELF`), malware scanning via ClamAV, object lock, OCC revisions. |
| **Restricted (Sensitive)** | Authentication credentials, security keys, audit logs, and encrypted backups. | User passwords (Argon2id), API tokens (SHA-256), session tokens, audit log entries (`audit_log`, `security_events`), age encrypted backups. | PostgreSQL, encrypted backup volumes | `AuditDataRedactor` credential redaction, least privilege DB users, age encryption, `SECURITY DEFINER` partition functions. |

---

## 3. Personal data (PII) inventory

SmartupCMS minimizes personal data collection to what is strictly necessary to operate the collaboration platform:

| Data element | Source | Purpose | Legal basis / Justification | Logging & redaction policy |
|---|---|---|---|---|
| **User identifier & login** | Administrator provisioning | User identification & authentication | Legitimate interest / Contract | Plaintext in audit log for accountability. |
| **Full name & email** | User profile | Notifications, assignment attribution | Contract / Communication | Plaintext in UI; email masked in unauthenticated flows. |
| **Password** | User input | Authentication | Contract / Authentication | **Never stored in plaintext.** Salted Argon2id hash only. Redacted from logs (`[REDACTED]`). |
| **Session cookie & API tokens** | System generation | API & web session management | Security / Authentication | Tokens hashed with SHA-256 before database storage. Bearer tokens omitted from audit payload diffs. |
| **Client IP address** | Ingress connection | Abuse prevention, security auditing, rate limiting | Security / Defense | Resolved via `ClientIpResolver` (trusted proxy validation). Stored in `security_events` and `audit_log`. |
| **User agent** | HTTP request header | Session management & forensic analysis | Security | Stored in `kauth_sessions` and `security_events`. |
| **Task / note user content** | User input | Business operations & collaboration | Legitimate interest | Protected by scope filters. Exportable via scoped CSV/XML reports. |

---

## 4. Data retention and lifecycle policies

Data is retained only as long as operationally necessary or legally mandated. Automated background routines and partition maintenance enforce lifecycle bounds:

```
+-----------------------------------------------------------------------------------+
|                            RETENTION LIFECYCLE SUMMARY                            |
+------------------------------------+-----------------------+----------------------+
| Data Category                      | Default Retention     | Enforcement Method   |
+------------------------------------+-----------------------+----------------------+
| Active audit log partitions        | 12 months             | PostgreSQL table     |
| Detached archived audit partitions | Per corporate policy  | Cold S3 / compressed |
| Idempotency keys & cached payloads | 24 hours              | IdempotencyWorker    |
| Inactive user sessions             | 7 days                | Auto-pruned on login |
| Rate-limit in-memory tracking      | 10 minutes sliding    | Caffeine cache TTL   |
| Local database backup archives     | 7 days (14 snapshots) | backup-loop.sh       |
| Remote object backups              | Defined by bucket S3  | S3 Lifecycle rules   |
+------------------------------------+-----------------------+----------------------+
```

### 4.1. Audit log partition lifecycle
- `audit_log` uses monthly declarative range partitioning (`audit_log_YYYY_MM`).
- Migration `V033` establishes restricted `SECURITY DEFINER` functions:
  - `audit_log_create_partition(p_year, p_month)` pre-creates runway partitions.
  - `audit_log_detach_partition(p_year, p_month)` cleanly detaches partitions older than the retention threshold without blocking concurrent writes.
- Detached partitions may be archived to cold storage or compressed using `pg_dump` with age encryption.

### 4.2. Idempotency records
- Used to protect mutation endpoints (e.g. task creation).
- Retained for a maximum TTL of 24 hours.
- Automated `IdempotencyCleanupWorker` executes hourly to purge expired records.

### 4.3. Backup retention
- Local encrypted database dumps created by `backup-loop.sh` retain the most recent 14 snapshots (default 7 days of bi-daily backups).
- Remote object store archives should configure automated S3 Lifecycle expiration policies in accordance with organizational compliance requirements.

---

## 5. Security incident escalation protocol

In the event of a suspected security event, service degradation, or data breach, the operator must execute the following escalation path:

### 5.1. Severity classification

| Level | Criteria | Initial response SLA | Required notifications |
|---|---|---|---|
| **P1 - Critical** | Confirmed data exfiltration, active credential compromise, total outage, or unauthorized data destruction. | Immediate (< 15 min) | Security Lead, Privacy Owner, Executive Sponsor |
| **P2 - Major** | Failed backup runway, persistent DB connection pool exhaustion, broken rate-limiter, or scanner failure. | < 2 hours | Security Lead, Infrastructure Lead |
| **P3 - Minor** | Local rate-limit trigger on single IP, isolated UI cosmetic defect, or transient search sync catchup. | Same business day | On-call Engineer |

### 5.2. Incident response action checklist
1. **Preserve evidence**:
   - Capture container logs: `docker compose -f deploy/compose/docker-compose.prod.yml --env-file .env.production logs --since 1h > incident-logs.txt`.
   - Take read-only snapshot of `security_events` table for the affected period.
   - Do not delete containers, truncate tables, or wipe disk volumes before evidence collection.
2. **Containment**:
   - If a specific user account is compromised: revoke active sessions via `/api/v1/auth/sessions` and lock user account.
   - If an IP is malicious: add host firewall rule (`iptables` / Cloudflare WAF block).
   - If an application vulnerability is suspected: halt external traffic at NGINX ingress (`503 Service Unavailable` maintenance page).
3. **Remediation & Rollback**:
   - For software defect: execute verified rollback procedure using `scripts/prod/rollback.sh` or `rollback.ps1`.
   - For corrupted data: execute point-in-time restore using `scripts/prod/restore-combined.ps1` into an isolated recovery environment.
4. **Post-incident review**:
   - Conduct root-cause analysis (RCA) within 3 business days.
   - Update threat model (`docs/security/threat-model.md`) and operational runbooks.
