import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { logger } from '../../../shared/logger'
import { Resilience } from '../../../shared/resilience'
import { BkashGatewayPayment } from './bkashPayment.interface'

type TokenState = {
  idToken: string
  refreshToken: string
  expiresAt: number
}

let tokenState: TokenState | null = null
let tokenPromise: Promise<TokenState> | null = null

const requiredConfig = (): void => {
  const { enabled, grant_token_url, create_payment_url, execute_payment_url, query_payment_url, app_key, app_secret, username, password } = config.bkash
  if (!enabled) throw new ApiError(503, 'bKash payments are currently disabled', '', 'BKASH_DISABLED')
  if (!grant_token_url || !create_payment_url || !execute_payment_url || !query_payment_url || !app_key || !app_secret || !username || !password) {
    throw new ApiError(503, 'bKash gateway is not configured', '', 'BKASH_NOT_CONFIGURED')
  }
}

const fetchJson = async (url: string, init: RequestInit): Promise<any> => {
  try {
    const response = await Resilience.fetch('bkash', url, init, { timeoutMs: config.bkash.timeout_ms })
    const text = await response.text()
    let body: any
    try { body = text ? JSON.parse(text) : {} } catch { throw new ApiError(502, 'bKash returned an invalid response') }
    if (!response.ok) {
      const message = body?.errorMessage || body?.statusMessage || `bKash gateway returned ${response.status}`
      const error = new ApiError(502, message)
      ;(error as any).bkashStatusCode = response.status
      throw error
    }
    return body
  } catch (error) {
    if (error instanceof ApiError) throw error
    logger.error('bKash gateway request failed', { error: error instanceof Error ? error.message : 'unknown' })
    throw new ApiError(502, 'bKash gateway request failed')
  }
}


const grantToken = async (): Promise<TokenState> => {
  const body = await fetchJson(config.bkash.grant_token_url as string, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      username: config.bkash.username as string,
      password: config.bkash.password as string,
    },
    body: JSON.stringify({
      app_key: config.bkash.app_key,
      app_secret: config.bkash.app_secret,
    }),
  })

  if (!body?.id_token) {
    throw new ApiError(502, 'bKash did not return an access token')
  }

  const expiresInSeconds = Number(body.expires_in) || 3600
  return {
    idToken: body.id_token,
    refreshToken: body.refresh_token,
    // Refresh a little before actual expiry to avoid using a stale token mid-request.
    expiresAt: Date.now() + Math.max(expiresInSeconds - 60, 30) * 1000,
  }
}

const getValidToken = async (): Promise<string> => {
  requiredConfig()

  if (tokenState && tokenState.expiresAt > Date.now()) {
    return tokenState.idToken
  }

  if (!tokenPromise) {
    tokenPromise = grantToken()
      .then(state => {
        tokenState = state
        return state
      })
      .finally(() => {
        tokenPromise = null
      })
  }

  const state = await tokenPromise
  return state.idToken
}

const invalidateToken = (): void => {
  tokenState = null
}

const authorizedRequest = async (url: string, payload: Record<string, unknown>): Promise<any> => {
  const idToken = await getValidToken()

  try {
    return await fetchJson(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: idToken,
        'x-app-key': config.bkash.app_key as string,
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    if ((error as any)?.bkashStatusCode === 401) {
      invalidateToken()
      const retriedToken = await getValidToken()
      return fetchJson(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: retriedToken,
          'x-app-key': config.bkash.app_key as string,
        },
        body: JSON.stringify(payload),
      })
    }
    throw error
  }
}

type CreatePaymentPayload = {
  amount: number
  callbackURL: string
  invoiceNumber: string
  payerReference: string
}

const createPayment = async (input: CreatePaymentPayload): Promise<BkashGatewayPayment> => {
  const body = await authorizedRequest(config.bkash.create_payment_url as string, {
    mode: '0011',
    payerReference: input.payerReference,
    callbackURL: input.callbackURL,
    amount: input.amount.toFixed(2),
    currency: 'BDT',
    intent: 'sale',
    merchantInvoiceNumber: input.invoiceNumber,
  })

  return {
    paymentID: body.paymentID,
    bkashURL: body.bkashURL,
    statusCode: body.statusCode,
    statusMessage: body.statusMessage,
    amount: body.amount,
    currency: body.currency,
  }
}

const executePayment = async (paymentId: string): Promise<BkashGatewayPayment> => {
  const body = await authorizedRequest(config.bkash.execute_payment_url as string, { paymentID: paymentId })

  return {
    paymentID: body.paymentID,
    statusCode: body.statusCode,
    statusMessage: body.statusMessage,
    amount: body.amount,
    currency: body.currency,
    trxID: body.trxID,
    payerAccount: body.customerMsisdn || body.payerAccount,
    transactionStatus: body.transactionStatus,
  }
}

const queryPayment = async (paymentId: string): Promise<BkashGatewayPayment> => {
  const body = await authorizedRequest(config.bkash.query_payment_url as string, { paymentID: paymentId })

  return {
    paymentID: body.paymentID,
    statusCode: body.statusCode,
    statusMessage: body.statusMessage,
    amount: body.amount,
    currency: body.currency,
    trxID: body.trxID,
    payerAccount: body.customerMsisdn || body.payerAccount,
    transactionStatus: body.transactionStatus,
  }
}

export const BkashPaymentClient = { createPayment, executePayment, queryPayment }
