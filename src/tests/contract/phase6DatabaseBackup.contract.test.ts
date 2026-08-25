import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../../..')
const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf8')

describe('Daily Atlas-to-Atlas database disaster-recovery backup', () => {
  it('runs as a dedicated production service at 03:00 Asia/Dhaka in both deployment compose paths', () => {
    for (const file of ['docker-compose.yml', 'docker-compose.production.yml']) {
      const compose = read(file)
      expect(compose).toContain('database-backup:')
      expect(compose).toContain('Dockerfile.backup')
      expect(compose).toContain('BACKUP_CRON: "${BACKUP_CRON:-0 3 * * *}"')
      expect(compose).toContain('BACKUP_TIMEZONE: ${BACKUP_TIMEZONE:-Asia/Dhaka}')
      expect(compose).toContain('BACKUP_ALLOW_SAME_CLUSTER: "false"')
      expect(compose).toContain('BACKUP_WORK_DIR: /tmp/real-estate-db-backup')
      expect(compose).not.toContain('database_backup_archives')
      expect(compose).not.toContain(':/backups')
    }
  })

  it('streams native MongoDB dump bytes directly into mongorestore without retaining a dump file', () => {
    const service = read('src/app/module/backup/databaseBackup.service.ts')
    expect(service).toContain('streamDumpToRestore')
    expect(service).toContain("spawn('mongodump'")
    expect(service).toContain("spawn('mongorestore'")
    expect(service).toContain('dump.stdout.pipe(restore.stdin)')
    expect(service).toContain("'--archive'")
    expect(service).toContain('--nsFrom=')
    expect(service).toContain('--nsTo=')
    expect(service).toContain('archiveSha256')
    expect(service).toContain('verifyRestore(')
    expect(service).toContain('sourceCollectionsBefore')
    expect(service).toContain('sourceCollectionsAfter')
    expect(service).toContain('runRetention(')
    expect(service).not.toContain('--archive=')
    expect(service).not.toContain('writeManifestFile')
    expect(service).not.toContain('migrationSafety')
    expect(service).not.toContain('insertMany(')
  })

  it('uses the supplied secondary Atlas cluster pattern and never commits its password', () => {
    const env = read('.env.example')
    expect(env).toContain('cluster0.bysjmo2.mongodb.net')
    expect(env).toContain('opygensubscription_db_user')
    expect(env).toContain('REPLACE_WITH_BACKUP_DB_PASSWORD')
    expect(env).toContain('PRIMARY_DB_PASSWORD')
    expect(env).toContain('REPLACE_WITH_SMTP_APP_PASSWORD')
  })

  it('keeps source and backup clusters separate in production', () => {
    const config = read('src/app/module/backup/databaseBackup.config.ts')
    expect(config).toContain("required('BACKUP_DATABASE_URL')")
    expect(config).toContain("nodeEnv === 'production'")
    expect(config).toContain('BACKUP_DATABASE_URL must point to a different MongoDB cluster in production')
  })

  it('verifies the restored Atlas database before treating it as a recovery point', () => {
    const service = read('src/app/module/backup/databaseBackup.service.ts')
    expect(service).toContain('assertBackupDatabaseEmpty')
    expect(service).toContain('missingCollections')
    expect(service).toContain('countWithinObservedRange')
    expect(service).toContain('indexesMatch')
    expect(service).toContain('optionsMatch')
    expect(service).toContain('persistRemoteManifest')
  })

  it('tracks GCS protection because database metadata does not contain media bytes', () => {
    const service = read('src/app/module/backup/databaseBackup.service.ts')
    expect(service).toContain('softDeletePolicy')
    expect(service).toContain('retentionPolicy')
    expect(service).toContain('versioning')
    expect(service).toContain('BACKUP_GCS_PROTECTION_MODE')
  })
})
