import mongoose, { Model, Schema } from 'mongoose'
import type { IFinanceAccountingSettings } from './financeAccountingSettings.interface'

const nullableAccount = { type: Schema.Types.ObjectId, default: null } as const

const financeAccountingSettingsSchema = new Schema<IFinanceAccountingSettings>({
  organizationId: { type: String, required: true, trim: true },
  baseCurrency: { type: String, required: true, default: 'BDT', uppercase: true, trim: true, minlength: 3, maxlength: 3 },
  accountingMethod: { type: String, enum: ['ACCRUAL'], required: true, default: 'ACCRUAL' },
  fiscalYearStartMonth: { type: Number, required: true, default: 1, min: 1, max: 12 },
  defaultAccounts: {
    accountsReceivable: nullableAccount, accountsPayable: nullableAccount, bank: nullableAccount,
    commissionRevenue: nullableAccount, commissionExpense: nullableAccount, commissionPayable: nullableAccount,
    clientDeposit: nullableAccount, shareCapital: nullableAccount, retainedEarnings: nullableAccount, rounding: nullableAccount,
  },
  taxAccounts: { outputTax: nullableAccount, inputTax: nullableAccount, withholdingTax: nullableAccount },
  initializedAt: { type: Date, required: true, default: Date.now },
  initializedBy: { type: String, required: true, trim: true },
  updatedBy: { type: String, required: true, trim: true },
}, { timestamps: true, versionKey: false })

financeAccountingSettingsSchema.index({ organizationId: 1 }, { unique: true, name: 'finance_accounting_settings_tenant_unique' })

export const FinanceAccountingSettings: Model<IFinanceAccountingSettings> = mongoose.models.FinanceAccountingSettings
  || mongoose.model<IFinanceAccountingSettings>('FinanceAccountingSettings', financeAccountingSettingsSchema)
