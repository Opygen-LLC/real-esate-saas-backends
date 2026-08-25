import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const requireText = (text, needle, label) => {
  if (!text.includes(needle)) throw new Error(`${label}: missing ${needle}`)
}
const rejectText = (text, needle, label) => {
  if (text.includes(needle)) throw new Error(`${label}: forbidden ${needle}`)
}

const service = read('src/app/module/backup/databaseBackup.service.ts')
const scheduler = read('src/app/module/backup/databaseBackup.scheduler.ts')
const config = read('src/app/module/backup/databaseBackup.config.ts')
const compose = read('docker-compose.production.yml')
const dockerfile = read('Dockerfile.backup')
const env = read('.env.example')
const pkg = JSON.parse(read('package.json'))

for (const token of ['mongodump', 'mongorestore', '--archive=', '--gzip', '--nsFrom=', '--nsTo=', 'archiveSha256', 'restoreVerification', 'runRetention']) {
  requireText(service, token, 'backup service')
}
for (const token of ['BACKUP_DATABASE_URL', 'different MongoDB cluster', 'BACKUP_TIMEZONE', 'Asia/Dhaka', 'BACKUP_RETENTION_DAYS']) {
  requireText(config + env, token, 'backup configuration')
}
for (const token of ['database-backup:', 'Dockerfile.backup', 'BACKUP_CRON', 'database_backup_archives:/backups']) {
  requireText(compose, token, 'production compose')
}
for (const token of ['MONGODB_DATABASE_TOOLS_VERSION=100.18.0', 'mongodb-database-tools-debian12-x86_64', 'USER backup']) {
  requireText(dockerfile, token, 'backup image')
}
for (const token of ['parseBackupCron', 'cronMatches', '.scheduler-heartbeat']) {
  requireText(scheduler, token, 'backup scheduler')
}
if (pkg.scripts['backup:database'] !== 'node --enable-source-maps dist/app/module/backup/databaseBackup.runner.js') throw new Error('backup:database script is not production runner')
if (pkg.scripts['backup:scheduler'] !== 'node --enable-source-maps dist/app/module/backup/databaseBackup.scheduler.js') throw new Error('backup:scheduler script is not production scheduler')
rejectText(service, 'find().lean()', 'backup service must not copy Mongoose models')
rejectText(service, 'insertMany(', 'backup service must not perform model-by-model copies')

console.log('Phase 6 database backup architecture verification passed.')
