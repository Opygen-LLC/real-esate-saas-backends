# Production MongoDB Atlas-to-Atlas Backup Runbook

## What this deployment does

The `database-backup` service is a dedicated scheduler that runs separately from API replicas.

At **03:15 Asia/Dhaka every day** it:

1. connects to the primary application database from `DATABASE_URL`;
2. inventories collections, document counts, collection options, and indexes;
3. starts MongoDB Database Tools `mongodump` in archive+gzip mode;
4. streams the archive bytes directly into `mongorestore` connected to `BACKUP_DATABASE_URL`;
5. calculates the streamed byte count and SHA-256 while the transfer is in flight;
6. restores into a new dated database on the secondary Atlas cluster;
7. inventories the primary database again and the restored backup database;
8. verifies collection presence, document-count range, collection options, and index definitions;
9. writes the backup manifest into `BACKUP_MANIFEST_DATABASE_NAME.database_backups` on the secondary Atlas cluster;
10. applies retention only after the new recovery point has verified successfully.

No MongoDB dump archive is retained on the VPS, laptop, or Docker volume.

The worker still uses tiny temporary files for MongoDB Tools credentials and a scheduler lock/heartbeat under `/tmp`; those are operational files, not database backups. Credential files are mode `0600` and deleted after each run.

## Required production `.env`

The backup cluster supplied for this project is represented in `.env.example` like this:

```env
BACKUP_DATABASE_URL=mongodb+srv://opygensubscription_db_user:REPLACE_WITH_BACKUP_DB_PASSWORD@cluster0.bysjmo2.mongodb.net/real_estate_saas_backup_control?retryWrites=true&w=majority&appName=Cluster0
```

On the production server, replace only `REPLACE_WITH_BACKUP_DB_PASSWORD` with the real password for that Atlas database user.

If the password contains reserved URI characters such as `@`, `:`, `/`, `?`, `#`, `%`, or spaces, URL-encode the password before placing it in the MongoDB URI.

Recommended backup settings:

```env
BACKUP_CRON=15 3 * * *
BACKUP_TIMEZONE=Asia/Dhaka
BACKUP_DATABASE_PREFIX=real_estate_saas_backup
BACKUP_MANIFEST_DATABASE_NAME=real_estate_saas_backup_control
BACKUP_RETENTION_DAYS=30
BACKUP_MIN_RECOVERY_POINTS=7
BACKUP_PROCESS_TIMEOUT_MINUTES=120
BACKUP_LOCK_STALE_MINUTES=360
BACKUP_MAX_PARALLEL_COLLECTIONS=4
BACKUP_ALLOW_SAME_CLUSTER=false
BACKUP_WORK_DIR=/tmp/real-estate-db-backup
BACKUP_GCS_PROTECTION_MODE=warn
```

`BACKUP_DATABASE_URL` must point to a different MongoDB cluster from `DATABASE_URL`. In production the worker refuses to run when both URLs resolve to the same MongoDB cluster authority.

The backup Atlas user must have enough permission on the **backup cluster** to:

- create the dated `real_estate_saas_backup_*` databases;
- create collections and indexes during restore;
- drop old dated backup databases during retention cleanup;
- read/write `real_estate_saas_backup_control`.

Do not reuse the primary application database credential for the backup cluster.

## Atlas network access

The secondary Atlas project must allow connections from the production server that runs the `database-backup` container.

Prefer adding the production server's fixed public egress IP to the Atlas Network Access list instead of using `0.0.0.0/0`.

## Database names

Each successful run creates a separate recovery point, for example:

```text
real_estate_saas_backup_2026_08_26_030000
real_estate_saas_backup_2026_08_27_030000
real_estate_saas_backup_2026_08_28_030000
```

The control database is:

```text
real_estate_saas_backup_control
```

and contains:

```text
database_backups
database_backup_drills
```

Keeping dated recovery points is safer than overwriting one `latest` database every night.

## Deployment

The backup service is present in both:

```text
docker-compose.yml
docker-compose.production.yml
```

This matters because the project's existing `update.sh` uses the default `docker-compose.yml`.

After setting the real `BACKUP_DATABASE_URL` in the server `.env`, rebuild:

```bash
./update.sh
```

or explicitly:

```bash
docker compose up -d --build database-backup
```

For the production compose file:

```bash
docker compose -f docker-compose.production.yml up -d --build database-backup
```

Check health and logs:

```bash
docker compose ps database-backup
docker compose logs --tail=200 database-backup
```

The healthcheck uses:

```text
/tmp/real-estate-db-backup/.scheduler-heartbeat
```

No database archive is written there.

## Run an immediate backup test

Do not wait until 03:15 for the first validation.

After configuring the real backup Atlas password:

```bash
docker compose run --rm --entrypoint node database-backup   --enable-source-maps dist/app/module/backup/databaseBackup.runner.js
```

Then confirm the secondary Atlas cluster contains:

```text
real_estate_saas_backup_YYYY_MM_DD_HHMMSS
real_estate_saas_backup_control
```

and inspect the latest document in:

```text
real_estate_saas_backup_control.database_backups
```

A successful manifest must contain:

```text
status: success
transferMode: atlas_stream
restoreVerification.passed: true
archiveRetained: false
archiveBytes: > 0
archiveSha256: <sha256>
```

`archiveBytes` and `archiveSha256` describe the streamed compressed MongoDB archive; they do not mean that an archive file is stored locally.

## Restore verification

A recovery point is marked successful only when all of these pass:

- every source collection/view observed before the dump exists in the restored database;
- collection options match;
- index definitions match;
- restored document counts fall within the source counts observed immediately before and after the dump.

If the stream fails or verification fails, the partially restored dated database is dropped and is not treated as a recovery point.

## Retention

With:

```env
BACKUP_RETENTION_DAYS=30
BACKUP_MIN_RECOVERY_POINTS=7
```

the worker removes old dated databases only after a new backup has restored and verified successfully.

It always keeps at least the newest seven successful recovery points regardless of age.

## Staging recovery drill

The existing drill still uses the same real Atlas-to-Atlas pipeline.

It refuses `NODE_ENV=production` and requires:

```env
BACKUP_DRILL_CONFIRM=PHASE7-STAGING-DRILL
BACKUP_DRILL_EXPECT_QUIESCENT=true
```

The drill compares selected critical records and stores its result in:

```text
real_estate_saas_backup_control.database_backup_drills
```

No local `staging-recovery-drill.json` file is required.

## GCS media disaster recovery

MongoDB stores property-image URLs and metadata, not the image bytes.

A MongoDB Atlas backup therefore does not recover a deleted GCS bucket. Keep one of these enabled on the media bucket:

- Cloud Storage soft-delete retention;
- bucket retention policy;
- Object Versioning.

The backup manifest records whether protection is detected. Keep:

```env
BACKUP_GCS_PROTECTION_MODE=warn
```

until the bucket protection policy is intentionally configured, then consider:

```env
BACKUP_GCS_PROTECTION_MODE=require
```

## Consistency boundary

This implementation deliberately uses MongoDB Database Tools rather than model-by-model Mongoose copying, so BSON data, collection options, and indexes are preserved much more faithfully.

Because this is a database-scoped live dump renamed into a dated backup database, it is not a substitute for managed continuous point-in-time recovery. For financial/compliance requirements that need strict point-in-time recovery while writes continue, enable Atlas managed backup/PITR in addition to this daily cross-cluster copy.

## Removing the old local backup volume

Older Phase 6 deployments created a Docker volume named with a suffix similar to:

```text
database_backup_archives
```

The updated Compose files no longer reference it.

After the new Atlas-to-Atlas backup has completed successfully and you have verified the dated database in Atlas, inspect old volumes:

```bash
docker volume ls | grep database_backup_archives
```

If an old backup archive volume exists and you no longer want those local copies, remove the exact volume name shown by Docker:

```bash
docker volume rm YOUR_PROJECT_database_backup_archives
```

Do this only after confirming a successful secondary-Atlas recovery point.

## Docker deployment build performance

The API and database-backup services intentionally use two runtime targets from the same `Dockerfile` (`api-runtime` and `backup-runtime`). They share the same dependency-install/TypeScript build stage, so Docker BuildKit can reuse that expensive work instead of running a second `pnpm install` and full TypeScript compile for the backup service.

`update.sh` also rebuilds the `database-backup` runtime only when backup-runtime inputs changed or the image is missing. Routine API-only deployments reuse the existing backup image. Do not restore the old `Dockerfile.backup`; it is obsolete.
