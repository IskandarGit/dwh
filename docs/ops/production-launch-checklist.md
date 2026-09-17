# SmartupCMS production launch checklist

**Version:** 2.0

**Updated:** 2026-09-18

Every unchecked blocking item means **NO-GO** for that installation. Evidence
must identify the release tag, environment, UTC time, command/check, result, and
owner. A commercial SLA cannot override a failed safety gate.

## Release integrity

- [ ] Release tag is immutable SemVer and resolves to the reviewed commit.
- [ ] Required CI and DCO checks are green on that commit.
- [ ] Server, web, and backup image digests match the release manifest.
- [ ] Managed host evidence confirms all five running release containers were
      configured by complete `image@sha256` references, not tags alone.
- [ ] Image signatures, provenance, and SBOMs verify successfully.
- [ ] Target-side `verify-published-release.ps1` evidence verifies checksums,
      five image signatures/attestations, and both SBOM formats.
- [ ] No Critical/High accepted vulnerability lacks a documented owner,
      mitigation, expiry date, and release decision.
- [ ] Changelog, migration notes, known limits, and rollback path are published.

## Installation and network

- [ ] Production Compose renders successfully with no default or blank required
      credential and no `latest` tag.
- [ ] Explicit container CPU and RAM limits and reservations (`deploy.resources.limits`)
      are configured for all services (`server`, `postgres`, `typesense`, `clamav`,
      `web`, `backup`), and `/tmp` tmpfs is bounded (`size=1024m`).
- [ ] Trusted proxy CIDRs (`DWH_SECURITY_TRUSTED_PROXIES`) are explicitly configured
      for the ingress topology; spoofed `X-Forwarded-For` headers cannot bypass rate limiting.
- [ ] Only the web origin is published; PostgreSQL, Typesense, server, management
      endpoints, secret files, and Docker socket are unreachable externally.
- [ ] HTTPS, certificate renewal, security headers, upload limits, and edge rate
      limits are tested from an external network.
- [ ] `.env.production` and `.secrets` have restricted ownership/permissions and
      are excluded from source control and support artifacts.
- [ ] Host capacity covers forecast data, 50 GB/month object growth assumption,
      database growth, logs, backup retention, and restore workspace with alert
      thresholds below exhaustion.

## Data and recovery

- [ ] Flyway migration succeeds from the oldest supported release and from an
      empty database using `smartupcms_migrator`.
- [ ] Runtime user `smartupcms` is verified to lack DDL, TRUNCATE, and superuser
      privileges. Monthly partition runway is established via `V033` functions.
- [ ] Upgrade stops before migration when the mandatory encrypted backup fails.
- [ ] A fresh encrypted database archive passes checksum and isolated restore.
- [ ] The age identity is recoverable by authorized operators if the application
      host is lost and is not stored only with the encrypted backup.
- [ ] Uploaded-object recovery is tested for the selected local or S3-compatible
      provider; database restore alone is not accepted.
- [ ] Combined restore evidence (`restore-combined.ps1`) reports matching database/object inventories,
      zero missing/orphan objects, successful sample downloads, row counts,
      and RPO/RTO inside approved limits.
- [ ] Measured RPO/RTO and retention are documented and fit the customer/SLA.
- [ ] Restore and rollback drills (`rollback.sh` / `rollback.ps1`) have named evidence
      and an operator who can execute them without repository authors.

## Security and access

- [ ] Initial administrator password is changed and removed from bootstrap
      configuration where supported.
- [ ] Least-privilege administrator, operator, auditor, and normal-user scenarios
      are tested; denied operations are rejected by the API.
- [ ] Configured `ALL/SUBTREE/UNITS/SELF` roles pass cross-branch task, comment,
      file metadata/download/delete and direct-ID negative tests; unexpected
      identifiers return `404`, not entity metadata.
- [ ] Idempotency filter strictly ignores secret-bearing endpoints (auth login, password reset)
      and enforces 24-hour retention with hourly background cleanup.
- [ ] File upload admission control is active (`DWH_FILES_MAX_CONCURRENT_UPLOADS: 10`)
      and task export streaming bounds (`LIMIT :maxExportRows`) are enforced.
- [ ] Session revocation, password recovery, CSRF, rate limits, and audit events
      pass the release test suite.
- [ ] Real delivery-provider and object-storage credentials are least-privilege,
      scoped to this installation, and successfully rotated in a drill.
- [ ] Named operational roles (Privacy Owner, Incident Response Lead, Backup Operator,
      Release Manager) are designated according to [privacy and retention annex](privacy-and-retention-annex.md).
- [ ] Private vulnerability reporting and the security response owner are live.

## Product workflows and UX

- [ ] Clean-install E2E covers sign-in, forced password change, navigation,
      users/roles, tasks, files, notifications, announcements, and System status.
- [ ] Authorization tests include cross-role and direct-API negative cases.
- [ ] Loading, empty, success, error, keyboard, screen-reader, and narrow-viewport
      states pass for critical workflows.
- [ ] A representative upload/download succeeds at the configured production
      size limit and interrupted upload behavior is understood.
- [ ] `DWH_FILE_SCANNER_REQUIRED=true`; the ClamAV EICAR test is rejected,
      scanner outage fails closed, and quarantine objects are removed.
- [ ] No unsafe placeholder provider or disabled module is presented as a
      working production capability.

## Operations

- [ ] `DWH_BACKUP_MAX_AGE` contains the approved non-zero recovery-point age;
      the System page reports a current backup after a verified run and becomes
      stale when a controlled test exceeds the threshold.
- [ ] Health, latency/error, capacity, certificate, backup age/failure, database,
      object storage, and delivery dead-letter alerts reach the on-call owner.
- [ ] Logs are retained, access-controlled, time-synchronized, searchable by
      request/audit identifiers, and verified free of secrets/personal payloads.
- [ ] Incident severity, escalation, maintenance window, customer communication,
      and security disclosure owners are named.
- [ ] Daily/weekly/monthly tasks in the
      [maintenance guide](maintenance-guide.md) are scheduled.
- [ ] A clean deployment on the target class of infrastructure runs for the
      agreed soak period without unexplained errors or resource growth.
- [ ] Smartup-managed installations attach passing preflight/capacity/failure
      manifests from the
      [managed infrastructure runbook](managed-infrastructure-acceptance.md);
      every omitted target-only check remains `UNVERIFIED` and blocks GO.

## Explicit release record

Record one of:

- **GO:** every blocking item is evidenced; link the evidence bundle.
- **NO-GO:** list failed items, owner, and next review date.

There is no implied GO. As of this document update, the repository itself does
not contain target-environment evidence, an approved production SLO/SLA, or a
completed four-month launch sign-off; those remain installation-specific inputs.
