import type { Connection } from 'mongoose'

type RepairMode = 'unset' | 'hard_blocker'
export type TenantRelationFinding = {
  collection: 'tasks' | 'viewings'
  documentId: string
  organizationId: string
  field: string
  referenceId: string
  targetOrganizationId?: string
  issue: string
  repair: RepairMode
}

type RelationSpec = {
  collection: TenantRelationFinding['collection']
  field: string
  targetCollection: 'properties' | 'leads' | 'users'
  taskAwareRepair?: boolean
  repair: RepairMode
}

const SPECS: RelationSpec[] = [
  { collection: 'tasks', field: 'linkedLead', targetCollection: 'leads', repair: 'unset', taskAwareRepair: true },
  { collection: 'tasks', field: 'linkedProperty', targetCollection: 'properties', repair: 'unset' },
  { collection: 'tasks', field: 'assignedAgent', targetCollection: 'users', repair: 'unset', taskAwareRepair: true },
  { collection: 'viewings', field: 'leadId', targetCollection: 'leads', repair: 'unset' },
  { collection: 'viewings', field: 'propertyId', targetCollection: 'properties', repair: 'hard_blocker' },
  { collection: 'viewings', field: 'agentId', targetCollection: 'users', repair: 'hard_blocker' },
]

const relationPipeline = (spec: RelationSpec) => [
  { $match: { [spec.field]: { $exists: true, $nin: [null, ''] } } },
  {
    $lookup: {
      from: spec.targetCollection,
      localField: spec.field,
      foreignField: '_id',
      as: '__phase3Target',
    },
  },
  { $set: { __phase3Target: { $arrayElemAt: ['$__phase3Target', 0] } } },
  {
    $match: {
      $expr: {
        $ne: [
          { $ifNull: ['$__phase3Target.organizationId', '__missing_target__'] },
          '$organizationId',
        ],
      },
    },
  },
  {
    $project: {
      _id: 1,
      organizationId: 1,
      taskType: 1,
      [spec.field]: 1,
      targetOrganizationId: '$__phase3Target.organizationId',
    },
  },
]

type RelationAuditDb = NonNullable<Connection['db']>

export const collectTenantRelationFindings = async (db: RelationAuditDb): Promise<TenantRelationFinding[]> => {
  const findings: TenantRelationFinding[] = []

  for (const spec of SPECS) {
    const cursor = db.collection(spec.collection).aggregate(relationPipeline(spec), { allowDiskUse: false, maxTimeMS: 30_000 })
    for await (const row of cursor) {
      const targetOrganizationId = row.targetOrganizationId ? String(row.targetOrganizationId) : undefined
      const followUp = spec.collection === 'tasks' && row.taskType === 'lead_follow_up'
      const repair: RepairMode = spec.taskAwareRepair && followUp ? 'hard_blocker' : spec.repair
      findings.push({
        collection: spec.collection,
        documentId: String(row._id),
        organizationId: String(row.organizationId || ''),
        field: spec.field,
        referenceId: String(row[spec.field] || ''),
        targetOrganizationId,
        issue: targetOrganizationId ? `reference belongs to tenant ${targetOrganizationId}` : 'reference target does not exist',
        repair,
      })
    }
  }

  return findings
}

export const summarizeTenantRelationFindings = (findings: TenantRelationFinding[]) =>
  findings.reduce<Record<string, number>>((acc, finding) => {
    const key = `${finding.collection}.${finding.field}`
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
