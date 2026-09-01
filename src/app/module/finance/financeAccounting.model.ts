import mongoose, { Model, Schema } from 'mongoose'
import type {
  IFinanceAccount,
  IFinanceAccountingSequence,
  IFinanceFiscalPeriod,
  IFinanceFiscalYear,
  IFinanceJournalEntry,
  IFinanceJournalLine,
  IFinanceCategoryAccountMapping,
} from './financeAccounting.interface'

const actorRef = { type: Schema.Types.ObjectId, ref: 'User', required: true } as const
const optionalActorRef = { type: Schema.Types.ObjectId, ref: 'User', default: null } as const

const financeAccountSchema = new Schema<IFinanceAccount>({
  organizationId: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, maxlength: 32 },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  type: { type: String, enum: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'], required: true },
  parentAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceAccount', default: null },
  normalBalance: { type: String, enum: ['DEBIT', 'CREDIT'], required: true },
  currency: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3 },
  systemKey: { type: String, trim: true, maxlength: 80, default: null },
  isSystem: { type: Boolean, default: false },
  allowManualPosting: { type: Boolean, default: true },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  createdBy: actorRef,
  updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
financeAccountSchema.index({ organizationId: 1, code: 1 }, { unique: true, name: 'finance_account_tenant_code_unique' })
financeAccountSchema.index({ organizationId: 1, systemKey: 1 }, { unique: true, partialFilterExpression: { systemKey: { $type: 'string' } }, name: 'finance_account_tenant_system_key_unique' })
financeAccountSchema.index({ organizationId: 1, parentAccountId: 1, code: 1 }, { name: 'finance_account_tenant_parent_code' })
financeAccountSchema.index({ organizationId: 1, type: 1, status: 1, code: 1 }, { name: 'finance_account_tenant_type_status_code' })

const financeFiscalYearSchema = new Schema<IFinanceFiscalYear>({
  organizationId: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['OPEN', 'CLOSING', 'CLOSED'], default: 'OPEN' },
  createdBy: actorRef,
  updatedBy: optionalActorRef,
  closedAt: { type: Date, default: null },
  closedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
financeFiscalYearSchema.index({ organizationId: 1, startDate: 1 }, { unique: true, name: 'finance_fiscal_year_tenant_start_unique' })
financeFiscalYearSchema.index({ organizationId: 1, status: 1, startDate: -1 }, { name: 'finance_fiscal_year_tenant_status_start' })

const financeFiscalPeriodSchema = new Schema<IFinanceFiscalPeriod>({
  organizationId: { type: String, required: true, trim: true },
  fiscalYearId: { type: Schema.Types.ObjectId, ref: 'FinanceFiscalYear', required: true },
  periodNumber: { type: Number, required: true, min: 1, max: 24 },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['OPEN', 'SOFT_LOCKED', 'CLOSED'], default: 'OPEN' },
  createdBy: actorRef,
  updatedBy: optionalActorRef,
  closedAt: { type: Date, default: null },
  closedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
financeFiscalPeriodSchema.index({ organizationId: 1, fiscalYearId: 1, periodNumber: 1 }, { unique: true, name: 'finance_fiscal_period_tenant_year_number_unique' })
financeFiscalPeriodSchema.index({ organizationId: 1, startDate: 1, endDate: 1, status: 1 }, { name: 'finance_fiscal_period_tenant_range_status' })

const financeJournalEntrySchema = new Schema<IFinanceJournalEntry>({
  organizationId: { type: String, required: true, trim: true },
  journalNumber: { type: String, required: true, trim: true, maxlength: 80 },
  entryDate: { type: Date, required: true },
  postingDate: { type: Date, required: true },
  status: { type: String, enum: ['DRAFT', 'POSTED', 'REVERSED'], default: 'DRAFT' },
  entryRole: { type: String, enum: ['PRIMARY', 'REVERSAL'], default: 'PRIMARY' },
  sourceType: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
  sourceId: { type: String, trim: true, maxlength: 160, default: null },
  idempotencyKey: { type: String, trim: true, maxlength: 180, default: null },
  description: { type: String, required: true, trim: true, maxlength: 1000 },
  reference: { type: String, trim: true, maxlength: 200, default: '' },
  currency: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3 },
  fiscalYearId: { type: Schema.Types.ObjectId, ref: 'FinanceFiscalYear', required: true },
  fiscalPeriodId: { type: Schema.Types.ObjectId, ref: 'FinanceFiscalPeriod', required: true },
  createdBy: actorRef,
  approvedBy: optionalActorRef,
  postedBy: optionalActorRef,
  postedAt: { type: Date, default: null },
  reversalOf: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', default: null },
  reversedBy: optionalActorRef,
  reversedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false })
financeJournalEntrySchema.index({ organizationId: 1, journalNumber: 1 }, { unique: true, name: 'finance_journal_tenant_number_unique' })
financeJournalEntrySchema.index({ organizationId: 1, postingDate: -1, status: 1 }, { name: 'finance_journal_tenant_posting_status' })
financeJournalEntrySchema.index({ organizationId: 1, sourceType: 1, sourceId: 1, entryRole: 1 }, {
  unique: true,
  partialFilterExpression: { sourceId: { $type: 'string' }, entryRole: 'PRIMARY' },
  name: 'finance_journal_tenant_source_primary_unique',
})
financeJournalEntrySchema.index({ organizationId: 1, idempotencyKey: 1 }, {
  unique: true,
  partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  name: 'finance_journal_tenant_idempotency_unique',
})
financeJournalEntrySchema.index({ organizationId: 1, reversalOf: 1 }, {
  unique: true,
  partialFilterExpression: { reversalOf: { $type: 'objectId' } },
  name: 'finance_journal_tenant_reversal_unique',
})

const financeJournalLineSchema = new Schema<IFinanceJournalLine>({
  organizationId: { type: String, required: true, trim: true },
  journalEntryId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', required: true },
  journalNumber: { type: String, required: true, trim: true, maxlength: 80 },
  lineNumber: { type: Number, required: true, min: 1 },
  accountId: { type: Schema.Types.ObjectId, ref: 'FinanceAccount', required: true },
  debitMinor: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
  creditMinor: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  currency: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3 },
  journalStatus: { type: String, enum: ['DRAFT', 'POSTED', 'REVERSED'], required: true },
  postingDate: { type: Date, required: true },
  sourceType: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
  agentId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  vendorId: { type: Schema.Types.ObjectId, ref: 'FinanceVendor', default: null },
  clientId: { type: Schema.Types.ObjectId, default: null },
  shareholderId: { type: Schema.Types.ObjectId, default: null },
}, { timestamps: true, versionKey: false })
financeJournalLineSchema.index({ organizationId: 1, journalEntryId: 1, lineNumber: 1 }, { unique: true, name: 'finance_journal_line_tenant_journal_line_unique' })
financeJournalLineSchema.index({ organizationId: 1, accountId: 1, postingDate: 1, journalStatus: 1 }, { name: 'finance_journal_line_tenant_account_date_status' })
financeJournalLineSchema.index({ organizationId: 1, propertyId: 1, postingDate: 1 }, { name: 'finance_journal_line_tenant_property_date' })
financeJournalLineSchema.index({ organizationId: 1, agentId: 1, postingDate: 1 }, { name: 'finance_journal_line_tenant_agent_date' })
financeJournalLineSchema.index({ organizationId: 1, vendorId: 1, postingDate: 1 }, { name: 'finance_journal_line_tenant_vendor_date' })
financeJournalLineSchema.index({ organizationId: 1, clientId: 1, postingDate: 1 }, { name: 'finance_journal_line_tenant_client_date' })
financeJournalLineSchema.index({ organizationId: 1, sourceType: 1, postingDate: 1 }, { name: 'finance_journal_line_tenant_source_date' })


const financeCategoryAccountMappingSchema = new Schema<IFinanceCategoryAccountMapping>({
  organizationId: { type: String, required: true, trim: true },
  transactionType: { type: String, enum: ['income', 'expense'], required: true },
  category: { type: String, required: true, trim: true, maxlength: 100 },
  categoryKey: { type: String, required: true, trim: true, lowercase: true, maxlength: 120 },
  accountId: { type: Schema.Types.ObjectId, ref: 'FinanceAccount', required: true },
  isSystemDefault: { type: Boolean, default: false },
  createdBy: actorRef,
  updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
financeCategoryAccountMappingSchema.index({ organizationId: 1, transactionType: 1, categoryKey: 1 }, { unique: true, name: 'finance_category_mapping_tenant_type_category_unique' })
financeCategoryAccountMappingSchema.index({ organizationId: 1, accountId: 1 }, { name: 'finance_category_mapping_tenant_account' })

const financeAccountingSequenceSchema = new Schema<IFinanceAccountingSequence>({
  organizationId: { type: String, required: true, trim: true },
  key: { type: String, required: true, trim: true, maxlength: 80 },
  value: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER, default: 0 },
}, { timestamps: true, versionKey: false })
financeAccountingSequenceSchema.index({ organizationId: 1, key: 1 }, { unique: true, name: 'finance_accounting_sequence_tenant_key_unique' })

export const FinanceAccount: Model<IFinanceAccount> = mongoose.models.FinanceAccount || mongoose.model<IFinanceAccount>('FinanceAccount', financeAccountSchema)
export const FinanceFiscalYear: Model<IFinanceFiscalYear> = mongoose.models.FinanceFiscalYear || mongoose.model<IFinanceFiscalYear>('FinanceFiscalYear', financeFiscalYearSchema)
export const FinanceFiscalPeriod: Model<IFinanceFiscalPeriod> = mongoose.models.FinanceFiscalPeriod || mongoose.model<IFinanceFiscalPeriod>('FinanceFiscalPeriod', financeFiscalPeriodSchema)
export const FinanceJournalEntry: Model<IFinanceJournalEntry> = mongoose.models.FinanceJournalEntry || mongoose.model<IFinanceJournalEntry>('FinanceJournalEntry', financeJournalEntrySchema)
export const FinanceJournalLine: Model<IFinanceJournalLine> = mongoose.models.FinanceJournalLine || mongoose.model<IFinanceJournalLine>('FinanceJournalLine', financeJournalLineSchema)
export const FinanceAccountingSequence: Model<IFinanceAccountingSequence> = mongoose.models.FinanceAccountingSequence || mongoose.model<IFinanceAccountingSequence>('FinanceAccountingSequence', financeAccountingSequenceSchema)
export const FinanceCategoryAccountMapping: Model<IFinanceCategoryAccountMapping> = mongoose.models.FinanceCategoryAccountMapping || mongoose.model<IFinanceCategoryAccountMapping>('FinanceCategoryAccountMapping', financeCategoryAccountMappingSchema)
