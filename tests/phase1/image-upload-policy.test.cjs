const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const policy = read('src/app/helpers/imageUploadPolicy.ts')
const codes = read('src/contracts/apiContract.ts')
const direct = read('src/app/module/upload/upload.direct.service.ts')
const middleware = read('src/app/module/upload/upload.middleware.ts')
const propertyMiddleware = read('src/app/module/property/propertyMedia.middleware.ts')
const propertyValidation = read('src/app/module/property/property.validation.ts')
const propertyDocuments = read('src/app/module/property/propertyDocument.service.ts')
const websiteValidation = read('src/app/module/websiteBuilder/websiteBuilder.validation.ts')
const website = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
const security = read('src/app/module/websiteBuilder/storedFileSecurity.service.ts')

test('server policy mirrors browser limits and explicit image error codes', () => {
  assert.match(policy, /property:\s*\{ maxBytes: 5 \* 1024 \* 1024, maxPixels: 40_000_000, maxDimension: 12_000/)
  assert.match(policy, /website:\s*\{ maxBytes: 5 \* 1024 \* 1024, maxPixels: 40_000_000, maxDimension: 12_000/)
  assert.match(policy, /avatar:\s*\{ maxBytes: 5 \* 1024 \* 1024/)
  for (const code of ['IMAGE_TOO_LARGE', 'IMAGE_DIMENSIONS_TOO_LARGE', 'IMAGE_PIXEL_LIMIT_EXCEEDED', 'INVALID_IMAGE_TYPE', 'EMPTY_IMAGE', 'INVALID_IMAGE']) {
    assert.match(codes, new RegExp(`${code}: '${code}'`))
  }
})

test('presign and multipart paths use the same context-aware server policy', () => {
  assert.match(direct, /assertImageUploadSize\(size, folder\)/)
  assert.match(direct, /assertImageUploadFilename\(filename, mimeType\)/)
  assert.match(middleware, /assertImageUploadSize\(file\.size, folder\)/)
  assert.match(propertyMiddleware, /assertImageUploadSize\(req\.file\.size, 'property'\)/)
  assert.match(propertyDocuments, /assertImageUploadSize\(input\.size, 'property'\)/)
  assert.match(propertyDocuments, /IMAGE_UPLOAD_MIME_TYPES/)
  assert.match(website, /context === 'property-draft' \? 'property' : 'website'/)
  assert.match(website, /assertImageUploadSize\(payload\.size, imageContext\)/)
})

test('size max is owned by services so oversize presign errors keep IMAGE_TOO_LARGE instead of generic zod validation', () => {
  assert.doesNotMatch(propertyValidation, /presignImageZodSchema[^\n]*max\(20 \* 1024 \* 1024\)/)
  assert.doesNotMatch(websiteValidation, /presignAssetSchema[^\n]*max\(20 \* 1024 \* 1024\)/)
})

test('stored-byte validation distinguishes type, dimension, pixel and decode failures', () => {
  assert.match(security, /assertImageDimensions\(width, height\)/)
  assert.match(security, /API_ERROR_CODES\.INVALID_IMAGE_TYPE/)
  assert.match(security, /API_ERROR_CODES\.INVALID_IMAGE/)
  assert.match(policy, /API_ERROR_CODES\.IMAGE_DIMENSIONS_TOO_LARGE/)
  assert.match(policy, /API_ERROR_CODES\.IMAGE_PIXEL_LIMIT_EXCEEDED/)
})
