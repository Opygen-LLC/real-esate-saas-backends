import config from '../../../../config'
import type { DomainProvider } from './domainProvider'
import { VercelDomainProvider } from './vercelDomainProvider'
import { GenericDomainProvider } from './genericDomainProvider'

const providers: Record<string, DomainProvider> = {
  vercel: VercelDomainProvider,
  generic: GenericDomainProvider,
}

export const DomainProviderService = {
  current(): DomainProvider {
    const provider = providers[config.domains.provider]
    if (!provider) throw new Error(`Unsupported domain provider: ${config.domains.provider}. Supported values: vercel, generic`)
    return provider
  },
  health(force = false) {
    return DomainProviderService.current().health(force)
  },
}

export type { DomainDiagnostic, DomainProvider, DomainProviderHealth, RequiredDnsRecord } from './domainProvider'
