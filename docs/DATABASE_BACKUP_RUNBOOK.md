# Production Database Disaster-Recovery Backup Runbook

## Scope

The `database-backup` service is a dedicated scheduler. It is deliberately separate from API replicas and from `migrationSafety.ts`.

Every scheduled run:

1. acquires a single-run lock;
2. inventories the source application database;
3. runs MongoDB Database Tools `mongodump` to a compressed archive;
4. calculates archive size and SHA-256;
5. restores the archive into a **new dated database on the secondary MongoDB cluster**;
6. inventories the source again and the restored database;
7. verifies collection presence, document counts against the observed before/after range, collection options, and index definitions;
8. writes a JSON manifest locally and to `BACKUP_MANIFEST_DATABASE_NAME.database_backups` on the secondary cluster;
9. removes expired recovery points only after a successful verified backup, while always preserving `BACKUP_MIN_RECOVERY_POINTS`.

A failed or unverified restore is never marked successful.

## Required production configuration

```env
DATABASE_URL=mongodb+srv://.../real-estate-saas
BACKUP_DATABASE_URL=mongodb+srv://.../backup-control
BACKUP_CRON=0 3 * * *
BACKUP_TIMEZONE=Asia/Dhaka
BACKUP_DATABASE_PREFIX=real_estate_saas_backup
BACKUP_MANIFEST_DATABASE_NAME=real_estate_saas_backup_control
BACKUP_RETENTION_DAYS=30
BACKUP_MIN_RECOVERY_POINTS=7
BACKUP_GCS_PROTECTION_MODE=warn
```

`BACKUP_DATABASE_URL` must point to a different MongoDB cluster. In production the worker refuses a source and backup URL with the same cluster authority, even if `BACKUP_ALLOW_SAME_CLUSTER=true` is accidentally set.

Prefer a separate cloud account/project and a separate region for the backup cluster so one provider/account/region incident does not remove both copies.

The backup MongoDB credential must be able to create/drop databases matching `BACKUP_DATABASE_PREFIX_*` and read/write `BACKUP_MANIFEST_DATABASE_NAME`. Do not reuse the production application credential.

## 03:00 Asia/Dhaka schedule

`BACKUP_CRON` is a standard five-field numeric cron expression. `BACKUP_TIMEZONE` is interpreted with the IANA timezone database by the scheduler. The production default is:

```text
0 3 * * *  Asia/Dhaka
```

This is **03:00 Bangladesh time**, not 03:00 UTC.

## Deploy

Build/restart the dedicated service with the normal production Compose project:

```bash
docker compose -f docker-compose.production.yml build database-backup
docker compose -f docker-compose.production.yml up -d database-backup
```

Check scheduler health/logs:

```bash
docker compose -f docker-compose.production.yml ps database-backup
docker compose -f docker-compose.production.yml logs --tail=100 database-backup
```

The container heartbeat at `/backups/.scheduler-heartbeat` is used by its Docker healthcheck.

## Run one backup immediately

For a production smoke test without waiting for 03:00:

```bash
docker compose -f docker-compose.production.yml run --rm --entrypoint node database-backup \
  --enable-source-maps dist/app/module/backup/databaseBackup.runner.js
```

A successful run creates a database similar to:

```text
real_estate_saas_backup_2026_08_26_030000
```

and a manifest in:

```text
real_estate_saas_backup_control.database_backups
```

The local archive volume also contains:

```text
/backups/real_estate_saas_backup_2026_08_26_030000/
  manifest.json
  real_estate_saas_backup_2026_08_26_030000.archive.gz
```

MongoDB credentials are written only to temporary mode-0600 MongoDB Tools config files and deleted after each run. They are not passed on the `mongodump`/`mongorestore` command line.

## Restore verification

A backup is `success` only when the dated restored database passes all of these checks:

- every source collection/view observed before the dump exists after restore;
- collection options match;
- index definitions match;
- restored document counts fall within the source counts observed immediately before and after the dump.

The manifest also records:

- `startedAt` / `finishedAt`;
- source and backup database names;
- MongoDB Database Tools versions;
- compressed archive byte size;
- archive SHA-256;
- source/restored per-collection document counts;
- collection/index verification result;
- GCS media-protection result;
- retention deletions.

## Consistency boundary

This worker intentionally backs up only the application database and restores it under a dated database name. MongoDB Database Tools preserve BSON data, collection options, and indexes far more faithfully than iterating Mongoose models.

For a database-scoped dump, however, MongoDB does **not** provide the same point-in-time guarantee as a full replica-set `mongodump --oplog` / `mongorestore --oplogReplay`. MongoDB does not allow `--oplog` together with a database-limited dump, and oplog replay cannot be combined with namespace renaming. Therefore, for financial/compliance workloads that require strict point-in-time recovery while writes continue, enable your MongoDB provider's managed snapshots/PITR **in addition to** this daily cross-cluster verified backup.

Do not switch this worker to a model-by-model JavaScript copy to work around that boundary.

## GCS media disaster recovery

MongoDB contains property-media URLs and metadata, not the image bytes themselves. A database restore does not recover a deleted GCS bucket.

The backup worker checks the configured media bucket and records whether it detects at least one of:

- Cloud Storage soft-delete retention;
- bucket retention policy;
- Object Versioning.

Start with:

```env
BACKUP_GCS_PROTECTION_MODE=warn
```

Google Cloud currently recommends soft delete as the primary protection against accidental or malicious deletion. For example, after reviewing retention cost/requirements for your bucket:

```bash
gcloud storage buckets update gs://YOUR_MEDIA_BUCKET --soft-delete-duration=30d
```

If you intentionally choose Object Versioning instead:

```bash
gcloud storage buckets update gs://YOUR_MEDIA_BUCKET --versioning
```

These are infrastructure changes and are not executed automatically by the application because they affect retention cost and deletion behavior.

After GCS protection is configured and verified, change it to:

```env
BACKUP_GCS_PROTECTION_MODE=require
```

For stronger regional/account isolation, maintain an independent bucket copy as well. Do not put the only media recovery copy in the same failure domain as the live bucket.

## Retention

`BACKUP_RETENTION_DAYS` controls age-based cleanup and `BACKUP_MIN_RECOVERY_POINTS` is an independent floor. Cleanup runs only after a new backup has restored and verified successfully.

Example:

```env
BACKUP_RETENTION_DAYS=30
BACKUP_MIN_RECOVERY_POINTS=7
```

This prevents a failed nightly job from deleting the last known-good recovery point.

## Recovery drill

At least monthly:

1. choose a recent `status=success` manifest;
2. connect to the corresponding dated backup database with a read-only test credential;
3. verify critical organizations, users, properties, subscriptions/payments and media metadata;
4. test application startup against an isolated copy of that recovery point;
5. verify referenced GCS media can also be recovered;
6. record the drill date and result operationally.

A backup that has never been restored/tested by the application should not be treated as a complete disaster-recovery plan.
