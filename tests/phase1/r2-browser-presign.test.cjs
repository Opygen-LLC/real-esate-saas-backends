const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const storage = read('src/app/module/websiteBuilder/objectStorage.service.ts')
const legacyStorage = read('src/app/module/upload/upload.config.ts')
const website = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
const direct = read('src/app/module/upload/upload.direct.service.ts')
const corsScript = read('scripts/setup-r2-cors.mjs')
const verifier = read('scripts/verify-r2-browser-upload.mjs')
const pkg = JSON.parse(read('package.json'))

test('R2 client disables automatic payload checksums for browser-presigned PUTs', () => {
  assert.match(storage, /requestChecksumCalculation:\s*'WHEN_REQUIRED'/)
  assert.match(storage, /responseChecksumValidation:\s*'WHEN_REQUIRED'/)
  assert.match(legacyStorage, /requestChecksumCalculation:\s*'WHEN_REQUIRED'/)
  assert.match(storage, /r2_presign_contains_automatic_payload_checksum/)
  assert.match(storage, /x-amz-checksum-crc32/)
  assert.match(storage, /x-amz-sdk-checksum-algorithm/)
})

test('presigned uploads explicitly sign and return the normalized Content-Type', () => {
  assert.match(storage, /signableHeaders:\s*new Set\(\['content-type'\]\)/)
  assert.match(storage, /contentType:\s*contentType \|\| ''/)
  assert.match(website, /contentType:\s*payload\.mimeType/)
  assert.match(direct, /contentType:\s*String\(intent\.mimeType \|\| ''\)/)
})

test('R2 CORS is applied and verified for both public and private buckets', () => {
  assert.match(corsScript, /for \(const bucket of \[publicBucket, privateBucket\]\)/)
  assert.match(corsScript, /AllowedMethods:\s*\['GET', 'HEAD', 'PUT'\]/)
  assert.match(corsScript, /AllowedHeaders:\s*\['Content-Type'\]/)
  assert.match(corsScript, /assertBrowserCors\(bucket/)
  assert.match(verifier, /does not allow browser PUT\/HEAD/)
  assert.equal(pkg.scripts['storage:r2:verify-browser'], 'node scripts/verify-r2-browser-upload.mjs')
})
