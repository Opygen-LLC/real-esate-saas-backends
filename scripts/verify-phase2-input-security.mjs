import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const app = read('src/app.ts')
const guard = read('src/app/middlewares/requestInputGuard.ts')
const input = read('src/app/helpers/inputSecurity.ts')
const cors = read('src/app/middlewares/corsPolicy.ts')
const csrf = read('src/app/middlewares/security.ts')
const cookies = read('src/app/module/auth/auth.controller.ts')
const sanitizer = read('src/app/helpers/sanitize.ts')
const dbConfig = read('src/config/index.ts')
const dbRuntime = read('src/app/db/databaseSecurity.ts')
const builder = read('src/app/module/websiteBuilder/websiteBuilder.validation.ts')
const upload = read('src/app/module/property/propertyMedia.middleware.ts')

assert(app.includes('app.set("query parser", "simple")'), 'Express simple query parser must be enabled')
assert(app.indexOf('app.use(requestInputGuard)') < app.indexOf('app.use(csrfProtection)'), 'Input guard must run before CSRF/routing')
assert(guard.includes('assertSafeInputTree(req.query') && guard.includes('assertSafeInputTree(req.body'), 'Global query/body input tree checks are required')
for (const marker of ["key.startsWith('$')", "key.includes('.')", "'__proto__'", "'constructor'"]) assert(input.includes(marker), `Missing request-key defense: ${marker}`)
assert(cors.includes('isVerifiedTenantOrigin') && cors.includes('credentials: false'), 'Public write CORS must verify tenant origins without credentials')
assert(csrf.includes("req.get('sec-fetch-site') === 'cross-site'") && csrf.includes('timingSafeEqual'), 'Cookie-authenticated mutations must enforce CSRF protections')
assert(cookies.includes("'/api/v1/auth'") && cookies.includes("'/backend-api/auth'") && cookies.includes('httpOnly: true'), 'Refresh/access cookies must remain HttpOnly and path-scoped for direct/proxy API paths')
assert(sanitizer.includes('allowedTags:') && sanitizer.includes("allowedSchemes: ['http', 'https']") && sanitizer.includes('allowProtocolRelative: false'), 'Rich-text sanitizer must use an explicit allowlist')
assert(dbConfig.includes('assertProductionDatabaseUrl') && dbConfig.includes('dedicated application database user') && dbConfig.includes('must explicitly enable TLS'), 'Production MongoDB URI authentication/TLS assertions are required')
assert(dbRuntime.includes('PRIVILEGED_RUNTIME_ROLES') && dbRuntime.includes('connectionStatus'), 'Production MongoDB runtime role verification is required')
assert(builder.includes('builderDocumentSchema') && builder.includes('}).strict()'), 'Website builder documents must use strict schemas')
assert(upload.includes('limits:') && upload.includes('fileSize:') && upload.includes('ALLOWED_PROPERTY_IMAGE_TYPES.has(mimeType)'), 'Property uploads must enforce file limits and MIME allowlists')

const moduleRoot = path.join(root, 'src/app/module')
const stack = [moduleRoot]
const requestSchemaFiles = []
while (stack.length) {
  const dir = stack.pop()
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) stack.push(full)
    else if (/\.(validation|route)\.ts$/.test(entry.name)) requestSchemaFiles.push(full)
  }
}
const passthrough = requestSchemaFiles.filter((file) => fs.readFileSync(file, 'utf8').includes('.passthrough()'))
assert(passthrough.length === 0, `Request schemas must not silently passthrough unknown properties: ${passthrough.join(', ')}`)
console.log('Phase 2 input/database/XSS/CSRF/CORS/session security verification passed.')
