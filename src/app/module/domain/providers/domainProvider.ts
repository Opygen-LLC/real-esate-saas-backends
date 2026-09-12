export type DomainDiagnosticState = 'pass' | 'pending' | 'failed'

export type DomainDiagnostic = {
  check: 'ownership_txt' | 'apex_a' | 'www_cname' | 'hosting_registration' | 'tls_certificate' | 'public_routing' | 'lifecycle'
  label: string
  state: DomainDiagnosticState
  ok: boolean
  expected?: unknown
  observed?: unknown
  message?: string
  checkedAt: Date
}

export type RequiredDnsSource =
  | 'opygen_ownership'
  | 'development_fallback'
  | 'generic_routing'
  | 'vercel_recommended'
  | 'vercel_project_verification'
  | 'cloudflare_routing'
  | 'cloudflare_hostname_validation'
  | 'cloudflare_ssl_validation'

export type RequiredDnsRecord = {
  type: 'TXT' | 'A' | 'CNAME'
  name: string
  host: string
  value: string
  purpose: 'ownership' | 'routing' | 'provider_verification'
  source?: string
  rank?: number
}

export type DomainProviderInput = {
  domain: string
  organizationId: string
  ownershipToken: string
}

export type DomainProviderHostnameMetadata = {
  hostname: string
  providerId: string
  status?: string
  sslStatus?: string
}

export type DomainProviderMetadata = {
  hostnames: DomainProviderHostnameMetadata[]
}

export type DomainRegistrationResult = {
  registered: boolean
  providerRequestId?: string
  providerMetadata?: DomainProviderMetadata
}

export type DomainRoutingResult = {
  apexOk: boolean
  wwwOk: boolean
  registered: boolean
  providerVerified: boolean
  diagnostics: DomainDiagnostic[]
  providerMetadata?: DomainProviderMetadata
}

export type DomainTlsResult = {
  status: 'not_started' | 'provisioning' | 'active' | 'failed'
  diagnostics: DomainDiagnostic[]
  providerMetadata?: DomainProviderMetadata
}

export type DomainPublicRoutingResult = {
  active: boolean
  diagnostics: DomainDiagnostic[]
}

export type DomainProviderHealth = {
  provider: string
  configured: boolean
  healthy: boolean
  latencyMs: number
  detail?: string
  checkedAt: string
}

export interface DomainProvider {
  readonly name: string
  getRequiredDns(input: DomainProviderInput): Promise<RequiredDnsRecord[]>
  registerDomain(input: DomainProviderInput): Promise<DomainRegistrationResult>
  verifyRouting(input: DomainProviderInput): Promise<DomainRoutingResult>
  provisionTls(input: DomainProviderInput): Promise<DomainTlsResult>
  getTlsStatus(input: DomainProviderInput): Promise<DomainTlsResult>
  verifyPublicRouting(input: DomainProviderInput): Promise<DomainPublicRoutingResult>
  removeDomain(domain: string): Promise<void>
  hasDomain(domain: string): Promise<boolean>
  health(force?: boolean): Promise<DomainProviderHealth>
}
