import { fail, redactError } from './common.mjs'

const apiBase = 'https://api.cloudflare.com/client/v4'

export const cloudflareContext = () => {
  const accountId = String(process.env.R2_ACCOUNT_ID || '').trim()
  const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || '').trim()
  if (!accountId) fail('R2_ACCOUNT_ID is required for Cloudflare migration API calls')
  if (!apiToken) fail('CLOUDFLARE_API_TOKEN is required for Cloudflare migration API calls')
  return { accountId, apiToken }
}

export const cloudflareRequest = async (pathname, { method = 'GET', body, query } = {}) => {
  const { apiToken } = cloudflareContext()
  const url = new URL(`${apiBase}${pathname}`)
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }

  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${apiToken}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.success === false) {
    const details = (payload?.errors || []).map((entry) => entry?.message).filter(Boolean).join('; ')
    throw new Error(`Cloudflare API ${method} ${pathname} failed (${response.status}): ${redactError(details || payload?.message || 'unknown')}`)
  }
  return payload?.result ?? payload
}
