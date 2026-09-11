const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const middleware = read('src/app/module/property/propertyMedia.middleware.ts')
const validation = read('src/app/module/property/property.validation.ts')
const service = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
const codes = read('src/contracts/apiContract.ts')
const cors = JSON.parse(read('ops/r2-cors.json'))

test('property server fallback is capped below the Vercel body limit', () => {
  assert.match(middleware, /MAX_PROPERTY_FALLBACK_BYTES = 4 \* 1024 \* 1024/)
  assert.match(middleware, /fileSize: MAX_PROPERTY_FALLBACK_BYTES/)
  assert.match(middleware, /API_ERROR_CODES\.DIRECT_UPLOAD_REQUIRED/)
  assert.match(codes, /DIRECT_UPLOAD_REQUIRED: 'DIRECT_UPLOAD_REQUIRED'/)
})

test('presign refresh reuses the same pending intent without reserving storage twice', () => {
  assert.match(validation, /key: z\.string\(\)\.min\(1\)\.max\(1024\)\.optional\(\)/)
  assert.match(service, /const refreshKey = String\(payload\.key \|\| ''\)\.trim\(\)/)
  assert.match(service, /WebsiteUploadIntent\.findOne/)
  assert.match(service, /ObjectStorageService\.presignUpload\(uploadKey, payload\.mimeType\)/)
  const refresh = service.indexOf('if (refreshKey)')
  const reserve = service.indexOf('await UsageBudgetService.reserveUploadBytes(organizationId, size)', refresh)
  assert.ok(refresh >= 0 && reserve > refresh, 'refresh branch must run before new storage reservation')
})

test('R2 browser CORS remains constrained to the production origin and direct PUT headers', () => {
  assert.deepEqual(cors[0].AllowedOrigins, ['https://realestate.opygen.com'])
  for (const method of ['PUT', 'HEAD']) assert.ok(cors[0].AllowedMethods.includes(method))
  assert.ok(cors[0].AllowedHeaders.includes('Content-Type'))
  assert.ok(cors[0].ExposeHeaders.includes('ETag'))
})
