import config from '../../../config'
import { logger } from '../../../shared/logger'

type RevalidationInput = {
  organizationId: string
  eventType: string
  publicVisible?: boolean
  tenantIdentifier?: string
  tenantIdentifiers?: string[]
}

const shouldRevalidate = (eventType: string, publicVisible: boolean): boolean =>
  publicVisible || eventType.startsWith('organization.') || eventType.startsWith('website.')

const normalizeTenantIdentifiers = (input: RevalidationInput): string[] =>
  Array.from(
    new Set(
      [input.tenantIdentifier, ...(input.tenantIdentifiers || [])]
        .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
        .map((value) => value.trim().toLowerCase())
    )
  ).slice(0, 20)

/**
 * Invalidate Next.js public-site cache tags. Production configuration is
 * fail-fast in config/index.ts, so an authentication failure here indicates a
 * deployment mismatch rather than a value we should silently replace.
 */
const trigger = async (input: RevalidationInput): Promise<boolean> => {
  if (!config.realtime.next_revalidate_url || !config.realtime.next_revalidate_secret) return true
  if (!shouldRevalidate(input.eventType, Boolean(input.publicVisible))) return true

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.realtime.revalidate_timeout_ms)
  timeout.unref?.()

  try {
    const response = await fetch(config.realtime.next_revalidate_url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-revalidate-secret': config.realtime.next_revalidate_secret,
      },
      body: JSON.stringify({
        organizationId: input.organizationId,
        tenantIdentifiers: normalizeTenantIdentifiers(input),
        eventType: input.eventType,
      }),
      signal: controller.signal,
    })

    if (response.ok) return true

    logger.warn('next_revalidation_failed', {
      status: response.status,
      eventType: input.eventType,
      organizationId: input.organizationId,
    })
    return false
  } catch (error) {
    logger.warn('next_revalidation_unavailable', {
      eventType: input.eventType,
      organizationId: input.organizationId,
      error,
    })
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export const NextRevalidationService = { trigger }
