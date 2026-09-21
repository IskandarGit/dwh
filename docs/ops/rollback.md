# SmartupCMS release rollback and recovery

**Version:** 2.0

**Updated:** 2026-09-06

Choose image rollback only when the previous server is compatible with the
current database schema. If compatibility is unknown or data is damaged, use
the encrypted pre-migration backup. Never reverse Flyway history or improvise
destructive SQL during an incident.

## Decision table

| Condition | Action |
|---|---|
| New web image fails; API and data are healthy | roll back `web` image only |
| New server fails; migration did not run | roll back `server` and `web` images |
| Migration completed; previous server has verified schema, writer and security/data-semantics compatibility | roll back images and verify |
| Authentication generations have advanced and old-writer compatibility is unverified | keep old writers stopped; use a tested compatible forward fix or an authorized restore |
| Previous server rejects the schema | restore the pre-migration backup |
| Data is corrupted or unauthorized writes occurred | contain incident, then restore verified data and objects |
| Only search index is damaged | rebuild derived index; do not roll back authoritative data |

## Preserve evidence

Before changing state, record the UTC incident time, current and previous image
digests, environment release tag, service state, and sanitized logs:

```bash
docker compose -f deploy/compose/docker-compose.prod.yml \
  --env-file .env.production ps
docker compose -f deploy/compose/docker-compose.prod.yml \
  --env-file .env.production images
docker compose -f deploy/compose/docker-compose.prod.yml \
  --env-file .env.production logs --since 30m server web migrate
```

Store evidence outside ephemeral containers. Do not include `.env.production`,
cookies, tokens, personal data, or object contents.

## Image rollback

For releases that activate authentication generations, drain and stop every old
server writer before starting the new version. The additive schema alone does
not make mixed old/new writers safe: an old writer neither checks nor advances
the generation. After any user's generation has advanced, application-only
rollback to an old writer is not validated. Keep traffic closed and use a
tested compatible forward fix or a separately authorized restore. Do not turn
this limitation into an automatic global logout or destructive credential
reset.

Set `APP_VERSION` in `.env.production` to the exact previous verified tag, or run the supported rollback script:

```bash
bash scripts/prod/rollback.sh
```

```powershell
./scripts/prod/rollback.ps1
```

Or execute manually:

```bash
docker compose -f deploy/compose/docker-compose.prod.yml \
  --env-file .env.production pull server web
docker compose -f deploy/compose/docker-compose.prod.yml \
  --env-file .env.production up -d --wait server web
```

Do not run `migrate` during image rollback. If readiness/schema checks reject the
older server, stop and restore. After a successful start, verify HTTPS health,
administrator and normal-user sign-in, one read/write workflow, denied
authorization, file access, search, audit, and provider queues.

## Database restore

Identify the encrypted pre-migration `.dump.age`, its `.sha256`, and the matching
age identity. Confirm the backup timestamp and expected data loss window. Stop
incoming traffic before restore.

Linux/macOS:

```bash
bash scripts/prod/restore.sh \
  /secure/pre-migration.dump.age \
  /secure/backup-age-identity.txt
```

PowerShell:

```powershell
./scripts/prod/restore.ps1 `
  -BackupFile C:\secure\pre-migration.dump.age `
  -AgeIdentityFile C:\secure\backup-age-identity.txt
```

The script verifies checksum and archive catalog before stopping the server,
renames the current database to a timestamped recovery name, streams decrypted
data directly into a clean database, applies current forward migrations,
refreshes the backup role, and waits for health. If the restore fails after the
database rename, keep traffic closed and preserve both databases for recovery.

Restore uploaded objects separately from the tested local-volume or
S3-compatible recovery source, then verify database metadata and object bytes
refer to a consistent point. A database-only rollback can leave missing or
orphaned objects.

## Reopen and close

Before reopening traffic:

- compare expected release and image digests;
- verify critical workflows and direct-API authorization negatives;
- confirm audit continuity, backup status, and object recovery;
- rotate credentials if compromise was possible;
- start enhanced error, latency, and integrity monitoring.

Record impact, data-loss interval, recovery duration, root cause, and the test or
gate that will prevent recurrence. Do not redeploy the failed release until that
gate is green.
