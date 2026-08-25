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
const defaultCompose = read('docker-compose.yml')
const dockerfile = read('Dockerfile.backup')
const env = read('.env.example')
const pkg = JSON.parse(read('package.json'))

for (const token of [
  'streamDumpToRestore',
  "spawn('mongodump'",
  "spawn('mongorestore'",
  "dump.stdout.pipe(restore.stdin)",
  "'--archive'",
  '--nsFrom=',
  '--nsTo=',
  'archiveSha256',
  'restoreVerification',
  'runRetention',
]) {
  requireText(service, token, 'backup service')
}

for (const token of [
  'BACKUP_DATABASE_URL',
  'different MongoDB cluster',
  'BACKUP_TIMEZONE',
  'Asia/Dhaka',
  'BACKUP_RETENTION_DAYS',
  'BACKUP_WORK_DIR',
]) {
  requireText(config + env, token, 'backup configuration')
}

requireText(config, "process.env.BACKUP_CRON || '30 2 * * *'", '02:30 default backup cron')
requireText(env, 'BACKUP_CRON=30 2 * * *', '02:30 env backup cron')

for (const composeText of [compose, defaultCompose]) {
  requireText(composeText, 'BACKUP_CRON: "${BACKUP_CRON:-30 2 * * *}"', '02:30 compose backup cron')
  for (const token of ['database-backup:', 'Dockerfile.backup', 'BACKUP_CRON', 'BACKUP_WORK_DIR']) {
    requireText(composeText, token, 'compose backup service')
  }
  rejectText(composeText, 'database_backup_archives', 'backup archives must not use a persistent Docker volume')
  rejectText(composeText, ':/backups', 'backup archives must not be mounted to local persistent storage')
}

for (const token of [
  'MONGODB_DATABASE_TOOLS_VERSION=100.18.0',
  'mongodb-database-tools-debian12-x86_64',
  'USER backup',
  '/tmp/real-estate-db-backup/.scheduler-heartbeat',
]) {
  requireText(dockerfile, token, 'backup image')
}

for (const token of ['parseBackupCron', 'cronMatches', '.scheduler-heartbeat', 'config.workDir']) {
  requireText(scheduler, token, 'backup scheduler')
}

requireText(env, 'cluster0.bysjmo2.mongodb.net', 'backup Atlas host')
requireText(env, 'REPLACE_WITH_BACKUP_DB_PASSWORD', 'backup Atlas password placeholder')
requireText(env, 'PRIMARY_DB_PASSWORD', 'primary MongoDB password placeholder')
requireText(env, 'REPLACE_WITH_SMTP_APP_PASSWORD', 'SMTP password placeholder')

if (pkg.scripts['backup:database'] !== 'node --enable-source-maps dist/app/module/backup/databaseBackup.runner.js') {
  throw new Error('backup:database script is not production runner')
}
if (pkg.scripts['backup:scheduler'] !== 'node --enable-source-maps dist/app/module/backup/databaseBackup.scheduler.js') {
  throw new Error('backup:scheduler script is not production scheduler')
}

rejectText(service, 'find().lean()', 'backup service must not copy Mongoose models')
rejectText(service, 'insertMany(', 'backup service must not perform model-by-model copies')
rejectText(service, '--archive=', 'backup service must stream the archive rather than write it to disk')
rejectText(service, 'createWriteStream(', 'backup service must not persist database archive bytes locally')
rejectText(service, 'writeManifestFile', 'backup manifest must live in the secondary Atlas control database')

console.log('Direct Atlas-to-Atlas database backup architecture verification passed.')
