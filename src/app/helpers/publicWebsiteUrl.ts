import config from '../../config'

const isLocalHost = (hostname: string) => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'

export const buildTenantWebsiteUrl = (subdomain: string, verifiedCustomDomain?: string | null): string => {
  if (verifiedCustomDomain) return `https://${verifiedCustomDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`

  const origin = new URL(config.domains.public_site_origin)
  const safeSubdomain = String(subdomain || '').trim().toLowerCase()
  if (!safeSubdomain) return origin.toString().replace(/\/$/, '')

  if (isLocalHost(origin.hostname)) {
    return `${origin.toString().replace(/\/$/, '')}/portal/${encodeURIComponent(safeSubdomain)}`
  }

  const rootHost = origin.hostname.replace(/^www\./, '')
  const port = origin.port ? `:${origin.port}` : ''
  return `${origin.protocol}//${safeSubdomain}.${rootHost}${port}`
}
