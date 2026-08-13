import { Schema, model } from 'mongoose'

const stageSchema = new Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  color: { type: String, default: '#64748b' },
  order: { type: Number, required: true },
  terminal: { type: Boolean, default: false },
  won: { type: Boolean, default: false },
  lost: { type: Boolean, default: false },
}, { _id: false })

const territoryRuleSchema = new Schema({
  name: { type: String, required: true },
  locations: [{ type: String }],
  agentIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  priority: { type: Number, default: 0 },
}, { _id: true })

const crmConfigSchema = new Schema({
  organizationId: { type: String, required: true, unique: true, index: true },
  pipelineStages: { type: [stageSchema], default: [] },
  lostReasons: { type: [String], default: ['Budget mismatch', 'No response', 'Chose another property', 'Financing issue', 'Timing', 'Other'] },
  responseSlaMinutes: { type: Number, default: 30, min: 1, max: 10080 },
  assignment: {
    mode: { type: String, enum: ['round_robin', 'territory', 'workload', 'manual'], default: 'round_robin' },
    eligibleAgentIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    workloadCap: { type: Number, default: 100, min: 1, max: 10000 },
    roundRobinCursor: { type: Number, default: 0 },
    territoryRules: { type: [territoryRuleSchema], default: [] },
  },
  reminders: {
    taskMinutesBefore: { type: Number, default: 30, min: 0, max: 10080 },
    viewingMinutesBefore: { type: Number, default: 120, min: 0, max: 10080 },
  },
}, { timestamps: true })

export const CrmConfig = model('CrmConfig', crmConfigSchema)

const assignmentAuditSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  previousAgentId: { type: Schema.Types.ObjectId, ref: 'User' },
  assignedAgentId: { type: Schema.Types.ObjectId, ref: 'User' },
  strategy: { type: String, enum: ['round_robin', 'territory', 'workload', 'manual', 'property_owner'], required: true },
  reason: { type: String, default: '' },
  actorId: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
assignmentAuditSchema.index({ organizationId: 1, leadId: 1, createdAt: -1 })
export const LeadAssignmentAudit = model('LeadAssignmentAudit', assignmentAuditSchema)
