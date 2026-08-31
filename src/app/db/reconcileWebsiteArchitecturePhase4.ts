import { isDeepStrictEqual } from 'node:util'
import mongoose, { Types } from 'mongoose'
import config from '../../config'
import { collectTenantRelationFindings } from './tenantRelationIntegrity'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'
import { WEBSITE_SECTION_KEYS } from '../module/websiteBuilder/websiteArchitecture.contract'
import { WEBSITE_TEMPLATE_IDS } from '../module/websiteBuilder/websiteTemplate.constants'
import { TemplateRegistry } from '../module/websiteBuilder/templateRegistry'
import { WebsiteBuilderValidation, checkGuardrails } from '../module/websiteBuilder/websiteBuilder.validation'

const MIGRATION = 'phase4-website-architecture'
const CONFIRM = 'APPLY_PHASE4_WEBSITE_ARCHITECTURE'
const HEX = /^#[0-9A-Fa-f]{6}$/
const validSections = new Set<string>(WEBSITE_SECTION_KEYS)
const validTemplates = new Set<string>(WEBSITE_TEMPLATE_IDS)

type Finding = {
  category: string
  collection: string
  documentId: string
  issue: string
  fixable: boolean
  manualReview: boolean
}

const flattenSectionStyles = (value: unknown, prefix = ''): Array<[string, any]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const out: Array<[string, any]> = []
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (validSections.has(path)) out.push([path, child])
    else if (child && typeof child === 'object' && !Array.isArray(child)) out.push(...flattenSectionStyles(child, path))
    else out.push([path, child])
  }
  return out
}

const normalizeBuilder = (input: any) => {
  const migrated = TemplateRegistry.migrate(input)
  const guardrail = checkGuardrails(migrated)
  if (!guardrail.valid) throw new Error(guardrail.message || 'Builder guardrail failed')
  WebsiteBuilderValidation.builderDocumentSchema.parse(migrated)
  TemplateRegistry.assertCapabilities(migrated)
  return migrated
}

const builderNeedsNormalization = (input: any, normalized: any) => !isDeepStrictEqual(input, normalized)

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, CONFIRM)
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const findings: Finding[] = []
  let checked = 0
  let valid = 0

  const relationFindings = await collectTenantRelationFindings(db)
  checked += relationFindings.length
  for (const finding of relationFindings) findings.push({
    category: 'tenant-relation', collection: finding.collection, documentId: finding.documentId,
    issue: `${finding.field}: ${finding.issue}`, fixable: finding.repair === 'unset', manualReview: finding.repair !== 'unset',
  })

  const organizations = await db.collection('organizations').find({}, { projection: { _id: 1, organizationId: 1, sub_domain: 1, templateId: 1, socialLinks: 1, websiteSettings: 1 } }).toArray()
  const subdomainMap = new Map<string, string[]>()
  for (const org of organizations) {
    checked += 1
    const id = String(org._id)
    const subdomain = String(org.sub_domain || '').trim().toLowerCase()
    if (!subdomain) findings.push({ category: 'subdomain', collection: 'organizations', documentId: id, issue: 'Blank subdomain', fixable: false, manualReview: true })
    else subdomainMap.set(subdomain, [...(subdomainMap.get(subdomain) || []), id])

    if (org.templateId && !validTemplates.has(String(org.templateId))) findings.push({ category: 'template', collection: 'organizations', documentId: id, issue: `Unknown templateId ${String(org.templateId)}`, fixable: false, manualReview: true })

    const styles = flattenSectionStyles(org.websiteSettings?.sectionStyles)
    for (const [key, style] of styles) {
      if (!validSections.has(key)) findings.push({ category: 'section-style', collection: 'organizations', documentId: id, issue: `Unknown section style key ${key}`, fixable: false, manualReview: true })
      else if (!style || typeof style !== 'object' || Array.isArray(style)) findings.push({ category: 'section-style', collection: 'organizations', documentId: id, issue: `Invalid style payload for ${key}`, fixable: false, manualReview: true })
      else for (const field of ['backgroundColor', 'textColor'] as const) if (style[field] != null && !HEX.test(String(style[field]))) findings.push({ category: 'section-style', collection: 'organizations', documentId: id, issue: `Malformed ${field} for ${key}`, fixable: false, manualReview: true })
    }

    if (org.socialLinks?.twitter && !org.socialLinks?.x) findings.push({ category: 'legacy-social', collection: 'organizations', documentId: id, issue: 'Legacy twitter field can be promoted to x', fixable: true, manualReview: false })
  }
  for (const [subdomain, ids] of subdomainMap) if (ids.length > 1) for (const id of ids) findings.push({ category: 'subdomain', collection: 'organizations', documentId: id, issue: `Duplicate subdomain ${subdomain}`, fixable: false, manualReview: true })

  const pages = await db.collection('websitepages').find({}, { projection: { _id: 1, organizationId: 1, draftDocument: 1, publishedDocument: 1 } }).toArray()
  for (const page of pages) {
    for (const field of ['draftDocument', 'publishedDocument'] as const) {
      const document = page[field]
      if (!document) continue
      checked += 1
      try {
        const migrated = normalizeBuilder(document)
        valid += 1
        if (builderNeedsNormalization(document, migrated)) findings.push({ category: 'builder-migration', collection: 'websitepages', documentId: String(page._id), issue: `${field} requires schema migration`, fixable: true, manualReview: false })
      } catch (error) {
        findings.push({ category: 'builder-document', collection: 'websitepages', documentId: String(page._id), issue: `${field}: ${error instanceof Error ? error.message : String(error)}`, fixable: false, manualReview: true })
      }
    }
  }

  const revisions = await db.collection('websiterevisions').find({}, { projection: { _id: 1, pageId: 1, organizationId: 1, document: 1, schemaVersion: 1 } }).toArray()
  for (const revision of revisions) {
    checked += 1
    const page = pages.find((candidate) => String(candidate._id) === String(revision.pageId))
    if (!page) {
      findings.push({ category: 'revision-orphan', collection: 'websiterevisions', documentId: String(revision._id), issue: 'Revision references a missing WebsitePage', fixable: false, manualReview: true })
      continue
    }
    if (String(page.organizationId) !== String(revision.organizationId)) findings.push({ category: 'revision-tenant', collection: 'websiterevisions', documentId: String(revision._id), issue: 'Revision organizationId does not match its WebsitePage', fixable: false, manualReview: true })
    try {
      const migrated = normalizeBuilder(revision.document)
      valid += 1
      if (Number(revision.schemaVersion || 0) !== Number(migrated.schemaVersion) || builderNeedsNormalization(revision.document, migrated)) findings.push({ category: 'revision-migration', collection: 'websiterevisions', documentId: String(revision._id), issue: 'Revision requires schemaVersion/document normalization', fixable: true, manualReview: false })
    } catch (error) {
      findings.push({ category: 'revision-document', collection: 'websiterevisions', documentId: String(revision._id), issue: error instanceof Error ? error.message : String(error), fixable: false, manualReview: true })
    }
  }

  const invalid = findings.length
  const fixable = findings.filter((item) => item.fixable).length
  const manualReview = findings.filter((item) => item.manualReview).length
  valid += Math.max(0, checked - invalid - valid)
  const byCategory = findings.reduce<Record<string, number>>((acc, finding) => { acc[finding.category] = (acc[finding.category] || 0) + 1; return acc }, {})
  const summary = { checked, valid, invalid, fixable, manualReview, byCategory }
  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'}`)
  console.log(JSON.stringify(summary, null, 2))
  if (findings.length) console.table(findings.slice(0, 100))

  if (cli.apply) {
    if (manualReview) throw new Error(`Refusing apply while ${manualReview} finding(s) require manual review`)
    const toObjectId = (value: string) => {
      if (!Types.ObjectId.isValid(value)) throw new Error(`Invalid ObjectId in deterministic Phase 4 repair: ${value}`)
      return new Types.ObjectId(value)
    }
    const backups: Array<{ file: string; count: number; sha256: string }> = []
    const repairableRelations = relationFindings.filter((finding) => finding.repair === 'unset')
    for (const collectionName of [...new Set(repairableRelations.map((finding) => finding.collection))]) {
      const ids = [...new Set(repairableRelations.filter((finding) => finding.collection === collectionName).map((finding) => finding.documentId))]
      if (ids.length) backups.push(await backupDocuments({ collection: db.collection(collectionName), filter: { _id: { $in: ids.map(toObjectId) } }, migrationName: MIGRATION, backupDir: cli.backupDir }))
    }
    const legacySocialIds = organizations.filter((org) => org.socialLinks?.twitter && !org.socialLinks?.x).map((org) => org._id)
    if (legacySocialIds.length) backups.push(await backupDocuments({ collection: db.collection('organizations'), filter: { _id: { $in: legacySocialIds } }, migrationName: MIGRATION, backupDir: cli.backupDir }))
    const legacyPageIds = pages.filter((page) => ['draftDocument', 'publishedDocument'].some((field) => {
      if (!page[field]) return false
      try { return builderNeedsNormalization(page[field], normalizeBuilder(page[field])) } catch { return false }
    })).map((page) => page._id)
    if (legacyPageIds.length) backups.push(await backupDocuments({ collection: db.collection('websitepages'), filter: { _id: { $in: legacyPageIds } }, migrationName: MIGRATION, backupDir: cli.backupDir }))
    const legacyRevisionIds = revisions.filter((revision) => {
      try {
        const migrated = normalizeBuilder(revision.document)
        return Number(revision.schemaVersion || 0) !== Number(migrated.schemaVersion) || builderNeedsNormalization(revision.document, migrated)
      } catch { return false }
    }).map((revision) => revision._id)
    if (legacyRevisionIds.length) backups.push(await backupDocuments({ collection: db.collection('websiterevisions'), filter: { _id: { $in: legacyRevisionIds } }, migrationName: MIGRATION, backupDir: cli.backupDir }))

    let applied = 0
    for (const finding of repairableRelations) {
      const result = await db.collection(finding.collection).updateOne(
        { _id: toObjectId(finding.documentId), organizationId: finding.organizationId, [finding.field]: toObjectId(finding.referenceId) },
        { $unset: { [finding.field]: '' } },
      )
      applied += result.modifiedCount
    }
    for (const org of organizations) {
      if (org.socialLinks?.twitter && !org.socialLinks?.x) {
        const result = await db.collection('organizations').updateOne({ _id: org._id, 'socialLinks.x': { $exists: false } }, { $set: { 'socialLinks.x': org.socialLinks.twitter }, $unset: { 'socialLinks.twitter': '' } })
        applied += result.modifiedCount
      }
    }
    for (const page of pages) {
      const set: Record<string, unknown> = {}
      for (const field of ['draftDocument', 'publishedDocument'] as const) if (page[field]) {
        const migrated = normalizeBuilder(page[field])
        if (builderNeedsNormalization(page[field], migrated)) set[field] = migrated
      }
      if (Object.keys(set).length) applied += (await db.collection('websitepages').updateOne({ _id: page._id, organizationId: page.organizationId }, { $set: set })).modifiedCount
    }
    for (const revision of revisions) {
      const migrated = normalizeBuilder(revision.document)
      if (Number(revision.schemaVersion || 0) !== Number(migrated.schemaVersion) || builderNeedsNormalization(revision.document, migrated)) applied += (await db.collection('websiterevisions').updateOne({ _id: revision._id, organizationId: revision.organizationId, pageId: revision.pageId }, { $set: { document: migrated, schemaVersion: migrated.schemaVersion } })).modifiedCount
    }
    const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { ...summary, applied, backups })
    console.log(`[${MIGRATION}] applied=${applied} manifest=${manifest}`)
  } else {
    console.log(`[${MIGRATION}] No changes made. Deterministic fixes only: --apply --confirm=${CONFIRM}`)
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => { await mongoose.disconnect().catch(() => undefined) })
