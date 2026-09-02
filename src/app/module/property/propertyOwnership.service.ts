import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { writeAudit } from '../audit/audit.service'
import { DomainEvent } from '../domainEvent/domainEvent.model'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { FinanceAccountingService } from '../finance/financeAccounting.service'
import { FinanceGlIntegrationService } from '../finance/financeGlIntegration.service'
import { FinanceTransaction } from '../finance/finance.model'
import type { FinancePaymentMethod, FinanceTransactionSourceType } from '../finance/finance.interface'
import { TenantReferenceService } from '../../shared/tenantReference.service'
import { Property } from './property.model'
import {
  PropertyInvestment,
  PropertyInvestor,
  PropertyInvestorDistribution,
  PropertyOwnership,
  PropertyOwnershipProfile,
} from './propertyOwnership.model'
import type { PropertyDistributionType, PropertyInvestmentType, PropertyOwnershipModel, PropertyPartyType } from './propertyOwnership.interface'

export type PropertyOwnershipActor = { id: string; role?: string; requestId?: string; ip?: string }

const actorObjectId = (actor: PropertyOwnershipActor) => {
  if (!mongoose.isValidObjectId(actor.id)) throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid authenticated user')
  return new mongoose.Types.ObjectId(actor.id)
}

const objectId = (value: unknown, label: string) => {
  const id = String(value || '').trim()
  if (!mongoose.isValidObjectId(id)) throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${label}`)
  return new mongoose.Types.ObjectId(id)
}

const cleanText = (value: unknown) => String(value || '').trim()
const identityKey = (type: PropertyPartyType, relatedId: unknown, name: unknown) => `${type}:${relatedId ? String(relatedId) : cleanText(name).toLowerCase().replace(/\s+/g, ' ')}`
const withSession = <T>(query: T, session?: ClientSession): T => { if (session && typeof (query as any)?.session === 'function') (query as any).session(session); return query }

const assertProperty = async (organizationId: string, propertyId: string, session?: ClientSession) => {
  const property = await withSession(Property.findOne({ _id: objectId(propertyId, 'property id'), organizationId }).select('_id title propertyType'), session).lean()
  if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  return property
}

const assertOptionalContact = async (organizationId: string, value: unknown) => {
  const id = cleanText(value)
  if (!id) return null
  await TenantReferenceService.assertContactBelongsToOrganization(organizationId, id)
  return objectId(id, 'contact id')
}

const audit = (organizationId: string, actor: PropertyOwnershipActor, action: string, entityType: string, entityId: string, reason: string, metadata: Record<string, unknown> = {}, session?: ClientSession) =>
  writeAudit({ organizationId, actorId: actor.id, actorRole: actor.role || 'tenant', action, entityType, entityId, reason, requestId: actor.requestId, ip: actor.ip, metadata }, session)

const emitPropertyEvent = async (organizationId: string, propertyId: string, actor: PropertyOwnershipActor, eventType: string, summary: string, payload: Record<string, unknown> = {}) => {
  await DomainEventService.emit({ organizationId, aggregateType: 'property', aggregateId: propertyId, eventType, propertyId, actorId: actor.id, requestId: actor.requestId, payload: { summary, ...payload } }).catch(() => undefined)
}

const assertOwnerPercentageTotal = async (organizationId: string, propertyId: string, percentage: number, excludeId?: string, session?: ClientSession) => {
  const where: any = { organizationId, propertyId: objectId(propertyId, 'property id') }
  if (excludeId) where._id = { $ne: objectId(excludeId, 'owner id') }
  const rows: any[] = await withSession(PropertyOwnership.find(where).select('ownershipPercentage'), session).lean()
  const total = rows.reduce((sum, row) => sum + Number(row.ownershipPercentage || 0), 0) + Number(percentage || 0)
  if (total > 100.000001) throw new ApiError(httpStatus.CONFLICT, 'Property owner percentages cannot exceed 100%')
}

const assertInvestorPercentageTotal = async (organizationId: string, propertyId: string, percentage: number | undefined, excludeId?: string, session?: ClientSession) => {
  if (percentage === undefined) return
  const where: any = { organizationId, propertyId: objectId(propertyId, 'property id'), ownershipPercentage: { $ne: null } }
  if (excludeId) where._id = { $ne: objectId(excludeId, 'investor id') }
  const rows: any[] = await withSession(PropertyInvestor.find(where).select('ownershipPercentage'), session).lean()
  const total = rows.reduce((sum, row) => sum + Number(row.ownershipPercentage || 0), 0) + Number(percentage || 0)
  if (total > 100.000001) throw new ApiError(httpStatus.CONFLICT, 'Property investor ownership percentages cannot exceed 100%')
}

const getOwnershipBundle = async (organizationId: string, propertyId: string) => {
  await assertProperty(organizationId, propertyId)
  const propertyObjectId = objectId(propertyId, 'property id')
  const [profile, owners, investors, investments, distributions] = await Promise.all([
    PropertyOwnershipProfile.findOne({ organizationId, propertyId: propertyObjectId }).lean(),
    PropertyOwnership.find({ organizationId, propertyId: propertyObjectId }).sort({ createdAt: 1 }).lean(),
    PropertyInvestor.find({ organizationId, propertyId: propertyObjectId }).sort({ status: 1, createdAt: 1 }).lean(),
    PropertyInvestment.find({ organizationId, propertyId: propertyObjectId }).sort({ transactionDate: -1, createdAt: -1 }).lean(),
    PropertyInvestorDistribution.find({ organizationId, propertyId: propertyObjectId }).sort({ transactionDate: -1, createdAt: -1 }).lean(),
  ])

  const totals = new Map<string, { contributed: number; capitalReturned: number; profitDistributed: number }>()
  const ensure = (id: unknown) => {
    const key = String(id)
    if (!totals.has(key)) totals.set(key, { contributed: 0, capitalReturned: 0, profitDistributed: 0 })
    return totals.get(key)!
  }
  for (const row of investments as any[]) if (row.status !== 'REVERSED') ensure(row.investorId).contributed += Number(row.amount || 0)
  for (const row of distributions as any[]) {
    if (row.status === 'REVERSED') continue
    const total = ensure(row.investorId)
    if (row.distributionType === 'CAPITAL_RETURN') total.capitalReturned += Number(row.amount || 0)
    else total.profitDistributed += Number(row.amount || 0)
  }
  const investorRows = (investors as any[]).map((row) => {
    const total = totals.get(String(row._id)) || { contributed: 0, capitalReturned: 0, profitDistributed: 0 }
    return {
      ...row,
      account: {
        totalContributed: Number(total.contributed.toFixed(2)),
        capitalReturned: Number(total.capitalReturned.toFixed(2)),
        profitDistributed: Number(total.profitDistributed.toFixed(2)),
        totalDistributed: Number((total.capitalReturned + total.profitDistributed).toFixed(2)),
        outstandingCapital: Number(Math.max(0, total.contributed - total.capitalReturned).toFixed(2)),
      },
    }
  })

  return {
    profile: profile || { propertyId, ownershipModel: 'CLIENT_OWNED' as PropertyOwnershipModel, jointVenture: undefined, notes: '' },
    owners,
    investors: investorRows,
    investments,
    distributions,
    summary: {
      ownerPercentage: Number((owners as any[]).reduce((sum, row) => sum + Number(row.ownershipPercentage || 0), 0).toFixed(6)),
      investorOwnershipPercentage: Number(investorRows.reduce((sum, row) => sum + Number(row.ownershipPercentage || 0), 0).toFixed(6)),
      totalContributed: Number(investorRows.reduce((sum, row) => sum + row.account.totalContributed, 0).toFixed(2)),
      totalDistributed: Number(investorRows.reduce((sum, row) => sum + row.account.totalDistributed, 0).toFixed(2)),
      outstandingCapital: Number(investorRows.reduce((sum, row) => sum + row.account.outstandingCapital, 0).toFixed(2)),
    },
  }
}

const updateProfile = async (organizationId: string, propertyId: string, actor: PropertyOwnershipActor, input: Record<string, any>) => {
  await assertProperty(organizationId, propertyId)
  const actorId = actorObjectId(actor)
  const update: any = {
    ownershipModel: input.ownershipModel,
    notes: cleanText(input.notes),
    updatedBy: actorId,
  }
  if (input.ownershipModel === 'JOINT_VENTURE') update.jointVenture = input.jointVenture || {}
  else update.$unset = { jointVenture: 1 }
  const setPayload = { ownershipModel: update.ownershipModel, notes: update.notes, updatedBy: update.updatedBy, ...(input.ownershipModel === 'JOINT_VENTURE' ? { jointVenture: update.jointVenture } : {}) }
  const updateDocument: any = { $set: setPayload, $setOnInsert: { organizationId, propertyId: objectId(propertyId, 'property id'), createdBy: actorId } }
  if (input.ownershipModel !== 'JOINT_VENTURE') updateDocument.$unset = { jointVenture: 1 }
  const row = await PropertyOwnershipProfile.findOneAndUpdate({ organizationId, propertyId: objectId(propertyId, 'property id') }, updateDocument, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true })
  await Promise.all([
    audit(organizationId, actor, 'property.ownership_profile_updated', 'propertyOwnershipProfile', String(row._id), 'Property ownership profile updated', { propertyId, ownershipModel: input.ownershipModel }),
    emitPropertyEvent(organizationId, propertyId, actor, 'property.ownership_profile_updated', `Ownership model changed to ${String(input.ownershipModel).replace(/_/g, ' ')}`, { ownershipModel: input.ownershipModel }),
  ])
  return row
}

const createOwner = async (organizationId: string, propertyId: string, actor: PropertyOwnershipActor, input: Record<string, any>) => {
  await assertProperty(organizationId, propertyId)
  const relatedId = await assertOptionalContact(organizationId, input.ownerId)
  await assertOwnerPercentageTotal(organizationId, propertyId, Number(input.ownershipPercentage))
  const rows = await PropertyOwnership.create([{
    organizationId,
    propertyId: objectId(propertyId, 'property id'),
    ownerType: input.ownerType,
    ownerId: relatedId,
    ownerName: cleanText(input.ownerName),
    identityKey: identityKey(input.ownerType, relatedId, input.ownerName),
    ownershipPercentage: Number(input.ownershipPercentage),
    investedAmount: input.investedAmount,
    acquisitionCost: input.acquisitionCost,
    notes: cleanText(input.notes),
    createdBy: actorObjectId(actor),
  }])
  const row = rows[0]
  await Promise.all([
    audit(organizationId, actor, 'property.owner_created', 'propertyOwnership', String(row._id), 'Property owner added', { propertyId, ownerName: row.ownerName, ownershipPercentage: row.ownershipPercentage }),
    emitPropertyEvent(organizationId, propertyId, actor, 'property.owner_created', `${row.ownerName} added as a ${row.ownershipPercentage}% property owner`, { ownerId: String(row._id) }),
  ])
  return row
}

const updateOwner = async (organizationId: string, propertyId: string, ownerRecordId: string, actor: PropertyOwnershipActor, input: Record<string, any>) => {
  await assertProperty(organizationId, propertyId)
  const row: any = await PropertyOwnership.findOne({ _id: objectId(ownerRecordId, 'owner id'), organizationId, propertyId: objectId(propertyId, 'property id') })
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Property owner not found')
  const nextPercentage = input.ownershipPercentage === undefined ? Number(row.ownershipPercentage) : Number(input.ownershipPercentage)
  await assertOwnerPercentageTotal(organizationId, propertyId, nextPercentage, ownerRecordId)
  const nextType = input.ownerType || row.ownerType
  const nextRelatedId = input.ownerId !== undefined ? await assertOptionalContact(organizationId, input.ownerId) : row.ownerId
  const nextName = input.ownerName !== undefined ? cleanText(input.ownerName) : row.ownerName
  Object.assign(row, input, {
    ownerId: nextRelatedId,
    ownerName: nextName,
    identityKey: identityKey(nextType, nextRelatedId, nextName),
    updatedBy: actorObjectId(actor),
  })
  await row.save()
  await Promise.all([
    audit(organizationId, actor, 'property.owner_updated', 'propertyOwnership', String(row._id), 'Property owner updated', { propertyId, ownerName: row.ownerName, ownershipPercentage: row.ownershipPercentage }),
    emitPropertyEvent(organizationId, propertyId, actor, 'property.owner_updated', `${row.ownerName} ownership details updated`, { ownerId: String(row._id) }),
  ])
  return row
}

const deleteOwner = async (organizationId: string, propertyId: string, ownerRecordId: string, actor: PropertyOwnershipActor) => {
  await assertProperty(organizationId, propertyId)
  const row: any = await PropertyOwnership.findOneAndDelete({ _id: objectId(ownerRecordId, 'owner id'), organizationId, propertyId: objectId(propertyId, 'property id') })
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Property owner not found')
  await Promise.all([
    audit(organizationId, actor, 'property.owner_deleted', 'propertyOwnership', String(row._id), 'Property owner removed', { propertyId, ownerName: row.ownerName }),
    emitPropertyEvent(organizationId, propertyId, actor, 'property.owner_deleted', `${row.ownerName} removed from property ownership`, { ownerId: String(row._id) }),
  ])
  return { _id: row._id, deleted: true }
}

const createInvestor = async (organizationId: string, propertyId: string, actor: PropertyOwnershipActor, input: Record<string, any>) => {
  await assertProperty(organizationId, propertyId)
  const relatedId = await assertOptionalContact(organizationId, input.investorId)
  await assertInvestorPercentageTotal(organizationId, propertyId, input.ownershipPercentage === undefined ? undefined : Number(input.ownershipPercentage))
  const rows = await PropertyInvestor.create([{
    organizationId,
    propertyId: objectId(propertyId, 'property id'),
    investorType: input.investorType,
    investorId: relatedId,
    investorName: cleanText(input.investorName),
    identityKey: identityKey(input.investorType, relatedId, input.investorName),
    ownershipPercentage: input.ownershipPercentage,
    status: input.status || 'ACTIVE',
    notes: cleanText(input.notes),
    createdBy: actorObjectId(actor),
  }])
  const row = rows[0]
  await Promise.all([
    audit(organizationId, actor, 'property.investor_created', 'propertyInvestor', String(row._id), 'Property investor added', { propertyId, investorName: row.investorName }),
    emitPropertyEvent(organizationId, propertyId, actor, 'property.investor_created', `${row.investorName} added as a property investor`, { investorId: String(row._id) }),
  ])
  return row
}

const updateInvestor = async (organizationId: string, propertyId: string, investorRecordId: string, actor: PropertyOwnershipActor, input: Record<string, any>) => {
  await assertProperty(organizationId, propertyId)
  const row: any = await PropertyInvestor.findOne({ _id: objectId(investorRecordId, 'investor id'), organizationId, propertyId: objectId(propertyId, 'property id') })
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Property investor not found')
  const nextPercentage = input.ownershipPercentage === undefined ? row.ownershipPercentage : Number(input.ownershipPercentage)
  await assertInvestorPercentageTotal(organizationId, propertyId, nextPercentage === null ? undefined : nextPercentage, investorRecordId)
  const nextType = input.investorType || row.investorType
  const nextRelatedId = input.investorId !== undefined ? await assertOptionalContact(organizationId, input.investorId) : row.investorId
  const nextName = input.investorName !== undefined ? cleanText(input.investorName) : row.investorName
  Object.assign(row, input, {
    investorId: nextRelatedId,
    investorName: nextName,
    identityKey: identityKey(nextType, nextRelatedId, nextName),
    updatedBy: actorObjectId(actor),
  })
  await row.save()
  await Promise.all([
    audit(organizationId, actor, 'property.investor_updated', 'propertyInvestor', String(row._id), 'Property investor updated', { propertyId, investorName: row.investorName, status: row.status }),
    emitPropertyEvent(organizationId, propertyId, actor, 'property.investor_updated', `${row.investorName} investor details updated`, { investorId: String(row._id) }),
  ])
  return row
}

type MovementInput = {
  amount: number
  transactionDate: Date | string
  paymentMethod: FinancePaymentMethod
  bankAccountId?: string | null
  reference?: string
  notes?: string
}

const investorRecord = async (organizationId: string, propertyId: string, investorId: string, session?: ClientSession) => {
  const row: any = await withSession(PropertyInvestor.findOne({ _id: objectId(investorId, 'investor id'), organizationId, propertyId: objectId(propertyId, 'property id'), status: 'ACTIVE' }), session)
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Active property investor not found')
  return row
}

const capitalOutstanding = async (organizationId: string, propertyId: string, investorId: string, session?: ClientSession) => {
  const [contributions, returns] = await Promise.all([
    withSession(PropertyInvestment.aggregate([
      { $match: { organizationId, propertyId: objectId(propertyId, 'property id'), investorId: objectId(investorId, 'investor id'), status: { $ne: 'REVERSED' } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]), session) as any,
    withSession(PropertyInvestorDistribution.aggregate([
      { $match: { organizationId, propertyId: objectId(propertyId, 'property id'), investorId: objectId(investorId, 'investor id'), distributionType: 'CAPITAL_RETURN', status: { $ne: 'REVERSED' } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]), session) as any,
  ])
  return Number(contributions?.[0]?.total || 0) - Number(returns?.[0]?.total || 0)
}

const createFinanceMovement = async (
  organizationId: string,
  propertyId: string,
  investor: any,
  actor: PropertyOwnershipActor,
  movementId: mongoose.Types.ObjectId,
  input: MovementInput,
  kind: 'CONTRIBUTION' | 'CAPITAL_RETURN' | 'PROFIT_DISTRIBUTION',
  session?: ClientSession,
) => {
  const accountingReady = await FinanceGlIntegrationService.isAutomaticPostingReady(organizationId, session)
  if (input.bankAccountId && !accountingReady) throw new ApiError(httpStatus.FORBIDDEN, 'Finance bank accounts require Advanced Accounting')
  const sourceType: FinanceTransactionSourceType = kind === 'CONTRIBUTION'
    ? 'property_investment_contribution'
    : 'property_investor_distribution'
  const affectsProfit = false
  const description = kind === 'CONTRIBUTION'
    ? `Property investment received from ${investor.investorName}`
    : kind === 'CAPITAL_RETURN'
      ? `Property investor capital returned to ${investor.investorName}`
      : `Property investor profit distributed to ${investor.investorName}`
  const category = kind === 'CONTRIBUTION'
    ? 'Property Investor Contribution'
    : kind === 'CAPITAL_RETURN'
      ? 'Property Investor Capital Return'
      : 'Property Investor Profit Distribution'
  const transactionId = new mongoose.Types.ObjectId()
  const rows = await FinanceTransaction.create([{
    _id: transactionId,
    organizationId,
    type: kind === 'CONTRIBUTION' ? 'income' : 'expense',
    category,
    amount: Number(input.amount),
    currency: 'BDT',
    transactionDate: new Date(input.transactionDate),
    paymentMethod: input.paymentMethod,
    bankAccountId: accountingReady && input.bankAccountId ? objectId(input.bankAccountId, 'bank account id') : null,
    status: 'paid',
    description,
    reference: cleanText(input.reference),
    propertyId: objectId(propertyId, 'property id'),
    sourceType,
    sourceId: movementId,
    affectsProfit,
    accountingVersion: 0,
    createdBy: actorObjectId(actor),
  }], session ? { session } : undefined)
  const transaction: any = rows[0]
  let journal: any = null
  if (accountingReady) {
    journal = await FinanceGlIntegrationService.postPropertyInvestorMovement(organizationId, { id: actor.id, role: actor.role, requestId: actor.requestId, ip: actor.ip }, transaction, kind, session)
    if (journal?._id) {
      transaction.accountingVersion = 1
      transaction.accountingJournalId = journal._id
      await transaction.save({ session })
    }
  }
  return { transaction, journal }
}

const createInvestment = async (organizationId: string, propertyId: string, investorId: string, actor: PropertyOwnershipActor, input: MovementInput & { investmentType: PropertyInvestmentType }) => {
  await assertProperty(organizationId, propertyId)
  const result = await FinanceAccountingService.accountingTransaction(async (session) => {
    const investor = await investorRecord(organizationId, propertyId, investorId, session)
    const movementId = new mongoose.Types.ObjectId()
    const { transaction, journal } = await createFinanceMovement(organizationId, propertyId, investor, actor, movementId, input, 'CONTRIBUTION', session)
    const rows = await PropertyInvestment.create([{
      _id: movementId,
      organizationId,
      propertyId: objectId(propertyId, 'property id'),
      investorId: investor._id,
      investmentType: input.investmentType,
      amount: Number(input.amount),
      currency: 'BDT',
      transactionDate: new Date(input.transactionDate),
      paymentMethod: input.paymentMethod,
      bankAccountId: transaction.bankAccountId || null,
      reference: cleanText(input.reference),
      notes: cleanText(input.notes),
      financeTransactionId: transaction._id,
      accountingJournalId: journal?._id || null,
      createdBy: actorObjectId(actor),
    }], session ? { session } : undefined)
    await audit(organizationId, actor, 'property.investment_received', 'propertyInvestment', String(rows[0]._id), 'Property investor contribution received', { propertyId, investorId, amount: input.amount, financeTransactionId: String(transaction._id), accountingJournalId: journal?._id ? String(journal._id) : null }, session)
    return { investment: rows[0], investorName: investor.investorName }
  })
  await emitPropertyEvent(organizationId, propertyId, actor, 'property.investment_received', `${result.investorName} contributed ৳${Number(input.amount).toLocaleString('en-BD')}`, { investorId, investmentId: String(result.investment._id), amount: Number(input.amount) })
  return result.investment
}

const createDistribution = async (organizationId: string, propertyId: string, investorId: string, actor: PropertyOwnershipActor, input: MovementInput & { distributionType: PropertyDistributionType }) => {
  await assertProperty(organizationId, propertyId)
  const result = await FinanceAccountingService.accountingTransaction(async (session) => {
    const investor = await investorRecord(organizationId, propertyId, investorId, session)
    if (input.distributionType === 'CAPITAL_RETURN') {
      const outstanding = await capitalOutstanding(organizationId, propertyId, investorId, session)
      if (Number(input.amount) > outstanding + 0.000001) throw new ApiError(httpStatus.CONFLICT, 'Capital return cannot exceed the investor’s outstanding contributed capital')
    }
    const movementId = new mongoose.Types.ObjectId()
    const kind = input.distributionType === 'CAPITAL_RETURN' ? 'CAPITAL_RETURN' : 'PROFIT_DISTRIBUTION'
    const { transaction, journal } = await createFinanceMovement(organizationId, propertyId, investor, actor, movementId, input, kind, session)
    const rows = await PropertyInvestorDistribution.create([{
      _id: movementId,
      organizationId,
      propertyId: objectId(propertyId, 'property id'),
      investorId: investor._id,
      distributionType: input.distributionType,
      amount: Number(input.amount),
      currency: 'BDT',
      transactionDate: new Date(input.transactionDate),
      paymentMethod: input.paymentMethod,
      bankAccountId: transaction.bankAccountId || null,
      reference: cleanText(input.reference),
      notes: cleanText(input.notes),
      financeTransactionId: transaction._id,
      accountingJournalId: journal?._id || null,
      createdBy: actorObjectId(actor),
    }], session ? { session } : undefined)
    await audit(organizationId, actor, 'property.investor_distribution_posted', 'propertyInvestorDistribution', String(rows[0]._id), 'Property investor distribution posted', { propertyId, investorId, distributionType: input.distributionType, amount: input.amount, financeTransactionId: String(transaction._id), accountingJournalId: journal?._id ? String(journal._id) : null }, session)
    return { distribution: rows[0], investorName: investor.investorName }
  })
  const label = input.distributionType === 'CAPITAL_RETURN' ? 'capital returned' : 'profit distributed'
  await emitPropertyEvent(organizationId, propertyId, actor, 'property.investor_distribution_posted', `৳${Number(input.amount).toLocaleString('en-BD')} ${label} to ${result.investorName}`, { investorId, distributionId: String(result.distribution._id), amount: Number(input.amount), distributionType: input.distributionType })
  return result.distribution
}

const reverseMovement = async (
  organizationId: string,
  propertyId: string,
  investorId: string,
  movementId: string,
  actor: PropertyOwnershipActor,
  reason: string,
  model: typeof PropertyInvestment | typeof PropertyInvestorDistribution,
  eventType: 'property.investment_reversed' | 'property.investor_distribution_reversed',
) => {
  await assertProperty(organizationId, propertyId)
  const result = await FinanceAccountingService.accountingTransaction(async (session) => {
    await investorRecord(organizationId, propertyId, investorId, session)
    const movement: any = await withSession((model as any).findOne({ _id: objectId(movementId, 'movement id'), organizationId, propertyId: objectId(propertyId, 'property id'), investorId: objectId(investorId, 'investor id') }), session)
    if (!movement) throw new ApiError(httpStatus.NOT_FOUND, 'Property investor movement not found')
    if (movement.status === 'REVERSED') return { movement, alreadyReversed: true }
    const transaction: any = await withSession(FinanceTransaction.findOne({ _id: movement.financeTransactionId, organizationId, sourceId: movement._id, deletedAt: null }), session)
    if (!transaction) throw new ApiError(httpStatus.CONFLICT, 'Linked Finance transaction is missing')
    const accountingReady = await FinanceGlIntegrationService.isAutomaticPostingReady(organizationId, session)
    let reversalJournal: any = null
    if (accountingReady && transaction.accountingJournalId) {
      const reversal = await FinanceGlIntegrationService.reverseLinkedJournal(organizationId, { id: actor.id, role: actor.role, requestId: actor.requestId, ip: actor.ip }, transaction.accountingJournalId, reason, new Date(), session)
      reversalJournal = reversal?.reversal || null
    }
    transaction.status = 'voided'
    transaction.voidedAt = new Date()
    transaction.voidedBy = actorObjectId(actor)
    transaction.voidReason = reason
    transaction.updatedBy = actorObjectId(actor)
    await transaction.save(session ? { session } : undefined)
    movement.status = 'REVERSED'
    movement.reversedAt = new Date()
    movement.reversedBy = actorObjectId(actor)
    movement.reversalReason = reason
    movement.reversalJournalId = reversalJournal?._id || null
    await movement.save(session ? { session } : undefined)
    await audit(organizationId, actor, eventType, model === PropertyInvestment ? 'propertyInvestment' : 'propertyInvestorDistribution', String(movement._id), reason, { propertyId, investorId, financeTransactionId: String(transaction._id), reversalJournalId: reversalJournal?._id ? String(reversalJournal._id) : null }, session)
    return { movement, alreadyReversed: false }
  })
  if (!result.alreadyReversed) await emitPropertyEvent(organizationId, propertyId, actor, eventType, reason, { investorId, movementId })
  return result.movement
}

const reverseInvestment = (organizationId: string, propertyId: string, investorId: string, investmentId: string, actor: PropertyOwnershipActor, reason: string) =>
  reverseMovement(organizationId, propertyId, investorId, investmentId, actor, reason, PropertyInvestment, 'property.investment_reversed')

const reverseDistribution = (organizationId: string, propertyId: string, investorId: string, distributionId: string, actor: PropertyOwnershipActor, reason: string) =>
  reverseMovement(organizationId, propertyId, investorId, distributionId, actor, reason, PropertyInvestorDistribution, 'property.investor_distribution_reversed')

const getActivity = async (organizationId: string, propertyId: string, limit = 50) => {
  await assertProperty(organizationId, propertyId)
  const rows: any[] = await DomainEvent.find({
    organizationId,
    $or: [
      { propertyId: objectId(propertyId, 'property id') },
      { aggregateType: 'property', aggregateId: propertyId },
    ],
  }).populate('actorId', 'name email').sort({ occurredAt: -1, _id: -1 }).limit(Math.min(Math.max(Number(limit) || 50, 1), 100)).lean()
  return rows.map((row) => ({
    _id: String(row._id),
    eventType: row.eventType,
    summary: cleanText(row.payload?.summary) || row.eventType,
    actor: row.actorId && typeof row.actorId === 'object' ? { _id: String(row.actorId._id), name: row.actorId.name || 'User', email: row.actorId.email || '' } : null,
    details: row.payload || {},
    occurredAt: row.occurredAt,
  }))
}

const hasFinancialHistory = async (organizationId: string, propertyId: string) => {
  const propertyObjectId = objectId(propertyId, 'property id')
  const [investments, distributions] = await Promise.all([
    PropertyInvestment.exists({ organizationId, propertyId: propertyObjectId }),
    PropertyInvestorDistribution.exists({ organizationId, propertyId: propertyObjectId }),
  ])
  return Boolean(investments || distributions)
}


const cleanupNonFinancialRecords = async (organizationId: string, propertyId: string) => {
  const propertyObjectId = objectId(propertyId, 'property id')
  if (await hasFinancialHistory(organizationId, propertyId)) {
    throw new ApiError(httpStatus.CONFLICT, 'Property investor financial history must be preserved')
  }
  const [profile, owners, investors] = await Promise.all([
    PropertyOwnershipProfile.deleteMany({ organizationId, propertyId: propertyObjectId }),
    PropertyOwnership.deleteMany({ organizationId, propertyId: propertyObjectId }),
    PropertyInvestor.deleteMany({ organizationId, propertyId: propertyObjectId }),
  ])
  return { profile: profile.deletedCount || 0, owners: owners.deletedCount || 0, investors: investors.deletedCount || 0 }
}

export const PropertyOwnershipService = {
  getOwnershipBundle,
  updateProfile,
  createOwner,
  updateOwner,
  deleteOwner,
  createInvestor,
  updateInvestor,
  createInvestment,
  createDistribution,
  reverseInvestment,
  reverseDistribution,
  getActivity,
  hasFinancialHistory,
  cleanupNonFinancialRecords,
}
