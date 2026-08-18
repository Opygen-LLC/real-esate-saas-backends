import ApiError from '../../../errors/ApiError'
import { Lead } from '../lead/lead.model'
import { User } from '../user/user.model'
import { CrmConfig, LeadAssignmentAudit } from './crm.model'
import { EntitlementService } from '../entitlement/entitlement.service'
import {
  DEFAULT_LEAD_PIPELINE_STAGES,
  LEAD_CLOSED_STATUSES,
  normalizeLeadStatus,
} from '../lead/leadStatus.contract'

const canonicalizePipelineStages = (stages: any[] = [], rejectUnknown = false) => {
  const existingByKey = new Map<string, any>()
  for (const stage of stages) {
    const normalizedKey = normalizeLeadStatus(stage?.key)
    if (!normalizedKey) {
      if (rejectUnknown) throw new ApiError(400, `Unsupported lead pipeline stage: ${String(stage?.key || '')}`)
      continue
    }
    if (!existingByKey.has(normalizedKey)) existingByKey.set(normalizedKey, stage)
  }

  return DEFAULT_LEAD_PIPELINE_STAGES.map((canonical) => {
    const existing = existingByKey.get(canonical.key)
    return {
      ...canonical,
      ...(existing?.color ? { color: existing.color } : {}),
    }
  })
}


const getConfig = async (organizationId: string) => {
  let config = await CrmConfig.findOne({ organizationId }).populate('assignment.eligibleAgentIds', 'name email userRole status').populate('assignment.territoryRules.agentIds', 'name email userRole status')
  if (!config) return CrmConfig.create({ organizationId, pipelineStages: DEFAULT_LEAD_PIPELINE_STAGES })

  const canonicalStages = canonicalizePipelineStages(config.pipelineStages || [])
  const currentContract = (config.pipelineStages || []).map((stage: any) => ({ key: stage.key, label: stage.label, order: stage.order, terminal: Boolean(stage.terminal), won: Boolean(stage.won), lost: Boolean(stage.lost), color: stage.color || undefined }))
  const nextContract = canonicalStages.map((stage: any) => ({ ...stage, color: stage.color || '#64748b' }))
  if (JSON.stringify(currentContract) !== JSON.stringify(nextContract)) {
    config.pipelineStages = canonicalStages as any
    await config.save()
  }
  return config
}

const updateConfig = async (organizationId: string, payload: any) => {
  const stages = payload.pipelineStages
  if (stages) payload = { ...payload, pipelineStages: canonicalizePipelineStages(stages, true) }
  if (payload.assignment) {
    const ids = new Set<string>()
    for (const id of payload.assignment.eligibleAgentIds || []) ids.add(String(id))
    for (const rule of payload.assignment.territoryRules || []) for (const id of rule.agentIds || []) ids.add(String(id))
    if (ids.size) {
      const validCount = await User.countDocuments({ _id: { $in: [...ids] }, organizationId, status: 'active', userRole: { $in: ['agency_owner', 'agency_admin', 'agent'] } })
      if (validCount !== ids.size) throw new ApiError(400, 'Assignment rules contain an agent outside this agency or an inactive agent')
    }
  }
  const setOnInsert: Record<string, unknown> = { organizationId }
  if (!payload.pipelineStages) setOnInsert.pipelineStages = DEFAULT_LEAD_PIPELINE_STAGES
  return CrmConfig.findOneAndUpdate({ organizationId }, { $set: payload, $setOnInsert: setOnInsert }, { new: true, upsert: true, runValidators: true })
}

const activeEligibleAgents = async (organizationId: string, configuredIds: any[] = []) => {
  const query: any = { organizationId, status: 'active', userRole: { $in: ['agency_owner', 'agency_admin', 'agent'] } }
  if (configuredIds.length) query._id = { $in: configuredIds }
  return User.find(query).select('_id name email userRole').sort({ createdAt: 1 }).lean()
}

const chooseAgent = async (organizationId: string, lead: { locationPreference?: string }, preferredPropertyAgent?: string) => {
  if (!(await EntitlementService.hasFeature(organizationId, 'leadAutomations'))) return { agentId: undefined, strategy: 'manual' as const, reason: 'Lead automation is not included in the current plan' }
  const config = await getConfig(organizationId)
  const assignment = config?.assignment || { mode: 'manual', eligibleAgentIds: [], territoryRules: [], workloadCap: 100, roundRobinCursor: 0 }
  if (preferredPropertyAgent) return { agentId: preferredPropertyAgent, strategy: 'property_owner' as const, reason: 'Property listing agent' }
  if (assignment.mode === 'manual') return { agentId: undefined, strategy: 'manual' as const, reason: 'Manual assignment configured' }
  let agents = await activeEligibleAgents(organizationId, assignment.eligibleAgentIds || [])
  if (!agents.length) return { agentId: undefined, strategy: assignment.mode as any, reason: 'No eligible active agents' }

  if (assignment.mode === 'territory' && lead.locationPreference) {
    const location = lead.locationPreference.toLowerCase()
    const rules = [...(assignment.territoryRules || [])].sort((a: any, b: any) => b.priority - a.priority)
    const match: any = rules.find((rule: any) => (rule.locations || []).some((v: string) => location.includes(v.toLowerCase())))
    if (match?.agentIds?.length) {
      const ids = new Set(match.agentIds.map((v: any) => String(v._id || v)))
      const territoryAgents = agents.filter((agent: any) => ids.has(String(agent._id)))
      if (territoryAgents.length) agents = territoryAgents
    }
  }

  if (assignment.mode === 'workload' || assignment.mode === 'territory') {
    const counts = await Lead.aggregate([
      { $match: { organizationId, leadStatus: { $nin: LEAD_CLOSED_STATUSES }, assignedAgent: { $in: agents.map((a: any) => a._id) } } },
      { $group: { _id: '$assignedAgent', count: { $sum: 1 } } },
    ])
    const byId = new Map<string, number>(counts.map((row: any) => [String(row._id), Number(row.count || 0)]))
    const cap = assignment.workloadCap || 100
    agents = agents.filter((a: any) => (byId.get(String(a._id)) || 0) < cap)
    agents.sort((a: any, b: any) => (byId.get(String(a._id)) || 0) - (byId.get(String(b._id)) || 0))
    return { agentId: agents[0]?._id?.toString(), strategy: assignment.mode as 'territory' | 'workload', reason: agents.length ? 'Lowest eligible open-lead workload' : 'All eligible agents are at workload cap' }
  }

  const cursor = Math.max(0, assignment.roundRobinCursor || 0)

  const selected: any = agents[cursor % agents.length]
  await CrmConfig.updateOne({ organizationId }, { $set: { 'assignment.roundRobinCursor': (cursor + 1) % Math.max(agents.length, 1) } })
  return { agentId: selected?._id?.toString(), strategy: 'round_robin' as const, reason: 'Next agent in round-robin rotation' }
}

const recordAssignment = async (input: { organizationId: string; leadId: string; previousAgentId?: string; assignedAgentId?: string; strategy: string; reason?: string; actorId?: string }) => {
  return LeadAssignmentAudit.create(input)
}

const getAssignmentHistory = async (organizationId: string, leadId: string) => LeadAssignmentAudit.find({ organizationId, leadId })
  .populate('previousAgentId assignedAgentId actorId', 'name email').sort({ createdAt: -1 }).lean()

export const CrmService = { getConfig, updateConfig, chooseAgent, recordAssignment, getAssignmentHistory }
