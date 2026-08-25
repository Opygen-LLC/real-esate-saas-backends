import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const service = read('src/app/module/metaIntegration/metaIntegration.service.ts')
const model = read('src/app/module/metaIntegration/metaIntegration.model.ts')
const route = read('src/app/module/metaIntegration/metaIntegration.route.ts')
const controller = read('src/app/module/metaIntegration/metaIntegration.controller.ts')

assert.match(model, /pixelEnabled/)
assert.match(model, /capiEnabled/)
assert.match(model, /capiStatus/)
assert.match(model, /accessTokenEncrypted: \{ type: String, default: '', select: false \}/)
assert.doesNotMatch(model, /accessTokenEncrypted: \{ type: String, required: true/)
assert.match(service, /resolveCanonicalMetaPublicUrl/)
assert.match(service, /buildTenantWebsiteUrl/)
assert.match(service, /domain\?\.domain \|\| null/)
assert.match(service, /browserPixelFired/)
assert.match(service, /event_id: event\.eventId/)
assert.match(service, /capiStatus: 'error'/)
assert.doesNotMatch(controller, /req\.body\.eventSourceUrl/)
assert.match(route, /router\.get\('\/diagnostics'/)
assert.match(route, /browserPixelFired: z\.boolean\(\)\.optional\(\)/)
console.log('Meta Phase 3 architecture verification passed')
