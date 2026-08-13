import { afterEach, describe, expect, it, vi } from 'vitest'

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const configure = () => {
  vi.stubEnv('BKASH_GRANT_TOKEN_URL', 'https://gateway.example.test/token')
  vi.stubEnv('BKASH_CREATE_PAYMENT_URL', 'https://gateway.example.test/create')
  vi.stubEnv('BKASH_EXECUTE_PAYMENT_URL', 'https://gateway.example.test/execute')
  vi.stubEnv('BKASH_QUERY_PAYMENT_URL', 'https://gateway.example.test/query')
  vi.stubEnv('BKASH_APP_KEY', 'app-key')
  vi.stubEnv('BKASH_APP_SECRET', 'app-secret')
  vi.stubEnv('BKASH_USERNAME', 'merchant-user')
  vi.stubEnv('BKASH_PASSWORD', 'merchant-password')
  vi.stubEnv('BKASH_TIMEOUT_MS', '1000')
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules() })

describe('bKash HTTP contract', () => {
  it('sends server-owned BDT amount, invoice and callback fields', async () => {
    configure()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id_token: 'token-1', refresh_token: 'refresh-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ paymentID: 'PAY123', bkashURL: 'https://tokenized.pay.bka.sh/checkout/PAY123', statusCode: '0000', amount: '1490.00', currency: 'BDT' }))
    vi.stubGlobal('fetch', fetchMock)
    const { BkashPaymentClient } = await import('../../app/module/bkashPayment/bkashPayment.client')
    const payment = await BkashPaymentClient.createPayment({ amount: 1490, callbackURL: 'https://api.example.test/api/v1/billing/bkash/callback', invoiceNumber: 'INV-1', payerReference: 'org-1' })
    expect(payment.paymentID).toBe('PAY123')
    const createInit = fetchMock.mock.calls[1][1] as RequestInit
    const body = JSON.parse(String(createInit.body))
    expect(body).toMatchObject({ amount: '1490.00', currency: 'BDT', merchantInvoiceNumber: 'INV-1', payerReference: 'org-1' })
    expect(body.callbackURL).toBe('https://api.example.test/api/v1/billing/bkash/callback')
  })

  it('invalidates the gateway token and retries once after a 401', async () => {
    configure()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id_token: 'token-old', refresh_token: 'r1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ statusMessage: 'expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ id_token: 'token-new', refresh_token: 'r2', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ paymentID: 'PAY2', statusCode: '0000', amount: '3490.00', currency: 'BDT' }))
    vi.stubGlobal('fetch', fetchMock)
    const { BkashPaymentClient } = await import('../../app/module/bkashPayment/bkashPayment.client')
    const result = await BkashPaymentClient.queryPayment('PAY2')
    expect(result.paymentID).toBe('PAY2')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(new Headers((fetchMock.mock.calls[3][1] as RequestInit).headers).get('authorization')).toBe('token-new')
  })
})
