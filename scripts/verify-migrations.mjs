import { spawnSync } from 'node:child_process'
import mongoose from 'mongoose'
import path from 'node:path'

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('MIGRATION_TEST_DATABASE_URL or TEST_DATABASE_URL is required')
if (!/phase7|migration|test/i.test(databaseUrl)) throw new Error('Migration verification refuses to use a database URL that is not clearly marked as test/migration')

const migrations = [
  'migratePlansToBdt.js', 'migratePhase01.js', 'migratePhase2.js', 'migratePhase4.js', 'migratePhase5.js', 'migratePhase6.js',
].map((name) => path.resolve('dist/app/db', name))

const runMigration = (file) => {
  const result = spawnSync(process.execPath, [file], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl, MIGRATION_APPLY: 'true', NODE_ENV: 'test' },
  })
  if (result.status !== 0) throw new Error(`Migration failed: ${path.basename(file)}`)
}

try {
  await mongoose.connect(databaseUrl, { serverSelectionTimeoutMS: 5_000 })
  await mongoose.connection.db?.dropDatabase()
  await mongoose.disconnect()
  for (let pass = 1; pass <= 2; pass += 1) {
    console.log(`Migration verification pass ${pass}/2`)
    migrations.forEach(runMigration)
  }
  console.log('All migrations completed twice without failure.')
} finally {
  try {
    if (!mongoose.connection.readyState) await mongoose.connect(databaseUrl, { serverSelectionTimeoutMS: 5_000 })
    await mongoose.connection.db?.dropDatabase().catch(() => undefined)
  } finally {
    await mongoose.disconnect().catch(() => undefined)
  }
}
