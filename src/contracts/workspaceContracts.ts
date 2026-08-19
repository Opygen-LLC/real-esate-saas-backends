export const WORKSPACE_RESOURCES = [
  'teamMembers',
  'properties',
  'leads',
  'websiteSubmissions',
  'sessions',
] as const

export type WorkspaceResource = (typeof WORKSPACE_RESOURCES)[number]


export type TeamMemberLimitContract = {
  maxTeamMembers: number
}

const toPlainObject = <T extends Record<string, any>>(entity: T): Record<string, any> =>
  typeof entity?.toObject === 'function' ? entity.toObject() : entity

export const toTeamMemberLimitContract = <T extends Record<string, any>>(
  entity: T,
): Omit<T, 'maxAgents'> & TeamMemberLimitContract => {
  const plain = toPlainObject(entity)
  const { maxAgents, ...rest } = plain
  return {
    ...rest,
    maxTeamMembers: Number(plain.maxTeamMembers ?? maxAgents ?? 0),
  } as Omit<T, 'maxAgents'> & TeamMemberLimitContract
}

export const normalizeTeamMemberLimitInput = <T extends Record<string, any>>(entity: T): Record<string, any> => {
  if (entity.maxTeamMembers === undefined) return entity
  const { maxTeamMembers, ...rest } = entity
  return { ...rest, maxAgents: maxTeamMembers }
}

export type UsageMetric = {
  used: number
  limit: number
  percentage: number
}

export type PaginationMeta = {
  page: number
  limit: number
  total: number
}

export type CollectionContract<T> = {
  meta: PaginationMeta
  data: T[]
}

export type EntityContract<T> = {
  data: T
}

export type WebsiteSubmissionType = 'lead' | 'viewing' | 'review' | 'contact'
export type WebsiteSubmissionStatus = 'received'

export type WebsiteSubmissionReceipt = {
  submissionId: string
  submissionType: WebsiteSubmissionType
  status: WebsiteSubmissionStatus
  submittedAt: string
  linkedEntityId: string
}

export type AuthSessionSummary = {
  id: string
  current: boolean
  userAgent: string
  createdIp: string
  lastUsedIp: string
  lastUsedAt: string | null
  createdAt: string | null
  expiresAt: string
}

const asIso = (value: unknown): string | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const entityId = (entity: any): string => String(entity?._id ?? entity?.id ?? '')

export const buildWebsiteSubmissionReceipt = (
  submissionType: WebsiteSubmissionType,
  entity: any,
): WebsiteSubmissionReceipt => {
  const id = entityId(entity)
  const submittedAt = asIso(entity?.createdAt) || new Date().toISOString()
  return {
    submissionId: id,
    submissionType,
    status: 'received',
    submittedAt,
    linkedEntityId: id,
  }
}

export const withWebsiteSubmissionReceipt = <T extends Record<string, any>>(
  submissionType: WebsiteSubmissionType,
  entity: T,
): T & { submission: WebsiteSubmissionReceipt } => {
  const plain = toPlainObject(entity)
  return {
    ...plain,
    submission: buildWebsiteSubmissionReceipt(submissionType, plain),
  } as T & { submission: WebsiteSubmissionReceipt }
}

export const toAuthSessionSummary = (session: any, current = false): AuthSessionSummary => ({
  id: String(session?._id ?? session?.id ?? ''),
  current,
  userAgent: String(session?.userAgent || ''),
  createdIp: String(session?.createdIp || ''),
  lastUsedIp: String(session?.lastUsedIp || ''),
  lastUsedAt: asIso(session?.lastUsedAt),
  createdAt: asIso(session?.createdAt),
  expiresAt: asIso(session?.expiresAt) || new Date(0).toISOString(),
})
