import config from '../../../../config'
import type { DomainProvider } from './domainProvider'
import { VercelDomainProvider } from './vercelDomainProvider'
import { GenericDomainProvider } from './genericDomainProvider'
import { CloudflareDomainProvider } from './cloudflareDomainProvider'

const providers: Record<string, DomainProvider> = {
  vercel: VercelDomainProvider,
  generic: GenericDomainProvider,
  cloudflare: CloudflareDomainProvider,
}

export const DomainProviderService = {
  byName(name: string): DomainProvider {
    const provider = providers[String(name || '').trim().toLowerCase()]
    if (!provider) throw new Error(`Unsupported domain provider: ${name}. Supported values: vercel, generic, cloudflare`)
    return provider
  },
  current(): DomainProvider {
    return DomainProviderService.byName(config.domains.provider)
  },
  health(force = false) {
    return DomainProviderService.current().health(force)
  },
}

export type { DomainDiagnostic, DomainProvider, DomainProviderHealth, DomainProviderMetadata, DomainRegistrationResult, RequiredDnsRecord } from './domainProvider'
