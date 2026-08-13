import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { BkashGatewayPayment, IBkashPayment } from './bkashPayment.interface'

export const trustedBkashCheckoutUrl = (value: string | undefined): string => {
  if (!value) throw new ApiError(httpStatus.BAD_GATEWAY, 'bKash returned no checkout URL')
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    const trusted = hostname === 'bka.sh' || hostname.endsWith('.bka.sh') || hostname === 'bkash.com' || hostname.endsWith('.bkash.com')
    if (url.protocol !== 'https:' || !trusted) throw new Error('Untrusted URL')
    return url.toString()
  } catch {
    throw new ApiError(httpStatus.BAD_GATEWAY, 'bKash returned an invalid checkout URL')
  }
}

export const isCompletedGatewayPayment = (payment: BkashGatewayPayment | null): boolean => {
  if (!payment || payment.statusCode !== '0000') return false
  return !payment.transactionStatus || payment.transactionStatus.toLowerCase() === 'completed'
}

export const ensurePaymentMatchesAttempt = (payment: BkashGatewayPayment, attempt: Pick<IBkashPayment, 'paymentId' | 'amount'>): void => {
  if (payment.paymentID && payment.paymentID !== attempt.paymentId) throw new ApiError(httpStatus.BAD_GATEWAY, 'bKash payment ID mismatch')
  if (payment.currency && payment.currency !== 'BDT') throw new ApiError(httpStatus.BAD_GATEWAY, 'bKash payment currency mismatch')
  const gatewayAmount = Number(payment.amount)
  if (!Number.isFinite(gatewayAmount) || Math.abs(gatewayAmount - attempt.amount) > 0.001) {
    throw new ApiError(httpStatus.BAD_GATEWAY, 'bKash payment amount mismatch')
  }
}
