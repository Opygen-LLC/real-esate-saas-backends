import type { Types } from 'mongoose'
import type { LegacyFinanceCurrency } from './finance.contract'

export type FinanceShareholderType = 'INDIVIDUAL' | 'COMPANY'
export type FinanceShareholderStatus = 'ACTIVE' | 'INACTIVE'
export type FinanceEquityTransactionType = 'CAPITAL_CONTRIBUTION' | 'SHARE_ISSUE' | 'SHARE_TRANSFER' | 'SHARE_BUYBACK' | 'CAPITAL_RETURN' | 'OWNER_DRAW' | 'DIVIDEND_DECLARATION' | 'DIVIDEND_PAYMENT'
export type FinanceDividendStatus = 'DRAFT' | 'APPROVED' | 'DECLARED' | 'PAID' | 'CANCELLED'
export type FinanceLoanStatus = 'DRAFT' | 'ACTIVE' | 'PAID' | 'CANCELLED'
export type FinanceLoanPaymentFrequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL' | 'OTHER'

export interface IFinanceShareholder {
  organizationId: string
  name: string
  type: FinanceShareholderType
  email?: string
  phone?: string
  shareClass: string
  sharesHeld: number
  ownershipPercentage: number
  joinedAt: Date
  status: FinanceShareholderStatus
  notes?: string
  createdBy: Types.ObjectId
  updatedBy?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceEquityTransaction {
  organizationId: string
  transactionNumber: string
  type: FinanceEquityTransactionType
  shareholderId?: Types.ObjectId | null
  counterpartyShareholderId?: Types.ObjectId | null
  shares: number
  amountMinor: number
  shareCapitalMinor: number
  additionalPaidInCapitalMinor: number
  currency: LegacyFinanceCurrency
  transactionDate: Date
  bankAccountId?: Types.ObjectId | null
  reference?: string
  notes?: string
  journalEntryId?: Types.ObjectId | null
  sourceDocumentId?: Types.ObjectId | null
  createdBy: Types.ObjectId
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceShareholderLoanPayment {
  _id?: Types.ObjectId
  paidAt: Date
  principalMinor: number
  interestMinor: number
  bankAccountId: Types.ObjectId
  reference?: string
  journalEntryId: Types.ObjectId
  recordedBy: Types.ObjectId
}

export interface IFinanceShareholderLoan {
  organizationId: string
  loanNumber: string
  shareholderId: Types.ObjectId
  principalMinor: number
  outstandingPrincipalMinor: number
  interestRateBasisPoints: number
  startDate: Date
  maturityDate?: Date | null
  paymentFrequency: FinanceLoanPaymentFrequency
  currency: LegacyFinanceCurrency
  bankAccountId: Types.ObjectId
  liabilityAccountId: Types.ObjectId
  interestExpenseAccountId: Types.ObjectId
  receiptJournalId: Types.ObjectId
  payments: IFinanceShareholderLoanPayment[]
  status: FinanceLoanStatus
  reference?: string
  notes?: string
  createdBy: Types.ObjectId
  updatedBy?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceDividendPayment {
  _id?: Types.ObjectId
  paidAt: Date
  amountMinor: number
  bankAccountId: Types.ObjectId
  reference?: string
  journalEntryId: Types.ObjectId
  recordedBy: Types.ObjectId
}

export interface IFinanceDividend {
  organizationId: string
  dividendNumber: string
  shareholderId?: Types.ObjectId | null
  description: string
  amountMinor: number
  paidMinor: number
  currency: LegacyFinanceCurrency
  declarationDate: Date
  paymentDueDate?: Date | null
  status: FinanceDividendStatus
  retainedEarningsAccountId: Types.ObjectId
  dividendPayableAccountId: Types.ObjectId
  declarationJournalId?: Types.ObjectId | null
  payments: IFinanceDividendPayment[]
  approvedAt?: Date | null
  approvedBy?: Types.ObjectId | null
  declaredAt?: Date | null
  declaredBy?: Types.ObjectId | null
  notes?: string
  createdBy: Types.ObjectId
  updatedBy?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceLoanPayment {
  _id?: Types.ObjectId
  paidAt: Date
  principalMinor: number
  interestMinor: number
  feesMinor: number
  bankAccountId: Types.ObjectId
  reference?: string
  journalEntryId: Types.ObjectId
  recordedBy: Types.ObjectId
}

export interface IFinanceLoan {
  organizationId: string
  loanNumber: string
  lender: string
  principalMinor: number
  outstandingPrincipalMinor: number
  interestRateBasisPoints: number
  startDate: Date
  maturityDate?: Date | null
  paymentFrequency: FinanceLoanPaymentFrequency
  currency: LegacyFinanceCurrency
  bankAccountId: Types.ObjectId
  liabilityAccountId: Types.ObjectId
  interestExpenseAccountId: Types.ObjectId
  receiptJournalId: Types.ObjectId
  payments: IFinanceLoanPayment[]
  status: FinanceLoanStatus
  reference?: string
  notes?: string
  createdBy: Types.ObjectId
  updatedBy?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}
