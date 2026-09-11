const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const security = read('src/app/module/websiteBuilder/storedFileSecurity.service.ts')
const genericDirect = read('src/app/module/upload/upload.direct.service.ts')
const genericProcessor = read('src/app/module/upload/upload.processor.service.ts')
const genericIntent = read('src/app/module/upload/uploadIntent.model.ts')
const fallback = read('src/app/module/upload/upload.service.ts')
const website = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
const websiteProcessor = read('src/app/module/websiteBuilder/websiteAssetProcessor.service.ts')
const websiteAsset = read('src/app/module/websiteBuilder/websiteAsset.model.ts')
const storage = read('src/app/module/websiteBuilder/objectStorage.service.ts')
const errors = read('src/contracts/apiContract.ts')

test('canonical public image normalization always emits optimized WebP', () => {
  assert.match(security, /CANONICAL_PUBLIC_IMAGE_MIME\s*=\s*'image\/webp'/)
  assert.match(security, /\.webp\(\{[\s\S]*quality:\s*profile\.quality[\s\S]*effort:\s*profile\.effort/)
  assert.match(security, /withoutEnlargement:\s*true/)
  assert.doesNotMatch(security, /\.withMetadata\(/)
  assert.match(security, /property:\s*\{ maxDimension:\s*1_920, quality:\s*80, effort:\s*4 \}/)
  assert.match(security, /website:\s*\{ maxDimension:\s*1_920, quality:\s*80, effort:\s*4 \}/)
  assert.match(security, /avatar:\s*\{ maxDimension:\s*512, quality:\s*80, effort:\s*4 \}/)
  assert.match(security, /branding:\s*\{ maxDimension:\s*1_200, quality:\s*82, effort:\s*4 \}/)
  assert.match(security, /general:\s*\{ maxDimension:\s*1_920, quality:\s*80, effort:\s*4 \}/)
})

test('new generic durable image keys are WebP while staging keeps source extension', () => {
  assert.match(genericDirect, /return `\$\{base\}\/\$\{randomUUID\(\)\}-\$\{safeStem\(filename\)\}\.webp`/)
  assert.match(genericDirect, /upload-staging\/generic/)
  assert.match(genericDirect, /extensionForMime\(mimeType\)/)
  assert.match(genericIntent, /finalMimeType/)
  assert.match(genericIntent, /etag/)
  assert.match(genericIntent, /'image\/webp', 'image\/avif'/)
})

test('generic worker verifies private converted bytes before public promotion', () => {
  assert.match(genericProcessor, /upload-staging\/processed/)
  assert.match(genericProcessor, /prepareCanonicalPublicImage/)
  assert.match(genericProcessor, /ObjectStorageService\.putBuffer\(processingKey, normalized\.buffer, PROCESSING_MIME\)/)
  assert.match(genericProcessor, /ObjectStorageService\.head\(processingKey\)/)
  assert.match(genericProcessor, /ObjectStorageService\.putBuffer\(finalKey, normalized\.buffer, normalized\.mimeType\)/)
  assert.match(genericProcessor, /ObjectStorageService\.head\(finalKey\)/)
  assert.match(genericProcessor, /finalMimeType:\s*normalized\.mimeType/)
  assert.match(genericProcessor, /etag:\s*String\(finalObject\?\.etag/)
  assert.match(genericProcessor, /ObjectStorageService\.remove\(sourceKey\)/)
})

test('website and property assets use WebP final keys and update final metadata', () => {
  assert.match(website, /canonicalPublicAssetFilename/)
  assert.match(website, /return `\$\{stem\}\.webp`/)
  assert.match(websiteProcessor, /prepareCanonicalPublicImage/)
  assert.match(websiteProcessor, /asset\.key = finalKey/)
  assert.match(websiteProcessor, /asset\.mimeType = finalMimeType/)
  assert.match(websiteProcessor, /asset\.etag = original\.etag/)
  assert.match(websiteProcessor, /asset\.width = width/)
  assert.match(websiteProcessor, /asset\.height = height/)
  assert.match(websiteProcessor, /asset\.size = totalSize/)
  assert.match(websiteProcessor, /asset\.url = isImage \? ObjectStorageService\.publicImageUrl\(finalKey\)/)
})

test('private non-image files remain byte-preserving and are not WebP converted', () => {
  assert.match(websiteProcessor, /if \(isImage\)/)
  assert.match(websiteProcessor, /Private\/non-image files keep their original bytes and content type/)
  assert.match(websiteProcessor, /validateStoredFile\(/)
  assert.match(websiteProcessor, /ObjectStorageService\.putBuffer\(finalKey, validated\.body, asset\.mimeType\)/)
})

test('processing failures have explicit durable error codes and messages', () => {
  for (const code of ['INVALID_IMAGE_BYTES', 'IMAGE_PROCESSING_FAILED', 'IMAGE_MALWARE_REJECTED', 'IMAGE_STORAGE_VERIFICATION_FAILED']) {
    assert.match(errors, new RegExp(`${code}: '${code}'`))
  }
  assert.match(websiteAsset, /failureCode/)
  assert.match(websiteAsset, /failureMessage/)
  assert.match(websiteProcessor, /status = 'rejected'/)
  assert.match(genericProcessor, /status:\s*'rejected'/)
})

test('legacy multipart compatibility uploads also store WebP rather than large source formats', () => {
  assert.match(fallback, /encoder\.webp\(/)
  assert.match(fallback, /const contentType = 'image\/webp'/)
  assert.match(fallback, /const extension = 'webp'/)
})

test('Cloudflare responsive delivery remains enabled after canonical WebP storage', () => {
  assert.match(storage, /wbreakpoints=320;480;640;960;1280;1600;1920/)
  assert.match(storage, /format=auto/)
  assert.match(storage, /metadata=none/)
})
