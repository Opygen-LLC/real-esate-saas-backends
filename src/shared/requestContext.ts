import crypto from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'

export type RequestStore = {
  requestId: string
  traceId: string
  parentSpanId?: string
  organizationId?: string
  userId?: string
  paymentId?: string
}

const storage = new AsyncLocalStorage<RequestStore>()

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i

const parseTraceparent = (value?: string | null): { traceId: string; parentSpanId?: string } => {
  const match = value?.trim().match(TRACEPARENT_RE)
  if (match && !/^0+$/.test(match[1]) && !/^0+$/.test(match[2])) {
    return { traceId: match[1].toLowerCase(), parentSpanId: match[2].toLowerCase() }
  }
  return { traceId: crypto.randomBytes(16).toString('hex') }
}

const childTraceparent = (): string => {
  const store = storage.getStore()
  const traceId = store?.traceId || crypto.randomBytes(16).toString('hex')
  const spanId = crypto.randomBytes(8).toString('hex')
  return `00-${traceId}-${spanId}-01`
}

const run = <T>(input: { requestId: string; traceparent?: string | null }, callback: () => T): T => {
  const parsed = parseTraceparent(input.traceparent)
  return storage.run({ requestId: input.requestId, traceId: parsed.traceId, parentSpanId: parsed.parentSpanId }, callback)
}

const patch = (values: Partial<Omit<RequestStore, 'requestId' | 'traceId'>>): void => {
  const store = storage.getStore()
  if (store) Object.assign(store, values)
}

export const RequestContext = {
  run,
  current: () => storage.getStore(),
  setTenant: (organizationId?: string, userId?: string) => patch({ organizationId, userId }),
  setPaymentId: (paymentId?: string) => patch({ paymentId }),
  childTraceparent,
}
