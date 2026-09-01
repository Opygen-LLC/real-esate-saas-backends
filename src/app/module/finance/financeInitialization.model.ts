import mongoose, { Model, Schema } from 'mongoose'
import type { IFinanceAccountingInitialization, IFinanceLegacyPaymentMethodMapping } from './financeInitialization.interface'

const actorRef = { type: Schema.Types.ObjectId, ref: 'User', required: true } as const
const optionalActorRef = { type: Schema.Types.ObjectId, ref: 'User', default: null } as const

const financeLegacyPaymentMethodMappingSchema = new Schema<IFinanceLegacyPaymentMethodMapping>({
  organizationId: { type: String, required: true, trim: true },
  paymentMethod: { type: String, enum: ['cash', 'bank', 'bkash', 'nagad', 'card', 'cheque', 'other'], required: true },
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', required: true },
  createdBy: actorRef,
  updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
financeLegacyPaymentMethodMappingSchema.index({ organizationId: 1, paymentMethod: 1 }, { unique: true, name: 'finance_legacy_payment_mapping_tenant_method_unique' })
financeLegacyPaymentMethodMappingSchema.index({ organizationId: 1, bankAccountId: 1 }, { name: 'finance_legacy_payment_mapping_tenant_bank' })

const financeAccountingInitializationSchema = new Schema<IFinanceAccountingInitialization>({
  organizationId: { type: String, required: true, trim: true },
  status: { type: String, enum: ['DRAFT', 'PREVIEWED', 'ACTIVATING', 'ACTIVATED'], required: true, default: 'DRAFT' },
  accountingStartDate: { type: Date, default: null },
  lastPreviewAt: { type: Date, default: null },
  previewSnapshot: { type: Schema.Types.Mixed, default: null },
  openingJournalId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', default: null },
  activatedAt: { type: Date, default: null },
  activatedBy: optionalActorRef,
  activationReason: { type: String, trim: true, maxlength: 1000, default: '' },
  createdBy: actorRef,
  updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
financeAccountingInitializationSchema.index({ organizationId: 1 }, { unique: true, name: 'finance_accounting_initialization_tenant_unique' })
financeAccountingInitializationSchema.index({ status: 1, updatedAt: -1 }, { name: 'finance_accounting_initialization_status_updated' })

export const FinanceLegacyPaymentMethodMapping: Model<IFinanceLegacyPaymentMethodMapping> = mongoose.models.FinanceLegacyPaymentMethodMapping
  || mongoose.model<IFinanceLegacyPaymentMethodMapping>('FinanceLegacyPaymentMethodMapping', financeLegacyPaymentMethodMappingSchema)
export const FinanceAccountingInitialization: Model<IFinanceAccountingInitialization> = mongoose.models.FinanceAccountingInitialization
  || mongoose.model<IFinanceAccountingInitialization>('FinanceAccountingInitialization', financeAccountingInitializationSchema)
