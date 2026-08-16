import config from '../../../config'
import { logger } from '../../../shared/logger'

const shouldRevalidate = (eventType: string, publicVisible: boolean): boolean =>
  publicVisible || eventType.startsWith('organization.') || eventType.startsWith('website.')

const trigger = async (input: { organizationId: string; eventType: string; publicVisible?: boolean; tenantIdentifier?: string }) => {
  if (!config.realtime.next_revalidate_url || !config.realtime.next_revalidate_secret) return
  if (!shouldRevalidate(input.eventType, Boolean(input.publicVisible))) return

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.realtime.revalidate_timeout_ms)
  timeout.unref?.()
  try {
    const response = await fetch(config.realtime.next_revalidate_url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-revalidate-secret': config.realtime.next_revalidate_secret,
      },
      body: JSON.stringify({
        organizationId: input.organizationId,
        tenantIdentifier: input.tenantIdentifier,
        eventType: input.eventType,
      }),
      signal: controller.signal,
    })
    if (!response.ok) logger.warn('next_revalidation_failed', { status: response.status, eventType: input.eventType, organizationId: input.organizationId })
  } catch (error) {
    logger.warn('next_revalidation_unavailable', { eventType: input.eventType, organizationId: input.organizationId, error })
  } finally {
    clearTimeout(timeout)
  }
}

export const NextRevalidationService = { trigger }
