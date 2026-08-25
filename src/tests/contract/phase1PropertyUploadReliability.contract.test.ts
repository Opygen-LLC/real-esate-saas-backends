import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8')

describe('Phase 1 property media foundation contract', () => {
  it('keeps the property image create/update contract stable', () => {
    const validation = read('src/app/module/property/property.validation.ts')
    for (const token of [
      'assetId:',
      'url:',
      'publicId:',
      'caption:',
      'isFeatured:',
      'order:',
      'images: propertyImages.optional()',
    ]) expect(validation).toContain(token)
    expect(validation).toContain('propertyDraftSessionId')
  })

  it('uses GCS as the single canonical production object-storage provider', () => {
    const config = read('src/config/index.ts')
    const storage = read('src/app/module/websiteBuilder/objectStorage.service.ts')
    const productionCompose = read('docker-compose.production.yml')
    const ciCompose = read('docker-compose.ci.yml')

    expect(config).toContain("provider: 'gcs' as const")
    expect(config).toContain('gcp_project_id: gcpProjectId')
    expect(config).toContain('gcp_bucket_name: gcpBucketName')
    expect(config).toContain("GCP_PROJECT_ID is required in production for Google Cloud Storage")
    expect(config).toContain("GCP_BUCKET_NAME is required in production for Google Cloud Storage")

    expect(storage).toContain("provider: 'gcs' as const")
    expect(storage).toContain('new Storage(opts)')
    expect(storage).toContain('config.assets.gcp_project_id')
    expect(storage).toContain('config.assets.gcp_bucket_name')

    expect(productionCompose).toContain('GCP_PROJECT_ID:')
    expect(productionCompose).toContain('GCP_BUCKET_NAME:')
    expect(productionCompose).not.toMatch(/^\s{2}minio:/m)
    expect(productionCompose).not.toContain('OBJECT_STORAGE_INTERNAL_ENDPOINT')
    expect(ciCompose).not.toMatch(/^\s{2}minio:/m)
  })

  it('returns stable storage-specific errors and verifies the GCS bucket plus browser CORS', () => {
    const storage = read('src/app/module/websiteBuilder/objectStorage.service.ts')
    const contract = read('src/contracts/apiContract.ts')
    const app = read('src/app.ts')
    for (const code of ['OBJECT_STORAGE_NOT_CONFIGURED', 'OBJECT_STORAGE_UNAVAILABLE']) {
      expect(contract).toContain(code)
      expect(storage).toContain(`API_ERROR_CODES.${code}`)
    }
    expect(storage).toContain("const methodsNeeded = ['PUT', 'GET', 'HEAD']")
    expect(storage).toContain("detail: 'browser_cors_misconfigured'")
    expect(app).toContain('ObjectStorageService.configurationStatus()')
    expect(app).toContain('ObjectStorageService.health()')
    expect(app).toContain('objectStorage.healthy && clamav.healthy')
  })

  it('keeps direct PUT/server upload on the existing hardened asset lifecycle', () => {
    const route = read('src/app/module/property/property.route.ts')
    const controller = read('src/app/module/property/property.controller.ts')
    const service = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
    for (const endpoint of ['/assets/presign', '/assets/upload', '/assets/complete']) expect(route).toContain(endpoint)
    expect(controller).toContain('WebsiteBuilderService.presignAsset')
    expect(controller).toContain('WebsiteBuilderService.uploadAssetBuffer')
    expect(controller).toContain('WebsiteBuilderService.completeAsset')
    expect(service).toContain('variantWidths.flatMap')
    expect(service).toContain("['webp', 'avif']")
    expect(service).toContain('ObjectStorageService.putBuffer')
    expect(service).toContain("type: 'asset_finalize'")
  })

  it('retains malware scanning, storage accounting, draft cleanup, claiming and deletion', () => {
    const service = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
    const processor = read('src/app/module/websiteBuilder/websiteAssetProcessor.service.ts')
    expect(processor).toContain('scanStoredObject(asset.key)')
    expect(processor).toContain('scanStoredObject(variant.key)')
    expect(processor).toContain('EntitlementService.assertStorage')
    expect(processor).toContain('$inc: { storageUsedBytes: delta }')
    expect(service).toContain('validatePropertyDraftAssets')
    expect(service).toContain('claimPropertyDraftAssets')
    expect(service).toContain('cleanupPropertyDraftSession')
    expect(service).toContain('cleanupAbandonedPropertyDraftAssets')
    expect(service).toContain('ObjectStorageService.remove(asset.key)')
    expect(service).toContain('decrementStorageUsage')
  })

  it('ships a GCS CORS policy and a GCS-aware media verifier', () => {
    const cors = JSON.parse(read('ops/gcs-cors.json'))
    const verify = read('scripts/verify-media-stack.mjs')
    expect(cors).toHaveLength(1)
    expect(cors[0].origin).toContain('https://realestate.opygen.com')
    for (const method of ['GET', 'HEAD', 'PUT']) expect(cors[0].method).toContain(method)
    expect(cors[0].responseHeader).toContain('Content-Type')
    expect(verify).toContain("storage?.provider === 'gcs'")
    expect(verify).toContain('storage?.browserCors?.healthy === true')
    expect(verify).toContain("new Set(['PUT', 'GET', 'HEAD'])")
  })
})
