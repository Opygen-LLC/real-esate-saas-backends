import { Types } from 'mongoose'
import { AgencyOwnerProfile } from '../agencyOwnerProfile/agencyOwnerProfile.model'
import { AgentProfile } from '../agentProfile/agentProfile.model'
import { SuperAdminProfile } from '../superAdminProfile/superAdminProfile.model'
import { UserProfile } from '../userProfile/userProfile.model'
import { User } from './user.model'

const lookupOne = (from: string, as: string) => ({
  $lookup: {
    from,
    localField: '_id',
    foreignField: 'userId',
    as,
  },
})

/**
 * One controlled projection for the split User/Profile model.
 * Each one-to-one lookup is backed by the unique userId indexes created in Phase 1.
 */
export const userProfileProjectionStages = (): any[] => [
  lookupOne(UserProfile.collection.name, '_profileRows'),
  lookupOne(AgencyOwnerProfile.collection.name, '_ownerProfileRows'),
  lookupOne(AgentProfile.collection.name, '_agentProfileRows'),
  lookupOne(SuperAdminProfile.collection.name, '_superAdminProfileRows'),
  {
    $set: {
      profile: { $arrayElemAt: ['$_profileRows', 0] },
      agencyOwnerProfile: { $arrayElemAt: ['$_ownerProfileRows', 0] },
      agentProfile: { $arrayElemAt: ['$_agentProfileRows', 0] },
      superAdminProfile: { $arrayElemAt: ['$_superAdminProfileRows', 0] },
    },
  },
  { $unset: ['_profileRows', '_ownerProfileRows', '_agentProfileRows', '_superAdminProfileRows'] },
]

const profileSearchStages = (searchTerm?: string): any[] => {
  const value = String(searchTerm || '').trim()
  if (!value) return []
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escaped, 'i')
  return [{
    $match: {
      $or: [
        { name: regex },
        { email: regex },
        { phoneNumber: regex },
        { organizationId: regex },
        { 'profile.address': regex },
        { 'agencyOwnerProfile.licenseNumber': regex },
        { 'agencyOwnerProfile.specialization': regex },
        { 'agencyOwnerProfile.serviceAreas': regex },
        { 'agentProfile.licenseNumber': regex },
        { 'agentProfile.specialization': regex },
        { 'agentProfile.serviceAreas': regex },
        { 'superAdminProfile.title': regex },
      ],
    },
  }]
}

export const listUsersWithProfiles = async (
  match: Record<string, unknown>,
  options: { sort?: Record<string, 1 | -1>; skip?: number; limit?: number } = {},
): Promise<any[]> => {
  // Page the compact User rows before joining the one-to-one profile collections.
  const pipeline: any[] = [{ $match: match }]
  if (options.sort) pipeline.push({ $sort: options.sort })
  if (options.skip) pipeline.push({ $skip: options.skip })
  if (options.limit) pipeline.push({ $limit: options.limit })
  pipeline.push(...userProfileProjectionStages())
  return User.aggregate(pipeline)
}

export const findUserWithProfiles = async (match: Record<string, unknown>): Promise<any | null> => {
  const rows = await User.aggregate([
    { $match: match },
    { $limit: 1 },
    ...userProfileProjectionStages(),
  ])
  return rows[0] || null
}

export const paginateUsersWithProfiles = async (input: {
  match: Record<string, unknown>
  searchTerm?: string
  sort: Record<string, 1 | -1>
  skip: number
  limit: number
}): Promise<{ rows: any[]; total: number }> => {
  const hasSearch = Boolean(String(input.searchTerm || '').trim())
  const pagePipeline = hasSearch
    ? [
        { $match: input.match },
        ...userProfileProjectionStages(),
        ...profileSearchStages(input.searchTerm),
        {
          $facet: {
            rows: [{ $sort: input.sort }, { $skip: input.skip }, { $limit: input.limit }],
            meta: [{ $count: 'total' }],
          },
        },
      ]
    : [
        { $match: input.match },
        {
          $facet: {
            // For normal directory browsing only the requested page pays the profile join cost.
            rows: [{ $sort: input.sort }, { $skip: input.skip }, { $limit: input.limit }, ...userProfileProjectionStages()],
            meta: [{ $count: 'total' }],
          },
        },
      ]

  const [page] = await User.aggregate(pagePipeline as any[])
  return {
    rows: page?.rows || [],
    total: Number(page?.meta?.[0]?.total || 0),
  }
}

export const asUserObjectId = (id: string): Types.ObjectId | null =>
  Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null
