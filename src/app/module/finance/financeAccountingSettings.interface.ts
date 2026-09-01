import type { Types } from 'mongoose'

export type FinanceAccountRef = Types.ObjectId | string | null
export type AccountingMethod = 'ACCRUAL'

export interface IFinanceAccountingSettings {
  organizationId: string
  baseCurrency: string
  accountingMethod: AccountingMethod
  fiscalYearStartMonth: number
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
