export type BkashPaymentStatus =
  | 'initialized'
  | 'pending'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface IBkashPayment {
  organizationId: string
  initiatedBy?: string
  planId: 'starter' | 'professional' | 'agency' | 'enterprise'
  planName: string
  planVersion: number
  billingCycle: 'monthly' | 'yearly'
  amount: number
  currency: 'BDT'
  maxProperties: number
  maxAgents: number
  maxLeads: number
  taxSnapshot?: {
    invoiceEnabled: boolean; registrationStatus: 'not_registered' | 'registered'; operatorLegalName?: string
    binEncrypted?: string; vatRate: number; pricesIncludeVat: boolean; baseAmount: number; vatAmount: number
  }
  invoiceNumber: string
  idempotencyKey: string
  paymentId?: string
  bkashURL?: string
  transactionId?: string
  payerAccount?: string
  gatewayStatusCode?: string
  gatewayStatusMessage?: string
  reconciliationNotes?: Array<{ authorId: string; note: string; createdAt: Date }>
  status: BkashPaymentStatus
  createdAt?: Date
  updatedAt?: Date
}

export interface BkashGatewayPayment {
  paymentID?: string
  bkashURL?: string
  statusCode?: string
  statusMessage?: string
  amount?: string
  currency?: string
  trxID?: string
  payerAccount?: string
  transactionStatus?: string
}
