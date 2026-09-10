import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const assert = (condition, message) => { if (!condition) throw new Error(`Phase 3 abuse/infrastructure security verification failed: ${message}`) }

const rateLimiter = read('src/app/middlewares/rateLimiter.ts')
const authRoutes = read('src/app/module/auth/auth.route.ts')
const authService = read('src/app/module/auth/auth.services.ts')
const budgets = read('src/app/security/usageBudget.service.ts')
const config = read('src/config/index.ts')
const app = read('src/app.ts')
const security = read('src/app/middlewares/security.ts')
const storage = read('src/app/module/websiteBuilder/objectStorage.service.ts')
const storedFile = read('src/app/module/websiteBuilder/storedFileSecurity.service.ts')
const processor = read('src/app/module/websiteBuilder/websiteAssetProcessor.service.ts')
const compose = read('docker-compose.production.yml')
const caddy = read('Caddyfile')
const runbook = read('docs/security/phase3-production-runbook.md')
const migration = read('scripts/migrate-private-storage.mjs')

// Replica-wide and identity-aware rate limiting.
assert(rateLimiter.includes("RedisClient.command(['EVAL'"), 'rate limiting must use atomic Redis counters')
assert(rateLimiter.includes("config.isProduction) throw new ApiError(503") && rateLimiter.includes('RATE_LIMIT_UNAVAILABLE'), 'production rate limiting must fail closed if Redis is unavailable')
for (const limiter of [
  'loginRateLimiter', 'registrationRateLimiter', 'otpSendRateLimiter', 'otpVerifyRateLimiter',
  'passwordResetRequestRateLimiter', 'passwordResetVerifyRateLimiter', 'passwordResetCompleteRateLimiter',
  'uploadRateLimiter', 'uploadPresignRateLimiter', 'publicLeadRateLimiter', 'searchRateLimiter',
  'reportRateLimiter', 'exportRateLimiter', 'adminOperationRateLimiter', 'outboundEmailRateLimiter',
  'outboundSmsRateLimiter', 'outboundWhatsAppRateLimiter', 'websiteMutationRateLimiter',
]) assert(rateLimiter.includes(`export const ${limiter}`), `missing operation-specific limiter ${limiter}`)
for (const identity of ['requestNetwork', 'requestUserId', 'requestTenantId', 'requestIdentifier', 'requestRefreshToken']) {
  assert(rateLimiter.includes(identity), `rate limiting must include ${identity}`)
}
assert(!rateLimiter.includes('express-rate-limit'), 'Phase 3 limiter must not depend on process-local express-rate-limit')

for (const marker of [
  'registrationRateLimiter', 'loginRateLimiter', 'otpSendRateLimiter', 'otpVerifyRateLimiter',
  'passwordResetRequestRateLimiter', 'passwordResetVerifyRateLimiter', 'passwordResetCompleteRateLimiter', 'refreshRateLimiter',
]) assert(authRoutes.includes(marker), `auth routes must apply ${marker}`)
assert(authService.includes('authenticationDelay') && authService.includes('lockedUntil') && authService.includes('ACCOUNT_TEMPORARILY_LOCKED'), 'login must retain progressive delay and temporary account lockout')
assert(authService.includes("event: 'auth_login_failed'") && authService.includes("event: 'auth_otp_failed'"), 'authentication anomalies must be logged')

// Hard application usage ceilings at provider/storage boundaries.
for (const kind of ["'email'", "'sms'", "'whatsapp'", "'meta'", "'upload-bytes'"]) assert(budgets.includes(kind), `usage budget missing ${kind}`)
assert(budgets.includes('LUA_RESERVE_DAILY') && budgets.includes('USAGE_BUDGET_EXCEEDED') && budgets.includes('USAGE_BUDGET_UNAVAILABLE'), 'usage budgets must be atomic and fail closed in production')
const budgetConsumers = [
  ['src/app/module/auth/authEmail.service.ts', 'reserveEmail'],
  ['src/app/module/teamInvitation/teamInvitation.service.ts', 'reserveEmail'],
  ['src/app/module/sms/sms.service.ts', 'reserveSms'],
  ['src/app/module/whatsapp/whatsapp.service.ts', 'reserveWhatsApp'],
  ['src/app/module/metaIntegration/metaIntegration.service.ts', 'reserveMeta'],
  ['src/app/module/upload/upload.service.ts', 'reserveUploadBytes'],
  ['src/app/module/websiteBuilder/websiteBuilder.service.ts', 'reserveUploadBytes'],
]
for (const [file, marker] of budgetConsumers) assert(read(file).includes(marker), `${file} must reserve ${marker} before metered work`)
for (const envName of [
  'EMAIL_GLOBAL_DAILY_LIMIT', 'EMAIL_TENANT_DAILY_LIMIT', 'SMS_GLOBAL_DAILY_LIMIT', 'SMS_TENANT_DAILY_LIMIT',
  'WHATSAPP_GLOBAL_DAILY_LIMIT', 'WHATSAPP_TENANT_DAILY_LIMIT', 'META_GLOBAL_DAILY_LIMIT', 'META_TENANT_DAILY_LIMIT',
  'UPLOAD_GLOBAL_DAILY_BYTES', 'UPLOAD_TENANT_DAILY_BYTES',
]) assert(config.includes(envName), `missing production usage-cap configuration ${envName}`)

// Upload content verification, sanitization, quarantine, and private storage separation.
for (const marker of ['assertSafeUploadFilename', 'validateStoredFile', 'sanitizeStoredPublicImage', 'Active or embedded PDF content is not allowed', 'PDF contains trailing or polyglot data']) {
  assert(storedFile.includes(marker), `stored-file security missing ${marker}`)
}
assert(storedFile.includes('sharp(') && storedFile.includes('limitInputPixels'), 'images must be decoded with a pixel limit before acceptance')
assert(processor.includes('scanStoredObject') && processor.includes('sanitizeStoredPublicImage'), 'website assets must be scanned and re-encoded before publication')
assert(config.includes('GCP_PRIVATE_BUCKET_NAME') && config.includes('must be different from the public GCP_BUCKET_NAME'), 'production must require a dedicated private object bucket')
assert(storage.includes('allUsers') && storage.includes('allAuthenticatedUsers'), 'private bucket readiness must reject public IAM principals')
assert(storage.includes('privateBucketSecurityHealth') && storage.includes("responseDisposition: 'attachment'") && storage.includes("responseType: 'application/octet-stream'"), 'private downloads and readiness must be hardened')
assert(migration.includes('copy-and-delete-public-private-objects') && migration.includes('crc32c') && migration.includes('delete'), 'private storage migration must verify then delete legacy public copies')

// HTTPS/proxy/header/cache controls.
assert(security.includes('export const enforceHttps') && security.includes('redirect(308') && security.includes('config.public_api_url'), 'production API must redirect HTTP to the canonical HTTPS origin')
assert(security.includes('private, no-store') && security.includes('Permissions-Policy') && security.includes('X-Permitted-Cross-Domain-Policies'), 'private caching and security headers must be explicit')
assert(app.includes('helmet({') && app.includes('includeSubDomains: false') && app.includes('app.use(enforceHttps)'), 'API must install Helmet/HSTS and HTTPS enforcement')
assert(config.includes("requireTrustedProxy(process.env.TRUST_PROXY") || (config.includes('TRUST_PROXY') && config.includes('production')), 'production trusted-proxy configuration must be required')
assert(caddy.includes('{$CADDY_SITE_ADDRESS}') && caddy.includes('reverse_proxy api:5000') && !caddy.includes(':80 {'), 'Caddy must terminate automatic HTTPS on the configured hostname')
assert(caddy.includes('Strict-Transport-Security') && caddy.includes('X-Content-Type-Options'), 'edge must set baseline transport/content headers')
assert(!/^\s*-\s*["']?5000:5000/m.test(compose), 'production compose must not publish API port 5000 to the host')
assert(compose.includes('requirepass') && compose.includes('--appendonly') && compose.includes('CADDY_SITE_ADDRESS'), 'production compose must protect/persist Redis and require the TLS site address')
assert(!compose.includes('opy-realestate-505614-d4e3b5e9f13d.json') && compose.includes('GCP_KEY_FILE: ${GCP_KEY_FILE:-}'), 'production compose must not bake a service-account key path into the deployment')
assert(config.includes('CLAMAV_HOST') && app.includes('virusScannerHealth'), 'production readiness must require malware scanning')

// Every super-admin route must have an identity limiter close to its auth guard.
const moduleRoot = path.join(root, 'src/app/module')
const stack = [moduleRoot]
const unthrottledAdminFiles = []
while (stack.length) {
  const dir = stack.pop()
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) stack.push(full)
    else if (entry.name.endsWith('.route.ts')) {
      const source = fs.readFileSync(full, 'utf8')
      let cursor = 0
      while ((cursor = source.indexOf('authMiddlewares.authSuperAdmin', cursor)) >= 0) {
        const nearbyAfter = source.slice(cursor, cursor + 260)
        const nearbyBefore = source.slice(Math.max(0, cursor - 180), cursor)
        const hasIdentityLimit = nearbyAfter.includes('adminOperationRateLimiter')
        const hasNetworkLimit = nearbyBefore.includes('adminNetworkRateLimiter') || source.includes('router.use(adminNetworkRateLimiter)')
        if (!hasIdentityLimit || !hasNetworkLimit) { unthrottledAdminFiles.push(path.relative(root, full)); break }
        cursor += 1
      }
    }
  }
}
assert(unthrottledAdminFiles.length === 0, `super-admin routes missing admin limiter: ${unthrottledAdminFiles.join(', ')}`)


const propertyRoutes = read('src/app/module/property/property.route.ts')
assert(propertyRoutes.includes("router.get('/public/:organizationId', searchRateLimiter") && propertyRoutes.includes("router.get('/', authMiddlewares.requirePermission('properties.read'), searchRateLimiter"), 'public and authenticated property searches must be rate limited')
const supportService = read('src/app/module/support/support.service.ts')
assert(supportService.includes('EntitlementService.assertStorage(ticket.organizationId, input.size)') && supportService.includes('storageUsedBytes'), 'support attachments must participate in tenant storage quotas')

assert(runbook.includes('provider') && runbook.includes('budget') && runbook.includes('private') && runbook.includes('Cloudflare'), 'production runbook must cover provider spend controls, private storage, and edge protection')
console.log('Phase 3 abuse prevention, uploads, infrastructure, HTTPS, headers, and spend security verification passed.')
