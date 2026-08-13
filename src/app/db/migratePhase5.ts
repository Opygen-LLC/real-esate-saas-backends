import mongoose from 'mongoose'
import config from '../../config'

const SLA_HOURS: Record<string, { firstResponse: number; resolution: number }> = {
  urgent: { firstResponse: 1, resolution: 8 },
  high: { firstResponse: 4, resolution: 24 },
  medium: { firstResponse: 8, resolution: 48 },
  low: { firstResponse: 24, resolution: 96 },
}

const addHours = (value: Date, hours: number) => new Date(value.getTime() + hours * 60 * 60 * 1000)

const run = async () => {
  await mongoose.connect(config.database_string, { autoIndex: false })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')
  const now = new Date()

  const plans = db.collection('subscriptionplans')
  const organizations = db.collection('organizations')
  const billings = db.collection('billings')
  const payments = db.collection('bkashpayments')
  const support = db.collection('supporttickets')

  // Legacy Phase 1/2 catalogs used a unique planId index. Versioned commercial
  // plans require uniqueness on {planId, version} instead.
  const planIndexes = await plans.indexes().catch(() => [] as any[])
  for (const index of planIndexes as any[]) {
    const keys = index.key || {}
    if (index.unique && Object.keys(keys).length === 1 && keys.planId === 1) {
      await plans.dropIndex(index.name)
    }
  }

  const existingPlans = await plans.find({}).sort({ createdAt: 1 }).toArray()
  const latestByPlan = new Map<string, any>()
  for (const plan of existingPlans) {
    const planId = String(plan.planId || '')
    if (!planId) continue
    const latest = latestByPlan.get(planId)
    if (!latest || Number(plan.version || 1) >= Number(latest.version || 1)) latestByPlan.set(planId, plan)
    await plans.updateOne({ _id: plan._id }, { $set: {
      version: Number(plan.version || 1),
      currency: 'BDT',
      effectiveFrom: plan.effectiveFrom || plan.createdAt || now,
      effectiveTo: plan.effectiveTo ?? null,
      grandfatherExisting: plan.grandfatherExisting ?? true,
      migrationAppliedAt: plan.migrationAppliedAt || now,
      changeReason: plan.changeReason || 'Phase 5 versioned commercial plan migration',
      createdBy: plan.createdBy || 'phase5-migration',
    } })
  }
  for (const [planId, latest] of latestByPlan) {
    await plans.updateMany({ planId }, { $set: { isCurrent: false } })
    await plans.updateOne({ _id: latest._id }, { $set: { isCurrent: true } })
  }
  await plans.createIndex({ planId: 1, version: 1 }, { name: 'planId_1_version_1', unique: true })
  await plans.createIndex({ planId: 1, isCurrent: 1 }, { name: 'planId_1_isCurrent_1', unique: true, partialFilterExpression: { isCurrent: true } })
  await plans.createIndex({ isActive: 1, effectiveFrom: 1, effectiveTo: 1 }, { name: 'isActive_1_effectiveFrom_1_effectiveTo_1' })

  const planVersionRows = await plans.find({}).project({ planId: 1, version: 1, maxLeads: 1 }).toArray()
  const versionMap = new Map(planVersionRows.map((row: any) => [`${row.planId}:${row.version || 1}`, row]))

  const orgRows = await organizations.find({}).project({ organizationId: 1, agencyName: 1, subscription: 1, isBlocked: 1, platformAccess: 1, updatedAt: 1 }).toArray()
  for (const org of orgRows) {
    const planId = org.subscription?.plan
    const currentPlan = latestByPlan.get(planId)
    const planVersion = Number(org.subscription?.planVersion || currentPlan?.version || 1)
    const set: Record<string, unknown> = { 'subscription.planVersion': planVersion }
    if (org.isBlocked) {
      set['platformAccess.status'] = 'suspended'
      set['platformAccess.suspendedAt'] = org.platformAccess?.suspendedAt || org.updatedAt || now
      set['platformAccess.suspendedBy'] = org.platformAccess?.suspendedBy || 'phase5-migration'
      set['platformAccess.suspensionReason'] = org.platformAccess?.suspensionReason || 'Legacy blocked tenant migrated to safe suspension state'
      set['platformAccess.previousSubscriptionStatus'] = org.platformAccess?.previousSubscriptionStatus || (org.subscription?.status === 'suspended' ? (planId === 'trial' ? 'trialing' : 'active') : org.subscription?.status || 'active')
      set['subscription.status'] = 'suspended'
    } else {
      set['platformAccess.status'] = 'active'
    }
    await organizations.updateOne({ _id: org._id }, { $set: set })
  }

  const billingRows = await billings.find({ serviceType: 'subscription', $or: [{ planVersion: { $exists: false } }, { planVersion: null }] }).project({ _id: 1, plan: 1, organizationId: 1 }).toArray()
  for (const billing of billingRows) {
    const org = orgRows.find((item: any) => item.organizationId === billing.organizationId)
    const version = Number(org?.subscription?.planVersion || latestByPlan.get(billing.plan)?.version || 1)
    await billings.updateOne({ _id: billing._id }, { $set: { planVersion: version, currency: 'BDT' } })
  }

  const paymentRows = await payments.find({}).project({ _id: 1, planId: 1, planVersion: 1, maxLeads: 1 }).toArray()
  for (const payment of paymentRows) {
    const version = Number(payment.planVersion || latestByPlan.get(payment.planId)?.version || 1)
    const plan = versionMap.get(`${payment.planId}:${version}`) || latestByPlan.get(payment.planId)
    const set: Record<string, unknown> = {}
    if (!payment.planVersion) set.planVersion = version
    if (payment.maxLeads === undefined || payment.maxLeads === null) set.maxLeads = Number(plan?.maxLeads || 500)
    if (Object.keys(set).length) await payments.updateOne({ _id: payment._id }, { $set: set })
  }

  const tickets = await support.find({ $or: [{ firstResponseDueAt: { $exists: false } }, { resolutionDueAt: { $exists: false } }] }).toArray()
  for (const ticket of tickets) {
    const createdAt = new Date(ticket.createdAt || now)
    const sla = SLA_HOURS[String(ticket.priority || 'medium')] || SLA_HOURS.medium
    const set: Record<string, unknown> = {
      firstResponseDueAt: ticket.firstResponseDueAt || addHours(createdAt, sla.firstResponse),
      resolutionDueAt: ticket.resolutionDueAt || addHours(createdAt, sla.resolution),
      firstRespondedAt: ticket.firstRespondedAt ?? null,
      resolvedAt: ticket.resolvedAt ?? (['resolved', 'closed'].includes(ticket.status) ? ticket.updatedAt || now : null),
      slaBreachedAt: ticket.slaBreachedAt ?? null,
      internalNotes: ticket.internalNotes || [],
      attachments: ticket.attachments || [],
    }
    if (!ticket.organizationName && ticket.organizationId) {
      const org = orgRows.find((row: any) => row.organizationId === ticket.organizationId) as any
      if (org?.agencyName) set.organizationName = org.agencyName
    }
    await support.updateOne({ _id: ticket._id }, { $set: set })
  }
  await support.createIndex({ status: 1, priority: 1, firstResponseDueAt: 1 }, { name: 'status_1_priority_1_firstResponseDueAt_1' })
  await support.createIndex({ ownerId: 1, status: 1, updatedAt: -1 }, { name: 'ownerId_1_status_1_updatedAt_-1' })

  await organizations.createIndex({ isBlocked: 1, 'subscription.status': 1, createdAt: -1 }, { name: 'isBlocked_1_subscription.status_1_createdAt_-1' })
  await payments.createIndex({ paymentId: 1 }, { name: 'paymentId_1', background: true }).catch(() => undefined)
  await payments.createIndex({ transactionId: 1 }, { name: 'transactionId_1', sparse: true }).catch(() => undefined)
  await payments.createIndex({ invoiceNumber: 1 }, { name: 'invoiceNumber_1', background: true }).catch(() => undefined)

  console.log(`Phase 5 migration completed: ${existingPlans.length} plan versions normalized, ${orgRows.length} tenant access records migrated, ${tickets.length} support tickets received SLA fields.`)
  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
