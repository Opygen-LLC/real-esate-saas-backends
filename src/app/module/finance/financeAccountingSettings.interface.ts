import type { Types } from 'mongoose'

export type FinanceAccountRef = Types.ObjectId | string | null
export type AccountingMethod = 'ACCRUAL'
export type FinanceAccountingActivationStatus = 'ACTIVE' | 'MIGRATION_REQUIRED' | 'LOCKED_READ_ONLY'

export interface IFinanceAccountingSettings {
  organizationId: string
  baseCurrency: string
  accountingMethod: AccountingMethod
  fiscalYearStartMonth: number
  makerCheckerRequired: boolean
  activationStatus: FinanceAccountingActivationStatus
  accountingStartDate?: Date | null
  activatedAt?: Date | null
  activatedBy?: string | null
  defaultAccounts: {
    accountsReceivable?: FinanceAccountRef
    accountsPayable?: FinanceAccountRef
    bank?: FinanceAccountRef
    commissionRevenue?: FinanceAccountRef
    commissionExpense?: FinanceAccountRef
    commissionPayable?: FinanceAccountRef
    clientDeposit?: FinanceAccountRef
    shareCapital?: FinanceAccountRef
    retainedEarnings?: FinanceAccountRef
    rounding?: FinanceAccountRef
  }
  taxAccounts: {
    outputTax?: FinanceAccountRef
    inputTax?: FinanceAccountRef
    withholdingTax?: FinanceAccountRef
  }
  initializedAt: Date
  initializedBy: string
  updatedBy: string
  createdAt?: Date
  updatedAt?: Date
}
