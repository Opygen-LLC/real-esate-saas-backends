import mongoose, { Model, Schema } from 'mongoose'
import type { IFinanceDividend, IFinanceEquityTransaction, IFinanceLoan, IFinanceShareholder, IFinanceShareholderLoan } from './financeCapital.interface'

const actorRef = { type: Schema.Types.ObjectId, ref: 'User', required: true } as const
const optionalActorRef = { type: Schema.Types.ObjectId, ref: 'User', default: null } as const
const safeMinor = { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER } as const
const nonNegativeShares = { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER, default: 0 } as const

const financeShareholderSchema = new Schema<IFinanceShareholder>({
  organizationId: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true, maxlength: 180 },
  type: { type: String, enum: ['INDIVIDUAL', 'COMPANY'], required: true },
  email: { type: String, trim: true, lowercase: true, maxlength: 200, default: '' },
  phone: { type: String, trim: true, maxlength: 80, default: '' },
  shareClass: { type: String, required: true, trim: true, maxlength: 80, default: 'Ordinary' },
  sharesHeld: nonNegativeShares,
  ownershipPercentage: { type: Number, required: true, min: 0, max: 100, default: 0 },
  joinedAt: { type: Date, required: true },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  notes: { type: String, trim: true, maxlength: 2000, default: '' },
  createdBy: actorRef,
  updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
financeShareholderSchema.index({ organizationId: 1, status: 1, name: 1 }, { name: 'finance_shareholder_tenant_status_name' })
financeShareholderSchema.index({ organizationId: 1, email: 1 }, { name: 'finance_shareholder_tenant_email' })

const financeEquityTransactionSchema = new Schema<IFinanceEquityTransaction>({
  organizationId: { type: String, required: true, trim: true },
  transactionNumber: { type: String, required: true, trim: true, maxlength: 80 },
  type: { type: String, enum: ['CAPITAL_CONTRIBUTION','SHARE_ISSUE','SHARE_TRANSFER','SHARE_BUYBACK','CAPITAL_RETURN','OWNER_DRAW','DIVIDEND_DECLARATION','DIVIDEND_PAYMENT'], required: true },
  shareholderId: { type: Schema.Types.ObjectId, ref: 'FinanceShareholder', default: null },
  counterpartyShareholderId: { type: Schema.Types.ObjectId, ref: 'FinanceShareholder', default: null },
  shares: nonNegativeShares,
  amountMinor: safeMinor,
  shareCapitalMinor: safeMinor,
  additionalPaidInCapitalMinor: safeMinor,
  currency: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3 },
  transactionDate: { type: Date, required: true },
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', default: null },
  reference: { type: String, trim: true, maxlength: 200, default: '' },
  notes: { type: String, trim: true, maxlength: 2000, default: '' },
  journalEntryId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', default: null },
  sourceDocumentId: { type: Schema.Types.ObjectId, default: null },
  createdBy: actorRef,
}, { timestamps: true, versionKey: false })
financeEquityTransactionSchema.index({ organizationId: 1, transactionNumber: 1 }, { unique: true, name: 'finance_equity_transaction_tenant_number_unique' })
financeEquityTransactionSchema.index({ organizationId: 1, shareholderId: 1, transactionDate: -1 }, { name: 'finance_equity_transaction_tenant_shareholder_date' })
financeEquityTransactionSchema.index({ organizationId: 1, type: 1, transactionDate: -1 }, { name: 'finance_equity_transaction_tenant_type_date' })

const shareholderLoanPaymentSchema = new Schema({
  paidAt: { type: Date, required: true }, principalMinor: safeMinor, interestMinor: safeMinor,
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', required: true },
  reference: { type: String, trim: true, maxlength: 200, default: '' },
  journalEntryId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', required: true }, recordedBy: actorRef,
}, { _id: true })
const financeShareholderLoanSchema = new Schema<IFinanceShareholderLoan>({
  organizationId: { type: String, required: true, trim: true }, loanNumber: { type: String, required: true, trim: true, maxlength: 80 },
  shareholderId: { type: Schema.Types.ObjectId, ref: 'FinanceShareholder', required: true }, principalMinor: safeMinor, outstandingPrincipalMinor: safeMinor,
  interestRateBasisPoints: { type: Number, required: true, min: 0, max: 100000, default: 0 }, startDate: { type: Date, required: true }, maturityDate: { type: Date, default: null },
  paymentFrequency: { type: String, enum: ['WEEKLY','MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL','OTHER'], required: true, default: 'MONTHLY' },
  currency: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3 },
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', required: true }, liabilityAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceAccount', required: true },
  interestExpenseAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceAccount', required: true }, receiptJournalId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', required: true },
  payments: { type: [shareholderLoanPaymentSchema], default: [] }, status: { type: String, enum: ['DRAFT','ACTIVE','PAID','CANCELLED'], default: 'ACTIVE' },
  reference: { type: String, trim: true, maxlength: 200, default: '' }, notes: { type: String, trim: true, maxlength: 2000, default: '' }, createdBy: actorRef, updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
financeShareholderLoanSchema.index({ organizationId: 1, loanNumber: 1 }, { unique: true, name: 'finance_shareholder_loan_tenant_number_unique' })
financeShareholderLoanSchema.index({ organizationId: 1, shareholderId: 1, status: 1 }, { name: 'finance_shareholder_loan_tenant_shareholder_status' })

const dividendPaymentSchema = new Schema({
  paidAt: { type: Date, required: true }, amountMinor: safeMinor, bankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', required: true },
  reference: { type: String, trim: true, maxlength: 200, default: '' }, journalEntryId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', required: true }, recordedBy: actorRef,
}, { _id: true })
const financeDividendSchema = new Schema<IFinanceDividend>({
  organizationId: { type: String, required: true, trim: true }, dividendNumber: { type: String, required: true, trim: true, maxlength: 80 },
  shareholderId: { type: Schema.Types.ObjectId, ref: 'FinanceShareholder', default: null }, description: { type: String, required: true, trim: true, maxlength: 500 },
  amountMinor: safeMinor, paidMinor: safeMinor, currency: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3 },
  declarationDate: { type: Date, required: true }, paymentDueDate: { type: Date, default: null }, status: { type: String, enum: ['DRAFT','APPROVED','DECLARED','PAID','CANCELLED'], default: 'DRAFT' },
  retainedEarningsAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceAccount', required: true }, dividendPayableAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceAccount', required: true },
  declarationJournalId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', default: null }, payments: { type: [dividendPaymentSchema], default: [] },
  approvedAt: { type: Date, default: null }, approvedBy: optionalActorRef, declaredAt: { type: Date, default: null }, declaredBy: optionalActorRef,
  notes: { type: String, trim: true, maxlength: 2000, default: '' }, createdBy: actorRef, updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
financeDividendSchema.index({ organizationId: 1, dividendNumber: 1 }, { unique: true, name: 'finance_dividend_tenant_number_unique' })
financeDividendSchema.index({ organizationId: 1, status: 1, declarationDate: -1 }, { name: 'finance_dividend_tenant_status_date' })

const loanPaymentSchema = new Schema({
  paidAt: { type: Date, required: true }, principalMinor: safeMinor, interestMinor: safeMinor, feesMinor: safeMinor,
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', required: true }, reference: { type: String, trim: true, maxlength: 200, default: '' },
  journalEntryId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', required: true }, recordedBy: actorRef,
}, { _id: true })
const financeLoanSchema = new Schema<IFinanceLoan>({
  organizationId: { type: String, required: true, trim: true }, loanNumber: { type: String, required: true, trim: true, maxlength: 80 }, lender: { type: String, required: true, trim: true, maxlength: 180 },
  principalMinor: safeMinor, outstandingPrincipalMinor: safeMinor, interestRateBasisPoints: { type: Number, required: true, min: 0, max: 100000, default: 0 },
  startDate: { type: Date, required: true }, maturityDate: { type: Date, default: null }, paymentFrequency: { type: String, enum: ['WEEKLY','MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL','OTHER'], required: true, default: 'MONTHLY' },
  currency: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3 }, bankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', required: true },
  liabilityAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceAccount', required: true }, interestExpenseAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceAccount', required: true },
  receiptJournalId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', required: true }, payments: { type: [loanPaymentSchema], default: [] }, status: { type: String, enum: ['DRAFT','ACTIVE','PAID','CANCELLED'], default: 'ACTIVE' },
  reference: { type: String, trim: true, maxlength: 200, default: '' }, notes: { type: String, trim: true, maxlength: 2000, default: '' }, createdBy: actorRef, updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
financeLoanSchema.index({ organizationId: 1, loanNumber: 1 }, { unique: true, name: 'finance_loan_tenant_number_unique' })
financeLoanSchema.index({ organizationId: 1, status: 1, maturityDate: 1 }, { name: 'finance_loan_tenant_status_maturity' })

export const FinanceShareholder: Model<IFinanceShareholder> = mongoose.models.FinanceShareholder || mongoose.model<IFinanceShareholder>('FinanceShareholder', financeShareholderSchema)
export const FinanceEquityTransaction: Model<IFinanceEquityTransaction> = mongoose.models.FinanceEquityTransaction || mongoose.model<IFinanceEquityTransaction>('FinanceEquityTransaction', financeEquityTransactionSchema)
export const FinanceShareholderLoan: Model<IFinanceShareholderLoan> = mongoose.models.FinanceShareholderLoan || mongoose.model<IFinanceShareholderLoan>('FinanceShareholderLoan', financeShareholderLoanSchema)
export const FinanceDividend: Model<IFinanceDividend> = mongoose.models.FinanceDividend || mongoose.model<IFinanceDividend>('FinanceDividend', financeDividendSchema)
export const FinanceLoan: Model<IFinanceLoan> = mongoose.models.FinanceLoan || mongoose.model<IFinanceLoan>('FinanceLoan', financeLoanSchema)
