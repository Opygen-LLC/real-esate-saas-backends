import type { Connection } from 'mongoose'

type RepairMode = 'unset' | 'hard_blocker'

export type TenantRelationFinding = {
  collection: string
  documentId: string
  organizationId: string
  field: string
  referenceId: string
  targetCollection: string
  targetOrganizationId?: string
  issue: string
  repair: RepairMode
}

type RelationSpec = {
  collection: string
  field: string
  targetCollection: string
  foreignField?: string
  sourceMatch?: Record<string, unknown>
  array?: boolean
  taskAwareRepair?: boolean
  repair: RepairMode
}

const TENANT_COLLECTIONS = [
  'users',
  'properties',
  'leads',
  'contacts',
  'activities',
  'viewings',
  'tasks',
  'agencyreviews',
  'reviewinvitations',
  'websitesubmissions',
  'financetransactions',
  'financebudgets',
  'financeinvoices',
  'financecommissions',
  'financevendors',
  'websitepages',
  'websiterevisions',
  'domainrecords',
  'subdomainaliases',
  'notifications',
  'websiteassets',
  'websitepreviewtokens',
  'websiteuploadintents',
] as const

const organizationOwnershipSpecs: RelationSpec[] = TENANT_COLLECTIONS.map((collection) => ({
  collection,
  field: 'organizationId',
  targetCollection: 'organizations',
  foreignField: 'organizationId',
  // Platform super-admin users are not tenant-owned and intentionally use the
  // platform identity namespace instead of an Organization document.
  ...(collection === 'users' ? { sourceMatch: { userRole: { $ne: 'super-admin' } } } : {}),
  repair: 'hard_blocker',
}))

const relationSpecs: RelationSpec[] = [
  // Leads / contacts.
  { collection: 'leads', field: 'propertyInterest', targetCollection: 'properties', array: true, repair: 'hard_blocker' },
  { collection: 'leads', field: 'contactId', targetCollection: 'contacts', repair: 'hard_blocker' },
  { collection: 'leads', field: 'convertedContactId', targetCollection: 'contacts', repair: 'hard_blocker' },
  { collection: 'leads', field: 'assignedAgent', targetCollection: 'users', repair: 'hard_blocker' },
  { collection: 'contacts', field: 'propertyInterest', targetCollection: 'properties', array: true, repair: 'hard_blocker' },
  { collection: 'contacts', field: 'sourceLeadId', targetCollection: 'leads', repair: 'hard_blocker' },
  { collection: 'contacts', field: 'assignedTo', targetCollection: 'users', repair: 'hard_blocker' },

  // Activity projections / interaction history.
  { collection: 'activities', field: 'leadId', targetCollection: 'leads', repair: 'hard_blocker' },
  { collection: 'activities', field: 'propertyId', targetCollection: 'properties', repair: 'hard_blocker' },
  { collection: 'activities', field: 'contactId', targetCollection: 'contacts', repair: 'hard_blocker' },
  { collection: 'activities', field: 'agentId', targetCollection: 'users', repair: 'hard_blocker' },

  // Tasks / viewings. Keep the pre-existing deterministic optional-reference repairs.
  { collection: 'tasks', field: 'linkedLead', targetCollection: 'leads', repair: 'unset', taskAwareRepair: true },
  { collection: 'tasks', field: 'linkedProperty', targetCollection: 'properties', repair: 'unset' },
  { collection: 'tasks', field: 'assignedAgent', targetCollection: 'users', repair: 'unset', taskAwareRepair: true },
  { collection: 'viewings', field: 'leadId', targetCollection: 'leads', repair: 'unset' },
  { collection: 'viewings', field: 'propertyId', targetCollection: 'properties', repair: 'hard_blocker' },
  { collection: 'viewings', field: 'agentId', targetCollection: 'users', repair: 'hard_blocker' },

  // Reviews.
  { collection: 'reviewinvitations', field: 'propertyId', targetCollection: 'properties', repair: 'hard_blocker' },
  { collection: 'reviewinvitations', field: 'createdBy', targetCollection: 'users', repair: 'hard_blocker' },
  { collection: 'agencyreviews', field: 'propertyId', targetCollection: 'properties', repair: 'hard_blocker' },
  { collection: 'agencyreviews', field: 'invitationId', targetCollection: 'reviewinvitations', repair: 'hard_blocker' },
  { collection: 'agencyreviews', field: 'moderatedBy', targetCollection: 'users', repair: 'hard_blocker' },

  // Website submissions.
  { collection: 'websitesubmissions', field: 'propertyId', targetCollection: 'properties', repair: 'hard_blocker' },
  { collection: 'websitesubmissions', field: 'movedToCrmBy', targetCollection: 'users', repair: 'hard_blocker' },
  { collection: 'websitesubmissions', field: 'linkedEntityId', targetCollection: 'leads', sourceMatch: { linkedEntityType: 'Lead' }, repair: 'hard_blocker' },
  { collection: 'websitesubmissions', field: 'linkedEntityId', targetCollection: 'viewings', sourceMatch: { linkedEntityType: 'Viewing' }, repair: 'hard_blocker' },
  { collection: 'websitesubmissions', field: 'linkedEntityId', targetCollection: 'agencyreviews', sourceMatch: { linkedEntityType: 'AgencyReview' }, repair: 'hard_blocker' },
  { collection: 'websitesubmissions', field: 'deletedBy', targetCollection: 'users', repair: 'hard_blocker' },

  // Finance direct relationships and source links.
  { collection: 'financetransactions', field: 'vendorId', targetCollection: 'financevendors', repair: 'hard_blocker' },
  { collection: 'financetransactions', field: 'propertyId', targetCollection: 'properties', repair: 'hard_blocker' },
  { collection: 'financetransactions', field: 'leadId', targetCollection: 'leads', repair: 'hard_blocker' },
  { collection: 'financetransactions', field: 'sourceId', targetCollection: 'financeinvoices', sourceMatch: { sourceType: 'invoice_payment' }, repair: 'hard_blocker' },
  { collection: 'financetransactions', field: 'sourceId', targetCollection: 'financecommissions', sourceMatch: { sourceType: 'commission_payout' }, repair: 'hard_blocker' },
  { collection: 'financeinvoices', field: 'propertyId', targetCollection: 'properties', repair: 'hard_blocker' },
  { collection: 'financeinvoices', field: 'leadId', targetCollection: 'leads', repair: 'hard_blocker' },
  { collection: 'financecommissions', field: 'agentId', targetCollection: 'users', repair: 'hard_blocker' },
  { collection: 'financecommissions', field: 'propertyId', targetCollection: 'properties', repair: 'hard_blocker' },
  { collection: 'financecommissions', field: 'leadId', targetCollection: 'leads', repair: 'hard_blocker' },
  { collection: 'financecommissions', field: 'payoutTransactionId', targetCollection: 'financetransactions', repair: 'hard_blocker' },

  // Builder relationships. There is no separate Website collection in this codebase;
  // WebsitePage is the tenant website document and WebsiteRevision belongs to a page.
  { collection: 'websitepages', field: 'updatedBy', targetCollection: 'users', repair: 'hard_blocker' },
  { collection: 'websiterevisions', field: 'pageId', targetCollection: 'websitepages', repair: 'hard_blocker' },
  { collection: 'websiterevisions', field: 'createdBy', targetCollection: 'users', repair: 'hard_blocker' },

  // Notifications / domains.
  { collection: 'notifications', field: 'userId', targetCollection: 'users', repair: 'hard_blocker' },
  { collection: 'notifications', field: 'leadId', targetCollection: 'leads', repair: 'hard_blocker' },
]

const allSpecs = [...organizationOwnershipSpecs, ...relationSpecs]

const relationPipeline = (spec: RelationSpec) => {
  const match: Record<string, unknown> = {
    ...(spec.sourceMatch || {}),
    [spec.field]: { $exists: true, $nin: [null, ''] },
  }
  const stages: any[] = [{ $match: match }]
  if (spec.array) stages.push({ $unwind: `$${spec.field}` })
  stages.push(
    {
      $lookup: {
        from: spec.targetCollection,
        localField: spec.field,
        foreignField: spec.foreignField || '_id',
        as: '__tenantTarget',
      },
    },
    { $set: { __tenantTarget: { $arrayElemAt: ['$__tenantTarget', 0] } } },
    {
      $match: {
        $expr: {
          $ne: [
            { $ifNull: ['$__tenantTarget.organizationId', '__missing_target__'] },
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
        targetOrganizationId: '$__tenantTarget.organizationId',
      },
    },
  )
  return stages
}

type RelationAuditDb = NonNullable<Connection['db']>

export const collectTenantRelationFindings = async (db: RelationAuditDb): Promise<TenantRelationFinding[]> => {
  const findings: TenantRelationFinding[] = []

  for (const spec of allSpecs) {
    // Some optional modules/collections may not have been created in older installs.
    const exists = await db.listCollections({ name: spec.collection }, { nameOnly: true }).hasNext()
    if (!exists) continue

    if (spec.field === 'organizationId' && spec.targetCollection === 'organizations') {
      const missingOwnerCursor = db.collection(spec.collection).find(
        { ...(spec.sourceMatch || {}), $or: [{ organizationId: { $exists: false } }, { organizationId: null }, { organizationId: '' }] },
        { projection: { _id: 1, organizationId: 1 } },
      )
      for await (const row of missingOwnerCursor) {
        findings.push({
          collection: spec.collection,
          documentId: String(row._id),
          organizationId: String(row.organizationId || ''),
          field: 'organizationId',
          referenceId: '',
          targetCollection: 'organizations',
          issue: 'tenant-owned document is missing organizationId',
          repair: 'hard_blocker',
        })
      }
    }

    const cursor = db.collection(spec.collection).aggregate(relationPipeline(spec), {
      allowDiskUse: false,
      maxTimeMS: 30_000,
    })
    for await (const row of cursor) {
      const targetOrganizationId = row.targetOrganizationId ? String(row.targetOrganizationId) : undefined
      const followUp = spec.collection === 'tasks' && row.taskType === 'lead_follow_up'
      const repair: RepairMode = spec.taskAwareRepair && followUp ? 'hard_blocker' : spec.repair
      const rawReference = row[spec.field]
      findings.push({
        collection: spec.collection,
        documentId: String(row._id),
        organizationId: String(row.organizationId || ''),
        field: spec.field,
        referenceId: String(rawReference || ''),
        targetCollection: spec.targetCollection,
        targetOrganizationId,
        issue: targetOrganizationId
          ? `reference belongs to tenant ${targetOrganizationId}`
          : `reference target does not exist in ${spec.targetCollection}`,
        repair,
      })
    }
  }

  return findings
}

export const summarizeTenantRelationFindings = (findings: TenantRelationFinding[]) =>
  findings.reduce<Record<string, number>>((acc, finding) => {
    const key = `${finding.collection}.${finding.field}->${finding.targetCollection}`
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
