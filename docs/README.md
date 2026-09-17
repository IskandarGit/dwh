# SmartupCMS documentation

This index defines the authority and navigation order for active project
documentation. Public operations documentation remains in English. The
canonical requirements document is the Russian technical specification.

## Authority tier 1 — requirements

- [Canonical technical specification](technical-specification.md) — the single
  normative requirements baseline, with stable `FR-*`, `NFR-*`, and `AC-*`
  identifiers.

If another document disagrees with the specification, current behavior is
checked against code and automated contracts and the discrepancy is tracked as
a documentation defect until requirements are formally changed.

## Authority tier 2 — current decisions

[ADR-0014](adr/ADR-0014-unified-open-source-runtime.md) defines the current
unified open-source runtime and overrides the superseded portions of older
decisions.

Current ADRs that are not superseded:

- [ADR-0002 — backend stack](adr/ADR-0002-backend-stack.md)
- [ADR-0005 — AI/ML readiness](adr/ADR-0005-ai-ml-readiness.md)
- [ADR-0012 — UI foundation](adr/ADR-0012-ui-foundation.md)
- [ADR-0013 — data scope](adr/ADR-0013-data-scope.md)

The following ADRs remain current only outside the areas explicitly replaced
by ADR-0014:

- [ADR-0001 — architecture model](adr/ADR-0001-architecture-model.md)
- [ADR-0003 — tenancy and RBAC](adr/ADR-0003-tenancy-rbac.md)
- [ADR-0006 — modular monolith](adr/ADR-0006-modular-monolith.md)
- [ADR-0008 — security baseline](adr/ADR-0008-security-baseline.md)
- [ADR-0009 — observability](adr/ADR-0009-observability.md)
- [ADR-0010 — resilience tiers](adr/ADR-0010-resilience-tiers.md)
- [ADR-0011 — provider SPI](adr/ADR-0011-provider-spi.md)

Historical, fully superseded decisions are retained for traceability only:
[ADR-0004](adr/ADR-0004-deployment-model.md) and
[ADR-0007](adr/ADR-0007-fleet-strategy.md).

## Authority tier 3 — engineering guidance

- [Developer onboarding](onboarding.md)
- [Biruni and Smartup architecture conventions](architecture/biruni-smartup-conventions.md)
- [Monorepo structure](architecture/monorepo-structure.md)
- [Database migration guidelines](guidelines/database-migrations.md)
- [Module development guide](guidelines/module-development-guide.md)
- [Testing strategy](guidelines/testing-strategy.md)
- [Centralized localization design](superpowers/specs/2026-09-04-centralized-localization-design.md)

Engineering guidance explains how to implement the current requirements and
decisions. It does not redefine either of them.

For UI copy, add a stable domain key to
`apps/server/src/main/resources/i18n/ru.json`, reference it through `t` or
`I18nService.translate`, run `npm run i18n:sync-ru`, then run
`npm run i18n:audit`. Non-Russian catalogs may be incomplete; missing values
must resolve per key through the effective Russian dictionary and are exposed
as coverage in Settings.

## Authority tier 4 — operations and security

- [Operations architecture](ops/architecture-overview.md)
- [Production deployment](ops/deployment-guide.md)
- [Maintenance, backup, and restore](ops/maintenance-guide.md)
- [Search and index maintenance](ops/search-and-index-maintenance.md)
- [Operations runbook](ops/operations-runbook.md)
- [Privacy, data protection, and retention annex](ops/privacy-and-retention-annex.md)
- [Production launch checklist](ops/production-launch-checklist.md)
- [Smartup-managed infrastructure acceptance](ops/managed-infrastructure-acceptance.md)
- [Rollback and recovery](ops/rollback.md)
- [RB-04 migration failure triage](runbooks/RB-04-migration-failure-triage.md)
- [Threat model and personal-data inventory](security/threat-model.md)

These documents govern execution for a concrete installation but cannot supply
missing product requirements, an unapproved SLO, or installation-specific
legal and ownership decisions.

## Project entry points and historical material

- [Project overview and quick start](../README.md)
- [AI project context](ai-context.md) — concise handoff for AI-assisted work;
  subordinate to this authority model and the canonical specification.
- [Contribution guide](../CONTRIBUTING.md)

`audit/` contains dated evidence and findings. `docs/superpowers/` contains
implementation and design history. Neither location overrides the canonical ТЗ
or a current ADR; consult them for traceability, not present-tense authority.
