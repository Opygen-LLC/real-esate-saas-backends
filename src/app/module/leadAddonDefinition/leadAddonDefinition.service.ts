import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { LeadAddonDefinition } from './leadAddonDefinition.model'

const assertEligiblePlansExist = async (planIds: string[]) => {
  const unique = [...new Set(planIds.map((value) => String(value).trim().toLowerCase()))]
  const count = await SubscriptionPlan.countDocuments({ planId: { $in: unique }, isCurrent: true, isActive: true })
  if (count !== unique.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Every eligible plan must reference a current active paid plan family')
  return unique
}

const listEligible = async (planId: string) => LeadAddonDefinition.find({
  isActive: true,
  archivedAt: null,
  eligiblePlans: String(planId).trim().toLowerCase(),
}).sort({ displayOrder: 1, leadCapacity: 1, _id: 1 }).lean()

const listAdmin = async (query: any = {}) => {
  const page = Math.max(1, Number(query.page || 1))
  const limit = Math.min(100, Math.max(1, Number(query.limit || 50)))
  const filter: Record<string, unknown> = {}
  if (query.status === 'active') Object.assign(filter, { isActive: true, archivedAt: null })
  if (query.status === 'archived') Object.assign(filter, { $or: [{ isActive: false }, { archivedAt: { $ne: null } }] })
  if (query.planId) filter.eligiblePlans = String(query.planId).trim().toLowerCase()
  const [rows, total] = await Promise.all([
    LeadAddonDefinition.find(filter).sort({ isActive: -1, displayOrder: 1, leadCapacity: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    LeadAddonDefinition.countDocuments(filter),
  ])
  return { data: rows, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } }
}

const create = async (payload: Record<string, any>, actorId: string) => {
  const eligiblePlans = await assertEligiblePlansExist(payload.eligiblePlans || [])
  try {
    return await LeadAddonDefinition.create({ ...payload, eligiblePlans, currency: 'BDT', createdBy: actorId, updatedBy: actorId })
  } catch (error: any) {
    if (Number(error?.code) === 11000) throw new ApiError(httpStatus.CONFLICT, 'A recurring lead add-on with this slug already exists')
    throw error
  }
}

const update = async (id: string, payload: Record<string, any>, actorId: string) => {
  const row: any = await LeadAddonDefinition.findById(id)
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Recurring lead add-on definition not found')
  if (row.archivedAt) throw new ApiError(httpStatus.CONFLICT, 'Archived recurring lead add-ons cannot be edited')
  if (payload.eligiblePlans) payload.eligiblePlans = await assertEligiblePlansExist(payload.eligiblePlans)
  for (const field of ['name', 'leadCapacity', 'priceMonthly', 'currency', 'eligiblePlans', 'displayOrder', 'isActive'] as const) {
    if (payload[field] !== undefined) row[field] = payload[field]
  }
  row.currency = 'BDT'; row.updatedBy = actorId
  await row.save()
  return row
}

const archive = async (id: string, actorId: string) => {
  const row: any = await LeadAddonDefinition.findById(id)
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Recurring lead add-on definition not found')
  if (row.archivedAt) return row
  row.isActive = false; row.archivedAt = new Date(); row.archivedBy = actorId; row.updatedBy = actorId
  await row.save()
  return row
}

export const LeadAddonDefinitionService = { listEligible, listAdmin, create, update, archive }
