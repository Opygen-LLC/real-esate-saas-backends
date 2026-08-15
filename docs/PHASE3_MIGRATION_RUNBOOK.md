# Phase 3 migration and deployment runbook

Phase 3 removes platform moderation, the compliance product UI/API, and the support-ticket subsystem. It replaces listing moderation with agency-controlled `properties.publish`, keeps public-form consent in the internal privacy module, and stores platform support contact channels in platform settings.

## Preconditions

- Phase 0, Phase 1 and Phase 2 code/migrations that your installation uses are already deployed.
- Take an infrastructure-level MongoDB snapshot/backup before the destructive apply step.
- Use a backup directory on persistent storage outside the application container. The migration writes JSONL backups with SHA-256 files using owner-only filesystem permissions.
- Schedule a write-disabled maintenance window for the apply/deploy transition. Do not leave Phase 2 application/worker processes writing after the Phase 3 migration has removed legacy fields/collections.

## 1. Dry-run first

Run against the exact production connection string without `--apply`:

```bash
pnpm migrate:phase-3-agency-publishing -- --backup-dir=/secure/migration-backups
```

Review these counts carefully:

- `affectedProperties`: every property that the migration can modify;
- `propertiesWithModeration`: listings containing legacy moderation metadata;
- `nonApprovedAvailableToDraft`: currently public-looking listings that will become `Draft` because they were not approved under the old moderation state;
- `customUsers` / `customInvitations`: custom access policies that will have stale compliance permissions removed; custom agency-admin policies receive `properties.publish` to preserve their prior publishing behavior;
- `supportEmailJobs`: retired support-email queue jobs that will be removed;
- legacy support/compliance/fraud collection counts.

A dry-run changes nothing.

## 2. Begin maintenance window

1. Put the public/dashboard application behind maintenance mode or otherwise stop writes.
2. Stop API/background worker instances that can create/update properties, support tickets, compliance records, or operations jobs.
3. Confirm the infrastructure MongoDB snapshot completed successfully.
4. Make sure `/secure/migration-backups` is persistent and has sufficient free space.

## 3. Apply the migration

```bash
pnpm migrate:phase-3-agency-publishing -- --apply --confirm=PHASE3_REMOVE_LEGACY_OPERATIONS --backup-dir=/secure/migration-backups
```

The migration backs up affected records **before mutation**, verifies the affected-property backup count, then:

- changes legacy `Available` listings that were not approved to `Draft` so moderation removal cannot accidentally publish them;
- removes moderation fields and moderation indexes;
- removes stale compliance permissions from custom member/invitation access rules;
- adds `properties.publish` to custom agency-admin policies to preserve previous administrator publishing behavior;
- removes retired support-email operations jobs;
- backs up and drops the retired support/compliance/fraud collections;
- initializes missing platform support contact fields with WhatsApp/phone `+8801891793354` without overwriting already configured values;
- writes a migration manifest containing backup paths/checksums and mutation counts.

Copy the JSONL backups, `.sha256` files and manifest to protected long-term storage before ending the maintenance window.

## 4. Deploy Phase 3 code immediately

Apply the changed files from the Phase 3 frontend/backend archives and delete every path listed in each archive's `docs/PHASE3_DELETE_FILES.txt`.

Deploy backend first, then frontend. Do not restart an old backend after the migration has been applied.

## 5. Required production verification

- `GET /api/v1/platform-settings/public` returns the configured `support` object.
- `/api/v1/moderation`, `/api/v1/compliance` and `/api/v1/support` are not mounted and return the normal not-found response.
- Agency owner and default agency-admin access include `properties.publish`; default agent/staff/viewer access does not.
- An owner can grant `properties.publish` through Team → custom access without granting subscription management.
- A member without `properties.publish` can create/edit a listing but it remains `Draft` and status changes are rejected server-side.
- A member with `properties.publish` can change a listing to `Available`; only `Available` properties appear on the public site.
- Agency Support displays WhatsApp `+880 1891-793354` (unless changed by super-admin) plus any configured phone/email/social links.
- Super-admin Platform Settings can edit support contact channels and the change is audited.
- Public lead/viewing forms still create internal privacy-consent records.

## Rollback

The safest rollback is to stop writes, restore the pre-migration MongoDB snapshot, and redeploy the complete Phase 2 frontend/backend. The migration intentionally drops retired collections after writing backups, so do not attempt a partial application-level rollback without restoring those data sets. Retain the migration manifest/checksums for auditability.
