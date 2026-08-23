import httpStatus from 'http-status'
import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { LeadTopupPricing } from './leadTopupPricing.model'
import type { LeadTopupQuote } from './leadTopupPricing.interface'

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

const validatePersistedShape = (input: Record<string, any>) => {
  if (input.pricingMode === 'rate') {
    if (Number(input.leadsPerUnit || 0) < 1 || Number(input.pricePerUnit || 0) <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Rate pricing requires a positive lead quantity unit and price')
    }
    input.packageLeads = null
    input.packagePrice = null
  } else if (input.pricingMode === 'package') {
    if (Number(input.packageLeads || 0) < 1 || Number(input.packagePrice || 0) <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Package pricing requires a positive lead quantity and price')
    }
    input.leadsPerUnit = null
    input.pricePerUnit = null
  } else throw new ApiError(httpStatus.BAD_REQUEST, 'Unsupported lead top-up pricing mode')
}

const getActivePricing = async () => LeadTopupPricing.find({ isActive: true, archivedAt: null })
  .sort({ displayOrder: 1, pricingMode: 1, createdAt: 1, _id: 1 })
  .lean()

const getAdminPricing = async (query: any = {}) => {
  const page = Math.max(1, Number(query.page || 1))
  const limit = Math.min(100, Math.max(1, Number(query.limit || 50)))
  const filter: Record<string, unknown> = {}
  if (query.status === 'active') Object.assign(filter, { isActive: true, archivedAt: null })
  if (query.status === 'archived') Object.assign(filter, { $or: [{ isActive: false }, { archivedAt: { $ne: null } }] })
  if (query.pricingMode) filter.pricingMode = String(query.pricingMode)
  const [rows, total] = await Promise.all([
    LeadTopupPricing.find(filter).sort({ isActive: -1, displayOrder: 1, createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    LeadTopupPricing.countDocuments(filter),
  ])
  return { data: rows, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } }
}

const createPricing = async (payload: Record<string, any>, actorId: string) => {
  const normalized = { ...payload, currency: 'BDT', createdBy: actorId, updatedBy: actorId }
  validatePersistedShape(normalized)
  return LeadTopupPricing.create(normalized)
}

const updatePricing = async (id: string, payload: Record<string, any>, actorId: string) => {
  const rule: any = await LeadTopupPricing.findById(id)
  if (!rule) throw new ApiError(httpStatus.NOT_FOUND, 'Lead top-up pricing rule not found')
  if (rule.archivedAt) throw new ApiError(httpStatus.CONFLICT, 'Archived lead top-up pricing cannot be edited')
  const merged = { ...rule.toObject(), ...payload, currency: 'BDT', updatedBy: actorId }
  validatePersistedShape(merged)
  const mutableFields = ['name', 'pricingMode', 'leadsPerUnit', 'pricePerUnit', 'packageLeads', 'packagePrice', 'currency', 'displayOrder', 'isActive', 'updatedBy'] as const
  for (const field of mutableFields) rule[field] = merged[field]
  await rule.save()
  return rule
}

const archivePricing = async (id: string, actorId: string) => {
  const rule: any = await LeadTopupPricing.findById(id)
  if (!rule) throw new ApiError(httpStatus.NOT_FOUND, 'Lead top-up pricing rule not found')
  if (rule.archivedAt) return rule
  rule.isActive = false
  rule.archivedAt = new Date()
  rule.archivedBy = actorId
  rule.updatedBy = actorId
  await rule.save()
  return rule
}

const quote = async (pricingRuleId: string, requestedLeadsInput: number, session?: ClientSession): Promise<LeadTopupQuote> => {
  const requestedLeads = Math.max(1, Math.trunc(Number(requestedLeadsInput || 0)))
  const query = LeadTopupPricing.findOne({ _id: pricingRuleId, isActive: true, archivedAt: null })
  if (session) query.session(session)
  const rule: any = await query.lean()
  if (!rule) throw new ApiError(httpStatus.NOT_FOUND, 'Selected lead top-up pricing is unavailable')

  let totalAmount = 0
  let leadsPerUnit: number | null = null
  let pricePerUnit: number | null = null
  if (rule.pricingMode === 'package') {
    if (requestedLeads !== Number(rule.packageLeads || 0)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `This package contains exactly ${Number(rule.packageLeads || 0).toLocaleString()} leads`)
    }
    totalAmount = Number(rule.packagePrice || 0)
  } else {
    leadsPerUnit = Math.max(1, Number(rule.leadsPerUnit || 1))
    pricePerUnit = Number(rule.pricePerUnit || 0)
    totalAmount = roundMoney((requestedLeads / leadsPerUnit) * pricePerUnit)
  }
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) throw new ApiError(httpStatus.CONFLICT, 'Lead top-up pricing is invalid')

  return {
    pricingRuleId: String(rule._id),
    pricingMode: rule.pricingMode,
    pricingName: rule.name,
    requestedLeads,
    leadsPerUnit,
    pricePerUnit,
    totalAmount,
    currency: 'BDT',
  }
}

export const LeadTopupPricingService = { getActivePricing, getAdminPricing, createPricing, updatePricing, archivePricing, quote }
