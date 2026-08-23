import type { ClientSession } from 'mongoose'
import { LeadTopupGrant } from './leadTopupGrant.model'

const activeFilter = (now = new Date()) => ({
  effectiveAt: { $lte: now },
  expiresAt: { $gt: now },
  $or: [{ revokedAt: null }, { revokedAt: { $exists: false } }],
})

const getActiveGrantSummary = async (organizationId: string, benefitPeriodId?: unknown, session?: ClientSession) => {
  const match: Record<string, unknown> = { organizationId, ...activeFilter(), ...(benefitPeriodId ? { benefitPeriodId } : {}) }
  const pipeline = LeadTopupGrant.aggregate([
    { $match: match },
    { $group: { _id: null, topupLeadAllowance: { $sum: '$grantedLeads' }, grantCount: { $sum: 1 } } },
  ])
  if (session) pipeline.session(session)
  const rows = await pipeline
  return { topupLeadAllowance: Math.max(0, Number(rows[0]?.topupLeadAllowance || 0)), grantCount: Math.max(0, Number(rows[0]?.grantCount || 0)) }
}

const getActiveGrants = async (organizationId: string, benefitPeriodId?: unknown) => LeadTopupGrant.find({ organizationId, ...activeFilter(), ...(benefitPeriodId ? { benefitPeriodId } : {}) })
  .sort({ effectiveAt: -1, _id: -1 })
  .lean()

export const LeadTopupGrantService = { activeFilter, getActiveGrantSummary, getActiveGrants }
