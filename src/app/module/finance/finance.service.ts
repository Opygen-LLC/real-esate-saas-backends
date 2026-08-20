import { randomBytes } from 'crypto'
import httpStatus from 'http-status'
import mongoose, { ClientSession } from 'mongoose'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { writeAudit } from '../audit/audit.service'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { Organization } from '../organization/organization.model'
import { User } from '../user/user.model'
import { userRefPopulate } from '../user/userProfile.service'
import {
  IFinanceBudget,
  IFinanceCommission,
  IFinanceInvoice,
  IFinanceInvoiceLineItem,
  IFinanceTransaction,
  IFinanceVendor,
} from './finance.interface'
import {
  FinanceBudget,
  FinanceCommission,
  FinanceInvoice,
  FinanceTransaction,
  FinanceVendor,
} from './finance.model'
import { renderInvoicePdf } from './invoicePdf.service'

const cleanOptionalId = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined
  if (!mongoose.isValidObjectId(value)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid related record id')
  return value
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const asString = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const asDate = (value: unknown, fallback = new Date()) => {
  const parsed = value ? new Date(String(value)) : fallback
  if (Number.isNaN(parsed.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid date')
  return parsed
}
const bdStart = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00+06:00`)
const bdEnd = (value: string) => new Date(`${value.slice(0, 10)}T23:59:59.999+06:00`)
const firstDayOfCurrentMonthBd = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const year = parts.find((item) => item.type === 'year')?.value
  const month = parts.find((item) => item.type === 'month')?.value
  return new Date(`${year}-${month}-01T00:00:00+06:00`)
}
const resolveDateRange = (query: Record<string, unknown>, defaultToCurrentMonth = false) => {
  const startText = asString(query.startDate)
  const endText = asString(query.endDate)
  const startDate = startText ? bdStart(startText) : defaultToCurrentMonth ? firstDayOfCurrentMonthBd() : undefined
  const endDate = endText ? bdEnd(endText) : defaultToCurrentMonth ? new Date() : undefined
  if (startDate && endDate && endDate < startDate) throw new ApiError(httpStatus.BAD_REQUEST, 'End date must be after start date')
  return { startDate, endDate }
}
const dateCondition = (startDate?: Date, endDate?: Date) => ({
  ...(startDate ? { $gte: startDate } : {}),
  ...(endDate ? { $lte: endDate } : {}),
})

const makeNumber = (prefix: string) => `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`
const actorObjectId = (actorId: string) => {
  if (!mongoose.isValidObjectId(actorId)) throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid authenticated user')
  return new mongoose.Types.ObjectId(actorId)
}

const emitFinanceEvent = async (organizationId: string, actorId: string, aggregateType: string, aggregateId: string, eventType: string, summary: string) => {
  await DomainEventService.emit({ organizationId, aggregateType, aggregateId, eventType, actorId, payload: { summary } }).catch(() => undefined)
}

export interface FinanceActorContext {
  id: string
  role?: string
  requestId?: string
  ip?: string
}

const invoiceActorId = (actor: FinanceActorContext) => actor.id
const invoiceAudit = async (organizationId: string, actor: FinanceActorContext, action: string, entityId: string, reason: string, metadata: Record<string, unknown> = {}, session?: ClientSession) => {
  await writeAudit({ organizationId, actorId: actor.id, actorRole: actor.role || 'tenant', action, entityType: 'financeInvoice', entityId, reason, requestId: actor.requestId, ip: actor.ip, metadata }, session)
}

const financeCommercialTransaction = async <T>(work: (session?: ClientSession) => Promise<T>): Promise<T> => {
  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try {
      let value: T | undefined
      await session.withTransaction(async () => { value = await work(session) })
      if (value === undefined) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Finance transaction did not complete')
      return value
    } finally { await session.endSession() }
  }
  if (config.env === 'production') throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Invoice payments require a MongoDB replica set or mongos in production')
  return work()
}

const normalizeTransactionPayload = (payload: Partial<IFinanceTransaction>) => ({
  ...payload,
  vendorId: cleanOptionalId(payload.vendorId),
  propertyId: cleanOptionalId(payload.propertyId),
  leadId: cleanOptionalId(payload.leadId),
  transactionDate: asDate(payload.transactionDate),
})

const createTransaction = async (organizationId: string, actorId: string, payload: Partial<IFinanceTransaction>) => {
  const normalized = normalizeTransactionPayload(payload)
  const result = await FinanceTransaction.create({
    ...normalized,
    organizationId,
    currency: 'BDT',
    sourceType: 'manual',
    createdBy: actorObjectId(actorId),
  })
  await emitFinanceEvent(organizationId, actorId, 'finance_transaction', result._id.toString(), 'finance.transaction.created', `${result.type} transaction created: ${result.description}`)
  return result
}

const listTransactions = async (organizationId: string, query: Record<string, unknown>, pagination: IPaginationOptions): Promise<IGenericResponse<any[]>> => {
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(pagination)
  const { startDate, endDate } = resolveDateRange(query)
  const conditions: any[] = [{ organizationId }]
  const type = asString(query.type); if (type) conditions.push({ type })
  const category = asString(query.category); if (category) conditions.push({ category })
  const status = asString(query.status); if (status) conditions.push({ status })
  const paymentMethod = asString(query.paymentMethod); if (paymentMethod) conditions.push({ paymentMethod })
  const minAmountText = asString(query.minAmount), maxAmountText = asString(query.maxAmount)
  const minAmount = minAmountText ? Number(minAmountText) : undefined, maxAmount = maxAmountText ? Number(maxAmountText) : undefined
  if (minAmount !== undefined && (!Number.isFinite(minAmount) || minAmount < 0)) throw new ApiError(httpStatus.BAD_REQUEST, 'Minimum amount must be a non-negative number')
  if (maxAmount !== undefined && (!Number.isFinite(maxAmount) || maxAmount < 0)) throw new ApiError(httpStatus.BAD_REQUEST, 'Maximum amount must be a non-negative number')
  if (minAmount !== undefined && maxAmount !== undefined && minAmount > maxAmount) throw new ApiError(httpStatus.BAD_REQUEST, 'Maximum amount must be greater than or equal to minimum amount')
  if (minAmount !== undefined || maxAmount !== undefined) conditions.push({ amount: { ...(minAmount !== undefined ? { $gte: minAmount } : {}), ...(maxAmount !== undefined ? { $lte: maxAmount } : {}) } })
  const vendorId = asString(query.vendorId); if (vendorId && mongoose.isValidObjectId(vendorId)) conditions.push({ vendorId })
  if (startDate || endDate) conditions.push({ transactionDate: dateCondition(startDate, endDate) })
  const searchTerm = asString(query.searchTerm)
  if (searchTerm) {
    const regex = escapeRegex(searchTerm)
    conditions.push({ $or: ['description', 'reference', 'category'].map((field) => ({ [field]: { $regex: regex, $options: 'i' } })) })
  }
  const where = { $and: conditions }
  const allowedSort = new Set(['transactionDate', 'amount', 'createdAt', 'updatedAt', 'category', 'status', 'paymentMethod'])
  const safeSortBy = allowedSort.has(sortBy) ? sortBy : 'transactionDate'
  const [data, total] = await Promise.all([
    FinanceTransaction.find(where)
      .populate('vendorId', 'name category')
      .populate('propertyId', 'title')
      .populate('createdBy', 'name email')
      .sort({ [safeSortBy]: sortOrder, createdAt: -1, _id: sortOrder })
      .skip(skip).limit(limit).lean(),
    FinanceTransaction.countDocuments(where),
  ])
  return { meta: { page, limit, total }, data }
}

const updateTransaction = async (organizationId: string, actorId: string, id: string, payload: Partial<IFinanceTransaction>) => {
  const existing: any = await FinanceTransaction.findOne({ _id: id, organizationId })
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Transaction not found')
  if (existing.status === 'voided') throw new ApiError(httpStatus.CONFLICT, 'Voided transactions cannot be changed')
  if (existing.sourceType !== 'manual') throw new ApiError(httpStatus.CONFLICT, 'Linked transactions must be managed from their source record')
  const normalized: any = { ...payload, updatedBy: actorObjectId(actorId) }
  if (payload.transactionDate) normalized.transactionDate = asDate(payload.transactionDate)
  if ('vendorId' in payload) normalized.vendorId = cleanOptionalId(payload.vendorId) || null
  if ('propertyId' in payload) normalized.propertyId = cleanOptionalId(payload.propertyId) || null
  if ('leadId' in payload) normalized.leadId = cleanOptionalId(payload.leadId) || null
  const result = await FinanceTransaction.findOneAndUpdate({ _id: id, organizationId }, normalized, { new: true, runValidators: true })
    .populate('vendorId', 'name category').populate('propertyId', 'title')
  await emitFinanceEvent(organizationId, actorId, 'finance_transaction', id, 'finance.transaction.updated', `Transaction updated: ${result?.description || id}`)
  return result
}

const voidTransaction = async (organizationId: string, actorId: string, id: string, reason: string) => {
  const existing: any = await FinanceTransaction.findOne({ _id: id, organizationId })
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Transaction not found')
  if (existing.status === 'voided') return existing
  if (existing.sourceType !== 'manual') throw new ApiError(httpStatus.CONFLICT, 'Linked transactions must be reversed from their source record')
  existing.status = 'voided'; existing.voidedAt = new Date(); existing.voidedBy = actorObjectId(actorId); existing.voidReason = reason; existing.updatedBy = actorObjectId(actorId)
  await existing.save()
  await emitFinanceEvent(organizationId, actorId, 'finance_transaction', id, 'finance.transaction.voided', `Transaction voided: ${reason}`)
  return existing
}

const calculateInvoiceAmounts = (lineItems: IFinanceInvoiceLineItem[], discount = 0) => {
  const normalized = lineItems.map((item) => {
    const quantity = Number(item.quantity); const unitPrice = Number(item.unitPrice)
    return { description: item.description.trim(), quantity, unitPrice, amount: Number((quantity * unitPrice).toFixed(2)) }
  })
  const subtotal = Number(normalized.reduce((sum, item) => sum + item.amount, 0).toFixed(2))
  const safeDiscount = Number(discount || 0)
  if (safeDiscount > subtotal) throw new ApiError(httpStatus.BAD_REQUEST, 'Discount cannot exceed invoice subtotal')
  return { lineItems: normalized, subtotal, discount: safeDiscount, total: Number((subtotal - safeDiscount).toFixed(2)) }
}

const refreshOverdueInvoices = async (organizationId: string) => {
  await FinanceInvoice.updateMany({
    organizationId,
    status: { $in: ['sent', 'partial'] },
    dueDate: { $lt: new Date() },
    $expr: { $lt: ['$paidAmount', '$total'] },
  }, { $set: { status: 'overdue' } })
}

const invoicePopulate = (query: any) => query
  .populate('propertyId', 'title')
  .populate('leadId', 'name phone email')
  .populate('createdBy', 'name email')
  .populate('updatedBy', 'name email')
  .populate('cancelledBy', 'name email')
  .populate('payments.recordedBy', 'name email')

const validateInvoiceDates = (issueDate: Date, dueDate?: Date | null) => {
  if (dueDate && dueDate.getTime() < issueDate.getTime()) throw new ApiError(httpStatus.BAD_REQUEST, 'Due date cannot be before the issue date')
}

const createInvoice = async (organizationId: string, actor: FinanceActorContext, payload: Partial<IFinanceInvoice>) => {
  const amounts = calculateInvoiceAmounts(payload.lineItems || [], Number(payload.discount || 0))
  const issueDate = asDate(payload.issueDate)
  const dueDate = payload.dueDate ? asDate(payload.dueDate) : undefined
  validateInvoiceDates(issueDate, dueDate)
  const result = await FinanceInvoice.create({
    ...payload,
    ...amounts,
    propertyId: cleanOptionalId(payload.propertyId), leadId: cleanOptionalId(payload.leadId),
    dueDate, issueDate,
    invoiceNumber: makeNumber('INV'),
    paidAmount: 0, payments: [], currency: 'BDT',
    status: payload.status || 'draft',
    organizationId, createdBy: actorObjectId(invoiceActorId(actor)),
  })
  await Promise.all([
    emitFinanceEvent(organizationId, actor.id, 'finance_invoice', result._id.toString(), 'finance.invoice.created', `Invoice ${result.invoiceNumber} created for ${result.clientName}`),
    invoiceAudit(organizationId, actor, 'finance.invoice.created', result._id.toString(), 'Invoice created', { invoiceNumber: result.invoiceNumber, status: result.status, total: result.total, currency: result.currency }),
  ])
  return result
}

const listInvoices = async (organizationId: string, query: Record<string, unknown>, pagination: IPaginationOptions): Promise<IGenericResponse<any[]>> => {
  await refreshOverdueInvoices(organizationId)
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(pagination)
  const { startDate, endDate } = resolveDateRange(query)
  const conditions: any[] = [{ organizationId }, { archivedAt: null }]
  const status = asString(query.status); if (status) conditions.push({ status })
  if (startDate || endDate) conditions.push({ issueDate: dateCondition(startDate, endDate) })
  const searchTerm = asString(query.searchTerm)
  if (searchTerm) { const regex = escapeRegex(searchTerm); conditions.push({ $or: ['invoiceNumber', 'clientName', 'clientEmail', 'clientPhone'].map((field) => ({ [field]: { $regex: regex, $options: 'i' } })) }) }
  const allowedSort = new Set(['issueDate', 'dueDate', 'total', 'paidAmount', 'createdAt', 'updatedAt', 'status'])
  const safeSortBy = allowedSort.has(sortBy) ? sortBy : 'issueDate'
  const where = { $and: conditions }
  const [data, total] = await Promise.all([
    FinanceInvoice.find(where).select('-payments').populate('propertyId', 'title').populate('leadId', 'name phone email').sort({ [safeSortBy]: sortOrder, createdAt: -1, _id: sortOrder }).skip(skip).limit(limit).lean(),
    FinanceInvoice.countDocuments(where),
  ])
  return { meta: { page, limit, total }, data }
}

const getInvoiceById = async (organizationId: string, id: string) => {
  const invoice = await invoicePopulate(FinanceInvoice.findOne({ _id: id, organizationId, archivedAt: null })).lean()
  if (!invoice) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found')
  return invoice
}

const paidInvoiceMetadataFields = new Set(['clientPhone', 'clientEmail', 'notes'])

const updateInvoice = async (organizationId: string, actor: FinanceActorContext, id: string, payload: Partial<IFinanceInvoice>) => {
  const existing: any = await FinanceInvoice.findOne({ _id: id, organizationId, archivedAt: null })
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found')
  if (existing.status === 'cancelled') throw new ApiError(httpStatus.CONFLICT, 'Voided invoices cannot be edited')

  const keys = Object.keys(payload)
  const hasPayment = Number(existing.paidAmount || 0) > 0 || ['partial', 'paid'].includes(existing.status)
  if (hasPayment) {
    const forbidden = keys.filter((key) => !paidInvoiceMetadataFields.has(key))
    if (forbidden.length) throw new ApiError(httpStatus.CONFLICT, `Paid financial records are immutable. Only client phone, client email, and notes may be updated.`)
  }
  if (payload.status === 'draft' && existing.status !== 'draft') throw new ApiError(httpStatus.CONFLICT, 'A sent invoice cannot be reverted to draft')

  const update: any = { ...payload, updatedBy: actorObjectId(actor.id) }
  const amountFieldsChanged = payload.lineItems !== undefined || payload.discount !== undefined
  if (amountFieldsChanged) Object.assign(update, calculateInvoiceAmounts(payload.lineItems || existing.lineItems, Number(payload.discount ?? existing.discount)))
  if (payload.issueDate) update.issueDate = asDate(payload.issueDate)
  if ('dueDate' in payload) update.dueDate = payload.dueDate ? asDate(payload.dueDate) : null
  if ('propertyId' in payload) update.propertyId = cleanOptionalId(payload.propertyId) || null
  if ('leadId' in payload) update.leadId = cleanOptionalId(payload.leadId) || null
  validateInvoiceDates(update.issueDate || existing.issueDate, 'dueDate' in update ? update.dueDate : existing.dueDate)

  const result: any = await invoicePopulate(FinanceInvoice.findOneAndUpdate({ _id: id, organizationId, archivedAt: null }, update, { new: true, runValidators: true }))
  await Promise.all([
    emitFinanceEvent(organizationId, actor.id, 'finance_invoice', id, 'finance.invoice.updated', `Invoice ${result?.invoiceNumber || id} updated`),
    invoiceAudit(organizationId, actor, 'finance.invoice.updated', id, 'Invoice updated', { invoiceNumber: result?.invoiceNumber || id, fields: keys, financialFieldsChanged: amountFieldsChanged }),
  ])
  return result
}

const voidInvoice = async (organizationId: string, actor: FinanceActorContext, id: string, reason: string) => {
  const invoice: any = await FinanceInvoice.findOne({ _id: id, organizationId, archivedAt: null })
  if (!invoice) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found')
  if (invoice.status === 'cancelled') return invoice
  if (invoice.status === 'draft') throw new ApiError(httpStatus.CONFLICT, 'Draft invoices should be archived instead of voided')
  if (Number(invoice.paidAmount || 0) > 0 || ['partial', 'paid'].includes(invoice.status)) throw new ApiError(httpStatus.CONFLICT, 'Paid or partially paid invoices cannot be voided')
  invoice.status = 'cancelled'
  invoice.cancelledAt = new Date()
  invoice.cancelledBy = actorObjectId(actor.id)
  invoice.cancelReason = reason
  invoice.updatedBy = actorObjectId(actor.id)
  await invoice.save()
  await Promise.all([
    emitFinanceEvent(organizationId, actor.id, 'finance_invoice', id, 'finance.invoice.voided', `Invoice ${invoice.invoiceNumber} voided: ${reason}`),
    invoiceAudit(organizationId, actor, 'finance.invoice.voided', id, reason, { invoiceNumber: invoice.invoiceNumber, total: invoice.total }),
  ])
  return invoicePopulate(FinanceInvoice.findById(id)).lean()
}

const archiveDraftInvoice = async (organizationId: string, actor: FinanceActorContext, id: string, reason = 'Draft removed by agency') => {
  const invoice: any = await FinanceInvoice.findOne({ _id: id, organizationId, archivedAt: null })
  if (!invoice) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found')
  if (invoice.status !== 'draft' || Number(invoice.paidAmount || 0) > 0 || invoice.payments?.length) throw new ApiError(httpStatus.CONFLICT, 'Only unpaid draft invoices can be archived')
  invoice.archivedAt = new Date()
  invoice.archivedBy = actorObjectId(actor.id)
  invoice.archiveReason = reason
  invoice.updatedBy = actorObjectId(actor.id)
  await invoice.save()
  await Promise.all([
    emitFinanceEvent(organizationId, actor.id, 'finance_invoice', id, 'finance.invoice.archived', `Draft invoice ${invoice.invoiceNumber} archived`),
    invoiceAudit(organizationId, actor, 'finance.invoice.archived', id, reason, { invoiceNumber: invoice.invoiceNumber }),
  ])
  return { _id: invoice._id, invoiceNumber: invoice.invoiceNumber, archivedAt: invoice.archivedAt }
}

const recordInvoicePayment = async (organizationId: string, actor: FinanceActorContext, id: string, payload: any) => {
  const invoiceNumber = await financeCommercialTransaction(async (session) => {
    const invoiceQuery: any = FinanceInvoice.findOne({ _id: id, organizationId, archivedAt: null })
    if (session) invoiceQuery.session(session)
    const invoice: any = await invoiceQuery
    if (!invoice) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found')
    if (!['sent', 'partial', 'overdue'].includes(invoice.status)) throw new ApiError(httpStatus.CONFLICT, `Cannot record a payment for a ${invoice.status} invoice`)
    const amountPaid = Number(payload.amount)
    const outstanding = Number((invoice.total - invoice.paidAmount).toFixed(2))
    if (amountPaid > outstanding + 0.001) throw new ApiError(httpStatus.BAD_REQUEST, `Payment exceeds the outstanding amount of BDT ${outstanding.toFixed(2)}`)
    const paidAt = asDate(payload.paidAt)
    const transactionDocs: any[] = await FinanceTransaction.create([{ organizationId, type: 'income', category: 'Invoice payment', amount: amountPaid, currency: 'BDT', transactionDate: paidAt, paymentMethod: payload.paymentMethod, status: 'paid', description: `Payment received for ${invoice.invoiceNumber}`, reference: payload.reference || invoice.invoiceNumber, sourceType: 'invoice_payment', sourceId: invoice._id, createdBy: actorObjectId(actor.id) }], session ? { session } : undefined)
    const transaction = transactionDocs[0]
    invoice.payments.push({ amount: amountPaid, paidAt, paymentMethod: payload.paymentMethod, reference: payload.reference || '', notes: payload.notes || '', recordedBy: actorObjectId(actor.id), transactionId: transaction._id })
    invoice.paidAmount = Number((invoice.paidAmount + amountPaid).toFixed(2))
    invoice.status = invoice.paidAmount >= invoice.total ? 'paid' : 'partial'
    invoice.updatedBy = actorObjectId(actor.id)
    await invoice.save(session ? { session } : undefined)
    await invoiceAudit(organizationId, actor, 'finance.invoice.payment_recorded', id, 'Invoice payment recorded', { invoiceNumber: invoice.invoiceNumber, amount: amountPaid, paymentMethod: payload.paymentMethod, reference: payload.reference || '', transactionId: String(transaction._id), status: invoice.status }, session)
    return invoice.invoiceNumber
  })
  await emitFinanceEvent(organizationId, actor.id, 'finance_invoice', id, 'finance.invoice.payment_recorded', `Payment recorded for ${invoiceNumber}`)
  return getInvoiceById(organizationId, id)
}

const renderInvoiceDocument = async (organizationId: string, actor: FinanceActorContext, id: string) => {
  const [invoice, organization]: any[] = await Promise.all([
    getInvoiceById(organizationId, id),
    Organization.findOne({ organizationId }).select('agencyName email phone address city state country primaryColor').lean(),
  ])
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  const pdf = await renderInvoicePdf(invoice, organization)
  await invoiceAudit(organizationId, actor, 'finance.invoice.pdf_downloaded', id, 'Invoice PDF downloaded', { invoiceNumber: invoice.invoiceNumber, status: invoice.status })
  return { pdf, filename: `${invoice.invoiceNumber}.pdf` }
}

const ensureAgent = async (organizationId: string, agentId: string) => {
  const agent = await User.findOne({ _id: agentId, organizationId, status: 'active', userRole: { $in: ['agency_owner', 'agency_admin', 'agent'] } }).select('_id name email')
  if (!agent) throw new ApiError(httpStatus.BAD_REQUEST, 'Selected agent is not an active member of this agency')
  return agent
}

const createCommission = async (organizationId: string, actorId: string, payload: Partial<IFinanceCommission>) => {
  await ensureAgent(organizationId, String(payload.agentId))
  const commissionAmount = Number(payload.commissionAmount || 0), agentShare = Number(payload.agentShare || 0), companyShare = Number(payload.companyShare || 0)
  if (Math.abs((agentShare + companyShare) - commissionAmount) > 0.01) throw new ApiError(httpStatus.BAD_REQUEST, 'Agent share and company share must equal the commission amount')
  const result = await FinanceCommission.create({ ...payload, organizationId, commissionNumber: makeNumber('COM'), propertyId: cleanOptionalId(payload.propertyId), leadId: cleanOptionalId(payload.leadId), dueDate: payload.dueDate ? asDate(payload.dueDate) : undefined, currency: 'BDT', createdBy: actorObjectId(actorId) })
  await emitFinanceEvent(organizationId, actorId, 'finance_commission', result._id.toString(), 'finance.commission.created', `Commission ${result.commissionNumber} created`)
  return result.populate('agentId', 'name email')
}

const listCommissions = async (organizationId: string, query: Record<string, unknown>, pagination: IPaginationOptions): Promise<IGenericResponse<any[]>> => {
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(pagination)
  const { startDate, endDate } = resolveDateRange(query)
  const conditions: any[] = [{ organizationId }]
  const status = asString(query.status); if (status) conditions.push({ status })
  const agentId = asString(query.agentId); if (agentId && mongoose.isValidObjectId(agentId)) conditions.push({ agentId })
  if (startDate || endDate) conditions.push({ createdAt: dateCondition(startDate, endDate) })
  const searchTerm = asString(query.searchTerm); if (searchTerm) { const regex = escapeRegex(searchTerm); conditions.push({ $or: [{ commissionNumber: { $regex: regex, $options: 'i' } }, { dealReference: { $regex: regex, $options: 'i' } }] }) }
  const allowedSort = new Set(['createdAt', 'dueDate', 'commissionAmount', 'agentShare', 'companyShare', 'status'])
  const safeSortBy = allowedSort.has(sortBy) ? sortBy : 'createdAt'
  const where = { $and: conditions }
  const [data, total] = await Promise.all([
    FinanceCommission.find(where).populate(userRefPopulate('agentId', 'name email userRole')).populate('propertyId', 'title').populate('leadId', 'name phone email').sort({ [safeSortBy]: sortOrder, _id: sortOrder }).skip(skip).limit(limit),
    FinanceCommission.countDocuments(where),
  ])
  return { meta: { page, limit, total }, data }
}

const updateCommission = async (organizationId: string, actorId: string, id: string, payload: Partial<IFinanceCommission>) => {
  const existing: any = await FinanceCommission.findOne({ _id: id, organizationId })
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Commission not found')
  if (['paid', 'cancelled'].includes(existing.status)) throw new ApiError(httpStatus.CONFLICT, `${existing.status === 'paid' ? 'Paid' : 'Cancelled'} commissions cannot be edited`)
  if (payload.agentId) await ensureAgent(organizationId, String(payload.agentId))
  const nextAmount = Number(payload.commissionAmount ?? existing.commissionAmount), nextAgent = Number(payload.agentShare ?? existing.agentShare), nextCompany = Number(payload.companyShare ?? existing.companyShare)
  if (Math.abs((nextAgent + nextCompany) - nextAmount) > 0.01) throw new ApiError(httpStatus.BAD_REQUEST, 'Agent share and company share must equal the commission amount')
  const update: any = { ...payload, updatedBy: actorObjectId(actorId) }
  if ('propertyId' in payload) update.propertyId = cleanOptionalId(payload.propertyId) || null
  if ('leadId' in payload) update.leadId = cleanOptionalId(payload.leadId) || null
  if ('dueDate' in payload) update.dueDate = payload.dueDate ? asDate(payload.dueDate) : null
  const result = await FinanceCommission.findOneAndUpdate({ _id: id, organizationId }, update, { new: true, runValidators: true }).populate('agentId', 'name email').populate('propertyId', 'title')
  await emitFinanceEvent(organizationId, actorId, 'finance_commission', id, 'finance.commission.updated', `Commission ${result?.commissionNumber || id} updated`)
  return result
}

const cancelCommission = async (organizationId: string, actorId: string, id: string, reason: string) => {
  const commission: any = await FinanceCommission.findOne({ _id: id, organizationId })
  if (!commission) throw new ApiError(httpStatus.NOT_FOUND, 'Commission not found')
  if (commission.status === 'paid') throw new ApiError(httpStatus.CONFLICT, 'Paid commissions cannot be cancelled')
  if (commission.status === 'cancelled') return commission.populate('agentId', 'name email')
  if (!['pending', 'approved'].includes(commission.status)) throw new ApiError(httpStatus.CONFLICT, `Cannot cancel a ${commission.status} commission`)
  commission.status = 'cancelled'
  commission.cancelledAt = new Date()
  commission.cancelledBy = actorObjectId(actorId)
  commission.cancelReason = reason.trim()
  commission.updatedBy = actorObjectId(actorId)
  await commission.save()
  await emitFinanceEvent(organizationId, actorId, 'finance_commission', id, 'finance.commission.cancelled', `Commission ${commission.commissionNumber} cancelled`)
  return commission.populate('agentId', 'name email')
}

const payCommission = async (organizationId: string, actorId: string, id: string, payload: any) => {
  const commission: any = await FinanceCommission.findOne({ _id: id, organizationId }).populate('agentId', 'name email')
  if (!commission) throw new ApiError(httpStatus.NOT_FOUND, 'Commission not found')
  if (commission.status !== 'approved') throw new ApiError(httpStatus.CONFLICT, 'Only approved commissions can be paid')
  const paidAt = asDate(payload.paidAt)
  let transactionId: mongoose.Types.ObjectId | undefined
  if (commission.agentShare > 0) {
    const transaction: any = await FinanceTransaction.create({ organizationId, type: 'expense', category: 'Agent commission', amount: commission.agentShare, currency: 'BDT', transactionDate: paidAt, paymentMethod: payload.paymentMethod, status: 'paid', description: `Commission payout to ${commission.agentId?.name || 'agent'} (${commission.commissionNumber})`, reference: payload.reference || commission.commissionNumber, sourceType: 'commission_payout', sourceId: commission._id, createdBy: actorObjectId(actorId) })
    transactionId = transaction._id
  }
  commission.status = 'paid'; commission.paidAt = paidAt; commission.paymentMethod = payload.paymentMethod; commission.paymentReference = payload.reference || ''; commission.payoutTransactionId = transactionId; commission.updatedBy = actorObjectId(actorId)
  await commission.save()
  await emitFinanceEvent(organizationId, actorId, 'finance_commission', id, 'finance.commission.paid', `Commission ${commission.commissionNumber} paid`)
  return commission
}

const createVendor = async (organizationId: string, actorId: string, payload: Partial<IFinanceVendor>) => {
  const result = await FinanceVendor.create({ ...payload, organizationId, createdBy: actorObjectId(actorId) })
  await emitFinanceEvent(organizationId, actorId, 'finance_vendor', result._id.toString(), 'finance.vendor.created', `Vendor ${result.name} created`)
  return result
}

const listVendors = async (organizationId: string, query: Record<string, unknown>, pagination: IPaginationOptions): Promise<IGenericResponse<any[]>> => {
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(pagination)
  const conditions: any[] = [{ organizationId }]
  const status = asString(query.status); if (status) conditions.push({ status })
  const categoryValue = asString(query.category); if (categoryValue) conditions.push({ category: categoryValue })
  const searchTerm = asString(query.searchTerm); if (searchTerm) { const regex = escapeRegex(searchTerm); conditions.push({ $or: ['name', 'email', 'phone', 'category'].map((field) => ({ [field]: { $regex: regex, $options: 'i' } })) }) }
  const allowedSort = new Set(['name', 'category', 'createdAt', 'updatedAt', 'status']); const safeSortBy = allowedSort.has(sortBy) ? sortBy : 'name'
  const where = { $and: conditions }
  const [data, total] = await Promise.all([FinanceVendor.find(where).sort({ [safeSortBy]: sortOrder, _id: sortOrder }).skip(skip).limit(limit).lean(), FinanceVendor.countDocuments(where)])
  const ids = data.map((item) => item._id)
  const spend = ids.length ? await FinanceTransaction.aggregate([{ $match: { organizationId, vendorId: { $in: ids }, type: 'expense', status: 'paid' } }, { $group: { _id: '$vendorId', totalSpend: { $sum: '$amount' } } }]) : []
  const spendMap = new Map(spend.map((row) => [String(row._id), row.totalSpend]))
  return { meta: { page, limit, total }, data: data.map((item) => ({ ...item, totalSpend: spendMap.get(String(item._id)) || 0 })) }
}

const updateVendor = async (organizationId: string, actorId: string, id: string, payload: Partial<IFinanceVendor>) => {
  const result = await FinanceVendor.findOneAndUpdate({ _id: id, organizationId }, { ...payload, updatedBy: actorObjectId(actorId) }, { new: true, runValidators: true })
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Vendor not found')
  await emitFinanceEvent(organizationId, actorId, 'finance_vendor', id, 'finance.vendor.updated', `Vendor ${result.name} updated`)
  return result
}
const archiveVendor = (organizationId: string, actorId: string, id: string) => updateVendor(organizationId, actorId, id, { status: 'inactive' })

const createBudget = async (organizationId: string, actorId: string, payload: Partial<IFinanceBudget>) => {
  const startDate = asDate(payload.startDate), endDate = asDate(payload.endDate)
  if (endDate < startDate) throw new ApiError(httpStatus.BAD_REQUEST, 'End date must be after start date')
  const result = await FinanceBudget.create({ ...payload, organizationId, startDate, endDate, currency: 'BDT', createdBy: actorObjectId(actorId) })
  await emitFinanceEvent(organizationId, actorId, 'finance_budget', result._id.toString(), 'finance.budget.created', `Budget ${result.name} created`)
  return result
}

const enrichBudgets = async (organizationId: string, budgets: any[]) => Promise.all(budgets.map(async (budget: any) => {
  const result = await FinanceTransaction.aggregate([{ $match: { organizationId, type: 'expense', status: 'paid', category: budget.category, transactionDate: { $gte: budget.startDate, $lte: budget.endDate } } }, { $group: { _id: null, spent: { $sum: '$amount' } } }])
  const spent = Number(result[0]?.spent || 0); const remaining = Number(Math.max(0, budget.amount - spent).toFixed(2)); const percentage = budget.amount > 0 ? Number(((spent / budget.amount) * 100).toFixed(1)) : 0
  return { ...budget, spent, remaining, percentage, alert: percentage >= budget.alertThresholdPercent }
}))

const listBudgets = async (organizationId: string, query: Record<string, unknown>, pagination: IPaginationOptions): Promise<IGenericResponse<any[]>> => {
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(pagination)
  const conditions: any[] = [{ organizationId }]
  const status = asString(query.status); if (status) conditions.push({ status })
  const categoryValue = asString(query.category); if (categoryValue) conditions.push({ category: categoryValue })
  const period = asString(query.period); if (period) conditions.push({ period })
  const searchTerm = asString(query.searchTerm); if (searchTerm) conditions.push({ name: { $regex: escapeRegex(searchTerm), $options: 'i' } })
  const allowedSort = new Set(['startDate', 'endDate', 'amount', 'name', 'createdAt']); const safeSortBy = allowedSort.has(sortBy) ? sortBy : 'startDate'
  const where = { $and: conditions }
  const [rows, total] = await Promise.all([FinanceBudget.find(where).sort({ [safeSortBy]: sortOrder, _id: sortOrder }).skip(skip).limit(limit).lean(), FinanceBudget.countDocuments(where)])
  return { meta: { page, limit, total }, data: await enrichBudgets(organizationId, rows) }
}

const updateBudget = async (organizationId: string, actorId: string, id: string, payload: Partial<IFinanceBudget>) => {
  const existing: any = await FinanceBudget.findOne({ _id: id, organizationId })
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Budget not found')
  const startDate = payload.startDate ? asDate(payload.startDate) : existing.startDate, endDate = payload.endDate ? asDate(payload.endDate) : existing.endDate
  if (endDate < startDate) throw new ApiError(httpStatus.BAD_REQUEST, 'End date must be after start date')
  const result = await FinanceBudget.findOneAndUpdate({ _id: id, organizationId }, { ...payload, startDate, endDate, updatedBy: actorObjectId(actorId) }, { new: true, runValidators: true }).lean()
  await emitFinanceEvent(organizationId, actorId, 'finance_budget', id, 'finance.budget.updated', `Budget ${result?.name || id} updated`)
  return (await enrichBudgets(organizationId, result ? [result] : []))[0]
}
const archiveBudget = (organizationId: string, actorId: string, id: string) => updateBudget(organizationId, actorId, id, { status: 'archived' })

const aggregateCategory = async (organizationId: string, type: 'income' | 'expense', startDate?: Date, endDate?: Date) => FinanceTransaction.aggregate([
  { $match: { organizationId, type, status: 'paid', ...(startDate || endDate ? { transactionDate: dateCondition(startDate, endDate) } : {}) } },
  { $group: { _id: '$category', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
  { $sort: { amount: -1 } },
  { $limit: 20 },
]).then((rows) => rows.map((row) => ({ category: row._id || 'Uncategorized', amount: row.amount, count: row.count })))

const aggregateTrend = async (organizationId: string, startDate?: Date, endDate?: Date) => FinanceTransaction.aggregate([
  { $match: { organizationId, status: 'paid', ...(startDate || endDate ? { transactionDate: dateCondition(startDate, endDate) } : {}) } },
  { $group: { _id: { year: { $year: { date: '$transactionDate', timezone: 'Asia/Dhaka' } }, month: { $month: { date: '$transactionDate', timezone: 'Asia/Dhaka' } }, type: '$type' }, amount: { $sum: '$amount' } } },
  { $sort: { '_id.year': 1, '_id.month': 1 } },
]).then((rows) => {
  const map = new Map<string, any>()
  for (const row of rows) {
    const month = `${row._id.year}-${String(row._id.month).padStart(2, '0')}`
    if (!map.has(month)) map.set(month, { month, income: 0, expense: 0, profit: 0 })
    map.get(month)[row._id.type] = row.amount
  }
  return [...map.values()].map((item) => ({ ...item, profit: Number((item.income - item.expense).toFixed(2)) }))
})

const getSummary = async (organizationId: string, startDate?: Date, endDate?: Date) => {
  await refreshOverdueInvoices(organizationId)
  const transactionMatch: any = { organizationId, status: 'paid', ...(startDate || endDate ? { transactionDate: dateCondition(startDate, endDate) } : {}) }
  const [totals, invoiceTotals, commissionTotals, activeBudgetCount] = await Promise.all([
    FinanceTransaction.aggregate([{ $match: transactionMatch }, { $group: { _id: '$type', amount: { $sum: '$amount' } } }]),
    FinanceInvoice.aggregate([{ $match: { organizationId, status: { $nin: ['cancelled', 'draft'] } } }, { $group: { _id: null, total: { $sum: '$total' }, paid: { $sum: '$paidAmount' }, overdue: { $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, { $subtract: ['$total', '$paidAmount'] }, 0] } } } }]),
    FinanceCommission.aggregate([{ $match: { organizationId, status: { $in: ['pending', 'approved'] } } }, { $group: { _id: null, payable: { $sum: '$agentShare' }, companyShare: { $sum: '$companyShare' } } }]),
    FinanceBudget.countDocuments({ organizationId, status: 'active', startDate: { $lte: new Date() }, endDate: { $gte: new Date() } }),
  ])
  const income = Number(totals.find((row) => row._id === 'income')?.amount || 0), expense = Number(totals.find((row) => row._id === 'expense')?.amount || 0)
  const invoiced = Number(invoiceTotals[0]?.total || 0), paid = Number(invoiceTotals[0]?.paid || 0)
  return { income, expense, netProfit: Number((income - expense).toFixed(2)), outstandingInvoices: Number(Math.max(0, invoiced - paid).toFixed(2)), overdueInvoices: Number(invoiceTotals[0]?.overdue || 0), commissionsPayable: Number(commissionTotals[0]?.payable || 0), projectedCompanyCommission: Number(commissionTotals[0]?.companyShare || 0), activeBudgets: activeBudgetCount }
}

const getOverview = async (organizationId: string, query: Record<string, unknown>) => {
  const { startDate, endDate } = resolveDateRange(query, true)
  const [summary, monthlyTrend, expenseByCategory, incomeByCategory, recentTransactions, overdueInvoices, activeBudgets] = await Promise.all([
    getSummary(organizationId, startDate, endDate),
    aggregateTrend(organizationId, startDate, endDate),
    aggregateCategory(organizationId, 'expense', startDate, endDate),
    aggregateCategory(organizationId, 'income', startDate, endDate),
    FinanceTransaction.find({ organizationId }).populate('vendorId', 'name').sort({ transactionDate: -1, createdAt: -1 }).limit(8).lean(),
    FinanceInvoice.find({ organizationId, status: 'overdue' }).sort({ dueDate: 1 }).limit(6).lean(),
    FinanceBudget.find({ organizationId, status: 'active', startDate: { $lte: new Date() }, endDate: { $gte: new Date() } }).sort({ endDate: 1 }).limit(8).lean(),
  ])
  return { range: { startDate, endDate }, summary, monthlyTrend, expenseByCategory, incomeByCategory, recentTransactions, overdueInvoices, budgets: await enrichBudgets(organizationId, activeBudgets) }
}

const getReports = async (organizationId: string, query: Record<string, unknown>) => {
  const { startDate, endDate } = resolveDateRange(query, true)
  const [summary, monthlyTrend, expenseByCategory, incomeByCategory, vendorSpendRows, commissionByStatus, paymentMethods, budgetRows] = await Promise.all([
    getSummary(organizationId, startDate, endDate),
    aggregateTrend(organizationId, startDate, endDate),
    aggregateCategory(organizationId, 'expense', startDate, endDate),
    aggregateCategory(organizationId, 'income', startDate, endDate),
    FinanceTransaction.aggregate([{ $match: { organizationId, type: 'expense', status: 'paid', vendorId: { $ne: null }, transactionDate: dateCondition(startDate, endDate) } }, { $group: { _id: '$vendorId', amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }, { $limit: 20 }]),
    FinanceCommission.aggregate([{ $match: { organizationId, ...(startDate || endDate ? { createdAt: dateCondition(startDate, endDate) } : {}) } }, { $group: { _id: '$status', commissionAmount: { $sum: '$commissionAmount' }, agentShare: { $sum: '$agentShare' }, companyShare: { $sum: '$companyShare' }, count: { $sum: 1 } } }]),
    FinanceTransaction.aggregate([{ $match: { organizationId, status: 'paid', ...(startDate || endDate ? { transactionDate: dateCondition(startDate, endDate) } : {}) } }, { $group: { _id: '$paymentMethod', amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
    FinanceBudget.find({ organizationId, status: 'active', ...(startDate || endDate ? { $and: [{ endDate: { $gte: startDate || new Date(0) } }, { startDate: { $lte: endDate || new Date(8640000000000000) } }] } : {}) }).sort({ startDate: 1 }).limit(100).lean(),
  ])
  const vendorIds = vendorSpendRows.map((row) => row._id).filter(Boolean)
  const vendors = vendorIds.length ? await FinanceVendor.find({ organizationId, _id: { $in: vendorIds } }).select('name category').lean() : []
  const vendorMap = new Map<string, any>(vendors.map((vendor: any) => [String(vendor._id), vendor]))
  return {
    range: { startDate, endDate }, summary, monthlyTrend, expenseByCategory, incomeByCategory,
    vendorSpend: vendorSpendRows.map((row) => ({ vendorId: row._id, vendorName: vendorMap.get(String(row._id))?.name || 'Unknown vendor', category: vendorMap.get(String(row._id))?.category || '', amount: row.amount, count: row.count })),
    commissions: commissionByStatus.map((row) => ({ status: row._id, commissionAmount: row.commissionAmount, agentShare: row.agentShare, companyShare: row.companyShare, count: row.count })),
    paymentMethods: paymentMethods.map((row) => ({ method: row._id, amount: row.amount, count: row.count })),
    budgets: await enrichBudgets(organizationId, budgetRows),
  }
}

const exportTransactionsCsv = async (organizationId: string, query: Record<string, unknown>) => {
  const { startDate, endDate } = resolveDateRange(query)
  const match: any = { organizationId }
  const type = asString(query.type); if (type) match.type = type
  const status = asString(query.status); if (status) match.status = status
  if (startDate || endDate) match.transactionDate = dateCondition(startDate, endDate)
  const rows: any[] = await FinanceTransaction.find(match).populate('vendorId', 'name').sort({ transactionDate: -1 }).limit(10_000).lean()
  const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const header = ['Date', 'Type', 'Category', 'Description', 'Amount (BDT)', 'Status', 'Payment Method', 'Vendor', 'Reference']
  const lines = rows.map((row) => [new Date(row.transactionDate).toISOString().slice(0, 10), row.type, row.category, row.description, row.amount, row.status, row.paymentMethod, row.vendorId?.name || '', row.reference || ''].map(quote).join(','))
  return [header.map(quote).join(','), ...lines].join('\n')
}

export const FinanceService = {
  createTransaction, listTransactions, updateTransaction, voidTransaction,
  createInvoice, listInvoices, getInvoiceById, updateInvoice, voidInvoice, archiveDraftInvoice, recordInvoicePayment, renderInvoiceDocument,
  createCommission, listCommissions, updateCommission, cancelCommission, payCommission,
  createVendor, listVendors, updateVendor, archiveVendor,
  createBudget, listBudgets, updateBudget, archiveBudget,
  getOverview, getReports, exportTransactionsCsv,
}
