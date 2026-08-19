import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8')

describe('Phase 7 property draft asset lifecycle contract', () => {
  it('persists property-draft ownership fields and production query indexes', () => {
    const model = read('src/app/module/websiteBuilder/websiteAsset.model.ts')
    const migration = read('src/app/db/migratePropertyDraftAssets.ts')
    for (const token of ["'property-draft'", 'uploadSessionId', 'claimed', 'claimedByPropertyId', 'claimedAt', 'property_draft_lifecycle']) {
      expect(model).toContain(token)
    }
    expect(migration).toContain("context: 'website', claimed: true")
    expect(migration).toContain('property_draft_intent_lifecycle')
    expect(migration).toContain('property_asset_claim')
  })

  it('binds property uploads to the tenant/session and exposes only tenant-scoped cleanup routes', () => {
    const controller = read('src/app/module/property/property.controller.ts')
    const route = read('src/app/module/property/property.route.ts')
    expect(controller).toContain("{ context: 'property-draft', uploadSessionId }")
    expect(controller).toContain('WebsiteBuilderService.deletePropertyDraftAsset(requireTenant(req)')
    expect(controller).toContain('WebsiteBuilderService.cleanupPropertyDraftSession(requireTenant(req)')
    expect(route).toContain("'/assets/session/:sessionId/:assetId'")
    expect(route).toContain("'/assets/session/:sessionId'")
    expect(route).toContain("requirePermission('properties.write')")
  })

  it('creates and claims property media atomically in production', () => {
    const controller = read('src/app/module/property/property.controller.ts')
    const propertyService = read('src/app/module/property/property.service.ts')
    expect(controller).toContain('mongoSupportsTransactions()')
    expect(controller).toContain('Atomic property media claiming requires MongoDB transactions in production')
    expect(controller).toContain('session.withTransaction(execute)')
    expect(controller).toContain('validatePropertyDraftAssets')
    expect(controller).toContain('claimPropertyDraftAssets')
    expect(propertyService).toContain('emitEvent?: boolean')
    expect(propertyService).toContain("options.emitEvent !== false")
  })

  it('never deletes claimed property assets and corrects storage usage when drafts are removed', () => {
    const service = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
    expect(service).toContain("context: 'property-draft', uploadSessionId, claimed: false")
    expect(service).toContain('propertyReferenceForAsset')
    expect(service).toContain("context: 'property', claimed: true, claimedByPropertyId")
    expect(service).toContain("$max: [0, { $subtract:")
    expect(service).toContain('Property draft media could not be fully removed from object storage')
  })

  it('uses cancelled upload-intent tombstones so late in-flight PUTs cannot leak objects', () => {
    const service = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
    const intent = read('src/app/module/websiteBuilder/websiteUploadIntent.model.ts')
    expect(intent).toContain("'cancelled'")
    expect(service).toContain("intent.status !== 'pending'")
    expect(service).toContain('Upload session was cancelled before the asset was completed')
    expect(service).toContain("intent.status = 'cancelled'")
    expect(service).toContain("status: 'cancelled', createdAt: { $lte: cutoff }")
  })

  it('runs a short TTL cleanup separately from the legacy seven-day orphan sweep', () => {
    const config = read('src/config/index.ts')
    const worker = read('src/app/module/cron/phase3.worker.ts')
    const service = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
    expect(config).toContain('PROPERTY_DRAFT_ASSET_TTL_MINUTES || 120')
    expect(config).toContain('PROPERTY_DRAFT_CLEANUP_INTERVAL_MINUTES || 15')
    expect(worker).toContain('cleanupAbandonedPropertyDraftAssets(100)')
    expect(service).toContain('config.assets.property_draft_ttl_minutes * 60_000')
    expect(service).toContain('7 * 24 * 60 * 60_000')
  })
})
