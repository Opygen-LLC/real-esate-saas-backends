import mongoose, { Model, Schema } from 'mongoose'
import type { IFinanceAccountingSettings } from './financeAccountingSettings.interface'

const nullableAccount = { type: Schema.Types.ObjectId, default: null } as const

const financeAccountingSettingsSchema = new Schema<IFinanceAccountingSettings>({
  organizationId: { type: String, required: true, trim: true },
  baseCurrency: { type: String, required: true, enum: ['BDT'], default: 'BDT', uppercase: true, trim: true },
  accountingMethod: { type: String, enum: ['ACCRUAL'], required: true, default: 'ACCRUAL' },
  fiscalYearStartMonth: { type: Number, required: true, default: 1, min: 1, max: 12 },
  makerCheckerRequired: { type: Boolean, required: true, default: false },
  activationStatus: { type: String, enum: ['ACTIVE', 'MIGRATION_REQUIRED', 'LOCKED_READ_ONLY'], required: true, default: 'ACTIVE' },
  accountingStartDate: { type: Date, default: null },
  activatedAt: { type: Date, default: null },
  activatedBy: { type: String, default: null },
  defaultAccounts: {
    accountsReceivable: nullableAccount, accountsPayable: nullableAccount, bank: nullableAccount,
    commissionRevenue: nullableAccount, commissionExpense: nullableAccount, commissionPayable: nullableAccount,
    clientDeposit: nullableAccount, shareCapital: nullableAccount, retainedEarnings: nullableAccount, rounding: nullableAccount,
  },
  taxAccounts: { outputTax: nullableAccount, inputTax: nullableAccount, withholdingTax: nullableAccount },
  initializedAt: { type: Date, default: null },
  initializedBy: { type: String, default: null, trim: true },
  updatedBy: { type: String, default: null, trim: true },
}, { timestamps: true, versionKey: false })

financeAccountingSettingsSchema.index({ organizationId: 1 }, { unique: true, name: 'finance_accounting_settings_tenant_unique' })

export const FinanceAccountingSettings: Model<IFinanceAccountingSettings> = mongoose.models.FinanceAccountingSettings
  || mongoose.model<IFinanceAccountingSettings>('FinanceAccountingSettings', financeAccountingSettingsSchema)
