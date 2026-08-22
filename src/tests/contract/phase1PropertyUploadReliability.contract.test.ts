import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8')

describe('Phase 1 property image upload reliability contract', () => {
  it('fails fast on missing production object-storage configuration', () => {
    const config = read('src/config/index.ts')
    for (const name of [
      'OBJECT_STORAGE_ENDPOINT',
      'OBJECT_STORAGE_BUCKET',
      'OBJECT_STORAGE_REGION',
      'OBJECT_STORAGE_ACCESS_KEY_ID',
      'OBJECT_STORAGE_SECRET_ACCESS_KEY',
      'OBJECT_STORAGE_PUBLIC_BASE_URL',
    ]) {
      expect(config).toContain(`requiredInProduction('${name}'`)
    }
    expect(config).toContain("objectStorageRequireInternalEndpoint")
    expect(config).toContain("requiredInProduction('OBJECT_STORAGE_INTERNAL_ENDPOINT')")
    expect(config).toContain("OBJECT_STORAGE_ENDPOINT must use https:// in production")
    expect(config).toContain("OBJECT_STORAGE_INTERNAL_ENDPOINT")
  })

  it('returns stable storage-specific errors and readiness checks bucket plus browser CORS', () => {
    const storage = read('src/app/module/websiteBuilder/objectStorage.service.ts')
    const contract = read('src/contracts/apiContract.ts')
    const app = read('src/app.ts')
    for (const code of ['OBJECT_STORAGE_NOT_CONFIGURED', 'OBJECT_STORAGE_UNAVAILABLE']) {
      expect(contract).toContain(code)
      expect(storage).toContain(`API_ERROR_CODES.${code}`)
    }
    expect(storage).toContain("(['PUT', 'GET', 'HEAD'] as CorsMethod[])")
    expect(storage).toContain("'access-control-request-headers': 'content-type'")
    expect(storage).toContain("detail: 'browser_cors_misconfigured'")
    expect(app).toContain('ObjectStorageService.configurationStatus()')
    expect(app).toContain('ObjectStorageService.health()')
    expect(app).toContain('objectStorage.healthy && clamav.healthy')
  })

  it('keeps direct PUT primary and the server upload on the same hardened asset lifecycle', () => {
    const route = read('src/app/module/property/property.route.ts')
    const controller = read('src/app/module/property/property.controller.ts')
    const service = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
    for (const endpoint of ['/assets/presign', '/assets/upload', '/assets/complete']) expect(route).toContain(endpoint)
    expect(controller).toContain('WebsiteBuilderService.presignAsset')
    expect(controller).toContain('WebsiteBuilderService.uploadAssetBuffer')
    expect(controller).toContain('WebsiteBuilderService.completeAsset')
    expect(service).toContain("[640, 1280].flatMap")
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
    expect(processor).toContain("$inc: { storageUsedBytes: delta }")
    expect(service).toContain('validatePropertyDraftAssets')
    expect(service).toContain('claimPropertyDraftAssets')
    expect(service).toContain('cleanupPropertyDraftSession')
    expect(service).toContain('cleanupAbandonedPropertyDraftAssets')
    expect(service).toContain('ObjectStorageService.remove(asset.key)')
    expect(service).toContain('decrementStorageUsage')
  })

  it('ships the expected production dashboard CORS policy and verifier', () => {
    const cors = read('ops/minio-cors.xml')
    const verify = read('scripts/verify-media-stack.mjs')
    expect(cors).toContain('<AllowedOrigin>https://realestate.opygen.com</AllowedOrigin>')
    for (const method of ['GET', 'HEAD', 'PUT']) expect(cors).toContain(`<AllowedMethod>${method}</AllowedMethod>`)
    expect(cors).toContain('<AllowedHeader>Content-Type</AllowedHeader>')
    expect(verify).toContain("new Set(['PUT', 'GET', 'HEAD'])")
    expect(verify).toContain('storage?.browserCors?.healthy === true')
  })
})
