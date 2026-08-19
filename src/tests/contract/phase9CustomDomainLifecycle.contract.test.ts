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

  it('has no production fallback to the obsolete custom CNAME and requires explicit Vercel configuration', () => {
    const config = read('src/config/index.ts')
    expect(config).not.toContain("cname.realestate-saas.com")
    expect(config).toContain("isProduction ? '' : 'cname.vercel-dns.com'")
    expect(config).toContain("requiredInProduction('DOMAIN_A_TARGET')")
    expect(config).toContain("requiredInProduction('DOMAIN_CNAME_TARGET')")
    expect(config).toContain("requiredInProduction('VERCEL_PROJECT_ID_OR_NAME')")
    expect(config).toContain("requiredInProduction('VERCEL_API_TOKEN', 20)")
  })

  it('uses the Vercel project-domain adapter instead of the retired generic TLS URL', () => {
    const provider = read('src/app/module/domain/providers/vercelDomainProvider.ts')
    const config = read('src/config/index.ts')
    for (const method of ['getRequiredDns', 'registerDomain', 'verifyRouting', 'provisionTls', 'getTlsStatus', 'verifyPublicRouting', 'removeDomain', 'health']) {
      expect(provider).toContain(method)
    }
    expect(provider).toContain('/projects/${encodeURIComponent(config.domains.vercel_project)}/domains')
    expect(provider).toContain('/domains/${encodeURIComponent(domain)}/verify')
    expect(provider).toContain('providerVerificationRecords')
    expect(provider).toContain("purpose: 'provider_verification'")
    expect(provider).toContain('registered && providerVerified')
    expect(config).not.toContain('tls_provider_url')
    expect(config).not.toContain('tls_provider_token')
  })

  it('routes only ACTIVE TLS/public domains and returns an apex canonical redirect for www', () => {
    const service = read('src/app/module/domain/domain.service.ts')
    expect(service).toContain("{ lifecycleStatus: 'ACTIVE', publicRoutingStatus: 'active' }")
    expect(service).toContain("tlsStatus: 'active'")
    expect(service).toContain('redirectTo: rawHost === canonicalHost ? null : `https://${canonicalHost}`')
  })

  it('reports domain-specific worker queue and provider health', () => {
    const controller = read('src/app/module/domain/domain.controller.ts')
    const queue = read('src/app/module/operationsQueue/operationsQueue.service.ts')
    const app = read('src/app.ts')
    expect(controller).toContain('OperationsQueueService.domainBacklog()')
    expect(controller).toContain('DomainProviderService.health()')
    expect(controller).toContain('worker.enabled && worker.scheduled && worker.healthy')
    expect(queue).toContain("type: 'domain_verify'")
    expect(queue).toContain('processing')
    expect(app).toContain('domainLifecycle')
  })
})
