import type { Types } from 'mongoose'

export type FinanceAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
export type FinanceNormalBalance = 'DEBIT' | 'CREDIT'
export type FinanceAccountStatus = 'ACTIVE' | 'INACTIVE'
export type FinanceFiscalYearStatus = 'OPEN' | 'CLOSING' | 'CLOSED'
export type FinanceFiscalPeriodStatus = 'OPEN' | 'SOFT_LOCKED' | 'CLOSED'
export type FinanceJournalStatus = 'DRAFT' | 'APPROVED' | 'POSTED' | 'REVERSED'
export type FinanceJournalEntryRole = 'PRIMARY' | 'REVERSAL'

export interface IFinanceAccount {
  organizationId: string
  code: string
  name: string
  type: FinanceAccountType
  parentAccountId?: Types.ObjectId | null
  normalBalance: FinanceNormalBalance
  currency: string
  systemKey?: string | null
  isSystem: boolean
  allowManualPosting: boolean
  status: FinanceAccountStatus
  createdBy: Types.ObjectId
  updatedBy?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceFiscalYear {
  organizationId: string
  name: string
  startDate: Date
  endDate: Date
  status: FinanceFiscalYearStatus
  createdBy: Types.ObjectId
  updatedBy?: Types.ObjectId | null
  closedAt?: Date | null
  closedBy?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceFiscalPeriod {
  organizationId: string
  fiscalYearId: Types.ObjectId
  periodNumber: number
  name: string
  startDate: Date
  endDate: Date
  status: FinanceFiscalPeriodStatus
  createdBy: Types.ObjectId
  updatedBy?: Types.ObjectId | null
  closedAt?: Date | null
  closedBy?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceJournalEntry {
  organizationId: string
  journalNumber: string
  entryDate: Date
  postingDate: Date
  status: FinanceJournalStatus
  entryRole: FinanceJournalEntryRole
  sourceType: string
  sourceId?: string | null
  idempotencyKey?: string | null
  description: string
  reference?: string
  currency: string
  fiscalYearId: Types.ObjectId
  fiscalPeriodId: Types.ObjectId
  createdBy: Types.ObjectId
  approvedBy?: Types.ObjectId | null
  approvedAt?: Date | null
  postedBy?: Types.ObjectId | null
  postedAt?: Date | null
  reversalOf?: Types.ObjectId | null
  reversedBy?: Types.ObjectId | null
  reversedAt?: Date | null
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceJournalLine {
  organizationId: string
  journalEntryId: Types.ObjectId
  journalNumber: string
  lineNumber: number
  accountId: Types.ObjectId
  debitMinor: number
  creditMinor: number
  description?: string
  currency: string
  journalStatus: FinanceJournalStatus
  postingDate: Date
  sourceType: string
  propertyId?: Types.ObjectId | null
  agentId?: Types.ObjectId | null
  vendorId?: Types.ObjectId | null
  clientId?: Types.ObjectId | null
  shareholderId?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceAccountingSequence {
  organizationId: string
  key: string
  value: number
  createdAt?: Date
  updatedAt?: Date
}

export interface FinanceJournalLineInput {
  accountId: string
  debitMinor?: number
  creditMinor?: number
  description?: string
  propertyId?: string | null
  agentId?: string | null
  vendorId?: string | null
  clientId?: string | null
  shareholderId?: string | null
}

export interface FinanceJournalInput {
  entryDate: Date | string
  postingDate: Date | string
  description: string
  reference?: string
  fiscalPeriodId?: string
  lines: FinanceJournalLineInput[]
}

export interface AccountingActor {
  id: string
  role?: string
  requestId?: string
  ip?: string
  permissions?: string[]
  system?: boolean
}

export type FinanceCategoryMappingType = 'income' | 'expense'

export interface IFinanceCategoryAccountMapping {
  organizationId: string
  transactionType: FinanceCategoryMappingType
  category: string
  categoryKey: string
  accountId: Types.ObjectId
  isSystemDefault: boolean
  createdBy: Types.ObjectId
  updatedBy?: Types.ObjectId | null
  createdAt?: Date
  updatedAt?: Date
}
