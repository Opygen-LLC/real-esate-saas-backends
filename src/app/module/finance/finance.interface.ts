import mongoose from 'mongoose'

export type FinanceTransactionType = 'income' | 'expense'
export type FinanceTransactionStatus = 'pending' | 'paid' | 'cancelled' | 'voided'
export type FinancePaymentMethod = 'cash' | 'bank' | 'bkash' | 'nagad' | 'card' | 'cheque' | 'other'

export interface IFinanceTransaction {
  organizationId: string
  type: FinanceTransactionType
  category: string
  amount: number
  currency: 'BDT'
  transactionDate: Date
  paymentMethod: FinancePaymentMethod
  status: FinanceTransactionStatus
  description: string
  reference?: string
  vendorId?: mongoose.Types.ObjectId | string
  propertyId?: mongoose.Types.ObjectId | string
  leadId?: mongoose.Types.ObjectId | string
  receiptUrl?: string
  recurring?: boolean
  sourceType?: 'manual' | 'invoice_payment' | 'commission_payout'
  sourceId?: mongoose.Types.ObjectId | string
  createdBy: mongoose.Types.ObjectId | string
  updatedBy?: mongoose.Types.ObjectId | string
  voidedAt?: Date
  voidedBy?: mongoose.Types.ObjectId | string
  voidReason?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceInvoiceLineItem {
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export interface IFinanceInvoicePayment {
  _id?: mongoose.Types.ObjectId | string
  amount: number
  paidAt: Date
  paymentMethod: FinancePaymentMethod
  reference?: string
  notes?: string
  recordedBy: mongoose.Types.ObjectId | string
  transactionId?: mongoose.Types.ObjectId | string
}

export interface IFinanceInvoice {
  organizationId: string
  invoiceNumber: string
  clientName: string
  clientPhone?: string
  clientEmail?: string
  issueDate: Date
  dueDate?: Date
  lineItems: IFinanceInvoiceLineItem[]
  subtotal: number
  discount: number
  total: number
  paidAmount: number
  currency: 'BDT'
  status: 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'cancelled'
  notes?: string
  propertyId?: mongoose.Types.ObjectId | string
  leadId?: mongoose.Types.ObjectId | string
  payments: IFinanceInvoicePayment[]
  createdBy: mongoose.Types.ObjectId | string
  updatedBy?: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceCommission {
  organizationId: string
  commissionNumber: string
  agentId: mongoose.Types.ObjectId | string
  propertyId?: mongoose.Types.ObjectId | string
  leadId?: mongoose.Types.ObjectId | string
  dealReference?: string
  grossDealValue: number
  commissionRate?: number
  commissionAmount: number
  agentShare: number
  companyShare: number
  currency: 'BDT'
  status: 'pending' | 'approved' | 'paid' | 'cancelled'
  dueDate?: Date
  paidAt?: Date
  paymentMethod?: FinancePaymentMethod
  paymentReference?: string
  payoutTransactionId?: mongoose.Types.ObjectId | string
  notes?: string
  createdBy: mongoose.Types.ObjectId | string
  updatedBy?: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceVendor {
  organizationId: string
  name: string
  category: string
  phone?: string
  email?: string
  address?: string
  taxId?: string
  notes?: string
  status: 'active' | 'inactive'
  createdBy: mongoose.Types.ObjectId | string
  updatedBy?: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceBudget {
  organizationId: string
  name: string
  category: string
  amount: number
  currency: 'BDT'
  period: 'monthly' | 'quarterly' | 'yearly' | 'custom'
  startDate: Date
  endDate: Date
  alertThresholdPercent: number
  status: 'active' | 'archived'
  notes?: string
  createdBy: mongoose.Types.ObjectId | string
  updatedBy?: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}
