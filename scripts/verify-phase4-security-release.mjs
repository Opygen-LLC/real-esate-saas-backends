import fs from 'node:fs'
import path from 'node:path'
const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const assert = (condition, message) => { if (!condition) throw new Error(`Phase 4 security release verification failed: ${message}`) }

const app = read('src/app.ts')
const logger = read('src/shared/logger.ts')
const observability = read('src/shared/securityObservability.ts')
const auditTrail = read('src/app/middlewares/securityAuditTrail.ts')
const limiter = read('src/app/middlewares/rateLimiter.ts')
const budgets = read('src/app/security/usageBudget.service.ts')
const ci = read('.github/workflows/ci.yml')
const securityWorkflow = read('.github/workflows/security.yml')
const dockerfile = read('Dockerfile')
const compose = read('docker-compose.production.yml')
const alerts = read('ops/monitoring/security-alerts.yml')
const release = read('.github/workflows/release.yml')
const pkg = JSON.parse(read('package.json'))
const privilegedRouteAudit = read('scripts/security/audit-privileged-routes.mjs')
const privilegedRouteBaseline = JSON.parse(read('ops/security/privileged-route-baseline.json'))

for (const marker of ['security_request_rejections_total', 'security_rate_limit_rejections_total', 'security_usage_budget_rejections_total', 'security_usage_reserved_units_total', 'security_usage_global_utilization_ratio', 'security_upload_bytes_total']) assert(observability.includes(marker), `missing security metric ${marker}`)
assert(app.includes('securityAuditTrail') && app.includes('http_slow_requests_total'), 'request security audit/slow telemetry is not wired')
assert(app.includes('database_backup_age_seconds') && app.includes('database_backup_restore_verified'), 'backup/restore monitoring metrics are missing')
for (const marker of ['mongoCredentialPattern', 'bearerPattern', 'namedSecretPattern', 'querySecretPattern']) assert(logger.includes(marker), `logger redaction missing ${marker}`)
assert(!auditTrail.includes('req.body') && !auditTrail.includes('req.query') && !auditTrail.includes('req.headers'), 'privileged audit trail must never serialize request payload/header data')
assert(limiter.includes('recordRateLimitRejection') && budgets.includes('recordUsageBudgetRejection'), 'abuse/spend rejections must feed security telemetry')

assert(ci.includes('scan-secrets.mjs --history --require-history') && ci.includes('gitleaks/gitleaks-action'), 'CI must reject current/history secret exposure')
assert(ci.includes('pnpm audit --prod --audit-level=high'), 'CI must audit production dependencies')
assert(ci.includes('pnpm security:privileged-routes'), 'CI must enforce privileged-route baseline drift')
assert(ci.includes('aquasecurity/trivy-action') && ci.includes('backend-api') && ci.includes('backend-backup') && ci.includes('image-ref: redis:7-alpine') && ci.includes('image-ref: caddy:2-alpine'), 'CI must scan API, backup, Redis and Caddy runtime images')
assert(securityWorkflow.includes('actions/dependency-review-action@v4'), 'PR dependency review is missing')
assert(securityWorkflow.includes('github/codeql-action/init@v3') && securityWorkflow.includes('security-extended'), 'CodeQL security analysis is missing')
assert(pkg.pnpm?.onlyBuiltDependencies?.includes('sharp'), 'dependency build-script allowlist must be explicit')
assert(!pkg.dependencies?.['express-rate-limit'], 'unused process-local express-rate-limit dependency must be removed')
assert(pkg.scripts?.['security:privileged-routes'] === 'node scripts/security/audit-privileged-routes.mjs', 'privileged-route audit script is not exposed through package scripts')
assert(privilegedRouteAudit.includes('requiredScenarios') && privilegedRouteAudit.includes('New privileged routes require explicit baseline review'), 'privileged-route drift audit is incomplete')
assert(Array.isArray(privilegedRouteBaseline.routes) && privilegedRouteBaseline.routes.length >= 300, 'privileged route baseline must cover at least 300 guarded resources')
for (const route of privilegedRouteBaseline.routes) assert(route.requiredScenarios?.join('|') === 'unauthenticated|authenticated-unauthorized|wrong-tenant|authorized', `privileged route ${route.key} is missing the four required authorization scenarios`)

assert(dockerfile.includes('node:22.16.0-alpine') && dockerfile.includes('node:22.16.0-bookworm-slim'), 'container runtime versions must remain pinned')
assert((compose.match(/read_only: true/g) || []).length >= 2, 'API and backup containers must use read-only root filesystems')
assert((compose.match(/no-new-privileges:true/g) || []).length >= 2, 'API and backup containers must drop privilege escalation')
for (const alert of ['AbnormalAuthenticationFailures', 'RepeatedForbiddenRequests', 'UsageBudgetBlocks', 'ProviderUsageBudgetNearLimit', 'ElevatedApi5xx', 'SlowApiEndpoints', 'CriticalDependencyDown', 'DatabaseBackupMissingOrStale', 'DatabaseRestoreVerificationFailed', 'UnusualUploadVolume']) assert(alerts.includes(alert), `monitoring rule ${alert} missing`)
assert(release.includes('PROVIDER_BUDGETS_VERIFIED') && release.includes('smoke:phase4-security:required'), 'protected staging/production live security smoke is missing')

const routeFiles = []
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.route.ts')) routeFiles.push(full)
  }
}
walk(path.join(root, 'src/app/module'))
const privilegedRouteFiles = routeFiles.filter((file) => /authSuperAdmin|requirePermission\(|authMiddlewares\.auth\(/.test(fs.readFileSync(file, 'utf8')))
assert(privilegedRouteFiles.length >= 30, `privileged route inventory unexpectedly small (${privilegedRouteFiles.length})`)
for (const file of privilegedRouteFiles) {
  const source = fs.readFileSync(file, 'utf8')
  if (source.includes('authSuperAdmin')) {
    assert(source.includes('adminNetworkRateLimiter') && source.includes('adminOperationRateLimiter'), `${path.relative(root, file)} super-admin routes must be network + identity throttled`)
  }
}

console.log(`Phase 4 security release verification passed across ${privilegedRouteFiles.length} privileged route modules.`)
