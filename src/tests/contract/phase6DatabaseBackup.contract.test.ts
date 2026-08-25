import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../../..')
const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf8')

describe('Phase 6 database disaster-recovery backup', () => {
  it('runs as a dedicated production service at 03:00 Asia/Dhaka', () => {
    const compose = read('docker-compose.production.yml')
    expect(compose).toContain('database-backup:')
    expect(compose).toContain('Dockerfile.backup')
    expect(compose).toContain('BACKUP_CRON: "${BACKUP_CRON:-0 3 * * *}"')
    expect(compose).toContain('BACKUP_TIMEZONE: ${BACKUP_TIMEZONE:-Asia/Dhaka}')
    expect(compose).toContain('BACKUP_ALLOW_SAME_CLUSTER: "false"')
  })

  it('uses MongoDB native dump/restore and verifies dated restores', () => {
    const service = read('src/app/module/backup/databaseBackup.service.ts')
    expect(service).toContain("runCommand('mongodump'")
    expect(service).toContain("runCommand('mongorestore'")
    expect(service).toContain('--nsFrom=')
    expect(service).toContain('--nsTo=')
    expect(service).toContain('archiveSha256')
    expect(service).toContain('verifyRestore(')
    expect(service).toContain('sourceCollectionsBefore')
    expect(service).toContain('sourceCollectionsAfter')
    expect(service).toContain('runRetention(')
    expect(service).not.toContain('migrationSafety')
    expect(service).not.toContain('insertMany(')
  })

  it('keeps source and backup clusters separate in production', () => {
    const config = read('src/app/module/backup/databaseBackup.config.ts')
    expect(config).toContain("required('BACKUP_DATABASE_URL')")
    expect(config).toContain("nodeEnv === 'production'")
    expect(config).toContain('BACKUP_DATABASE_URL must point to a different MongoDB cluster in production')
  })

  it('tracks GCS protection because database metadata does not contain media bytes', () => {
    const service = read('src/app/module/backup/databaseBackup.service.ts')
    expect(service).toContain('softDeletePolicy')
    expect(service).toContain('retentionPolicy')
    expect(service).toContain('versioning')
    expect(service).toContain('BACKUP_GCS_PROTECTION_MODE')
  })
})
