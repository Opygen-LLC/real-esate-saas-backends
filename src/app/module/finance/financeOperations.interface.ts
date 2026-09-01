import type { Types } from 'mongoose'

export type FinanceBankAccountType = 'CHECKING' | 'SAVINGS' | 'PETTY_CASH' | 'CLIENT_MONEY' | 'CREDIT_CARD' | 'MOBILE_WALLET'
export type FinanceBankAccountStatus = 'ACTIVE' | 'INACTIVE'
export type FinanceVendorBillStatus = 'DRAFT' | 'APPROVED' | 'POSTED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID'
export type FinanceBankStatementStatus = 'OPEN' | 'RECONCILED'
export type FinanceBankStatementLineStatus = 'UNMATCHED' | 'PARTIAL' | 'MATCHED' | 'EXCLUDED' | 'RECONCILED'
export type FinanceClientDepositType = 'BOOKING_DEPOSIT' | 'SECURITY_DEPOSIT' | 'ADVANCE' | 'CLIENT_MONEY'
export type FinanceClientDepositStatus = 'OPEN' | 'PARTIALLY_APPLIED' | 'APPLIED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'CANCELLED'
export type FinanceTaxCodeType = 'VAT' | 'SALES_TAX' | 'ZERO_RATED' | 'EXEMPT' | 'WITHHOLDING'
export type FinanceTaxDirection = 'OUTPUT' | 'INPUT' | 'WITHHOLDING'

export interface IFinanceBankAccount {
  organizationId: string
  name: string
  type: FinanceBankAccountType
  bankName?: string
  accountName?: string
  accountNumberMasked?: string
  currency: string
  glAccountId: Types.ObjectId
  isDefaultOperating: boolean
  status: FinanceBankAccountStatus
  createdBy: Types.ObjectId
  updatedBy?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceVendorBillLine {
  description: string
  accountId: Types.ObjectId
  amountMinor: number
  propertyId?: Types.ObjectId | null
}

export interface IFinanceVendorBillPayment {
  _id?: Types.ObjectId
  amountMinor: number
  paidAt: Date
  bankAccountId: Types.ObjectId
  reference?: string
  notes?: string
  journalEntryId?: Types.ObjectId | null
  recordedBy: Types.ObjectId
}

export interface IFinanceVendorBill {
  organizationId: string
  billNumber: string
  vendorId: Types.ObjectId
  vendorInvoiceNumber?: string
  billDate: Date
  dueDate?: Date
  currency: string
  lines: IFinanceVendorBillLine[]
  subtotalMinor: number
  taxCodeId?: Types.ObjectId | null
  taxAmountMinor: number
  totalMinor: number
  paidMinor: number
  status: FinanceVendorBillStatus
  notes?: string
  propertyId?: Types.ObjectId | null
  postingJournalId?: Types.ObjectId | null
  accountingVersion: number
  payments: IFinanceVendorBillPayment[]
  voidedAt?: Date | null
  voidedBy?: Types.ObjectId | null
  voidReason?: string
  createdBy: Types.ObjectId
  updatedBy?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceBankTransfer {
  organizationId: string
  transferNumber: string
  sourceBankAccountId: Types.ObjectId
  destinationBankAccountId: Types.ObjectId
  amountMinor: number
  currency: string
  transferDate: Date
  reference?: string
  description?: string
  journalEntryId: Types.ObjectId
  createdBy: Types.ObjectId
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceBankStatement {
  organizationId: string
  bankAccountId: Types.ObjectId
  statementNumber: string
  startDate: Date
  endDate: Date
  openingBalanceMinor: number
  closingBalanceMinor: number
  currency: string
  status: FinanceBankStatementStatus
  sourceFileName?: string
  reconciledAt?: Date | null
  reconciledBy?: Types.ObjectId | null
  createdBy: Types.ObjectId
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceBankStatementLine {
  organizationId: string
  statementId: Types.ObjectId
  bankAccountId: Types.ObjectId
  lineNumber: number
  transactionDate: Date
  description: string
  reference?: string
  amountMinor: number
  status: FinanceBankStatementLineStatus
  matchedJournalLineIds: Types.ObjectId[]
  matchedAmountMinor: number
  exclusionReason?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceReconciliation {
  organizationId: string
  statementId: Types.ObjectId
  bankAccountId: Types.ObjectId
  statementClosingBalanceMinor: number
  ledgerClosingBalanceMinor: number
  differenceMinor: number
  reconciledAt: Date
  reconciledBy: Types.ObjectId
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceClientDepositApplication {
  _id?: Types.ObjectId
  invoiceId: Types.ObjectId
  amountMinor: number
  appliedAt: Date
  journalEntryId: Types.ObjectId
  appliedBy: Types.ObjectId
}

export interface IFinanceClientDepositRefund {
  _id?: Types.ObjectId
  amountMinor: number
  refundedAt: Date
  bankAccountId: Types.ObjectId
  reference?: string
  journalEntryId: Types.ObjectId
  refundedBy: Types.ObjectId
}

export interface IFinanceClientDeposit {
  organizationId: string
  depositNumber: string
  type: FinanceClientDepositType
  clientName: string
  clientEmail?: string
  clientPhone?: string
  leadId?: Types.ObjectId | null
  propertyId?: Types.ObjectId | null
  bankAccountId: Types.ObjectId
  amountMinor: number
  appliedMinor: number
  refundedMinor: number
  currency: string
  receivedAt: Date
  reference?: string
  notes?: string
  status: FinanceClientDepositStatus
  receiptJournalId: Types.ObjectId
  applications: IFinanceClientDepositApplication[]
  refunds: IFinanceClientDepositRefund[]
  createdBy: Types.ObjectId
  updatedBy?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceTaxCode {
  organizationId: string
  code: string
  name: string
  type: FinanceTaxCodeType
  direction: FinanceTaxDirection
  rateBasisPoints: number
  outputAccountId?: Types.ObjectId | null
  inputAccountId?: Types.ObjectId | null
  withholdingAccountId?: Types.ObjectId | null
  status: 'ACTIVE' | 'INACTIVE'
  isSystemDefault: boolean
  createdBy: Types.ObjectId
  updatedBy?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}
