import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import config from '../../../config'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { calculateChargeFromBaseAmount } from '../billing/pricing'
import { Billing } from '../billing/billing.model'
import { EntitlementService } from '../entitlement/entitlement.service'
import { LeadEntitlementService } from '../lead/leadEntitlement.service'
import { Organization } from '../organization/organization.model'
import { PlatformSettings } from '../platformSettings/platformSettings.model'
import { RealtimeService } from '../realtime/realtime.service'
import { SubscriptionBenefitPeriod } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.model'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { writeAudit } from '../audit/audit.service'
import { LeadAddonDefinition } from '../leadAddonDefinition/leadAddonDefinition.model'
import { LeadAddonSubscription } from './leadAddonSubscription.model'

const activeStatuses = ['active', 'cancel_at_period_end'] as const
const committedStatuses = ['pending_payment', 'active', 'cancel_at_period_end'] as const
const money = (value: number) => Number(Math.max(0, Number(value || 0)).toFixed(2))
const cycleMultiplier = (cycle: 'monthly' | 'yearly') => cycle === 'yearly' ? 12 : 1
const cyclePrice = (priceMonthly: number, cycle: 'monthly' | 'yearly') => money(Number(priceMonthly || 0) * cycleMultiplier(cycle))
const invoiceNumber = () => `ADDON-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`

const loadTax = async (session?: ClientSession) => {
  const query = PlatformSettings.findOne({ key: 'platform' }).select('+tax.binEncrypted').lean()
  if (session) query.session(session)
  const settings: any = await query
  return settings?.tax ? { ...(settings.tax as any), binEncrypted: settings.tax?.binEncrypted || '' } : null
}

const currentPaidContext = async (organizationId: string, now = new Date(), session?: ClientSession) => {
  const orgQuery = Organization.findOne({ organizationId })
  if (session) orgQuery.session(session)
  const organization: any = await orgQuery.lean()
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  const status = String(organization.subscription?.status || '')
  const planId = String(organization.subscription?.plan || 'trial')
  const planVersion = Number(organization.subscription?.planVersion || 1)
  const periodEnd = organization.subscription?.currentPeriodEnd ? new Date(organization.subscription.currentPeriodEnd) : null
  if (planId === 'trial' || !['active', 'cancel_at_period_end'].includes(status) || !periodEnd || periodEnd <= now) {
    throw new ApiError(httpStatus.CONFLICT, 'Recurring lead add-ons require an active paid subscription')
  }
  const planQuery = SubscriptionPlan.findOne({ planId, version: planVersion })
  if (session) planQuery.session(session)
  const plan: any = await planQuery.lean()
  if (!plan) throw new ApiError(httpStatus.CONFLICT, 'Assigned subscription plan version is unavailable')

  const benefitQuery = SubscriptionBenefitPeriod.findOne({ organizationId, planId, planVersion, periodStart: { $lte: now }, periodEnd: { $gt: now }, $or: [{ voidedAt: null }, { voidedAt: { $exists: false } }] }).sort({ periodStart: -1, _id: -1 })
  if (session) benefitQuery.session(session)
  const benefit: any = await benefitQuery.lean()
  let billingCycle: 'monthly' | 'yearly' = benefit?.billingCycle === 'yearly' ? 'yearly' : 'monthly'
  let periodStart = benefit?.periodStart ? new Date(benefit.periodStart) : null
  if (!periodStart) {
    periodStart = organization.subscription?.lastPaymentDate ? new Date(organization.subscription.lastPaymentDate) : new Date(periodEnd)
    if (!organization.subscription?.lastPaymentDate) billingCycle === 'yearly' ? periodStart.setUTCFullYear(periodStart.getUTCFullYear() - 1) : periodStart.setUTCMonth(periodStart.getUTCMonth() - 1)
  }
  if (!periodStart || !Number.isFinite(periodStart.getTime()) || periodStart >= periodEnd) throw new ApiError(httpStatus.CONFLICT, 'Current paid billing period is invalid')
  return { organization, plan, planId, planVersion, status, periodStart, periodEnd, billingCycle }
}

const getActiveSummary = async (organizationId: string, session?: ClientSession, now = new Date()) => {
  const match = { organizationId, status: { $in: [...activeStatuses] }, currentPeriodEnd: { $gt: now } }
  const pipeline = LeadAddonSubscription.aggregate([
    { $match: match },
    { $group: { _id: null, recurringLeadAllowance: { $sum: '$leadCapacity' }, recurringAddonPriceMonthly: { $sum: '$priceMonthly' }, recurringAddonCyclePrice: { $sum: '$cyclePrice' }, count: { $sum: 1 } } },
  ])
  if (session) pipeline.session(session)
  const rows = await pipeline
  return {
    recurringLeadAllowance: Math.max(0, Number(rows[0]?.recurringLeadAllowance || 0)),
    recurringAddonPriceMonthly: money(Number(rows[0]?.recurringAddonPriceMonthly || 0)),
    recurringAddonCyclePrice: money(Number(rows[0]?.recurringAddonCyclePrice || 0)),
    count: Math.max(0, Number(rows[0]?.count || 0)),
  }
}


const getRenewingSummary = async (organizationId: string, billingCycle: 'monthly' | 'yearly', session?: ClientSession, now = new Date()) => {
  const match = { organizationId, status: 'active', cancelAtPeriodEnd: { $ne: true }, currentPeriodEnd: { $gt: now } }
  const pipeline = LeadAddonSubscription.aggregate([
    { $match: match },
    { $group: { _id: null, recurringLeadAllowance: { $sum: '$leadCapacity' }, recurringAddonPriceMonthly: { $sum: '$priceMonthly' }, count: { $sum: 1 } } },
  ])
  if (session) pipeline.session(session)
  const rows = await pipeline
  const priceMonthly = money(Number(rows[0]?.recurringAddonPriceMonthly || 0))
  return {
    recurringLeadAllowance: Math.max(0, Number(rows[0]?.recurringLeadAllowance || 0)),
    recurringAddonPriceMonthly: priceMonthly,
    recurringAddonCyclePrice: cyclePrice(priceMonthly, billingCycle),
    count: Math.max(0, Number(rows[0]?.count || 0)),
  }
}

const assertPlanCeiling = async (organizationId: string, maxRecurringLeadAddon: number, session?: ClientSession) => {
  const summary = await getActiveSummary(organizationId, session)
  const max = Math.max(0, Number(maxRecurringLeadAddon || 0))
  if (summary.recurringLeadAllowance > max) {
    throw new ApiError(httpStatus.CONFLICT, `Your active recurring lead add-ons total ${summary.recurringLeadAllowance.toLocaleString()} leads, but the target plan supports only ${max.toLocaleString()}. Cancel or reduce add-ons before changing to that plan.`)
  }
  return summary
}

const getCommittedCapacity = async (organizationId: string, session?: ClientSession) => {
  const query = LeadAddonSubscription.aggregate([
    { $match: { organizationId, status: { $in: [...committedStatuses] } } },
    { $group: { _id: null, capacity: { $sum: '$leadCapacity' } } },
  ])
  if (session) query.session(session)
  const rows = await query
  return Math.max(0, Number(rows[0]?.capacity || 0))
}

const quote = async (organizationId: string, definitionId: string, now = new Date(), session?: ClientSession) => {
  const context = await currentPaidContext(organizationId, now, session)
  const definitionQuery = LeadAddonDefinition.findOne({ _id: definitionId, isActive: true, archivedAt: null })
  if (session) definitionQuery.session(session)
  const definition: any = await definitionQuery.lean()
  if (!definition) throw new ApiError(httpStatus.NOT_FOUND, 'Selected recurring lead add-on is unavailable')
  if (!Array.isArray(definition.eligiblePlans) || !definition.eligiblePlans.includes(context.planId)) {
    throw new ApiError(httpStatus.CONFLICT, `This recurring lead add-on is not available on the ${context.plan.name || context.planId} plan`)
  }
  const duplicateQuery = LeadAddonSubscription.findOne({ organizationId, definitionId: definition._id, status: { $in: [...committedStatuses] } })
  if (session) duplicateQuery.session(session)
  if (await duplicateQuery.lean()) throw new ApiError(httpStatus.CONFLICT, 'This recurring lead add-on is already active or awaiting payment')

  const maxRecurringLeadAddon = Math.max(0, Number(context.plan.maxRecurringLeadAddon || 0))
  const committed = await getCommittedCapacity(organizationId, session)
  const requested = Math.max(1, Number(definition.leadCapacity || 0))
  if (maxRecurringLeadAddon <= 0 || committed + requested > maxRecurringLeadAddon) {
    throw new ApiError(402, `Your ${context.plan.name || context.planId} plan supports up to ${maxRecurringLeadAddon.toLocaleString()} additional recurring lead capacity. Upgrade your plan to add more leads.`, '', 'LEAD_ADDON_LIMIT_REACHED', {
      resource: 'leads', currentPlan: context.planId, currentAddonCapacity: committed, requestedAddonCapacity: requested, maxRecurringLeadAddon, upgradeRequired: true,
    })
  }

  const totalSeconds = Math.max(1, (context.periodEnd.getTime() - context.periodStart.getTime()) / 1000)
  const remainingSeconds = Math.max(0, Math.min(totalSeconds, (context.periodEnd.getTime() - now.getTime()) / 1000))
  const remainingFraction = Math.max(0, Math.min(1, remainingSeconds / totalSeconds))
  const catalogCyclePrice = cyclePrice(definition.priceMonthly, context.billingCycle)
  const catalogDueNow = money(catalogCyclePrice * remainingFraction)
  const tax = await loadTax(session)
  const due = calculateChargeFromBaseAmount(catalogDueNow, tax)
  const renewal = calculateChargeFromBaseAmount(catalogCyclePrice, tax)
  return {
    version: 1,
    calculatedAt: now,
    organizationId,
    definition: { id: String(definition._id), name: definition.name, slug: definition.slug, leadCapacity: requested, priceMonthly: money(definition.priceMonthly), updatedAt: definition.updatedAt || null },
    plan: { planId: context.planId, planName: context.plan.name || context.planId, planVersion: context.planVersion, billingCycle: context.billingCycle, maxRecurringLeadAddon },
    currentAddonCapacity: committed,
    addonCapacityAfter: committed + requested,
    periodStart: context.periodStart,
    periodEnd: context.periodEnd,
    remainingSeconds: Math.round(remainingSeconds),
    totalPeriodSeconds: Math.round(totalSeconds),
    remainingFraction: Number(remainingFraction.toFixed(6)),
    catalogAmountDueNow: catalogDueNow,
    dueNow: due.amount,
    nextRenewalPrice: renewal.amount,
    cyclePrice: catalogCyclePrice,
    currency: 'BDT' as const,
    taxSnapshot: due.taxSnapshot,
    nextRenewalTaxSnapshot: renewal.taxSnapshot,
  }
}

const createSubscription = async (organizationId: string, requestedBy: string, input: { definitionId: string; quoteCalculatedAt?: string }) => {
  const now = new Date()
  let anchor = now
  if (input.quoteCalculatedAt) {
    const parsed = new Date(input.quoteCalculatedAt)
    if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > now.getTime() + 5_000 || now.getTime() - parsed.getTime() > 10 * 60_000) throw new ApiError(httpStatus.CONFLICT, 'This recurring lead add-on quote has expired. Review a fresh quote before continuing.')
    anchor = parsed
  }
  const snapshot: any = await quote(organizationId, input.definitionId, anchor)
  try {
    const row: any = await LeadAddonSubscription.create({
      organizationId,
      definitionId: snapshot.definition.id,
      definitionName: snapshot.definition.name,
      definitionSlug: snapshot.definition.slug,
      leadCapacity: snapshot.definition.leadCapacity,
      priceMonthly: snapshot.definition.priceMonthly,
      currency: 'BDT',
      planId: snapshot.plan.planId,
      planVersion: snapshot.plan.planVersion,
      billingCycle: snapshot.plan.billingCycle,
      cyclePrice: snapshot.cyclePrice,
      status: 'pending_payment',
      quoteSnapshot: snapshot,
      cancelAtPeriodEnd: false,
      requestedBy,
      requestedAt: now,
    })
    await writeAudit({ organizationId, actorId: requestedBy, actorRole: 'agency_owner', action: 'lead_addon.requested', entityType: 'leadAddonSubscription', entityId: String(row._id), reason: 'Agency requested recurring lead capacity', metadata: { definitionId: snapshot.definition.id, leadCapacity: snapshot.definition.leadCapacity, dueNow: snapshot.dueNow, nextRenewalPrice: snapshot.nextRenewalPrice, periodEnd: snapshot.periodEnd } })
    RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'created', entityId: String(row._id) })
    return row
  } catch (error: any) {
    if (Number(error?.code) === 11000) throw new ApiError(httpStatus.CONFLICT, 'Another recurring lead add-on payment request is already pending. Complete or cancel it before creating a new one.')
    throw error
  }
}


const createAdminSubscriptionRequest = async (
  organizationId: string,
  requestedBy: string,
  input: { definitionId: string; quoteCalculatedAt?: string; reason: string },
) => {
  const now = new Date()
  let anchor = now
  if (input.quoteCalculatedAt) {
    const parsed = new Date(input.quoteCalculatedAt)
    if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > now.getTime() + 5_000 || now.getTime() - parsed.getTime() > 10 * 60_000) throw new ApiError(httpStatus.CONFLICT, 'This recurring lead add-on quote has expired. Review a fresh quote before continuing.')
    anchor = parsed
  }
  const snapshot: any = await quote(organizationId, input.definitionId, anchor)
  try {
    const row: any = await LeadAddonSubscription.create({
      organizationId, definitionId: snapshot.definition.id, definitionName: snapshot.definition.name, definitionSlug: snapshot.definition.slug,
      leadCapacity: snapshot.definition.leadCapacity, priceMonthly: snapshot.definition.priceMonthly, currency: 'BDT', planId: snapshot.plan.planId,
      planVersion: snapshot.plan.planVersion, billingCycle: snapshot.plan.billingCycle, cyclePrice: snapshot.cyclePrice, status: 'pending_payment',
      quoteSnapshot: snapshot, cancelAtPeriodEnd: false, requestedBy, requestedAt: now,
    })
    await writeAudit({ organizationId, actorId: requestedBy, actorRole: 'super-admin', action: 'lead_addon.requested_by_platform_admin', entityType: 'leadAddonSubscription', entityId: String(row._id), reason: input.reason, metadata: { definitionId: snapshot.definition.id, leadCapacity: snapshot.definition.leadCapacity, dueNow: snapshot.dueNow, nextRenewalPrice: snapshot.nextRenewalPrice, periodEnd: snapshot.periodEnd } })
    RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'created', entityId: String(row._id) })
    RealtimeService.emitOrganization(organizationId, { type: 'subscription.changed', action: 'lead_addon_payment_requested', entityId: String(row._id) })
    return row
  } catch (error: any) {
    if (Number(error?.code) === 11000) throw new ApiError(httpStatus.CONFLICT, 'Another recurring lead add-on payment request is already pending. Complete or cancel it before creating a new one.')
    throw error
  }
}

const listTenant = async (organizationId: string) => LeadAddonSubscription.find({ organizationId }).sort({ createdAt: -1, _id: -1 }).lean()

const cancel = async (organizationId: string, id: string, actorId: string) => {
  const row: any = await LeadAddonSubscription.findOne({ _id: id, organizationId })
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Recurring lead add-on subscription not found')
  if (row.status === 'pending_payment') {
    row.status = 'cancelled'; row.cancelledAt = new Date(); row.cancelAtPeriodEnd = false
  } else if (row.status === 'active') {
    row.status = 'cancel_at_period_end'; row.cancelAtPeriodEnd = true
  } else if (row.status === 'cancel_at_period_end') return row
  else throw new ApiError(httpStatus.CONFLICT, 'This recurring lead add-on cannot be cancelled in its current state')
  await row.save()
  await writeAudit({ organizationId, actorId, actorRole: 'agency_owner', action: 'lead_addon.cancel_requested', entityType: 'leadAddonSubscription', entityId: String(row._id), reason: row.status === 'cancel_at_period_end' ? 'Customer scheduled recurring lead add-on cancellation at billing-period end' : 'Customer cancelled recurring lead add-on before payment' })
  return row
}

const listAdmin = async (query: any = {}) => {
  const page = Math.max(1, Number(query.page || 1)); const limit = Math.min(100, Math.max(1, Number(query.limit || 50)))
  const filter: any = {}
  if (query.status && query.status !== 'all') filter.status = query.status
  if (query.organizationId) filter.organizationId = String(query.organizationId).trim()
  const [rows, total] = await Promise.all([
    LeadAddonSubscription.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    LeadAddonSubscription.countDocuments(filter),
  ])
  const ids = [...new Set(rows.map((row: any) => row.organizationId))]
  const orgs: any[] = await Organization.find({ organizationId: { $in: ids } }).select('organizationId agencyName email').lean()
  const map = new Map(orgs.map((org) => [org.organizationId, org]))
  return { data: rows.map((row: any) => ({ ...row, organization: map.get(row.organizationId) || null })), meta: { page, limit, total, totalPages: Math.ceil(total / limit) } }
}

const activateWrites = async (id: string, input: { status: 'active'; method: string; reference?: string; paidAt?: string; reason: string }, actorId: string, session?: ClientSession) => {
  const rowQuery = LeadAddonSubscription.findById(id)
  if (session) rowQuery.session(session)
  const row: any = await rowQuery
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Recurring lead add-on subscription not found')
  if (row.status === 'active' || row.status === 'cancel_at_period_end') return { subscription: row, idempotent: true }
  if (row.status !== 'pending_payment') throw new ApiError(httpStatus.CONFLICT, 'Only recurring lead add-ons awaiting payment can be activated')
  const context = await currentPaidContext(row.organizationId, new Date(), session)
  if (context.planId !== row.planId || context.planVersion !== Number(row.planVersion)) throw new ApiError(httpStatus.CONFLICT, 'The customer changed plans after requesting this add-on. Create a fresh add-on request.')
  const committed = await getCommittedCapacity(row.organizationId, session)
  const max = Math.max(0, Number(context.plan.maxRecurringLeadAddon || 0))
  const otherCommitted = Math.max(0, committed - Number(row.leadCapacity || 0))
  if (otherCommitted + Number(row.leadCapacity || 0) > max) throw new ApiError(httpStatus.CONFLICT, 'The current plan no longer has enough recurring lead add-on capacity for this request')
  const quoted: any = row.quoteSnapshot || {}
  if (quoted.periodEnd && new Date(quoted.periodEnd).getTime() !== context.periodEnd.getTime()) throw new ApiError(httpStatus.CONFLICT, 'The quoted billing period changed. Ask the customer to create a fresh add-on request.')

  const now = input.paidAt ? new Date(input.paidAt) : new Date()
  row.status = 'active'; row.cancelAtPeriodEnd = false; row.currentPeriodStart = now; row.currentPeriodEnd = context.periodEnd
  row.billingCycle = context.billingCycle; row.cyclePrice = cyclePrice(row.priceMonthly, context.billingCycle)
  row.activatedBy = actorId; row.activatedAt = now; row.paymentMethod = input.method; row.paymentReference = input.reference || ''
  const invoice = invoiceNumber(); row.lastPaymentNumber = invoice
  await row.save(session ? { session } : undefined)

  const tax: any = quoted.taxSnapshot || {}
  await Billing.create([{
    organizationId: row.organizationId, invoiceId: invoice, serviceType: 'lead_addon', serviceName: `${row.definitionName} recurring lead add-on`, plan: context.planId, planVersion: context.planVersion,
    billingCycle: context.billingCycle, date: now.toISOString(), amount: Number(quoted.dueNow || 0), currency: 'BDT', paymentId: invoice, transactionId: input.reference || '', paymentMethod: input.method, status: 'paid',
    taxSnapshot: { invoiceEnabled: Boolean(tax.invoiceEnabled), registrationStatus: tax.registrationStatus || 'not_registered', operatorLegalName: tax.operatorLegalName || '', binEncrypted: tax.binEncrypted || '', vatRate: Number(tax.vatRate || 0), pricesIncludeVat: tax.pricesIncludeVat !== false, netAmount: Number(tax.baseAmount ?? quoted.catalogAmountDueNow ?? quoted.dueNow ?? 0), vatAmount: Number(tax.vatAmount || 0) },
  }], session ? { session } : undefined)

  const effective = await EntitlementService.resolve(row.organizationId, session)
  const reconciliation = await LeadEntitlementService.reconcileLeadCapacity(row.organizationId, Number(effective.limits.maxLeads || 0), session, actorId)
  await writeAudit({ organizationId: row.organizationId, actorId, actorRole: 'super-admin', action: 'lead_addon.activated', entityType: 'leadAddonSubscription', entityId: String(row._id), reason: input.reason, metadata: { leadCapacity: row.leadCapacity, amount: quoted.dueNow, nextRenewalPrice: quoted.nextRenewalPrice, billingCycle: row.billingCycle, currentPeriodEnd: row.currentPeriodEnd } }, session)
  RealtimeService.emitOrganization(row.organizationId, { type: 'subscription.changed', action: 'lead_addon_activated', entityId: String(row._id), payload: { leadCapacity: row.leadCapacity, currentPeriodEnd: row.currentPeriodEnd } })
  RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'updated', entityId: String(row._id) })
  return { subscription: row, reconciliation, idempotent: false }
}

const decide = async (id: string, input: any, actorId: string) => {
  if (input.status === 'rejected') {
    const row: any = await LeadAddonSubscription.findById(id)
    if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Recurring lead add-on subscription not found')
    if (row.status === 'rejected') return { subscription: row, idempotent: true }
    if (row.status !== 'pending_payment') throw new ApiError(httpStatus.CONFLICT, 'Only recurring lead add-ons awaiting payment can be rejected')
    row.status = 'rejected'; row.rejectedBy = actorId; row.rejectedAt = new Date(); row.rejectionReason = input.reason
    await row.save()
    await writeAudit({ organizationId: row.organizationId, actorId, actorRole: 'super-admin', action: 'lead_addon.rejected', entityType: 'leadAddonSubscription', entityId: String(row._id), reason: input.reason })
    RealtimeService.emitOrganization(row.organizationId, { type: 'subscription.changed', action: 'lead_addon_rejected', entityId: String(row._id) })
    RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'updated', entityId: String(row._id) })
    return { subscription: row, idempotent: false }
  }
  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession(); let result: any
    try { await session.withTransaction(async () => { result = await activateWrites(id, input, actorId, session) }); return result } finally { await session.endSession() }
  }
  if (config.env === 'production') throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Recurring lead add-on activation requires a MongoDB replica set or mongos in production')
  return activateWrites(id, input, actorId)
}

const renewForSubscriptionPeriod = async (organizationId: string, periodStart: Date, periodEnd: Date, billingCycle: 'monthly' | 'yearly', paymentNumber: string, targetPlanId: string, targetPlanVersion: number, session?: ClientSession) => {
  const rowsQuery = LeadAddonSubscription.find({ organizationId, status: { $in: [...activeStatuses] }, currentPeriodEnd: { $lte: periodStart } })
  if (session) rowsQuery.session(session)
  const rows: any[] = await rowsQuery
  let renewed = 0; let cancelled = 0
  for (const row of rows) {
    if (row.status === 'cancel_at_period_end' || row.cancelAtPeriodEnd) {
      row.status = 'cancelled'; row.cancelAtPeriodEnd = false; row.cancelledAt = periodStart; cancelled += 1
    } else {
      row.currentPeriodStart = periodStart; row.currentPeriodEnd = periodEnd; row.billingCycle = billingCycle; row.cyclePrice = cyclePrice(row.priceMonthly, billingCycle); row.lastPaymentNumber = paymentNumber; row.planId = targetPlanId; row.planVersion = targetPlanVersion; renewed += 1
    }
    await row.save(session ? { session } : undefined)
  }
  return { renewed, cancelled }
}

const applyDueLifecycle = async (limit = 100, now = new Date()) => {
  const rows: any[] = await LeadAddonSubscription.find({ status: { $in: [...activeStatuses] }, currentPeriodEnd: { $lte: now } }).sort({ currentPeriodEnd: 1, _id: 1 }).limit(limit)
  let cancelled = 0; let paymentFailed = 0
  const touched = new Set<string>()
  for (const row of rows) {
    touched.add(row.organizationId)
    if (row.status === 'cancel_at_period_end' || row.cancelAtPeriodEnd) { row.status = 'cancelled'; row.cancelAtPeriodEnd = false; row.cancelledAt = row.currentPeriodEnd || now; cancelled += 1 }
    else { row.status = 'payment_failed'; paymentFailed += 1 }
    await row.save()
  }
  for (const organizationId of touched) {
    try {
      const effective = await EntitlementService.resolve(organizationId)
      const result = await LeadEntitlementService.reconcileLeadCapacity(organizationId, Number(effective.limits.maxLeads || 0))
      await LeadEntitlementService.publishCapacityChange(organizationId, result)
      RealtimeService.emitOrganization(organizationId, { type: 'subscription.changed', action: 'lead_addon_period_ended', entityId: organizationId })
    } catch { /* subscription may also be inactive; next request-time reconciliation remains authoritative */ }
  }
  return { processed: rows.length, cancelled, paymentFailed }
}

export const LeadAddonSubscriptionService = { quote, createSubscription, createAdminSubscriptionRequest, listTenant, cancel, listAdmin, decide, getActiveSummary, getRenewingSummary, assertPlanCeiling, getCommittedCapacity, renewForSubscriptionPeriod, applyDueLifecycle, cyclePrice }
