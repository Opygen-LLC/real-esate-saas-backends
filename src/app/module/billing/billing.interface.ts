export interface IBilling {
  organizationId: string
  invoiceId: string
  serviceType: 'subscription' | 'messaging' | 'design' | 'domain' | 'service'
  serviceName: string
  plan?: string
  billingCycle: 'monthly' | 'yearly' | 'one-time'
  date: string
  amount: number
  paymentId?: string
  paymentMethod?: string
  status: 'paid' | 'pending' | 'failed' | 'refunded'
  createdAt?: Date
  updatedAt?: Date
}
