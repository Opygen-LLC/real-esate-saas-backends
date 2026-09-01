import type { Types } from 'mongoose'

export type FinanceAccountingInitializationStatus = 'DRAFT' | 'PREVIEWED' | 'ACTIVATING' | 'ACTIVATED'
export type LegacyFinancePaymentMethod = 'cash' | 'bank' | 'bkash' | 'nagad' | 'card' | 'cheque' | 'other'

export interface IFinanceLegacyPaymentMethodMapping {
  organizationId: string
  paymentMethod: LegacyFinancePaymentMethod
  bankAccountId: Types.ObjectId
  createdBy: Types.ObjectId
  updatedBy?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceAccountingInitialization {
  organizationId: string
  status: FinanceAccountingInitializationStatus
  accountingStartDate?: Date | null
  lastPreviewAt?: Date | null
  previewSnapshot?: Record<string, unknown> | null
  openingJournalId?: Types.ObjectId | null
  activatedAt?: Date | null
  activatedBy?: Types.ObjectId | null
  activationReason?: string
  createdBy: Types.ObjectId
  updatedBy?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}
