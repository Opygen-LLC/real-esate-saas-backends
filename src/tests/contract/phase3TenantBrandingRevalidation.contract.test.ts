import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 3 tenant branding and revalidation contracts', () => {
  it('requires an explicit production revalidation secret and never writes a fallback into process.env', () => {
    const config = read('src/config/index.ts')
    expect(config).toContain("requiredInProduction('NEXT_REVALIDATE_SECRET', 32)")
    expect(config).not.toContain('real_estate_saas_next_revalidate_secret_key_32bytes_production')
    expect(config).not.toContain('process.env.NEXT_REVALIDATE_SECRET =')
  })

  it('publishes branding changes only after current subdomain/custom-domain identifiers are known', () => {
    const service = read('src/app/module/organization/organization.service.ts')
    expect(service).toContain('getPublicTenantIdentifiers')
    expect(service).toContain("status: 'verified'")
    expect(service).toContain("tlsStatus: 'active'")
    expect(service).toContain('tenantIdentifiers')
    expect(service).toContain('faviconChanged')
    expect(service).toContain('brandingVersion')
  })

  it('awaits Next revalidation publication and sends all tenant identifiers in one request', () => {
    const domainEvent = read('src/app/module/domainEvent/domainEvent.service.ts')
    const revalidation = read('src/app/module/realtime/nextRevalidation.service.ts')
    expect(domainEvent).toContain('await NextRevalidationService.trigger')
    expect(domainEvent).toContain('tenantIdentifiers')
    expect(revalidation).toContain('normalizeTenantIdentifiers')
    expect(revalidation).toContain('tenantIdentifiers: normalizeTenantIdentifiers(input)')
  })

  it('invalidates Redis/cache entries for active and aliased tenant hostnames', () => {
    const cache = read('src/app/module/domainEvent/cacheInvalidation.service.ts')
    expect(cache).toContain('DomainRecord.find({ organizationId })')
    expect(cache).toContain('SubdomainAlias.find({ organizationId })')
    expect(cache).toContain('Cache.tenantPublic.del(...identifiers)')
    expect(cache).toContain('Cache.tenantResolve.del(...identifiers)')
  })
})
