import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'
import { collectTenantRelationFindings, summarizeTenantRelationFindings } from './tenantRelationIntegrity'

const MIGRATION = 'phase3-production-reconciliation-v1'
const CONFIRMATION = 'phase3-production-reconciliation'
const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'youtube', 'x'] as const
const SOCIAL_HOSTS: Record<(typeof SOCIAL_PLATFORMS)[number], readonly string[]> = {
  facebook: ['facebook.com'],
  instagram: ['instagram.com'],
  youtube: ['youtube.com', 'youtu.be'],
  x: ['x.com', 'twitter.com'],
}

type SocialFinding = { organizationId: string; field: string; valueType: string; reason: string }
type ShapeFinding = { organizationId: string; field: string; reason: string }

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)

const socialUrlIssue = (platform: keyof typeof SOCIAL_HOSTS, raw: unknown): string | undefined => {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'string') return 'must be a string'
  if (raw.length > 2048) return 'exceeds 2048 characters'
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return 'must use https://'
    if (url.username || url.password) return 'must not contain URL credentials'
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!SOCIAL_HOSTS[platform].some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      return `host must be ${SOCIAL_HOSTS[platform].join(' or ')}`
    }
  } catch {
    return 'is not a valid URL'
  }
  return undefined
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

  const relationFindings = await collectTenantRelationFindings(db)
  const relationCounts = summarizeTenantRelationFindings(relationFindings)
  const socialFindings: SocialFinding[] = []
  const shapeFindings: ShapeFinding[] = []
  let legacyTwitterCount = 0
  let twitterNeedsCopyCount = 0
  let masterVisibilityDefaults = 0
  const networkVisibilityDefaults: Record<string, number> = Object.fromEntries(SOCIAL_PLATFORMS.map((field) => [field, 0]))
  const deterministicOrgIds = new Set<string>()

  const cursor = organizations.find({}, {
    projection: {
      organizationId: 1,
      agencyName: 1,
      email: 1,
      phone: 1,
      socialLinks: 1,
      websiteSettings: 1,
    },
  })
  for await (const org of cursor) {
    const organizationId = String(org.organizationId || '')
    if (!organizationId) {
      shapeFindings.push({ organizationId: String(org._id), field: 'organizationId', reason: 'missing required public tenant identifier' })
      continue
    }
    for (const required of ['agencyName', 'email', 'phone'] as const) {
      if (typeof org[required] !== 'string' || !String(org[required]).trim()) {
        shapeFindings.push({ organizationId, field: required, reason: 'missing or invalid required public-site field' })
      }
    }

    if (org.socialLinks !== undefined && !isPlainObject(org.socialLinks)) {
      shapeFindings.push({ organizationId, field: 'socialLinks', reason: 'must be an object when present' })
      continue
    }
    const social = isPlainObject(org.socialLinks) ? org.socialLinks : {}
    const twitter = social.twitter
    if (typeof twitter === 'string' && twitter.trim()) {
      legacyTwitterCount += 1
      if (typeof social.x !== 'string' || !social.x.trim()) {
        twitterNeedsCopyCount += 1
        deterministicOrgIds.add(organizationId)
      }
    }
    for (const platform of SOCIAL_PLATFORMS) {
      const issue = socialUrlIssue(platform, social[platform])
      if (issue) socialFindings.push({ organizationId, field: `socialLinks.${platform}`, valueType: typeof social[platform], reason: issue })
    }
    if (twitter !== undefined) {
      const issue = socialUrlIssue('x', twitter)
      if (issue) socialFindings.push({ organizationId, field: 'socialLinks.twitter', valueType: typeof twitter, reason: issue })
    }

    if (org.websiteSettings !== undefined && !isPlainObject(org.websiteSettings)) {
      shapeFindings.push({ organizationId, field: 'websiteSettings', reason: 'must be an object when present' })
      continue
    }
    const settings = isPlainObject(org.websiteSettings) ? org.websiteSettings : {}
    if (settings.footer !== undefined && !isPlainObject(settings.footer)) {
      shapeFindings.push({ organizationId, field: 'websiteSettings.footer', reason: 'must be an object when present' })
      continue
    }
    const footer = isPlainObject(settings.footer) ? settings.footer : {}
    if (!Object.prototype.hasOwnProperty.call(footer, 'showSocialLinks')) {
      masterVisibilityDefaults += 1
      deterministicOrgIds.add(organizationId)
    } else if (typeof footer.showSocialLinks !== 'boolean') {
      shapeFindings.push({ organizationId, field: 'websiteSettings.footer.showSocialLinks', reason: 'must be boolean' })
    }

    if (footer.socialVisibility !== undefined && !isPlainObject(footer.socialVisibility)) {
      shapeFindings.push({ organizationId, field: 'websiteSettings.footer.socialVisibility', reason: 'must be an object when present' })
      continue
    }
    const visibility = isPlainObject(footer.socialVisibility) ? footer.socialVisibility : {}
    for (const platform of SOCIAL_PLATFORMS) {
      if (!Object.prototype.hasOwnProperty.call(visibility, platform)) {
        networkVisibilityDefaults[platform] += 1
        deterministicOrgIds.add(organizationId)
      } else if (typeof visibility[platform] !== 'boolean') {
        shapeFindings.push({ organizationId, field: `websiteSettings.footer.socialVisibility.${platform}`, reason: 'must be boolean' })
      }
    }
  }

  const summary = {
    relations: relationCounts,
    relationFindingCount: relationFindings.length,
    hardRelationBlockers: relationFindings.filter((finding) => finding.repair === 'hard_blocker').length,
    legacyTwitterCount,
    twitterNeedsCopyCount,
    masterVisibilityDefaults,
    networkVisibilityDefaults,
    malformedSocialUrlCount: socialFindings.length,
    incompatibleShapeCount: shapeFindings.length,
    deterministicOrganizationCount: deterministicOrgIds.size,
  }
  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'}`)
  console.log(JSON.stringify(summary, null, 2))
  for (const finding of relationFindings.slice(0, 100)) console.log(JSON.stringify({ type: 'relation', ...finding }))
  for (const finding of socialFindings.slice(0, 100)) console.log(JSON.stringify({ type: 'social_url', ...finding }))
  for (const finding of shapeFindings.slice(0, 100)) console.log(JSON.stringify({ type: 'shape', ...finding }))

  const manifestPayload = { summary, relationFindings, socialFindings, shapeFindings }
  if (!cli.apply) {
    const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { mode: 'dry-run', ...manifestPayload })
    console.log(`[${MIGRATION}] manifest=${manifest}; no data changed.`)
    console.log(`[${MIGRATION}] resolve ambiguous findings first; deterministic fixes require --apply --confirm=${CONFIRMATION}`)
    if (process.argv.includes('--fail-on-findings') && (relationFindings.length || socialFindings.length || shapeFindings.length || deterministicOrgIds.size)) {
      throw new Error(`Phase 3 reconciliation gate found unresolved production data. Review ${manifest}`)
    }
    return
  }

  // Only deterministic, lossless repairs are automated. Cross-tenant references,
  // malformed URLs and invalid object shapes need explicit operator decisions.
  if (relationFindings.length || socialFindings.length || shapeFindings.length) {
    const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { mode: 'apply-refused', ...manifestPayload })
    throw new Error(`Refusing apply while ambiguous findings remain. Review ${manifest}`)
  }

  const affectedFilter = deterministicOrgIds.size
    ? { organizationId: { $in: [...deterministicOrgIds] } }
    : { _id: { $exists: false } }
  const backup = await backupDocuments({ collection: organizations, filter: affectedFilter, migrationName: MIGRATION, backupDir: cli.backupDir })

  const twitterResult = await organizations.updateMany(
    { 'socialLinks.twitter': { $type: 'string', $ne: '' }, $or: [{ 'socialLinks.x': { $exists: false } }, { 'socialLinks.x': '' }, { 'socialLinks.x': null }] },
    [{ $set: { 'socialLinks.x': '$socialLinks.twitter' } }],
  )
  const masterResult = await organizations.updateMany(
    { 'websiteSettings.footer.showSocialLinks': { $exists: false } },
    { $set: { 'websiteSettings.footer.showSocialLinks': true } },
  )
  const visibilityResults: Record<string, number> = {}
  for (const platform of SOCIAL_PLATFORMS) {
    const result = await organizations.updateMany(
      { [`websiteSettings.footer.socialVisibility.${platform}`]: { $exists: false } },
      { $set: { [`websiteSettings.footer.socialVisibility.${platform}`]: true } },
    )
    visibilityResults[platform] = result.modifiedCount
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    mode: 'apply',
    ...manifestPayload,
    backup,
    twitterCopiedToX: twitterResult.modifiedCount,
    masterVisibilityDefaultsApplied: masterResult.modifiedCount,
    networkVisibilityDefaultsApplied: visibilityResults,
    legacyTwitterDeleted: 0,
  })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
