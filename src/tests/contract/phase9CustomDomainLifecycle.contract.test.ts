import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOMAIN_LIFECYCLE_STATUSES } from '../../app/module/domain/domain.model'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 9 custom-domain contracts', () => {
  it('freezes the explicit lifecycle in order', () => {
    expect(DOMAIN_LIFECYCLE_STATUSES).toEqual([
      'PENDING_DNS',
      'OWNERSHIP_VERIFIED',
      'ROUTING_VERIFIED',
      'TLS_PROVISIONING',
      'ACTIVE',
    ])
  })

  it('fails production startup without real Vercel control-plane configuration and keeps generic DNS values development-only', () => {
    const config = read('src/config/index.ts')
    expect(config).not.toContain("cname.realestate-saas.com")
    expect(config).toContain("isProduction ? '' : '76.76.21.21'")
    expect(config).toContain("isProduction ? '' : 'cname.vercel-dns.com'")
    expect(config).toContain("requiredInProduction('DOMAIN_PROVIDER')")
    expect(config).toContain("requiredInProduction('PUBLIC_SITE_ORIGIN')")
    expect(config).toContain("requiredInProduction('VERCEL_PROJECT_ID_OR_NAME')")
    expect(config).toContain("requiredInProduction('VERCEL_API_TOKEN', 20)")
    expect(config).toContain("if (vercelRequireTeamId) requiredInProduction('VERCEL_TEAM_ID')")
    expect(config).toContain("WORKER_ENABLED must be true in production")
    expect(config).toContain("VERCEL_API_TOKEN must be a real production access token")
  })

  it('uses the Vercel project-domain adapter instead of the retired generic TLS URL', () => {
    const provider = read('src/app/module/domain/providers/vercelDomainProvider.ts')
    const config = read('src/config/index.ts')
    for (const method of ['getRequiredDns', 'registerDomain', 'verifyRouting', 'provisionTls', 'getTlsStatus', 'verifyPublicRouting', 'removeDomain', 'health']) {
      expect(provider).toContain(method)
    }
    expect(provider).toContain('/projects/${encodeURIComponent(config.domains.vercel_project)}/domains')
    expect(provider).toContain('/domains/${encodeURIComponent(domain)}/verify')
    expect(provider).toContain('/v6/domains/${encodeURIComponent(domain)}/config')
    expect(provider).toContain("url.searchParams.set('projectIdOrName', config.domains.vercel_project)")
    expect(provider).toContain('recommendedIPv4')
    expect(provider).toContain('recommendedCNAME')
    expect(provider).toContain("source: 'vercel_recommended'")
    expect(provider).toContain('providerVerificationRecords')
    expect(provider).toContain("purpose: 'provider_verification'")
    expect(provider).toContain('registered && providerVerified')
    expect(provider).toContain('triggerProjectDomainVerification')
    expect(provider).toContain('refreshProjectVerification')
    expect(config).not.toContain('tls_provider_url')
    expect(config).not.toContain('tls_provider_token')
  })

  it('routes only ACTIVE TLS/public domains and performs zero-downtime replacement with a retired-host redirect grace period', () => {
    const service = read('src/app/module/domain/domain.service.ts')
    const model = read('src/app/module/domain/domain.model.ts')
    expect(service).toContain("{ lifecycleStatus: 'ACTIVE', publicRoutingStatus: 'active' }")
    expect(service).toContain("tlsStatus: 'active'")
    expect(service).toContain('current.candidate = state')
    expect(service).toContain('promoteCandidate')
    expect(service).toContain('cleanupRetiredDomains')
    expect(service).toContain('providerChanged')
    expect(service).toContain('registerWithCurrentProvider')
    expect(service).toContain("{ retiredDomains: { $elemMatch: { domain, retireAfter: { $gt: now } } } }")
    expect(service).toContain('redirectTo: rawHost === canonicalHost ? null : `https://${canonicalHost}`')
    expect(model).toContain('candidate: { type: candidateDomainSchema, default: null }')
    expect(model).toContain('retiredDomains: { type: [retiredDomainSchema], default: [] }')
    expect(model).toContain("partialFilterExpression: { 'candidate.domain': { $type: 'string' } }")
  })

  it('ships an explicit cutover migration and preserves domain records across entitlement suspension/reactivation', () => {
    const migration = read('src/app/db/migratePhase3DomainCutover.ts')
    const reconciliation = read('src/app/module/entitlement/resourceEntitlementReconciliation.service.ts')
    expect(migration).toContain('PHASE3-DOMAIN-CUTOVER')
    expect(migration).toContain("'candidate.domain': 1")
    expect(migration).toContain("'retiredDomains.retireAfter': 1")
    expect(reconciliation).toContain("entitlementStatus: 'suspended'")
    expect(reconciliation).toContain("entitlementStatus: 'active'")
  })

  it('reports domain-specific worker queue and provider health', () => {
    const controller = read('src/app/module/domain/domain.controller.ts')
    const queue = read('src/app/module/operationsQueue/operationsQueue.service.ts')
    const app = read('src/app.ts')
    expect(controller).toContain('OperationsQueueService.domainBacklog()')
    expect(controller).toContain('DomainProviderService.health()')
    expect(controller).toContain('worker.enabled && worker.scheduled && worker.healthy')
    expect(queue).toContain("type: 'domain_verify'")
    expect(queue).toContain('resolveFailedDomainChecks')
    expect(queue).toContain('Superseded by a successful domain verification')
    expect(queue).toContain('processing')
    expect(app).toContain('domainLifecycle')
  })
})
