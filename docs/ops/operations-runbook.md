# SmartupCMS operations runbook

**Version:** 2.0

**Updated:** 2026-09-05

**Audience:** the operator responsible for one SmartupCMS installation.

Use the exact production Compose and environment files for every command:

```bash
docker compose -f deploy/compose/docker-compose.prod.yml \
  --env-file .env.production ps
```

## Severity and first response

| Severity | Examples | First response target |
|---|---|---|
| P1 | unavailable installation, active compromise, confirmed data loss/corruption | immediate |
| P2 | failed migration/backup, widespread sign-in failure, sustained delivery failure | same working day |
| P3 | degraded performance, isolated provider failure, capacity warning | planned with owner |

For P1/P2: record UTC time, release tag, affected workflows, service state, and
sanitized logs; stop further rollout; protect evidence; identify an incident
owner. Never paste credentials, session cookies, personal data, object contents,
or database dumps into a public issue.

## Daily checks

```bash
docker compose -f deploy/compose/docker-compose.prod.yml \
  --env-file .env.production ps
curl --fail --silent --show-error http://127.0.0.1:8080/healthz
```

Confirm all long-running services are healthy, the backup status in the System
screen is successful and younger than the accepted RPO, disk usage is below the
operator threshold, TLS is valid, and error/dead-letter alerts are quiet.

## Service is unavailable

Capture evidence before restarting:

```bash
docker compose -f deploy/compose/docker-compose.prod.yml \
  --env-file .env.production logs --since 30m server web postgres typesense
```

Check in order:

1. `web` health and host reverse-proxy/TLS routing.
2. `server` readiness and its PostgreSQL/Typesense connection errors.
3. PostgreSQL health, disk capacity, and filesystem errors.
4. Whether a migration failed or the release tag changed unexpectedly.

Restart only the failed stateless service when the cause is understood:

```bash
docker compose -f deploy/compose/docker-compose.prod.yml \
  --env-file .env.production up -d --wait web server
```

Do not delete volumes, edit Flyway history, or repeatedly restart a corrupt
database. Use [rollback](rollback.md) when a release caused the incident.

## Sign-in or authorization failure

- Confirm whether the failure affects one user, one role, or every user.
- Check browser time, TLS, cookie/CSRF errors, account state, and recent role
  changes.
- Reproduce the denied API request with a test account of the same role; do not
  weaken server-side permission checks to restore access.
- Review audit entries for account, role, token, and session changes.
- If all administrators are locked out, preserve evidence and use a documented,
  reviewed recovery procedure. No emergency default password is provided.

An action visible in the UI but rejected by the API is a UI permissions defect;
an action accepted by the API without permission is a P1 security incident.

## Backup failure or stale status

```bash
docker compose -f deploy/compose/docker-compose.prod.yml \
  --env-file .env.production logs --since 24h backup
bash scripts/prod/backup.sh
```

Check the age recipient, read-only database credential, target capacity, and
S3/R2 endpoint/permissions. The backup process deliberately exits non-zero if
dump, encryption, checksum, or upload fails. Do not run a migration until a
one-shot backup succeeds or a documented risk owner explicitly stops the
release.

Backup recovery is not proven until [an isolated restore drill](maintenance-guide.md#restore-drill)
passes. Database success does not prove recovery of uploaded objects.
Use `backup-objects.ps1` and `restore-combined.ps1` for the release drill; the
combined evidence must reject a missing/wrong age key, partial object archive,
inventory mismatch, or RPO/RTO breach.

## Search failure

If PostgreSQL-backed workflows work but search fails, inspect Typesense and
server logs. Keep Typesense private and never point the browser directly at it.
Because the search index is derived data, prefer a documented reindex over
restoring it as authoritative state. Confirm authorization filtering after any
reindex.

## Notification or webhook failure

Check whether a real provider was explicitly selected; console providers do not
deliver externally. Inspect sanitized server logs and dead-letter state, then
test provider DNS/TLS, credential scope, quota, and destination policy. Avoid
retry storms: fix the cause before replaying failed deliveries.

Webhooks are fail-closed unless `DWH_WEBHOOKS_ENABLED=true` and every destination
host is present in `DWH_WEBHOOKS_ALLOWED_HOSTS`. Do not add wildcard hosts. Keep
`DWH_WEBHOOKS_ALLOW_PRIVATE_ADDRESSES=false` on Smartup-managed or
internet-facing installations. A client-owned private target may opt in only
after the destination and network boundary are reviewed. The API returns a
signing secret only when the subscription is created; rotate by replacing the
subscription if that one-time value is lost or exposed.

## Storage failure

For local storage, check `server-data` capacity, permissions, and host health.
For S3-compatible storage, check endpoint reachability, bucket policy,
credentials, region/path-style settings, quota, and provider incident status.
Do not switch providers during an incident without an inventory and migration
plan; database metadata and object bytes must stay consistent.

## Suspected compromise

1. Restrict external access without destroying containers or volumes.
2. Preserve UTC logs, image digests, Compose configuration, audit records, and
   provider access logs in a protected location.
3. Revoke affected sessions, API/provider credentials, and edge tokens.
4. Report privately according to [SECURITY.md](../../SECURITY.md).
5. Recover from verified images and backups; validate permissions and object
   integrity before reopening access.

## Database roles and least privilege

SmartupCMS enforces strict role separation across database operations:
- **`smartupcms_migrator`**: Schema owner with DDL privileges. Used only by Flyway during bootstrap and release upgrades.
- **`smartupcms`**: Application runtime user. Has DML privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) on public tables; lacks `CREATE TABLE`, `DROP`, `ALTER`, `TRUNCATE`, and superuser privileges.
- **`smartupcms_backup`**: Read-only user (`SELECT` on public tables + `pg_read_all_data`) used by `backup-loop.sh`.

If an application feature reports `permission denied for table ...` or fails with DDL errors at runtime, confirm the runtime is connecting as `smartupcms` and that Flyway was successfully run by `smartupcms_migrator`.

## Audit partition maintenance

Audit logs are partitioned monthly into `audit_log_YYYY_MM` tables:
- An automated worker maintains a forward partition runway of at least 3 months.
- Under least privilege, the runtime user invokes restricted `SECURITY DEFINER` functions:
  ```sql
  -- Manually create a future partition:
  SELECT audit_log_create_partition(2026, 11);

  -- Manually detach an aged partition for archival:
  SELECT audit_log_detach_partition(2025, 9);
  ```
- If partition creation fails, inspect postgres logs to verify function permissions and ensure disk space is sufficient.

## Search outbox sync and reconciliation

Mutations to tasks, files, and notes are staged transactionally in `search_outbox` and asynchronously delivered to Typesense by `SearchDeliveryWorker`:
- Transient Typesense outages do not abort client transactions. Events retry with exponential backoff and jitter up to 8 attempts.
- If search results become stale, check the outbox queue status and trigger reconciliation via the management API:
  ```bash
  curl -X POST http://127.0.0.1:8080/api/v1/search/management/reconcile \
    -H "Authorization: Bearer dwh_operator_token"
  ```
- Alternatively, restarting the server container triggers non-blocking startup reconciliation automatically.

## Task optimistic concurrency conflicts (HTTP 409)

Tasks enforce monotonic compare-and-set versioning via the `revision` column:
- If two users or processes modify the same task concurrently with a stale `expectedRevision`, the API returns HTTP 409 with error code `task_revision_conflict`.
- Triage: The UI prompts the user to refresh the task to view the latest changes before reapplying edits. If automated integrations receive 409, they should re-fetch the current task revision and retry.

## Rate limiting and upload concurrency (HTTP 429)

- **API and Auth Rate Limiting**: Client IPs are resolved via trusted proxy validation (`ClientIpResolver`). Floods from an untrusted origin or brute-force attempts are rejected with HTTP 429 (`RATE_LIMITED`).
- **File Upload Admission**: File uploads acquire a permit from an in-memory semaphore (default 10 permits). If the server reaches capacity under burst load, excess uploads return HTTP 429 immediately rather than exhausting server heap.
- Triage: Inspect NGINX logs for authentic client IPs and evaluate whether `dwh.security.rate-limit.login.capacity` or `dwh.files.max-concurrent-uploads` require adjustment for enterprise scale.

## Export streaming and memory bounding

- Task exports (`/api/v1/reports/tasks-export-csv` and XML) stream directly to the client with `defaultRowFetchSize: 500` and a hard cap (`dwh.reports.export.max-rows`, default 50,000 rows).
- If a client disconnects mid-download, `ReportService` catches `ClientAbortException | IOException`, cleanly aborts the database cursor, and returns the Hikari connection to the pool without leaking resources.

## Incident closure

Document impact, timeline, root cause, data/security assessment, remediation,
test evidence, and follow-up owner/date. Update this runbook when the actual
recovery path differed from the documented one.
