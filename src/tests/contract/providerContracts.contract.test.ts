import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSmsProviderPayload, interpolateSmsTemplate, mapSmsDeliveryStatus, parseSmsProviderAcceptance } from '../../app/module/sms/sms.service'
import { buildMetaCapiBody, metaRetryDelayMs, normalizeMetaUserData, parseMetaCapiResponse } from '../../app/module/metaIntegration/metaIntegration.service'
import { Resilience } from '../../shared/resilience'


afterEach(() => vi.restoreAllMocks())

describe('provider contracts', () => {
  it('renders SMS templates without leaking unknown variables into output', () => {
    expect(interpolateSmsTemplate('Hello {{name}}, visit {{property}} {{missing}}', { name: 'Rahim', property: 'P-42' }))
      .toBe('Hello Rahim, visit P-42 ')
  })

  it('builds the Bangladesh SMS provider payload with delivery callback metadata', () => {
    const payload = buildSmsProviderPayload({ phone: '+8801712345678', message: 'Viewing confirmed' }, 'https://api.example.test/sms/receipt')
    expect(payload.to).toBe('+8801712345678')
    expect(payload.message).toBe('Viewing confirmed')
    expect(payload.callbackUrl).toBe('https://api.example.test/sms/receipt')
  })

  it('parses accepted SMS responses and delivery receipts without provider-specific leakage', () => {
    expect(parseSmsProviderAcceptance(true, { messageId: 'sms-1', cost: '0.35' })).toEqual({ providerMessageId: 'sms-1', cost: 0.35 })
    expect(() => parseSmsProviderAcceptance(false, { error: 'rejected' })).toThrow(/rejected/i)
    expect(mapSmsDeliveryStatus('DELIVERED')).toBe('delivered')
    expect(mapSmsDeliveryStatus('undelivered')).toBe('failed')
    expect(mapSmsDeliveryStatus('queued')).toBe('sent')
  })

  it('hashes normalized Meta identity data and preserves browser identifiers', () => {
    const user = normalizeMetaUserData({ email: ' Buyer@Example.com ', phone: '+880 1712-345678', firstName: 'RAHIM', fbp: 'fb.1.123' })
    expect(user.em?.[0]).toMatch(/^[a-f0-9]{64}$/)
    expect(user.ph?.[0]).toMatch(/^[a-f0-9]{64}$/)
    expect(user.fn?.[0]).toMatch(/^[a-f0-9]{64}$/)
    expect(user.fbp).toBe('fb.1.123')
    expect(JSON.stringify(user)).not.toContain('Buyer@Example.com')
    expect(JSON.stringify(user)).not.toContain('1712-345678')
  })

  it('uses the same event_id in the Meta CAPI payload for browser/server deduplication', () => {
    const body = buildMetaCapiBody({ eventName: 'Lead', eventTime: 123, eventId: 'shared-event-id', eventSourceUrl: 'https://agency.example/property/a', customData: { propertyId: 'a' }, testEventCode: 'TEST123' }, {})
    expect(body.data[0].event_id).toBe('shared-event-id')
    expect(body.data[0].action_source).toBe('website')
    expect(body.test_event_code).toBe('TEST123')
  })

  it('accepts successful Meta responses and surfaces provider error codes for retry diagnostics', () => {
    expect(parseMetaCapiResponse(true, 200, { events_received: 1 })).toEqual({ events_received: 1 })
    expect(() => parseMetaCapiResponse(false, 400, { error: { code: 190, message: 'Invalid token' } })).toThrow(/Invalid token/)
    try { parseMetaCapiResponse(false, 400, { error: { code: 190, message: 'Invalid token' } }) } catch (error) {
      expect((error as Error & { code?: string }).code).toBe('190')
    }
  })

  it('backs off Meta retries and caps them at six hours', () => {
    expect(metaRetryDelayMs(1)).toBe(60_000)
    expect(metaRetryDelayMs(20)).toBe(6 * 60 * 60_000)
  })

  it('converts aborted provider calls into bounded timeout errors', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })))
    await expect(Resilience.fetch('phase7-timeout-contract', 'https://provider.example.test', {}, { timeoutMs: 500, failureThreshold: 2 }))
      .rejects.toMatchObject({ statusCode: 504 })
  }, 1500)
})
