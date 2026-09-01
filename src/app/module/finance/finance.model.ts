import { Schema, model } from 'mongoose'
import {
  IFinanceBudget,
  IFinanceCommission,
  IFinanceInvoice,
  IFinanceTransaction,
  IFinanceVendor,
} from './finance.interface'

const transactionSchema = new Schema<IFinanceTransaction>(
  {
    organizationId: { type: String, required: true, index: true },
    type: { type: String, enum: ['income', 'expense'], required: true, index: true },
    category: { type: String, required: true, trim: true, maxlength: 100, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, enum: ['BDT'], default: 'BDT' },
    transactionDate: { type: Date, required: true, index: true },
    paymentMethod: { type: String, enum: ['cash', 'bank', 'bkash', 'nagad', 'card', 'cheque', 'other'], required: true, index: true },
    status: { type: String, enum: ['pending', 'paid', 'cancelled', 'voided'], default: 'paid', index: true },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    reference: { type: String, trim: true, maxlength: 200, default: '' },
    vendorId: { type: Schema.Types.ObjectId, ref: 'FinanceVendor', index: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    receiptUrl: { type: String, trim: true, maxlength: 2000, default: '' },
    recurring: { type: Boolean, default: false },
    sourceType: { type: String, enum: ['manual', 'invoice_payment', 'commission_payout'], default: 'manual', index: true },
    sourceId: { type: Schema.Types.ObjectId, index: true },
    accountingVersion: { type: Number, default: 0, min: 0 },
    accountingJournalId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', default: null, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    voidedAt: Date,
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    voidReason: { type: String, trim: true, maxlength: 500, default: '' },
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deleteReason: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true },
)
transactionSchema.index({ organizationId: 1, transactionDate: -1, type: 1, status: 1 })
transactionSchema.index({ organizationId: 1, category: 1, transactionDate: -1 })
transactionSchema.index({ organizationId: 1, sourceType: 1, sourceId: 1 })
transactionSchema.index({ organizationId: 1, deletedAt: 1, createdAt: -1 })
transactionSchema.index({ organizationId: 1, deletedAt: 1, createdAt: -1, _id: -1 }, { name: 'finance_transaction_tenant_deleted_created_cursor' })
transactionSchema.index({ organizationId: 1, deletedAt: 1, transactionDate: -1, _id: -1 }, { name: 'finance_transaction_tenant_deleted_date_cursor' })
transactionSchema.index({ organizationId: 1, deletedAt: 1, status: 1, createdAt: -1, _id: -1 }, { name: 'finance_transaction_tenant_deleted_status_created' })
transactionSchema.index({ organizationId: 1, deletedAt: 1, amount: -1, _id: -1 }, { name: 'finance_transaction_tenant_deleted_amount_sort' })
transactionSchema.index({ organizationId: 1, deletedAt: 1, updatedAt: -1, _id: -1 }, { name: 'finance_transaction_tenant_deleted_updated_sort' })
transactionSchema.index({ organizationId: 1, deletedAt: 1, category: 1, _id: 1 }, { name: 'finance_transaction_tenant_deleted_category_sort' })
transactionSchema.index({ organizationId: 1, deletedAt: 1, status: 1, _id: 1 }, { name: 'finance_transaction_tenant_deleted_status_sort' })
transactionSchema.index({ organizationId: 1, deletedAt: 1, paymentMethod: 1, _id: 1 }, { name: 'finance_transaction_tenant_deleted_payment_sort' })

const invoiceLineItemSchema = new Schema(
  {
    description: { type: String, required: true, trim: true, maxlength: 500 },
    quantity: { type: Number, required: true, min: 0.01 },
    unitPrice: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const invoicePaymentSchema = new Schema(
  {
    amount: { type: Number, required: true, min: 0.01 },
    paidAt: { type: Date, required: true },
    paymentMethod: { type: String, enum: ['cash', 'bank', 'bkash', 'nagad', 'card', 'cheque', 'other'], required: true },
    reference: { type: String, trim: true, maxlength: 200, default: '' },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    transactionId: { type: Schema.Types.ObjectId, ref: 'FinanceTransaction' },
    journalEntryId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry' },
  },
  { _id: true },
)

const invoiceSchema = new Schema<IFinanceInvoice>(
  {
    organizationId: { type: String, required: true, index: true },
    invoiceNumber: { type: String, required: true, trim: true },
    clientName: { type: String, required: true, trim: true, maxlength: 160 },
    clientPhone: { type: String, trim: true, maxlength: 40, default: '' },
    clientEmail: { type: String, trim: true, lowercase: true, maxlength: 200, default: '' },
    issueDate: { type: Date, required: true, index: true },
    dueDate: { type: Date, index: true },
    lineItems: { type: [invoiceLineItemSchema], required: true },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    currency: { type: String, enum: ['BDT'], default: 'BDT' },
    status: { type: String, enum: ['draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled'], default: 'draft', index: true },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, trim: true, maxlength: 500, default: '' },
    archivedAt: { type: Date, default: null, index: true },
    archivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    archiveReason: { type: String, trim: true, maxlength: 500, default: '' },
    notes: { type: String, trim: true, maxlength: 3000, default: '' },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    payments: { type: [invoicePaymentSchema], default: [] },
    accountingVersion: { type: Number, default: 0, min: 0 },
    revenueJournalId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', default: null, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)
invoiceSchema.index({ organizationId: 1, invoiceNumber: 1 }, { unique: true })
invoiceSchema.index({ organizationId: 1, status: 1, dueDate: 1 })
invoiceSchema.index({ organizationId: 1, issueDate: -1 })
invoiceSchema.index({ organizationId: 1, archivedAt: 1, createdAt: -1 })
invoiceSchema.index({ organizationId: 1, archivedAt: 1, createdAt: -1, _id: -1 }, { name: 'finance_invoice_tenant_archived_created_cursor' })
invoiceSchema.index({ organizationId: 1, propertyId: 1, createdAt: -1 })

const commissionSchema = new Schema<IFinanceCommission>(
  {
    organizationId: { type: String, required: true, index: true },
    commissionNumber: { type: String, required: true, trim: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    dealReference: { type: String, trim: true, maxlength: 200, default: '' },
    grossDealValue: { type: Number, required: true, min: 0 },
    commissionRate: { type: Number, min: 0, max: 100 },
    agentSplitPercent: { type: Number, min: 0, max: 100 },
    manualOverride: { type: Boolean },
    commissionAmount: { type: Number, required: true, min: 0 },
    agentShare: { type: Number, required: true, min: 0 },
    companyShare: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['BDT'], default: 'BDT' },
    status: { type: String, enum: ['pending', 'approved', 'paid', 'cancelled'], default: 'pending', index: true },
    dueDate: Date,
    paidAt: Date,
    cancelledAt: Date,
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelReason: { type: String, trim: true, maxlength: 500, default: '' },
    archivedAt: { type: Date, default: null, index: true },
    archivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    archiveReason: { type: String, trim: true, maxlength: 500, default: '' },
    paymentMethod: { type: String, enum: ['cash', 'bank', 'bkash', 'nagad', 'card', 'cheque', 'other'] },
    paymentReference: { type: String, trim: true, maxlength: 200, default: '' },
    payoutTransactionId: { type: Schema.Types.ObjectId, ref: 'FinanceTransaction' },
    accountingVersion: { type: Number, default: 0, min: 0 },
    accrualJournalId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', default: null, index: true },
    payoutJournalId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', default: null, index: true },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)
commissionSchema.index({ organizationId: 1, commissionNumber: 1 }, { unique: true })
commissionSchema.index({ organizationId: 1, status: 1, dueDate: 1 })
commissionSchema.index({ organizationId: 1, agentId: 1, createdAt: -1 })
commissionSchema.index({ organizationId: 1, archivedAt: 1, createdAt: -1 })

const vendorSchema = new Schema<IFinanceVendor>(
  {
    organizationId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    category: { type: String, required: true, trim: true, maxlength: 100, index: true },
    phone: { type: String, trim: true, maxlength: 40, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 200, default: '' },
    address: { type: String, trim: true, maxlength: 1000, default: '' },
    taxId: { type: String, trim: true, maxlength: 100, default: '' },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)
vendorSchema.index({ organizationId: 1, name: 1 })
vendorSchema.index({ organizationId: 1, status: 1, category: 1 })

const budgetSchema = new Schema<IFinanceBudget>(
  {
    organizationId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    category: { type: String, required: true, trim: true, maxlength: 100, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, enum: ['BDT'], default: 'BDT' },
    period: { type: String, enum: ['monthly', 'quarterly', 'yearly', 'custom'], required: true },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },
    alertThresholdPercent: { type: Number, default: 80, min: 1, max: 100 },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)
budgetSchema.index({ organizationId: 1, status: 1, startDate: 1, endDate: 1 })
budgetSchema.index({ organizationId: 1, category: 1, startDate: 1, endDate: 1 })

export const FinanceTransaction = model<IFinanceTransaction>('FinanceTransaction', transactionSchema)
export const FinanceInvoice = model<IFinanceInvoice>('FinanceInvoice', invoiceSchema)
export const FinanceCommission = model<IFinanceCommission>('FinanceCommission', commissionSchema)
export const FinanceVendor = model<IFinanceVendor>('FinanceVendor', vendorSchema)
export const FinanceBudget = model<IFinanceBudget>('FinanceBudget', budgetSchema)
