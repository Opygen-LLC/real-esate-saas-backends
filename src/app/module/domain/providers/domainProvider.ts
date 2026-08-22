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

export type RequiredDnsRecord = {
  type: 'TXT' | 'A' | 'CNAME'
  name: string
  host: string
  value: string
  purpose: 'ownership' | 'routing' | 'provider_verification'
  source?: 'opygen_ownership' | 'vercel_recommended' | 'vercel_project_verification' | 'development_fallback' | 'generic_routing'
  rank?: number
}

export type DomainProviderInput = {
  domain: string
  organizationId: string
  ownershipToken: string
}

export type DomainRoutingResult = {
  apexOk: boolean
  wwwOk: boolean
  registered: boolean
  providerVerified: boolean
  diagnostics: DomainDiagnostic[]
}

export type DomainTlsResult = {
  status: 'not_started' | 'provisioning' | 'active' | 'failed'
  diagnostics: DomainDiagnostic[]
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
  registerDomain(input: DomainProviderInput): Promise<{ registered: boolean; providerRequestId?: string }>
  verifyRouting(input: DomainProviderInput): Promise<DomainRoutingResult>
  provisionTls(input: DomainProviderInput): Promise<DomainTlsResult>
  getTlsStatus(input: DomainProviderInput): Promise<DomainTlsResult>
  verifyPublicRouting(input: DomainProviderInput): Promise<DomainPublicRoutingResult>
  removeDomain(domain: string): Promise<void>
  health(force?: boolean): Promise<DomainProviderHealth>
}
