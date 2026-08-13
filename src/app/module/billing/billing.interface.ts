export interface IBilling {
  organizationId: string
  invoiceId: string
  serviceType: 'subscription' | 'messaging' | 'design' | 'domain' | 'service'
  serviceName: string
  plan?: string
  planVersion?: number
  billingCycle: 'monthly' | 'yearly' | 'one-time'
  date: string
  amount: number
  currency?: string
  paymentId?: string
  transactionId?: string
  paymentMethod?: string
  status: 'paid' | 'pending' | 'failed' | 'refunded'
  taxSnapshot?: {
    invoiceEnabled: boolean; registrationStatus: 'not_registered' | 'registered'; operatorLegalName?: string
    binEncrypted?: string; vatRate: number; pricesIncludeVat: boolean; netAmount: number; vatAmount: number
  }
  createdAt?: Date
  updatedAt?: Date
}
