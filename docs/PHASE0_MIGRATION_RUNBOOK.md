# Phase 0 migration runbook

All Phase 0 migrations are dry-run by default. Run them against a staging copy first and keep the generated JSONL backup plus SHA-256 file outside the application container before applying production changes.

## 1. Contract/index migration

```bash
pnpm migrate:phase-0-contracts
pnpm migrate:phase-0-contracts -- --apply --backup-dir=/secure/migration-backups
```

This creates indexes for the new manual subscription payment/change-request contracts and privacy-consent queries. It does not change existing business data.

## 2. Property media migration

Dry-run:

```bash
pnpm migrate:phase-0-media
```

Apply only after reviewing the counts:

```bash
pnpm migrate:phase-0-media -- --apply --confirm=APPLY_PROPERTY_MEDIA_V1 --backup-dir=/secure/migration-backups
```

The apply mode creates a JSONL backup with SHA-256 checksum before it:

- trims properties above 20 photos using featured/order priority;
- normalizes legacy galleries that contain multiple featured images to at most one featured image;
- copies legacy `videos[]` links into the structured `mediaLinks[]` contract when `mediaLinks` is empty.

Legacy `videos[]` remains untouched during Phase 0 for runtime compatibility.

## 3. Moderation removal

The old Phase 0 moderation-removal script has been retired. **Do not use the earlier `migrate:phase-0-moderation` command.** Phase 3 now owns this destructive transition through `migrate:phase-3-agency-publishing`, which backs up every property it can modify, converts previously non-approved `Available` listings to `Draft`, removes the legacy fields/indexes, migrates custom access rules, and removes the retired operational modules.

Follow `docs/PHASE3_MIGRATION_RUNBOOK.md` for the production sequence.

## Deployment order

For installations already moving to Phase 3, follow the Phase 3 runbook instead of the historical Phase 0 deployment order. The Phase 0 contract and media migrations remain valid prerequisites when they have not yet been applied.
