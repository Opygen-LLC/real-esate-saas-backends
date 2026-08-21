import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import mongoose from 'mongoose'
import os from 'node:os'
import path from 'node:path'

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('MIGRATION_TEST_DATABASE_URL or TEST_DATABASE_URL is required')
if (!/phase7|migration|test/i.test(databaseUrl)) throw new Error('Migration verification refuses to use a database URL that is not clearly marked as test/migration')

const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase7-migrations-'))
const specs = [
  { file: 'migrateEmailOtpAuth.js', args: [] },
  { file: 'migrateFinance.js', args: [] },
  { file: 'migratePhase0Contracts.js', args: ['--apply'] },
  { file: 'migratePhase0PropertyMedia.js', args: ['--apply', '--confirm=APPLY_PROPERTY_MEDIA_V1'] },
  { file: 'migratePhase1ManualSubscriptions.js', args: ['--apply', '--confirm=PHASE1-MANUAL-SUBSCRIPTIONS'] },
  { file: 'migratePhase3AgencyPublishing.js', args: ['--apply', '--confirm=PHASE3_REMOVE_LEGACY_OPERATIONS'] },
  { file: 'migratePhase4PropertyMedia2.js', args: ['--apply', '--confirm=APPLY_PROPERTY_MEDIA_2'] },
  { file: 'migrateTeamQuota.js', args: ['--apply'] },
  { file: 'migrateWebsiteSubmissions.js', args: ['--apply'] },
  { file: 'migratePropertyDraftAssets.js', args: ['--apply', '--confirm=PHASE7-PROPERTY-DRAFT-ASSETS'] },
  { file: 'migratePhase9DomainLifecycle.js', args: ['--apply', '--confirm=PHASE9-DOMAIN-LIFECYCLE'] },
  { file: 'migrateSubscriptionTierRolloverV2.js', args: ['--apply'] },
  { file: 'migrateDeferredSubscriptionSchedules.js', args: ['--apply'] },
  { file: 'migrateLeadSubscriptionLocking.js', args: ['--apply'] },
  { file: 'migrateSubscriptionLeadReleaseV1.js', args: ['--apply'] },
].map((spec) => ({ ...spec, file: path.resolve('dist/app/db', spec.file) }))

const runMigration = (spec) => {
  if (!fs.existsSync(spec.file)) throw new Error(`Built migration is missing: ${spec.file}. Run pnpm build before test:migrations.`)
  const result = spawnSync(process.execPath, [spec.file, ...spec.args, `--backup-dir=${backupDir}`], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test', MIGRATION_BACKUP_DIR: backupDir },
  })
  if (result.status !== 0) throw new Error(`Migration failed: ${path.basename(spec.file)}`)
}

const seedLegacyFixtures = async (db) => {
  const images = Array.from({ length: 22 }, (_, index) => ({
    url: `https://media.example.test/legacy-${index + 1}.jpg`, order: index, isFeatured: index < 2,
  }))
  await db.collection('organizations').insertOne({
    organizationId: 'phase7-migration-org', agencyName: 'Migration Realty', email: 'migration@example.com', phone: '+8801711111111',
    subscription: { plan: 'starter', planVersion: 1, status: 'active', source: 'bkash' }, websiteStatus: 'published',
  })
  await db.collection('billings').insertOne({
    organizationId: 'phase7-migration-org', serviceType: 'subscription', status: 'paid', plan: 'starter', planVersion: 1,
    billingCycle: 'monthly', amount: 500, currency: 'BDT', paymentMethod: 'bKash', invoiceId: 'LEGACY-INV-1', transactionId: 'LEGACY-TRX-1',
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
  })
  await db.collection('leads').insertOne({
    organizationId: 'phase7-migration-org', name: 'Legacy lead', phone: '+8801712345678', normalizedPhone: '+8801712345678',
    email: 'legacy-lead@example.test', normalizedEmail: 'legacy-lead@example.test', leadStatus: 'New',
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
  })
  await db.collection('properties').insertOne({
    organizationId: 'phase7-migration-org', title: 'Legacy pending listing', status: 'Available', moderationStatus: 'pending', moderationReason: 'legacy',
    images, videos: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'], createdAt: new Date(), updatedAt: new Date(),
  })
  await db.collection('users').insertOne({
    organizationId: 'phase7-migration-org', userRole: 'agency_admin', accessControl: { useRoleDefaults: false, permissions: ['properties.read', 'compliance.read'] },
  })
  await db.collection('teaminvitations').insertOne({
    organizationId: 'phase7-migration-org', userRole: 'agency_admin', accessControl: { useRoleDefaults: false, permissions: ['properties.read', 'compliance.write'] },
  })
  await db.collection('operationsjobs').insertOne({ organizationId: 'phase7-migration-org', type: 'support_email', status: 'pending' })
  for (const name of ['supporttickets', 'fraudreports', 'complianceprofiles', 'datasubjectrequests']) {
    await db.collection(name).insertOne({ organizationId: 'phase7-migration-org', legacy: true })
  }
  await db.collection('websiteassets').insertOne({
    organizationId: 'phase7-migration-org', key: 'legacy/asset.jpg', url: 'https://media.example.test/legacy-asset.jpg',
    size: 1200, mimeType: 'image/jpeg', status: 'ready', createdAt: new Date(), updatedAt: new Date(),
  })
  await db.collection('websiteuploadintents').insertOne({
    organizationId: 'phase7-migration-org', key: 'legacy/intent.jpg', objectKeys: ['legacy/intent.jpg'],
    status: 'pending', expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), updatedAt: new Date(),
  })
  await db.collection('domainrecords').insertOne({
    organizationId: 'phase7-migration-org', domain: 'legacy-domain.example', ownershipToken: 'legacy-token',
    status: 'verified', tlsStatus: 'active', createdAt: new Date(), updatedAt: new Date(),
  })
  await db.collection('platformsettings').insertOne({ key: 'platform' })
}

const assertPostMigration = async (db) => {
  const property = await db.collection('properties').findOne({ organizationId: 'phase7-migration-org' })
  if (!property) throw new Error('Migration fixture property disappeared')
  if (property.status !== 'Draft') throw new Error(`Legacy non-approved Available listing should become Draft, got ${property.status}`)
  for (const field of ['moderationStatus', 'moderationReason', 'moderatedBy', 'moderatedAt', 'videos']) {
    if (Object.prototype.hasOwnProperty.call(property, field)) throw new Error(`Legacy property field still exists after migrations: ${field}`)
  }
  if (!Array.isArray(property.images) || property.images.length > 20) throw new Error('Property gallery migration did not enforce the 20-photo maximum')
  if (property.images.filter((image) => image.isFeatured).length > 1) throw new Error('Property gallery still has multiple featured photos')
  if (!Array.isArray(property.mediaLinks) || !property.mediaLinks.some((item) => item.provider === 'youtube')) throw new Error('Legacy hosted media was not migrated')

  const org = await db.collection('organizations').findOne({ organizationId: 'phase7-migration-org' })
  if (org?.subscription?.source === 'bkash') throw new Error('Legacy automated payment source was not normalized')
  if (org?.subscription?.plan !== 'starter' || Number(org?.subscription?.planVersion) !== 1) throw new Error('Subscription release migration changed the grandfathered tenant plan/version assignment')
  const targetPlans = [
    ['starter', 6, 500, 5000, 200, 50],
    ['professional', 4, 1000, 10000, 800, 100],
    ['agency', 4, 1500, 15000, 2000, 200],
  ]
  for (const [planId, version, monthly, yearly, base, bonus] of targetPlans) {
    const plan = await db.collection('subscriptionplans').findOne({ planId, version })
    if (!plan || plan.isCurrent !== true || plan.isActive !== true || plan.grandfatherExisting !== true) throw new Error(`${planId} v${version} is not the current active grandfather-safe release version`)
    if (Number(plan.priceMonthly) !== monthly || Number(plan.priceYearly) !== yearly || Number(plan.maxLeads) !== base || Number(plan.baseMonthlyLeadAllowance) !== base || Number(plan.renewalLeadBonus) !== bonus || Number(plan.maxRenewalLeadBonus) !== 0 || plan.leadAllowanceModel !== 'active_capacity') {
      throw new Error(`${planId} v${version} commercial release policy is incorrect`)
    }
    if (await db.collection('subscriptionplans').countDocuments({ planId, version: { $ne: version }, isCurrent: true })) throw new Error(`${planId} has a historical version still marked current`)
    if (!(await db.collection('subscriptionplans').findOne({ planId, version: 1 }))?.isActive) throw new Error(`${planId} historical v1 was archived instead of remaining active for grandfathered tenants`)
  }
  const legacyLead = await db.collection('leads').findOne({ organizationId: 'phase7-migration-org' })
  if (!legacyLead || legacyLead.isLocked !== false) throw new Error('Existing Lead was not backfilled as accessible')
  if (await db.collection('leads').countDocuments({ organizationId: 'phase7-migration-org' }) !== 1) throw new Error('Lead was deleted during subscription release migration')
  const leadIndexes = await db.collection('leads').indexes()
  if (!leadIndexes.some((index) => index.name === 'lead_tenant_lock_created')) throw new Error('Lead subscription-lock index was not installed')
  const payment = await db.collection('subscriptionpayments').findOne({ organizationId: 'phase7-migration-org', status: 'confirmed' })
  if (!payment?.paymentNumber || !payment?.receiptNumber) throw new Error('Legacy subscription billing was not imported into the manual payment ledger')

  const user = await db.collection('users').findOne({ organizationId: 'phase7-migration-org' })
  if (user?.accessControl?.permissions?.some((value) => String(value).startsWith('compliance.'))) throw new Error('Legacy compliance permissions remain on user')
  if (!user?.accessControl?.permissions?.includes('properties.publish')) throw new Error('Agency admin publishing permission was not preserved')

  for (const name of ['supporttickets', 'fraudreports', 'complianceprofiles', 'datasubjectrequests']) {
    const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext()
    if (exists) throw new Error(`Legacy collection was not removed: ${name}`)
  }
  if (await db.collection('operationsjobs').countDocuments({ type: 'support_email' })) throw new Error('Legacy support-email jobs were not removed')

  const draftAsset = await db.collection('websiteassets').findOne({ organizationId: 'phase7-migration-org', key: 'legacy/asset.jpg' })
  if (draftAsset?.context !== 'website' || draftAsset?.claimed !== true) throw new Error('Legacy website asset lifecycle defaults were not backfilled')
  const uploadIntent = await db.collection('websiteuploadintents').findOne({ organizationId: 'phase7-migration-org', key: 'legacy/intent.jpg' })
  if (uploadIntent?.context !== 'website' || uploadIntent?.uploadSessionId !== '') throw new Error('Legacy upload intent lifecycle defaults were not backfilled')
  const domain = await db.collection('domainrecords').findOne({ organizationId: 'phase7-migration-org', domain: 'legacy-domain.example' })
  if (domain?.lifecycleStatus !== 'ACTIVE' || domain?.publicRoutingStatus !== 'active' || domain?.providerRegistrationStatus !== 'registered') {
    throw new Error('Legacy custom domain lifecycle was not backfilled to ACTIVE')
  }

  const submissionIndexes = await db.collection('websitesubmissions').indexes()
  if (!submissionIndexes.some((index) => index.name === 'submission_tenant_status_submitted')) throw new Error('Website submission inbox indexes were not installed')
  const invitationIndexes = await db.collection('teaminvitations').indexes()
  if (!invitationIndexes.some((index) => index.name === 'tenant_status_expires')) throw new Error('Team quota invitation indexes were not installed')
  const assetIndexes = await db.collection('websiteassets').indexes()
  if (!assetIndexes.some((index) => index.name === 'property_draft_lifecycle')) throw new Error('Property draft lifecycle indexes were not installed')

  const settings = await db.collection('platformsettings').findOne({ key: 'platform' })
  if (settings?.support?.whatsapp !== '+8801891793354') throw new Error('Platform support contact defaults were not installed')
}

try {
  await mongoose.connect(databaseUrl, { serverSelectionTimeoutMS: 5_000 })
  const db = mongoose.connection.db
  if (!db) throw new Error('Migration test database is unavailable')
  await db.dropDatabase()
  await seedLegacyFixtures(db)
  await mongoose.disconnect()

  for (let pass = 1; pass <= 2; pass += 1) {
    console.log(`Phase 7 migration verification pass ${pass}/2`)
    for (const spec of specs) runMigration(spec)
    await mongoose.connect(databaseUrl, { serverSelectionTimeoutMS: 5_000 })
    const currentDb = mongoose.connection.db
    if (!currentDb) throw new Error('Migration test database is unavailable after migration run')
    await assertPostMigration(currentDb)
    await mongoose.disconnect()
  }

  const backupFiles = fs.readdirSync(backupDir)
  if (!backupFiles.some((name) => name.endsWith('.sha256')) || !backupFiles.some((name) => name.includes('manifest'))) {
    throw new Error('Destructive migrations did not produce backup checksums/manifests')
  }
  console.log('Migration verification passed twice, including subscription tier rollover, deferred downgrade, Lead locking and final release invariants.')
} finally {
  try {
    if (!mongoose.connection.readyState) await mongoose.connect(databaseUrl, { serverSelectionTimeoutMS: 5_000 })
    await mongoose.connection.db?.dropDatabase().catch(() => undefined)
  } finally {
    await mongoose.disconnect().catch(() => undefined)
    fs.rmSync(backupDir, { recursive: true, force: true })
  }
}
