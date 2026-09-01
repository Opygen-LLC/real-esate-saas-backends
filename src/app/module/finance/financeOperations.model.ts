import mongoose, { Model, Schema } from 'mongoose'
import type {
  IFinanceBankAccount, IFinanceBankStatement, IFinanceBankStatementLine, IFinanceBankTransfer,
  IFinanceClientDeposit, IFinanceReconciliation, IFinanceTaxCode, IFinanceVendorBill,
} from './financeOperations.interface'

const actorRef = { type: Schema.Types.ObjectId, ref: 'User', required: true } as const
const optionalActorRef = { type: Schema.Types.ObjectId, ref: 'User', default: null } as const
const safeMinor = { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER } as const

const financeBankAccountSchema = new Schema<IFinanceBankAccount>({
  organizationId: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  type: { type: String, enum: ['CHECKING', 'SAVINGS', 'PETTY_CASH', 'CLIENT_MONEY', 'CREDIT_CARD', 'MOBILE_WALLET'], required: true },
  bankName: { type: String, trim: true, maxlength: 160, default: '' },
  accountName: { type: String, trim: true, maxlength: 160, default: '' },
  accountNumberMasked: { type: String, trim: true, maxlength: 80, default: '' },
  currency: { type: String, required: true, enum: ['BDT'], default: 'BDT', uppercase: true, trim: true },
  glAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceAccount', required: true },
  isDefaultOperating: { type: Boolean, default: false },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  createdBy: actorRef,
  updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
financeBankAccountSchema.index({ organizationId: 1, name: 1 }, { unique: true, name: 'finance_bank_account_tenant_name_unique' })
financeBankAccountSchema.index({ organizationId: 1, glAccountId: 1 }, { unique: true, name: 'finance_bank_account_tenant_gl_unique' })
financeBankAccountSchema.index({ organizationId: 1, isDefaultOperating: 1, status: 1 }, { name: 'finance_bank_account_tenant_default_status' })

const vendorBillLineSchema = new Schema({
  description: { type: String, required: true, trim: true, maxlength: 500 },
  accountId: { type: Schema.Types.ObjectId, ref: 'FinanceAccount', required: true },
  amountMinor: safeMinor,
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
}, { _id: true })
const vendorBillPaymentSchema = new Schema({
  amountMinor: safeMinor,
  paidAt: { type: Date, required: true },
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', required: true },
  reference: { type: String, trim: true, maxlength: 200, default: '' },
  notes: { type: String, trim: true, maxlength: 500, default: '' },
  journalEntryId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', default: null },
  recordedBy: actorRef,
}, { _id: true })
const financeVendorBillSchema = new Schema<IFinanceVendorBill>({
  organizationId: { type: String, required: true, trim: true },
  billNumber: { type: String, required: true, trim: true, maxlength: 80 },
  vendorId: { type: Schema.Types.ObjectId, ref: 'FinanceVendor', required: true },
  vendorInvoiceNumber: { type: String, trim: true, maxlength: 120, default: '' },
  billDate: { type: Date, required: true },
  dueDate: { type: Date, default: null },
  currency: { type: String, required: true, enum: ['BDT'], default: 'BDT', uppercase: true, trim: true },
  lines: { type: [vendorBillLineSchema], required: true },
  subtotalMinor: safeMinor,
  taxCodeId: { type: Schema.Types.ObjectId, ref: 'FinanceTaxCode', default: null },
  taxAmountMinor: safeMinor,
  totalMinor: safeMinor,
  paidMinor: safeMinor,
  status: { type: String, enum: ['DRAFT', 'APPROVED', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'VOID'], default: 'DRAFT' },
  notes: { type: String, trim: true, maxlength: 2000, default: '' },
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
  postingJournalId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', default: null },
  accountingVersion: { type: Number, min: 0, default: 0 },
  payments: { type: [vendorBillPaymentSchema], default: [] },
  voidedAt: { type: Date, default: null },
  voidedBy: optionalActorRef,
  voidReason: { type: String, trim: true, maxlength: 500, default: '' },
  createdBy: actorRef,
  updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
financeVendorBillSchema.index({ organizationId: 1, billNumber: 1 }, { unique: true, name: 'finance_vendor_bill_tenant_number_unique' })
financeVendorBillSchema.index({ organizationId: 1, vendorId: 1, status: 1, dueDate: 1 }, { name: 'finance_vendor_bill_tenant_vendor_status_due' })
financeVendorBillSchema.index({ organizationId: 1, status: 1, dueDate: 1 }, { name: 'finance_vendor_bill_tenant_status_due' })

const financeBankTransferSchema = new Schema<IFinanceBankTransfer>({
  organizationId: { type: String, required: true, trim: true },
  transferNumber: { type: String, required: true, trim: true, maxlength: 80 },
  sourceBankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', required: true },
  destinationBankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', required: true },
  amountMinor: safeMinor,
  currency: { type: String, required: true, enum: ['BDT'], default: 'BDT', uppercase: true, trim: true },
  transferDate: { type: Date, required: true },
  reference: { type: String, trim: true, maxlength: 200, default: '' },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  journalEntryId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', required: true },
  createdBy: actorRef,
}, { timestamps: true, versionKey: false })
financeBankTransferSchema.index({ organizationId: 1, transferNumber: 1 }, { unique: true, name: 'finance_bank_transfer_tenant_number_unique' })
financeBankTransferSchema.index({ organizationId: 1, transferDate: -1 }, { name: 'finance_bank_transfer_tenant_date' })

const financeBankStatementSchema = new Schema<IFinanceBankStatement>({
  organizationId: { type: String, required: true, trim: true },
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', required: true },
  statementNumber: { type: String, required: true, trim: true, maxlength: 100 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  openingBalanceMinor: { type: Number, required: true, min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
  closingBalanceMinor: { type: Number, required: true, min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
  currency: { type: String, required: true, enum: ['BDT'], default: 'BDT', uppercase: true, trim: true },
  status: { type: String, enum: ['OPEN', 'RECONCILED'], default: 'OPEN' },
  sourceFileName: { type: String, trim: true, maxlength: 255, default: '' },
  reconciledAt: { type: Date, default: null },
  reconciledBy: optionalActorRef,
  createdBy: actorRef,
}, { timestamps: true, versionKey: false })
financeBankStatementSchema.index({ organizationId: 1, bankAccountId: 1, statementNumber: 1 }, { unique: true, name: 'finance_bank_statement_tenant_account_number_unique' })
financeBankStatementSchema.index({ organizationId: 1, bankAccountId: 1, endDate: -1 }, { name: 'finance_bank_statement_tenant_account_end' })

const financeBankStatementLineSchema = new Schema<IFinanceBankStatementLine>({
  organizationId: { type: String, required: true, trim: true },
  statementId: { type: Schema.Types.ObjectId, ref: 'FinanceBankStatement', required: true },
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', required: true },
  lineNumber: { type: Number, required: true, min: 1 },
  transactionDate: { type: Date, required: true },
  description: { type: String, required: true, trim: true, maxlength: 1000 },
  reference: { type: String, trim: true, maxlength: 200, default: '' },
  amountMinor: { type: Number, required: true, min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
  status: { type: String, enum: ['UNMATCHED', 'PARTIAL', 'MATCHED', 'EXCLUDED', 'RECONCILED'], default: 'UNMATCHED' },
  matchedJournalLineIds: [{ type: Schema.Types.ObjectId, ref: 'FinanceJournalLine' }],
  matchedAmountMinor: { type: Number, required: true, min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER, default: 0 },
  exclusionReason: { type: String, trim: true, maxlength: 500, default: '' },
}, { timestamps: true, versionKey: false })
financeBankStatementLineSchema.index({ organizationId: 1, statementId: 1, lineNumber: 1 }, { unique: true, name: 'finance_bank_statement_line_tenant_statement_line_unique' })
financeBankStatementLineSchema.index({ organizationId: 1, bankAccountId: 1, transactionDate: 1, status: 1 }, { name: 'finance_bank_statement_line_tenant_account_date_status' })

const financeReconciliationSchema = new Schema<IFinanceReconciliation>({
  organizationId: { type: String, required: true, trim: true },
  statementId: { type: Schema.Types.ObjectId, ref: 'FinanceBankStatement', required: true },
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', required: true },
  statementClosingBalanceMinor: { type: Number, required: true, min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
  ledgerClosingBalanceMinor: { type: Number, required: true, min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
  differenceMinor: { type: Number, required: true, min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
  reconciledAt: { type: Date, required: true },
  reconciledBy: actorRef,
}, { timestamps: true, versionKey: false })
financeReconciliationSchema.index({ organizationId: 1, statementId: 1 }, { unique: true, name: 'finance_reconciliation_tenant_statement_unique' })

const depositApplicationSchema = new Schema({
  invoiceId: { type: Schema.Types.ObjectId, ref: 'FinanceInvoice', required: true },
  amountMinor: safeMinor,
  appliedAt: { type: Date, required: true },
  journalEntryId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', required: true },
  appliedBy: actorRef,
}, { _id: true })
const depositRefundSchema = new Schema({
  amountMinor: safeMinor,
  refundedAt: { type: Date, required: true },
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', required: true },
  reference: { type: String, trim: true, maxlength: 200, default: '' },
  journalEntryId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', required: true },
  refundedBy: actorRef,
}, { _id: true })
const financeClientDepositSchema = new Schema<IFinanceClientDeposit>({
  organizationId: { type: String, required: true, trim: true },
  depositNumber: { type: String, required: true, trim: true, maxlength: 80 },
  type: { type: String, enum: ['BOOKING_DEPOSIT', 'SECURITY_DEPOSIT', 'ADVANCE', 'CLIENT_MONEY'], required: true },
  clientName: { type: String, required: true, trim: true, maxlength: 160 },
  clientEmail: { type: String, trim: true, lowercase: true, maxlength: 200, default: '' },
  clientPhone: { type: String, trim: true, maxlength: 60, default: '' },
  leadId: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', required: true },
  amountMinor: safeMinor,
  appliedMinor: safeMinor,
  refundedMinor: safeMinor,
  currency: { type: String, required: true, enum: ['BDT'], default: 'BDT', uppercase: true, trim: true },
  receivedAt: { type: Date, required: true },
  reference: { type: String, trim: true, maxlength: 200, default: '' },
  notes: { type: String, trim: true, maxlength: 2000, default: '' },
  status: { type: String, enum: ['OPEN', 'PARTIALLY_APPLIED', 'APPLIED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED'], default: 'OPEN' },
  receiptJournalId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', required: true },
  applications: { type: [depositApplicationSchema], default: [] },
  refunds: { type: [depositRefundSchema], default: [] },
  createdBy: actorRef,
  updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
financeClientDepositSchema.index({ organizationId: 1, depositNumber: 1 }, { unique: true, name: 'finance_client_deposit_tenant_number_unique' })
financeClientDepositSchema.index({ organizationId: 1, status: 1, receivedAt: -1 }, { name: 'finance_client_deposit_tenant_status_date' })
financeClientDepositSchema.index({ organizationId: 1, propertyId: 1, status: 1 }, { name: 'finance_client_deposit_tenant_property_status' })

const financeTaxCodeSchema = new Schema<IFinanceTaxCode>({
  organizationId: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  type: { type: String, enum: ['VAT', 'SALES_TAX', 'ZERO_RATED', 'EXEMPT', 'WITHHOLDING'], required: true },
  direction: { type: String, enum: ['OUTPUT', 'INPUT', 'WITHHOLDING'], required: true },
  rateBasisPoints: { type: Number, required: true, min: 0, max: 1000000 },
  outputAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceAccount', default: null },
  inputAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceAccount', default: null },
  withholdingAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceAccount', default: null },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  isSystemDefault: { type: Boolean, default: false },
  createdBy: actorRef,
  updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
financeTaxCodeSchema.index({ organizationId: 1, code: 1 }, { unique: true, name: 'finance_tax_code_tenant_code_unique' })
financeTaxCodeSchema.index({ organizationId: 1, direction: 1, status: 1 }, { name: 'finance_tax_code_tenant_direction_status' })

export const FinanceBankAccount: Model<IFinanceBankAccount> = mongoose.models.FinanceBankAccount || mongoose.model<IFinanceBankAccount>('FinanceBankAccount', financeBankAccountSchema)
export const FinanceVendorBill: Model<IFinanceVendorBill> = mongoose.models.FinanceVendorBill || mongoose.model<IFinanceVendorBill>('FinanceVendorBill', financeVendorBillSchema)
export const FinanceBankTransfer: Model<IFinanceBankTransfer> = mongoose.models.FinanceBankTransfer || mongoose.model<IFinanceBankTransfer>('FinanceBankTransfer', financeBankTransferSchema)
export const FinanceBankStatement: Model<IFinanceBankStatement> = mongoose.models.FinanceBankStatement || mongoose.model<IFinanceBankStatement>('FinanceBankStatement', financeBankStatementSchema)
export const FinanceBankStatementLine: Model<IFinanceBankStatementLine> = mongoose.models.FinanceBankStatementLine || mongoose.model<IFinanceBankStatementLine>('FinanceBankStatementLine', financeBankStatementLineSchema)
export const FinanceReconciliation: Model<IFinanceReconciliation> = mongoose.models.FinanceReconciliation || mongoose.model<IFinanceReconciliation>('FinanceReconciliation', financeReconciliationSchema)
export const FinanceClientDeposit: Model<IFinanceClientDeposit> = mongoose.models.FinanceClientDeposit || mongoose.model<IFinanceClientDeposit>('FinanceClientDeposit', financeClientDepositSchema)
export const FinanceTaxCode: Model<IFinanceTaxCode> = mongoose.models.FinanceTaxCode || mongoose.model<IFinanceTaxCode>('FinanceTaxCode', financeTaxCodeSchema)
