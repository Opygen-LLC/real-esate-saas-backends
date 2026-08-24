import { Types, type PipelineStage, type SortOrder } from 'mongoose'
import { logger } from '../../../shared/logger'
import { Activity } from '../activity/activity.model'
import { Contact } from '../contact/contact.model'
import { Lead } from '../lead/lead.model'
import { LOCKED_LEAD_EMAIL_MASK, LOCKED_LEAD_PHONE_MASK, redactLockedLeadForList } from '../lead/leadEntitlement.service'
import { Property } from '../property/property.model'
import { Task } from '../task/task.model'
import { TASK_TYPE } from '../task/taskType.contract'
import { User } from '../user/user.model'
import { userRefPopulate } from '../user/userProfile.service'
import { UserProfile } from '../userProfile/userProfile.model'

export type CrmListReadModelOptions = {
  match: Record<string, unknown>
  skip: number
  limit: number
  sortBy: string
  sortOrder: SortOrder
}

export type ContactListReadModelOptions = CrmListReadModelOptions & {
  /** Explicit tenant boundary used by the resilient fallback and diagnostics. */
  organizationId: string
  scope?: 'mine' | 'team'
  requestId?: string
}

type ReadModelPage<T> = { rows: T[]; total: number }

const OBJECT_ID_MATCH_FIELDS = new Set([
  '_id',
  'assignedAgent',
  'assignedTo',
  'createdBy',
  'updatedBy',
  'convertedBy',
  'convertedContactId',
  'contactId',
  'sourceLeadId',
  'propertyInterest',
  'linkedLead',
  'linkedProperty',
])

const castObjectIdMatchValue = (value: unknown): unknown => {
  if (typeof value === 'string' && Types.ObjectId.isValid(value)) return new Types.ObjectId(value)
  if (Array.isArray(value)) return value.map(castObjectIdMatchValue)
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Types.ObjectId)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, castObjectIdMatchValue(nested)]))
  }
  return value
}

const castAggregationMatch = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(castAggregationMatch)
  if (!value || typeof value !== 'object' || value instanceof Date || value instanceof Types.ObjectId) return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      OBJECT_ID_MATCH_FIELDS.has(key) ? castObjectIdMatchValue(nested) : castAggregationMatch(nested),
    ]),
  )
}

const LEAD_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'followUpDate',
  'leadScore',
  'name',
  'leadStatus',
  'source',
  'budgetMin',
  'budgetMax',
])

const CONTACT_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'convertedAt',
  'followUpDate',
  'name',
  'source',
  'statusAtConversion',
])

const sortSpec = (requested: string, direction: SortOrder, allowed: Set<string>, fallback: string) => {
  const field = allowed.has(requested) ? requested : fallback
  const order: 1 | -1 = direction === 1 || direction === 'asc' || direction === 'ascending' ? 1 : -1
  return { [field]: order, _id: order }
}

const userLookupStages = (sourceField: string, targetField = sourceField): PipelineStage.FacetPipelineStage[] => [
  {
    $lookup: {
      from: User.collection.name,
      let: { userId: `$${sourceField}`, organizationId: '$organizationId' },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$_id', '$$userId'] },
                { $eq: ['$organizationId', '$$organizationId'] },
              ],
            },
          },
        },
        {
          $lookup: {
            from: UserProfile.collection.name,
            localField: '_id',
            foreignField: 'userId',
            as: '__profile',
          },
        },
        { $set: { __profile: { $arrayElemAt: ['$__profile', 0] } } },
        {
          $project: {
            _id: 1,
            name: 1,
            email: 1,
            phoneNumber: 1,
            userRole: 1,
            profileImgURL: { $ifNull: ['$__profile.profileImgURL', ''] },
          },
        },
      ],
      as: `__${targetField}`,
    },
  },
  {
    $set: {
      [targetField]: {
        $ifNull: [{ $arrayElemAt: [`$__${targetField}`, 0] }, `$${sourceField}`],
      },
    },
  },
  { $unset: `__${targetField}` },
]

const propertyLookupStages = (): PipelineStage.FacetPipelineStage[] => [
  {
    $lookup: {
      from: Property.collection.name,
      let: {
        propertyIds: { $cond: [{ $isArray: '$propertyInterest' }, '$propertyInterest', []] },
        organizationId: '$organizationId',
      },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $in: ['$_id', '$$propertyIds'] },
                { $eq: ['$organizationId', '$$organizationId'] },
              ],
            },
          },
        },
        {
          $project: {
            _id: 1,
            title: 1,
            price: 1,
            city: 1,
            propertyType: 1,
            status: 1,
            bedrooms: 1,
            bathrooms: 1,
            images: { $slice: [{ $cond: [{ $isArray: '$images' }, '$images', []] }, 1] },
          },
        },
      ],
      as: '__properties',
    },
  },
  {
    $set: {
      propertyInterest: '$__properties',
      propertySummary: {
        count: { $size: '$__properties' },
        primary: { $arrayElemAt: ['$__properties', 0] },
      },
    },
  },
  { $unset: '__properties' },
]

const activityProjectionFields = {
  _id: 0,
  id: { $toString: '$_id' },
  type: { $ifNull: ['$metadata.eventType', '$type'] },
  title: 1,
  content: 1,
  leadId: {
    $cond: [{ $ne: ['$leadId', null] }, { $toString: '$leadId' }, '$$REMOVE'],
  },
  contactId: {
    $cond: [{ $ne: ['$contactId', null] }, { $toString: '$contactId' }, '$$REMOVE'],
  },
  authorId: {
    $cond: [{ $ne: ['$agentId', null] }, { $toString: '$agentId' }, '$$REMOVE'],
  },
  occurredAt: '$createdAt',
}

const interactionMatch = {
  $or: [
    { type: { $in: ['call', 'email', 'whatsapp', 'meeting', 'viewing', 'offer'] } },
    { 'metadata.eventType': { $regex: '^sms\\.' } },
  ],
}

const leadActivityLookupStages = (): PipelineStage.FacetPipelineStage[] => [
  {
    $lookup: {
      from: Activity.collection.name,
      let: { leadId: '$_id', organizationId: '$organizationId' },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$leadId', '$$leadId'] },
                { $eq: ['$organizationId', '$$organizationId'] },
              ],
            },
          },
        },
        {
          $facet: {
            latestNote: [
              { $match: { type: 'note' } },
              { $sort: { createdAt: -1, _id: -1 } },
              { $limit: 1 },
              { $project: activityProjectionFields },
            ],
            latestInteraction: [
              { $match: interactionMatch },
              { $sort: { createdAt: -1, _id: -1 } },
              { $limit: 1 },
              { $project: activityProjectionFields },
            ],
          },
        },
      ],
      as: '__activityReadModel',
    },
  },
  { $set: { __activityReadModel: { $arrayElemAt: ['$__activityReadModel', 0] } } },
  {
    $set: {
      latestNote: { $arrayElemAt: [{ $ifNull: ['$__activityReadModel.latestNote', []] }, 0] },
      latestInteraction: { $arrayElemAt: [{ $ifNull: ['$__activityReadModel.latestInteraction', []] }, 0] },
    },
  },
  { $unset: '__activityReadModel' },
]

const leadFollowUpLookupStages = (): PipelineStage.FacetPipelineStage[] => [
  {
    $lookup: {
      from: Task.collection.name,
      let: { leadId: '$_id', organizationId: '$organizationId' },
      pipeline: [
        {
          $match: {
            taskType: TASK_TYPE.LEAD_FOLLOW_UP,
            status: { $in: ['Pending', 'InProgress', 'Overdue'] },
            $expr: {
              $and: [
                { $eq: ['$linkedLead', '$$leadId'] },
                { $eq: ['$organizationId', '$$organizationId'] },
              ],
            },
          },
        },
        { $sort: { dueAt: 1, _id: 1 } },
        { $limit: 1 },
        { $project: { _id: 1, title: 1, dueAt: 1, status: 1, priority: 1, assignedAgent: 1 } },
      ],
      as: '__followUpTask',
    },
  },
  {
    $set: {
      followUpTask: { $arrayElemAt: ['$__followUpTask', 0] },
      followUp: {
        date: '$followUpDate',
        task: { $arrayElemAt: ['$__followUpTask', 0] },
      },
    },
  },
  { $unset: '__followUpTask' },
]

const leadContactLookupStages = (): PipelineStage.FacetPipelineStage[] => [
  {
    $lookup: {
      from: Contact.collection.name,
      let: { contactId: '$contactId' },
      pipeline: [
        { $match: { $expr: { $eq: ['$_id', '$$contactId'] } } },
        { $project: { _id: 1, name: 1, email: 1, phone: 1, company: 1 } },
        { $limit: 1 },
      ],
      as: '__legacyContact',
    },
  },
  {
    $set: {
      contactId: { $ifNull: [{ $arrayElemAt: ['$__legacyContact', 0] }, '$contactId'] },
    },
  },
  { $unset: '__legacyContact' },
]

const sourceLeadLookupStages = (): PipelineStage.FacetPipelineStage[] => [
  {
    $lookup: {
      from: Lead.collection.name,
      let: { leadId: '$sourceLeadId', organizationId: '$organizationId' },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$_id', '$$leadId'] },
                { $eq: ['$organizationId', '$$organizationId'] },
              ],
            },
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            phone: 1,
            email: 1,
            leadStatus: 1,
            source: 1,
            budgetMin: 1,
            budgetMax: 1,
            currency: 1,
            locationPreference: 1,
            propertyType: 1,
            createdAt: 1,
            convertedAt: 1,
            isConverted: 1,
          },
        },
        { $limit: 1 },
      ],
      as: '__sourceLead',
    },
  },
  {
    $set: {
      sourceLeadId: { $ifNull: [{ $arrayElemAt: ['$__sourceLead', 0] }, '$sourceLeadId'] },
    },
  },
  { $unset: '__sourceLead' },
]

const contactActivityLookupStages = (): PipelineStage.FacetPipelineStage[] => [
  {
    $lookup: {
      from: Activity.collection.name,
      let: { contactId: '$_id', sourceLeadId: '$sourceLeadId', organizationId: '$organizationId' },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$organizationId', '$$organizationId'] },
                {
                  $or: [
                    { $eq: ['$contactId', '$$contactId'] },
                    {
                      $and: [
                        { $ne: ['$$sourceLeadId', null] },
                        { $eq: ['$leadId', '$$sourceLeadId'] },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          $facet: {
            latestNote: [
              { $match: { type: 'note' } },
              { $sort: { createdAt: -1, _id: -1 } },
              { $limit: 1 },
              { $project: activityProjectionFields },
            ],
            latestInteraction: [
              { $match: interactionMatch },
              { $sort: { createdAt: -1, _id: -1 } },
              { $limit: 1 },
              { $project: activityProjectionFields },
            ],
          },
        },
      ],
      as: '__activityReadModel',
    },
  },
  { $set: { __activityReadModel: { $arrayElemAt: ['$__activityReadModel', 0] } } },
  {
    $set: {
      latestNote: { $arrayElemAt: [{ $ifNull: ['$__activityReadModel.latestNote', []] }, 0] },
      latestInteraction: { $arrayElemAt: [{ $ifNull: ['$__activityReadModel.latestInteraction', []] }, 0] },
    },
  },
  { $unset: '__activityReadModel' },
]

const publicUserRef = (value: any) => {
  if (!value || typeof value !== 'object') return value
  return {
    _id: value._id,
    name: value.name,
    email: value.email,
    phoneNumber: value.phoneNumber,
    userRole: value.userRole,
    profileImgURL: value.profile?.profileImgURL || value.profileImgURL || '',
  }
}

const objectIdKey = (value: unknown): string | undefined => {
  const candidate = value && typeof value === 'object' && '_id' in (value as Record<string, unknown>)
    ? (value as Record<string, unknown>)._id
    : value
  if (candidate instanceof Types.ObjectId) return candidate.toHexString()
  if (typeof candidate === 'string' && Types.ObjectId.isValid(candidate)) return String(new Types.ObjectId(candidate))
  return undefined
}

const uniqueObjectIds = (values: unknown[]): Types.ObjectId[] => {
  const ids = new Map<string, Types.ObjectId>()
  for (const value of values) {
    const key = objectIdKey(value)
    if (key && !ids.has(key)) ids.set(key, new Types.ObjectId(key))
  }
  return [...ids.values()]
}

const contactActivityProjection = (activity: any) => ({
  id: String(activity._id),
  type: String(activity?.metadata?.eventType || activity.type || 'system'),
  title: String(activity.title || ''),
  content: typeof activity.content === 'string' ? activity.content : '',
  ...(objectIdKey(activity.leadId) ? { leadId: objectIdKey(activity.leadId) } : {}),
  ...(objectIdKey(activity.contactId) ? { contactId: objectIdKey(activity.contactId) } : {}),
  ...(objectIdKey(activity.agentId) ? { authorId: objectIdKey(activity.agentId) } : {}),
  occurredAt: activity.createdAt,
})

const isInteractionActivity = (activity: any): boolean => {
  if (['call', 'email', 'whatsapp', 'meeting', 'viewing', 'offer'].includes(String(activity?.type || ''))) return true
  return typeof activity?.metadata?.eventType === 'string' && activity.metadata.eventType.startsWith('sms.')
}

const safeFallbackEnrichment = async <T>(
  name: string,
  options: ContactListReadModelOptions,
  operation: () => Promise<T>,
  fallback: T,
): Promise<T> => {
  try {
    return await operation()
  } catch (error) {
    const candidate = error as { code?: unknown; codeName?: unknown; name?: unknown }
    logger.warn('crm_contact_fallback_enrichment_degraded', {
      organizationId: options.organizationId,
      scope: options.scope || 'team',
      requestId: options.requestId,
      enrichment: name,
      mongoErrorCode: typeof candidate?.code === 'string' || typeof candidate?.code === 'number' ? candidate.code : 'unknown',
      mongoErrorName: typeof candidate?.codeName === 'string' ? candidate.codeName : typeof candidate?.name === 'string' ? candidate.name : 'Error',
    })
    return fallback
  }
}

/**
 * Resilient Contact list path used only when the optimized aggregation presenter
 * fails. It deliberately uses simple tenant-scoped finds and batched lookups so
 * missing/deleted legacy references cannot make the whole list unavailable.
 */
export const readContactListPageFallback = async <T = any>(options: ContactListReadModelOptions): Promise<ReadModelPage<T>> => {
  const tenantMatch = { $and: [options.match, { organizationId: options.organizationId }] } as any
  const sort = sortSpec(options.sortBy, options.sortOrder, CONTACT_SORT_FIELDS, 'updatedAt') as any
  const [documents, total] = await Promise.all([
    Contact.find(tenantMatch)
      .sort(sort)
      .skip(options.skip)
      .limit(options.limit)
      .lean(),
    Contact.countDocuments(tenantMatch),
  ])

  const contacts = documents as any[]
  if (!contacts.length) return { rows: [], total }

  const assignedIds = uniqueObjectIds(contacts.map((row) => row.assignedTo))
  const sourceLeadIds = uniqueObjectIds(contacts.map((row) => row.sourceLeadId))
  const propertyIds = uniqueObjectIds(contacts.flatMap((row) => Array.isArray(row.propertyInterest) ? row.propertyInterest : row.propertyInterest ? [row.propertyInterest] : []))
  const contactIds = uniqueObjectIds(contacts.map((row) => row._id))

  const [users, profiles, properties, sourceLeads, activities] = await Promise.all([
    safeFallbackEnrichment('assigned-users', options, async () => assignedIds.length
      ? User.find({ organizationId: options.organizationId, _id: { $in: assignedIds } })
        .select('_id name email phoneNumber userRole')
        .lean()
      : [], [] as any[]),
    safeFallbackEnrichment('assigned-user-profiles', options, async () => assignedIds.length
      ? UserProfile.find({ userId: { $in: assignedIds } })
        .select('userId profileImgURL')
        .lean()
      : [], [] as any[]),
    safeFallbackEnrichment('properties', options, async () => propertyIds.length
      ? Property.find({ organizationId: options.organizationId, _id: { $in: propertyIds } })
        .select('_id title price images city propertyType bedrooms bathrooms')
        .lean()
      : [], [] as any[]),
    safeFallbackEnrichment('source-leads', options, async () => sourceLeadIds.length
      ? Lead.find({ organizationId: options.organizationId, _id: { $in: sourceLeadIds } })
        .select('_id name phone email leadStatus source budgetMin budgetMax currency locationPreference propertyType createdAt convertedAt isConverted')
        .lean()
      : [], [] as any[]),
    safeFallbackEnrichment('activities', options, async () => (contactIds.length || sourceLeadIds.length)
      ? Activity.find({
        organizationId: options.organizationId,
        $and: [
          {
            $or: [
              ...(contactIds.length ? [{ contactId: { $in: contactIds } }] : []),
              ...(sourceLeadIds.length ? [{ leadId: { $in: sourceLeadIds } }] : []),
            ],
          },
          {
            $or: [
              { type: { $in: ['note', 'call', 'email', 'whatsapp', 'meeting', 'viewing', 'offer'] } },
              { 'metadata.eventType': { $regex: '^sms\\.' } },
            ],
          },
        ],
      })
        .select('_id type title content leadId contactId agentId metadata createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .lean()
      : [], [] as any[]),
  ])

  const profileByUser = new Map<string, any>()
  for (const profile of profiles as any[]) {
    const key = objectIdKey(profile.userId)
    if (key) profileByUser.set(key, profile)
  }
  const userById = new Map<string, any>()
  for (const user of users as any[]) {
    const key = objectIdKey(user._id)
    if (key) userById.set(key, { ...user, profile: profileByUser.get(key) })
  }
  const propertyById = new Map<string, any>()
  for (const property of properties as any[]) {
    const key = objectIdKey(property._id)
    if (key) propertyById.set(key, property)
  }
  const leadById = new Map<string, any>()
  for (const lead of sourceLeads as any[]) {
    const key = objectIdKey(lead._id)
    if (key) leadById.set(key, lead)
  }

  const contactIdsByLead = new Map<string, Set<string>>()
  for (const contact of contacts) {
    const contactId = objectIdKey(contact._id)
    const leadId = objectIdKey(contact.sourceLeadId)
    if (!contactId || !leadId) continue
    const set = contactIdsByLead.get(leadId) || new Set<string>()
    set.add(contactId)
    contactIdsByLead.set(leadId, set)
  }

  const latestNote = new Map<string, ReturnType<typeof contactActivityProjection>>()
  const latestInteraction = new Map<string, ReturnType<typeof contactActivityProjection>>()
  for (const activity of activities as any[]) {
    const targets = new Set<string>()
    const directContactId = objectIdKey(activity.contactId)
    if (directContactId) targets.add(directContactId)
    const leadId = objectIdKey(activity.leadId)
    if (leadId) for (const contactId of contactIdsByLead.get(leadId) || []) targets.add(contactId)
    for (const contactId of targets) {
      if (activity.type === 'note' && !latestNote.has(contactId)) latestNote.set(contactId, contactActivityProjection(activity))
      if (isInteractionActivity(activity) && !latestInteraction.has(contactId)) latestInteraction.set(contactId, contactActivityProjection(activity))
    }
  }

  const rows = contacts.map((row) => {
    const contactId = objectIdKey(row._id) || String(row._id)
    const assignedKey = objectIdKey(row.assignedTo)
    const sourceLeadKey = objectIdKey(row.sourceLeadId)
    const rawPropertyRefs = Array.isArray(row.propertyInterest) ? row.propertyInterest : row.propertyInterest ? [row.propertyInterest] : []
    const hydratedProperties = rawPropertyRefs
      .map((ref: unknown) => {
        const propertyKey = objectIdKey(ref)
        return propertyKey ? propertyById.get(propertyKey) : undefined
      })
      .filter(Boolean)

    return {
      ...row,
      assignedTo: assignedKey && userById.has(assignedKey) ? publicUserRef(userById.get(assignedKey)) : row.assignedTo,
      sourceLeadId: sourceLeadKey && leadById.has(sourceLeadKey) ? leadById.get(sourceLeadKey) : row.sourceLeadId,
      propertyInterest: hydratedProperties,
      propertySummary: { count: hydratedProperties.length, primary: hydratedProperties[0] },
      ...(latestNote.has(contactId) ? { latestNote: latestNote.get(contactId) } : {}),
      ...(latestInteraction.has(contactId) ? { latestInteraction: latestInteraction.get(contactId) } : {}),
    } as T
  })

  return { rows, total }
}

const lockedLeadRedactionStages = (): PipelineStage.FacetPipelineStage[] => [
  {
    $set: {
      phone: { $cond: [{ $and: [{ $eq: ['$isLocked', true] }, { $eq: ['$lockReason', 'subscription_limit'] }] }, LOCKED_LEAD_PHONE_MASK, '$phone'] },
      email: { $cond: [{ $and: [{ $eq: ['$isLocked', true] }, { $eq: ['$lockReason', 'subscription_limit'] }] }, LOCKED_LEAD_EMAIL_MASK, '$email'] },
    },
  },
]

const accessibleLeadMatch = (match: Record<string, unknown>) => ({ $and: [match, { isLocked: { $ne: true } }] })

const readLeadListPageFallback = async <T = any>(options: CrmListReadModelOptions): Promise<ReadModelPage<T>> => {
  const query = accessibleLeadMatch(options.match) as any
  const sort = sortSpec(options.sortBy, options.sortOrder, LEAD_SORT_FIELDS, 'createdAt') as any
  const [documents, total] = await Promise.all([
    Lead.find(query)
      .sort(sort)
      .skip(options.skip)
      .limit(options.limit)
      .populate(userRefPopulate('assignedAgent', 'name email phoneNumber userRole'))
      .populate(userRefPopulate('createdBy', 'name email userRole'))
      .populate(userRefPopulate('updatedBy', 'name email userRole'))
      .populate('propertyInterest', 'title price images city propertyType bedrooms bathrooms')
      .populate('contactId', 'name email phone company')
      .lean(),
    Lead.countDocuments(query),
  ])

  const rows = (documents as any[]).map((row) => {
    const safeRow = redactLockedLeadForList(row)
    const properties = Array.isArray(safeRow.propertyInterest) ? safeRow.propertyInterest : []
    return {
      ...safeRow,
      assignedAgent: publicUserRef(safeRow.assignedAgent),
      createdBy: publicUserRef(safeRow.createdBy),
      updatedBy: publicUserRef(safeRow.updatedBy),
      propertyInterest: properties,
      propertySummary: { count: properties.length, primary: properties[0] },
      followUp: { date: row.followUpDate },
    } as T
  })

  return { rows, total }
}

export const readLeadListPage = async <T = any>(options: CrmListReadModelOptions): Promise<ReadModelPage<T>> => {
  const documentMatch = accessibleLeadMatch(options.match) as Record<string, unknown>
  const aggregateMatch = castAggregationMatch(documentMatch) as Record<string, unknown>
  const rowPipeline: PipelineStage[] = [
    { $match: aggregateMatch },
    { $sort: sortSpec(options.sortBy, options.sortOrder, LEAD_SORT_FIELDS, 'createdAt') },
    { $skip: options.skip },
    { $limit: options.limit },
    ...lockedLeadRedactionStages(),
    ...userLookupStages('assignedAgent'),
    ...userLookupStages('createdBy'),
    ...userLookupStages('updatedBy'),
    ...propertyLookupStages(),
    ...leadActivityLookupStages(),
    ...leadFollowUpLookupStages(),
    ...leadContactLookupStages(),
  ] as PipelineStage[]

  try {
    // Production Mongo rejects lookup stages nested inside an outer facet stage.
    // Keep counting and page hydration as independent queries: the count stays
    // cheap, and expensive lookups only run for the bounded page of rows.
    const [rows, total] = await Promise.all([
      Lead.aggregate(rowPipeline).allowDiskUse(true),
      Lead.countDocuments(documentMatch as any),
    ])
    return { rows: rows as T[], total }
  } catch (error) {
    logger.warn('crm_lead_read_model_failed', { error })
    return readLeadListPageFallback<T>(options)
  }
}

export const readContactListPage = async <T = any>(options: ContactListReadModelOptions): Promise<ReadModelPage<T>> => {
  const documentMatch = { $and: [options.match, { organizationId: options.organizationId }] } as Record<string, unknown>
  const aggregateMatch = castAggregationMatch(documentMatch) as Record<string, unknown>
  const rowPipeline: PipelineStage[] = [
    { $match: aggregateMatch },
    { $sort: sortSpec(options.sortBy, options.sortOrder, CONTACT_SORT_FIELDS, 'updatedAt') },
    { $skip: options.skip },
    { $limit: options.limit },
    ...userLookupStages('assignedTo'),
    ...propertyLookupStages(),
    ...contactActivityLookupStages(),
    ...sourceLeadLookupStages(),
  ] as PipelineStage[]

  try {
    const [rows, total] = await Promise.all([
      Contact.aggregate(rowPipeline).allowDiskUse(true),
      Contact.countDocuments(documentMatch as any),
    ])
    return { rows: rows as T[], total }
  } catch (error) {
    const candidate = error as { code?: unknown; codeName?: unknown; name?: unknown }
    logger.warn('crm_contact_read_model_failed', {
      organizationId: options.organizationId,
      sortBy: options.sortBy,
      scope: options.scope || 'team',
      requestId: options.requestId,
      mongoErrorCode: typeof candidate?.code === 'string' || typeof candidate?.code === 'number' ? candidate.code : 'unknown',
      mongoErrorName: typeof candidate?.codeName === 'string' ? candidate.codeName : typeof candidate?.name === 'string' ? candidate.name : 'Error',
    })
    return readContactListPageFallback<T>(options)
  }
}
