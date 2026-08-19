import { Types, type PipelineStage, type SortOrder } from 'mongoose'
import { logger } from '../../../shared/logger'
import { Activity } from '../activity/activity.model'
import { Contact } from '../contact/contact.model'
import { Lead } from '../lead/lead.model'
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
      let: { userId: `$${sourceField}` },
      pipeline: [
        { $match: { $expr: { $eq: ['$_id', '$$userId'] } } },
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
      let: { propertyIds: { $cond: [{ $isArray: '$propertyInterest' }, '$propertyInterest', []] } },
      pipeline: [
        { $match: { $expr: { $in: ['$_id', '$$propertyIds'] } } },
        {
          $project: {
            _id: 1,
            title: 1,
            price: 1,
            city: 1,
            propertyType: 1,
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

const unwrapFacet = <T>(result: any[]): ReadModelPage<T> => {
  const facet = result[0] || {}
  return {
    rows: Array.isArray(facet.rows) ? facet.rows : [],
    total: Number(facet.total?.[0]?.count || 0),
  }
}

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

const readLeadListPageFallback = async <T = any>(options: CrmListReadModelOptions): Promise<ReadModelPage<T>> => {
  const query = options.match as any
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
    const properties = Array.isArray(row.propertyInterest) ? row.propertyInterest : []
    return {
      ...row,
      assignedAgent: publicUserRef(row.assignedAgent),
      createdBy: publicUserRef(row.createdBy),
      updatedBy: publicUserRef(row.updatedBy),
      propertyInterest: properties,
      propertySummary: { count: properties.length, primary: properties[0] },
      followUp: { date: row.followUpDate },
    } as T
  })

  return { rows, total }
}

export const readLeadListPage = async <T = any>(options: CrmListReadModelOptions): Promise<ReadModelPage<T>> => {
  try {
    const result = await Lead.aggregate([
    { $match: castAggregationMatch(options.match) as Record<string, unknown> },
    {
      $facet: {
        rows: [
          { $sort: sortSpec(options.sortBy, options.sortOrder, LEAD_SORT_FIELDS, 'createdAt') },
          { $skip: options.skip },
          { $limit: options.limit },
          ...userLookupStages('assignedAgent'),
          ...userLookupStages('createdBy'),
          ...userLookupStages('updatedBy'),
          ...propertyLookupStages(),
          ...leadActivityLookupStages(),
          ...leadFollowUpLookupStages(),
          ...leadContactLookupStages(),
        ],
        total: [{ $count: 'count' }],
      },
    },
    ]).allowDiskUse(true)

    return unwrapFacet<T>(result)
  } catch (error) {
    logger.warn('crm_lead_read_model_fallback', { error })
    return readLeadListPageFallback<T>(options)
  }
}

export const readContactListPage = async <T = any>(options: CrmListReadModelOptions): Promise<ReadModelPage<T>> => {
  const result = await Contact.aggregate([
    { $match: castAggregationMatch(options.match) as Record<string, unknown> },
    {
      $facet: {
        rows: [
          { $sort: sortSpec(options.sortBy, options.sortOrder, CONTACT_SORT_FIELDS, 'updatedAt') },
          { $skip: options.skip },
          { $limit: options.limit },
          ...userLookupStages('assignedTo'),
          ...propertyLookupStages(),
          ...contactActivityLookupStages(),
          ...sourceLeadLookupStages(),
        ],
        total: [{ $count: 'count' }],
      },
    },
  ]).allowDiskUse(true)

  return unwrapFacet<T>(result)
}
