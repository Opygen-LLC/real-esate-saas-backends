import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import mongoose from 'mongoose'
import { migrateWebsiteContent } from '../../contracts/websiteCatalog/content'
import { getTemplateContentDefaults, isPublicationRevision } from '../../contracts/websiteCatalog/manifest'

/** One tenant per invocation. Dry run by default. Never publishes or switches a tenant's template/render mode. */
async function run() {
  const uri = process.env.PHASE2_DATABASE_URL
  const organizationId = process.env.PHASE2_ORGANIZATION_ID
  const apply = process.argv.includes('--apply')
  const backupPath = process.argv.find((arg) => arg.startsWith('--backup='))?.slice(9)
  if (!uri || !organizationId) throw new Error('Set PHASE2_DATABASE_URL and PHASE2_ORGANIZATION_ID explicitly')
  if (apply && (!backupPath || !process.argv.includes('--confirm=APPLY_PHASE2_CONTENT'))) throw new Error('Writes require --apply --confirm=APPLY_PHASE2_CONTENT --backup=<new-private-json-path>')
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10_000 })
  const organizations = mongoose.connection.db!.collection('organizations')
  const org = await organizations.findOne({ organizationId })
  if (!org) throw new Error('Tenant not found')
  const settings = org.websiteSettings || {}
  const revision = settings.publicationRevision ?? 0
  if (!isPublicationRevision(revision)) throw new Error('Invalid existing publication revision; review manually')
  const migration = migrateWebsiteContent(settings, getTemplateContentDefaults(org.templateId))
  const changed = !isDeepStrictEqual(settings.content, migration.content) || settings.contentSchemaVersion !== migration.contentSchemaVersion
  const report = { mode: apply ? 'apply' : 'dry-run', changed, contentSchemaVersion: migration.contentSchemaVersion, expectedPublicationRevision: revision, templateChanged: false, renderModeChanged: false, websiteStatusChanged: false }
  if (!apply) { console.log(JSON.stringify(report, null, 2)); return }
  // Load cache integration before any write so missing deployment configuration cannot cause a partial operation.
  const { CacheInvalidationService } = await import('../module/domainEvent/cacheInvalidation.service')
  if (changed) {
    writeFileSync(backupPath!, JSON.stringify({ format: 'phase2-content-backup-v1', createdAt: new Date().toISOString(), organizationId, documentId: org._id.toString(), templateId: org.templateId, expectedPublicationRevision: revision, appliedPublicationRevision: revision + 1, fields: { content: settings.content, contentSchemaVersion: settings.contentSchemaVersion }, absent: ['content', 'contentSchemaVersion'].filter((key) => !Object.prototype.hasOwnProperty.call(settings, key)) }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    const updated = await organizations.updateOne({ _id: org._id, organizationId,
      updatedAt: org.updatedAt ?? { $exists: false },
      ...(revision === 0 ? { $or: [{ 'websiteSettings.publicationRevision': 0 }, { 'websiteSettings.publicationRevision': { $exists: false } }] } : { 'websiteSettings.publicationRevision': revision }),
    }, { $set: { 'websiteSettings.content': migration.content, 'websiteSettings.contentSchemaVersion': migration.contentSchemaVersion, updatedAt: new Date() }, $inc: { 'websiteSettings.publicationRevision': 1 } })
    if (updated.modifiedCount !== 1) throw new Error('Concurrent website edit detected. No migration applied; rerun the dry run with a fresh backup path')
  }
  // Also invalidate on an unchanged rerun, allowing recovery after a prior cache outage.
  await CacheInvalidationService.invalidateTenant(organizationId)
  console.log(JSON.stringify({ ...report, cacheInvalidated: true }, null, 2))
}
run().catch((error) => { console.error(error instanceof Error ? error.message : 'Content migration failed'); process.exitCode = 1 }).finally(() => mongoose.disconnect())
