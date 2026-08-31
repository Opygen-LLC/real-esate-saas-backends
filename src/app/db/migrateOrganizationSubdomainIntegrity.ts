import mongoose from 'mongoose'
import config from '../../config'
import { normalizeSubdomain, RESERVED_SUBDOMAINS } from '../helpers/identity'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'organization-subdomain-integrity-phase1-v1'
const CONFIRMATION = 'organization-subdomain-integrity-phase1'
const INDEX_NAME = 'organization_subdomain_unique_nonempty'

const generatedSubdomain = (organizationId: string, agencyName: string, occupied: Set<string>): string => {
  const normalizedAgency = normalizeSubdomain(agencyName || 'agency')
  const seed = (normalizedAgency || 'agency').slice(0, 40)
  const safeSeed = RESERVED_SUBDOMAINS.has(seed) ? `agency-${seed}` : seed
  const stableSuffix = organizationId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-10) || 'tenant'
  const base = `${safeSeed}-${stableSuffix}`.slice(0, 63).replace(/-+$/g, '')
  if (!occupied.has(base) && !RESERVED_SUBDOMAINS.has(base)) return base
  for (let attempt = 2; attempt <= 999; attempt += 1) {
    const suffix = `-${attempt}`
    const candidate = `${base.slice(0, 63 - suffix.length)}${suffix}`
    if (!occupied.has(candidate) && !RESERVED_SUBDOMAINS.has(candidate)) return candidate
  }
  throw new Error(`Unable to generate a unique subdomain for ${organizationId}`)
}

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, CONFIRMATION)
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')
  const organizations = db.collection('organizations')
  const aliases = db.collection('subdomainaliases')

  const rows = await organizations.find({}).project({ _id: 1, organizationId: 1, agencyName: 1, sub_domain: 1 }).sort({ _id: 1 }).toArray()
  const aliasRows = await aliases.find({}).project({ alias: 1 }).toArray()
  const occupied = new Set(aliasRows.map((row: any) => normalizeSubdomain(String(row.alias || ''))).filter(Boolean))
  const seen = new Map<string, string>()
  const changes: Array<{ _id: any; organizationId: string; previous: string; next: string; reason: string }> = []

  for (const row of rows as any[]) {
    const organizationId = String(row.organizationId || '')
    const previous = String(row.sub_domain || '').trim()
    const normalized = normalizeSubdomain(previous)
    const invalid = !normalized || normalized.length < 2 || RESERVED_SUBDOMAINS.has(normalized)
    const duplicateOwner = normalized ? seen.get(normalized) : undefined
    const aliasConflict = normalized ? occupied.has(normalized) : false

    if (!invalid && !duplicateOwner && !aliasConflict) {
      seen.set(normalized, organizationId)
      occupied.add(normalized)
      if (previous !== normalized) {
        changes.push({ _id: row._id, organizationId, previous, next: normalized, reason: 'canonicalize_format' })
      }
      continue
    }

    const reason = !previous
      ? 'blank_or_missing'
      : duplicateOwner
        ? `duplicate_of:${duplicateOwner}`
        : aliasConflict
          ? 'conflicts_with_alias'
          : 'invalid_or_reserved'
    const next = generatedSubdomain(organizationId, String(row.agencyName || 'agency'), occupied)
    occupied.add(next)
    seen.set(next, organizationId)
    changes.push({ _id: row._id, organizationId, previous, next, reason })
  }

  const indexes = await organizations.indexes()
  const legacyIndexes = indexes.filter((index: any) => {
    const keys = Object.keys(index.key || {})
    return keys.length === 1 && keys[0] === 'sub_domain' && index.name !== INDEX_NAME
  })

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} organizations=${rows.length} changes=${changes.length}`)
  if (changes.length) console.table(changes.map(({ _id, ...item }) => item))
  console.log(`[${MIGRATION}] legacy subdomain indexes=${legacyIndexes.map((index: any) => index.name).join(', ') || 'none'}`)

  const manifestBase = {
    mode: cli.apply ? 'apply' : 'dry-run',
    scanned: rows.length,
    changes: changes.map(({ _id, ...item }) => ({ ...item, documentId: String(_id) })),
    legacyIndexes: legacyIndexes.map((index: any) => ({ name: index.name, key: index.key, unique: Boolean(index.unique), partialFilterExpression: index.partialFilterExpression })),
  }

  if (!cli.apply) {
    const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { ...manifestBase, applied: 0 })
    console.log(`[${MIGRATION}] dry-run manifest=${manifest}; no data or indexes changed`)
    return
  }

  const affectedOrganizationIds = [...new Set(changes.map((change) => change.organizationId))]
  const backups = [] as Array<{ file: string; count: number; sha256: string }>
  if (changes.length) {
    backups.push(await backupDocuments({
      collection: organizations,
      filter: { _id: { $in: changes.map((change) => change._id) } },
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
    }))
    backups.push(await backupDocuments({
      collection: aliases,
      filter: { organizationId: { $in: affectedOrganizationIds } },
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
    }))
  }

  // Persist the recovery plan before removing uniqueness. If the process is interrupted,
  // the backups plus this manifest are enough to inspect/restore before rerunning.
  const preApplyManifest = await writeMigrationManifest(cli.backupDir, `${MIGRATION}-pre-apply`, {
    ...manifestBase,
    backups,
    plannedChanges: changes.length,
  })

  // Drop the old/target single-field indexes before canonicalizing values. This
  // avoids a case-sensitive legacy value such as `Foo` colliding with an existing
  // `foo` while the deterministic duplicate winner/loser plan is being applied.
  for (const index of legacyIndexes as any[]) await organizations.dropIndex(index.name)
  const existingTarget = (await organizations.indexes()).find((index: any) => index.name === INDEX_NAME)
  if (existingTarget) await organizations.dropIndex(INDEX_NAME)

  let applied = 0
  let aliasUpdates = 0
  for (const change of changes) {
    const result = await organizations.updateOne(
      { _id: change._id, organizationId: change.organizationId },
      { $set: { sub_domain: change.next } },
    )
    applied += result.modifiedCount
    const aliasResult = await aliases.updateMany(
      { organizationId: change.organizationId },
      { $set: { canonicalSubdomain: change.next } },
    )
    aliasUpdates += aliasResult.modifiedCount
  }

  await organizations.createIndex(
    { sub_domain: 1 },
    {
      unique: true,
      name: INDEX_NAME,
      partialFilterExpression: { sub_domain: { $type: 'string', $gt: '' } },
    },
  )

  const invalidCount = await organizations.countDocuments({
    $or: [
      { sub_domain: { $exists: false } },
      { sub_domain: null },
      { sub_domain: '' },
    ],
  })
  const duplicates = await organizations.aggregate([
    { $match: { sub_domain: { $type: 'string', $gt: '' } } },
    { $group: { _id: '$sub_domain', count: { $sum: 1 }, organizations: { $push: '$organizationId' } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray()
  const finalRows = await organizations.find({}).project({ organizationId: 1, sub_domain: 1 }).toArray()
  const invalidFormats = finalRows.filter((row: any) => {
    const value = String(row.sub_domain || '').trim()
    return value.length < 2 || RESERVED_SUBDOMAINS.has(value) || normalizeSubdomain(value) !== value
  })
  const aliasMismatches = await aliases.aggregate([
    { $lookup: { from: 'organizations', localField: 'organizationId', foreignField: 'organizationId', as: '__organization' } },
    { $set: { __organization: { $arrayElemAt: ['$__organization', 0] } } },
    { $match: { $expr: { $ne: ['$canonicalSubdomain', '$__organization.sub_domain'] } } },
    { $project: { _id: 1, alias: 1, organizationId: 1, canonicalSubdomain: 1, expected: '$__organization.sub_domain' } },
  ]).toArray()
  if (invalidCount || duplicates.length || invalidFormats.length || aliasMismatches.length) {
    throw new Error(`Post-migration verification failed: blank=${invalidCount} duplicateGroups=${duplicates.length} invalidFormats=${invalidFormats.length} aliasMismatches=${aliasMismatches.length}; recoveryPlan=${preApplyManifest}`)
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    ...manifestBase,
    applied,
    backups,
    preApplyManifest,
    verification: { blankOrMissing: invalidCount, duplicateGroups: duplicates.length, invalidFormats: invalidFormats.length, aliasMismatches: aliasMismatches.length, index: INDEX_NAME, aliasUpdates },
  })
  console.log(`[${MIGRATION}] completed applied=${applied} aliasUpdates=${aliasUpdates} manifest=${manifest}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
