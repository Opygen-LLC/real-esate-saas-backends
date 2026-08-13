import config from '../../../config'
import { logger } from '../../../shared/logger'
import { Resilience } from '../../../shared/resilience'

type ClientError = {
  name?: string
  message: string
  stack?: string
  url?: string
  digest?: string
  userAgent?: string
  buildId?: string
}

const stripQuery = (value?: string): string => {
  if (!value) return ''
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`.slice(0, 1000)
  } catch { return String(value).split('?')[0].slice(0, 1000) }
}

const sanitize = (input: ClientError) => ({
  name: String(input.name || 'Error').slice(0, 80),
  message: String(input.message || 'Client error').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]').replace(/(?:\+?880|0)1[3-9]\d{8}\b/g, '[redacted-phone]').slice(0, 1000),
  stack: String(input.stack || '').replace(/\?.*?(?=\s|\)|$)/g, '').slice(0, 8000),
  url: stripQuery(input.url),
  digest: String(input.digest || '').slice(0, 160),
  userAgent: String(input.userAgent || '').slice(0, 500),
  buildId: String(input.buildId || '').slice(0, 160),
})

const reportClientError = async (input: ClientError): Promise<{ accepted: true }> => {
  const event = sanitize(input)
  logger.error('client_error', { event })
  if (config.observability.client_error_reporting_url) {
    void Resilience.fetch('error-reporting', config.observability.client_error_reporting_url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.observability.client_error_reporting_token ? { authorization: `Bearer ${config.observability.client_error_reporting_token}` } : {}),
      },
      body: JSON.stringify({ service: 'real-estate-saas-web', environment: config.env, ...event }),
    }, { timeoutMs: 5000, failureThreshold: 3, resetAfterMs: 60000 }).catch(() => undefined)
  }
  return { accepted: true }
}

export const ObservabilityService = { reportClientError }
