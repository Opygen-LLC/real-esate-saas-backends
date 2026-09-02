import { logger } from './logger'

export const PRODUCTION_EVENT_NAMES = [
  'invoice_created',
  'invoice_property_linked',
  'invoice_calculation_rejected',
  'invoice_payment_recorded',
  'form_validation_failed',
  'website_submission_received',
  'website_submission_moved_to_crm',
  'website_submission_crm_merged',
  'website_submission_crm_failed',
  'meta_pixel_configured',
  'meta_capi_configured',
  'meta_capi_failed',
  'website_template_changed',
  'website_template_render_failed',
  'website_submission_deleted',
  'query_performance',
  'public_site_query_performance',
  'finance_request_failed',
  'finance_billing_profile_updated',
  'finance_billing_profile_removed',
] as const

export type ProductionEventName = typeof PRODUCTION_EVENT_NAMES[number]

/**
 * Emits a stable, structured production event through the existing scrubbed
 * Winston logger. Callers should pass identifiers, booleans, enum-like values,
 * and field names only; never credentials, tokens, payment references, or raw
 * customer form values.
 */
export const emitProductionEvent = (
  event: ProductionEventName,
  metadata: Record<string, unknown> = {},
  level: 'info' | 'warn' | 'error' = 'info',
) => {
  logger.log(level, event, { event, ...metadata })
}
