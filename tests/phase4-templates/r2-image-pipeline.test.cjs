const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const direct = read('src/app/module/upload/upload.direct.service.ts')
const processor = read('src/app/module/upload/upload.processor.service.ts')
const worker = read('src/app/module/upload/uploadProcessing.worker.ts')
const route = read('src/app/module/upload/upload.route.ts')
const controller = read('src/app/module/upload/upload.controller.ts')
const storage = read('src/app/module/websiteBuilder/objectStorage.service.ts')
const security = read('src/app/module/websiteBuilder/storedFileSecurity.service.ts')
const imagePolicy = read('src/app/helpers/imageUploadPolicy.ts')
const website = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
const websiteProcessor = read('src/app/module/websiteBuilder/websiteAssetProcessor.service.ts')
const app = read('src/app.ts')
const server = read('src/server.ts')
const config = read('src/config/index.ts')

// Source-level release gates intentionally protect architectural requirements
// that can regress even when endpoint-level tests continue to pass.
test('direct completion accepts R2 bytes without doing Sharp work in the request', () => {
  assert.match(direct, /status:\s*'uploaded'/)
  assert.match(direct, /ObjectStorageService\.head\(expectedUploadKey\)/)
  assert.doesNotMatch(direct, /\bsharp\s*\(/)
  assert.doesNotMatch(direct, /prepareStoredPublicImage/)
  assert.match(controller, /httpStatus\.ACCEPTED/)
})

test('new direct uploads are quarantined in the private R2 staging namespace', () => {
  assert.match(direct, /upload-staging\/generic/)
  assert.match(direct, /presignUpload\(uploadKey/)
  assert.match(storage, /\^tenants\\\/\[\^\/\]\+\\\/upload-staging\\\//)
})

test('worker verifies, scans, normalizes, promotes and accounts the clean original', () => {
  assert.match(processor, /scanStoredObject\(sourceKey\)/)
  assert.match(processor, /prepareStoredPublicImage\(sourceKey/)
  assert.match(processor, /ObjectStorageService\.putBuffer\(String\(intent\.key\), normalized\.buffer/)
  assert.match(processor, /status:\s*'ready'/)
  assert.match(processor, /storageUsedBytes/)
  assert.match(processor, /mongoSupportsTransactions/)
  assert.match(processor, /MAX_PROCESSING_ATTEMPTS\s*=\s*5/)
  assert.match(worker, /DirectUploadProcessor\.processBatch/)
  assert.match(server, /startUploadProcessingWorker\(\)/)
})

test('image security validates bytes and dimensions and strips metadata by re-encoding', () => {
  assert.match(security, /limitInputPixels:\s*MAX_IMAGE_PIXELS/)
  assert.match(security, /assertImageDimensions\(width, height\)/)
  assert.match(imagePolicy, /width \* height > MAX_IMAGE_UPLOAD_PIXELS/)
  assert.match(security, /Animated or multi-page images are not allowed/)
  assert.match(security, /\.rotate\(\)/)
  assert.match(security, /\.resize\(/)
  assert.doesNotMatch(security, /\.withMetadata\(/)
  assert.match(security, /mozjpeg:\s*false/)
})

test('status API exposes the asynchronous lifecycle and remains tenant/user scoped', () => {
  assert.match(route, /\/status\/:uploadId/)
  assert.match(route, /directUploadStatus/)
  assert.match(direct, /UploadIntent\.findOne\(\{ uploadId: normalized, organizationId, userId \}\)/)
  for (const status of ['presigned', 'uploaded', 'verifying', 'processing', 'ready', 'rejected']) {
    assert.ok(direct.includes(`'${status}'`), `missing lifecycle status ${status}`)
  }
})

test('website/property assets upload one staging object and worker promotes one clean original', () => {
  assert.match(website, /assetStagingKey/)
  assert.match(website, /requiredVariants:\s*any\[\]\s*=\s*\[\]/)
  assert.match(website, /presignUpload\(uploadKey/)
  assert.doesNotMatch(website, /\bsharp\s*\(/)
  assert.match(websiteProcessor, /const sourceKey = String\(intent\.uploadKey \|\| asset\.key\)/)
  assert.match(websiteProcessor, /Number\(source\.size\) !== declaredSize/)
  assert.match(websiteProcessor, /prepareStoredPublicImage\(sourceKey/)
  assert.match(websiteProcessor, /ObjectStorageService\.putBuffer\(asset\.key, prepared\.buffer/)
})

test('Cloudflare delivery provides responsive breakpoints and modern format negotiation', () => {
  assert.match(storage, /wbreakpoints=320;480;640;960;1280;1600;1920/)
  assert.match(storage, /format=auto/)
  assert.match(storage, /metadata=none/)
  assert.match(storage, /publicImageUrl/)
  assert.match(config, /CLOUDFLARE_IMAGE_TRANSFORMATIONS_ENABLED/)
  assert.match(config, /CLOUDFLARE_IMAGE_TRANSFORM_BASE_URL/)
})

test('readiness includes image processor health so production cannot silently strand uploads', () => {
  assert.match(app, /getUploadProcessingWorkerHealth/)
  assert.match(app, /imageProcessor/)
  assert.match(app, /workerReady/)
  assert.match(worker, /healthy:/)
})
