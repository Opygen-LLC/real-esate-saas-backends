import httpStatus from 'http-status'
import JSZip from 'jszip'
import { Types } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { Activity } from '../activity/activity.model'
import { AuthSession } from '../auth/authSession.model'
import { Contact } from '../contact/contact.model'
import {
  FinanceBudget,
  FinanceCommission,
  FinanceInvoice,
  FinanceTransaction,
  FinanceVendor,
} from '../finance/finance.model'
import { Lead } from '../lead/lead.model'
import { LeadAddonSubscription } from '../leadAddonSubscription/leadAddonSubscription.model'
import { LeadPurchaseRequest } from '../leadPurchaseRequest/leadPurchaseRequest.model'
import { Notification } from '../notification/notification.model'
import { Organization } from '../organization/organization.model'
import { PrivacyConsentRecord } from '../privacy/privacyConsent.model'
import { Property } from '../property/property.model'
import { AgencyReview, ReviewInvitation } from '../review/review.model'
import { SubscriptionChangeRequest } from '../subscriptionChangeRequest/subscriptionChangeRequest.model'
import { SupportTicket } from '../support/support.model'
import { Task } from '../task/task.model'
import { TeamInvitation } from '../teamInvitation/teamInvitation.model'
import { Viewing } from '../viewing/viewing.model'
import { WebsiteSubmission } from '../websiteSubmission/websiteSubmission.model'
import { User } from './user.model'
import { USER_PROFILE_POPULATES, toUserDto } from './userProfile.service'

export const USER_DATA_EXPORT_SECTIONS = [
  'leads',
  'properties',
  'website_submissions',
  'profile_information',
  'other_profile_data',
] as const

export type UserDataExportSection = (typeof USER_DATA_EXPORT_SECTIONS)[number]
export type UserDataExportScope = 'organization' | 'self'

const SECTION_SET = new Set<string>(USER_DATA_EXPORT_SECTIONS)

export const parseUserDataExportSections = (input?: string | string[]): UserDataExportSection[] => {
  const raw = Array.isArray(input) ? input.join(',') : input || ''
  if (!raw.trim()) return [...USER_DATA_EXPORT_SECTIONS]

  const values = [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))]
  const invalid = values.filter((value) => !SECTION_SET.has(value))
  if (invalid.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Unsupported export section: ${invalid.join(', ')}`)
  }
  if (!values.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Select at least one data section to export')
  return values as UserDataExportSection[]
}

export const determineUserDataExportScope = (role: string): UserDataExportScope =>
  role === 'agency_owner' ? 'organization' : 'self'

const idString = (value: unknown): string => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value instanceof Types.ObjectId) return value.toHexString()
  if (typeof value === 'object' && '_id' in (value as Record<string, unknown>)) return idString((value as any)._id)
  return String(value)
}

const csvCell = (value: unknown): string => {
  let text = ''
  if (value !== null && value !== undefined) {
    text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

const cleanTopLevelRecord = (row: Record<string, any>): Record<string, any> => {
  const clean = { ...row }
  delete clean.__v
  return clean
}

export const rowsToCsv = (rows: Array<Record<string, any>>): string => {
  if (!rows.length) return '\uFEFF'
  const cleanRows = rows.map(cleanTopLevelRecord)
  const columns = [...new Set(cleanRows.flatMap((row) => Object.keys(row)))]
  const lines = [columns.map(csvCell).join(',')]
  for (const row of cleanRows) lines.push(columns.map((column) => csvCell(row[column])).join(','))
  return `\uFEFF${lines.join('\n')}\n`
}

const jsonFile = (zip: JSZip, path: string, value: unknown) => {
  zip.file(path, `${JSON.stringify(value, null, 2)}\n`)
}

const addDataset = (
  zip: JSZip,
  folder: string,
  name: string,
  rows: Array<Record<string, any>>,
) => {
  const clean = rows.map(cleanTopLevelRecord)
  jsonFile(zip, `${folder}/${name}.json`, clean)
  zip.file(`${folder}/${name}.csv`, rowsToCsv(clean))
}

const selfLeadFilter = (organizationId: string, userObjectId: Types.ObjectId) => ({
  organizationId,
  $or: [
    { assignedAgent: userObjectId },
    { createdBy: userObjectId },
    { updatedBy: userObjectId },
    { convertedBy: userObjectId },
  ],
})

const selfPropertyFilter = (organizationId: string, userObjectId: Types.ObjectId) => ({
  organizationId,
  agentId: userObjectId,
})

const relatedSelfIds = async (organizationId: string, userObjectId: Types.ObjectId) => {
  const [leadRows, propertyRows, viewingRows] = await Promise.all([
    Lead.find(selfLeadFilter(organizationId, userObjectId)).select('_id').lean(),
    Property.find(selfPropertyFilter(organizationId, userObjectId)).select('_id').lean(),
    Viewing.find({ organizationId, agentId: userObjectId }).select('_id').lean(),
  ])
  return {
    leadIds: leadRows.map((row: any) => row._id),
    propertyIds: propertyRows.map((row: any) => row._id),
    viewingIds: viewingRows.map((row: any) => row._id),
  }
}

const sanitizeSupportTickets = (tickets: any[]) => tickets.map((ticket) => {
  const clean = cleanTopLevelRecord(ticket)
  delete clean.internalNotes
  clean.attachments = Array.isArray(clean.attachments)
    ? clean.attachments
      .filter((attachment: any) => attachment?.visibility !== 'internal')
      .map((attachment: any) => {
        const safe = { ...attachment }
        delete safe.key
        return safe
      })
    : []
  return clean
})

const fetchOtherProfileData = async (
  organizationId: string,
  userObjectId: Types.ObjectId,
  userId: string,
  relationIds: { leadIds: any[]; propertyIds: any[]; viewingIds: any[] },
  permissions: Set<string>,
  role: string,
) => {
  const userObjectIdOr = (fields: string[]) => fields.map((field) => ({ [field]: userObjectId }))
  const userStringOr = (fields: string[]) => fields.map((field) => ({ [field]: userId }))

  const canReadContacts = permissions.has('contacts.read')
  const canReadViewings = permissions.has('viewings.read')
  const canReadTasks = permissions.has('tasks.read')
  const canReadActivities = permissions.has('leads.read') || permissions.has('contacts.read')
  const canReadFinance = permissions.has('finance.read')
  const canManageReviews = role === 'agency_owner' || role === 'agency_admin'

  const [
    contacts,
    viewings,
    tasks,
    activities,
    notifications,
    privacyConsents,
    sessions,
    financeTransactions,
    financeInvoices,
    financeCommissions,
    financeVendors,
    financeBudgets,
    reviewInvitations,
    moderatedReviews,
    supportTicketsRaw,
    teamInvitations,
    subscriptionChangeRequests,
    leadPurchaseRequests,
    leadAddonSubscriptions,
  ] = await Promise.all([
    canReadContacts ? Contact.find({
      organizationId,
      $or: [
        ...userObjectIdOr(['assignedTo', 'createdBy', 'updatedBy', 'convertedBy']),
        ...(relationIds.leadIds.length ? [{ sourceLeadId: { $in: relationIds.leadIds } }] : []),
      ],
    }).sort({ createdAt: 1, _id: 1 }).lean() : Promise.resolve([]),
    canReadViewings ? Viewing.find({
      organizationId,
      $or: [
        { agentId: userObjectId },
        ...(relationIds.leadIds.length ? [{ leadId: { $in: relationIds.leadIds } }] : []),
        ...(relationIds.propertyIds.length ? [{ propertyId: { $in: relationIds.propertyIds } }] : []),
      ],
    }).sort({ createdAt: 1, _id: 1 }).lean() : Promise.resolve([]),
    canReadTasks ? Task.find({
      organizationId,
      $or: [
        ...userObjectIdOr(['assignedAgent', 'approvedBy']),
        ...(relationIds.leadIds.length ? [{ linkedLead: { $in: relationIds.leadIds } }] : []),
        ...(relationIds.propertyIds.length ? [{ linkedProperty: { $in: relationIds.propertyIds } }] : []),
      ],
    }).sort({ createdAt: 1, _id: 1 }).lean() : Promise.resolve([]),
    canReadActivities ? Activity.find({
      organizationId,
      $or: [
        { agentId: userObjectId },
        ...(relationIds.leadIds.length ? [{ leadId: { $in: relationIds.leadIds } }] : []),
        ...(relationIds.propertyIds.length ? [{ propertyId: { $in: relationIds.propertyIds } }] : []),
      ],
    }).sort({ createdAt: 1, _id: 1 }).lean() : Promise.resolve([]),
    Notification.find({ organizationId, userId: userObjectId }).sort({ createdAt: 1, _id: 1 }).lean(),
    PrivacyConsentRecord.find({ organizationId, userId }).sort({ capturedAt: 1, _id: 1 }).lean(),
    AuthSession.find({ organizationId, userId: userObjectId })
      .select('_id organizationId expiresAt revokedAt revokeReason lastUsedAt lastUsedIp createdIp userAgent sessionVersion authorizationVersion authorizationChangedAt createdAt updatedAt')
      .sort({ createdAt: 1, _id: 1 })
      .lean(),
    canReadFinance ? FinanceTransaction.find({
      organizationId,
      $or: userObjectIdOr(['createdBy', 'updatedBy', 'voidedBy', 'deletedBy']),
    }).sort({ createdAt: 1, _id: 1 }).lean() : Promise.resolve([]),
    canReadFinance ? FinanceInvoice.find({
      organizationId,
      $or: [
        ...userObjectIdOr(['createdBy', 'updatedBy', 'cancelledBy', 'archivedBy']),
        { 'payments.recordedBy': userObjectId },
      ],
    }).sort({ createdAt: 1, _id: 1 }).lean() : Promise.resolve([]),
    canReadFinance ? FinanceCommission.find({
      organizationId,
      $or: userObjectIdOr(['agentId', 'createdBy', 'updatedBy', 'cancelledBy', 'archivedBy']),
    }).sort({ createdAt: 1, _id: 1 }).lean() : Promise.resolve([]),
    canReadFinance ? FinanceVendor.find({ organizationId, $or: userObjectIdOr(['createdBy', 'updatedBy']) })
      .sort({ createdAt: 1, _id: 1 }).lean() : Promise.resolve([]),
    canReadFinance ? FinanceBudget.find({ organizationId, $or: userObjectIdOr(['createdBy', 'updatedBy']) })
      .sort({ createdAt: 1, _id: 1 }).lean() : Promise.resolve([]),
    canManageReviews ? ReviewInvitation.find({ organizationId, createdBy: userObjectId })
      .select('-tokenHash').sort({ createdAt: 1, _id: 1 }).lean() : Promise.resolve([]),
    canManageReviews ? AgencyReview.find({ organizationId, moderatedBy: userObjectId }).sort({ createdAt: 1, _id: 1 }).lean() : Promise.resolve([]),
    SupportTicket.find({
      organizationId,
      $or: [
        ...userObjectIdOr(['userId', 'ownerId']),
        ...userStringOr(['messages.authorId']),
      ],
    }).sort({ createdAt: 1, _id: 1 }).lean(),
    TeamInvitation.find({ organizationId, invitedBy: userObjectId })
      .select('-tokenHash').sort({ createdAt: 1, _id: 1 }).lean(),
    SubscriptionChangeRequest.find({ organizationId, requestedBy: userId }).sort({ createdAt: 1, _id: 1 }).lean(),
    LeadPurchaseRequest.find({ organizationId, requestedBy: userId }).sort({ createdAt: 1, _id: 1 }).lean(),
    LeadAddonSubscription.find({ organizationId, requestedBy: userId }).sort({ createdAt: 1, _id: 1 }).lean(),
  ])

  return {
    contacts,
    viewings,
    tasks,
    activities,
    notifications,
    privacyConsents,
    sessions,
    financeTransactions,
    financeInvoices,
    financeCommissions,
    financeVendors,
    financeBudgets,
    reviewInvitations,
    moderatedReviews,
    supportTickets: sanitizeSupportTickets(supportTicketsRaw as any[]),
    teamInvitations,
    subscriptionChangeRequests,
    leadPurchaseRequests,
    leadAddonSubscriptions,
  }
}

const RELATIONSHIPS = {
  profile: {
    'user._id': 'Canonical exported user identifier used by User relationship fields in other datasets.',
    'user.organizationId': 'Tenant identifier applied to every exported tenant record.',
  },
  leads: {
    assignedAgent: 'profile-information/profile.json -> user._id',
    createdBy: 'profile-information/profile.json -> user._id when the current user created the record',
    propertyInterest: 'properties/properties.json -> _id',
    convertedContactId: 'other-profile-data/contacts.json -> _id',
  },
  properties: {
    agentId: 'profile-information/profile.json -> user._id',
    ownerId: 'other-profile-data/contacts.json -> _id when that contact is part of this export',
  },
  websiteSubmissions: {
    propertyId: 'properties/properties.json -> _id when that property is part of this export',
    linkedEntityId: 'Resolves according to linkedEntityType (Lead, Viewing, AgencyReview).',
    movedToCrmBy: 'profile-information/profile.json -> user._id when handled by the current user',
  },
  otherProfileData: {
    contacts: 'sourceLeadId -> leads._id; propertyInterest -> properties._id; assignedTo -> user._id',
    viewings: 'leadId -> leads._id; propertyId -> properties._id; agentId -> user._id',
    tasks: 'linkedLead -> leads._id; linkedProperty -> properties._id; assignedAgent -> user._id',
    activities: 'leadId/propertyId/contactId link to the corresponding exported records when present.',
    finance: 'propertyId/leadId/sourceId/payoutTransactionId retain canonical database identifiers.',
  },
}

export interface UserDataExportResult {
  buffer: Buffer
  fileName: string
  sections: UserDataExportSection[]
  scope: UserDataExportScope
  counts: Record<string, any>
  totalRecords: number
}

const buildUserDataExport = async (
  organizationId: string,
  userId: string,
  requestedSections?: string | string[],
): Promise<UserDataExportResult> => {
  const sections = parseUserDataExportSections(requestedSections)
  const userObjectId = new Types.ObjectId(userId)
  const userDocument = await User.findOne({ _id: userObjectId, organizationId }).populate(USER_PROFILE_POPULATES)
  if (!userDocument) throw new ApiError(httpStatus.NOT_FOUND, 'Profile not found')

  const profileDto = toUserDto(userDocument, {
    includeAccessControl: true,
    includePrivateProfile: true,
    includePermissions: true,
  })
  const role = profileDto.userRole
  const permissions = new Set(profileDto.permissions || [])
  const requiredPermissions: Partial<Record<UserDataExportSection, string>> = {
    leads: 'leads.read',
    properties: 'properties.read',
    website_submissions: 'website.submissions.read',
  }
  for (const section of sections) {
    const permission = requiredPermissions[section]
    if (permission && !permissions.has(permission)) {
      throw new ApiError(httpStatus.FORBIDDEN, `Your current access does not allow exporting ${section.replace(/_/g, ' ')}`)
    }
  }

  const scope = determineUserDataExportScope(role)
  const zip = new JSZip()
  const counts: Record<string, any> = {}
  let totalRecords = 0
  const generatedAt = new Date()

  const needsRelationIds = sections.includes('other_profile_data')
    || (scope === 'self' && sections.includes('website_submissions'))
  const relationIds = needsRelationIds
    ? await relatedSelfIds(organizationId, userObjectId)
    : { leadIds: [], propertyIds: [], viewingIds: [] }

  if (sections.includes('profile_information')) {
    const organization = await Organization.findOne({ organizationId }).select('organizationId agencyName').lean()
    const profile = {
      user: profileDto,
      organization: organization ? { organizationId: (organization as any).organizationId, agencyName: (organization as any).agencyName || '' } : { organizationId },
    }
    jsonFile(zip, 'profile-information/profile.json', profile)
    zip.file('profile-information/profile.csv', rowsToCsv([profile.user as any]))
    counts.profileInformation = 1
    totalRecords += 1
  }

  if (sections.includes('leads')) {
    const filter = scope === 'organization' ? { organizationId } : selfLeadFilter(organizationId, userObjectId)
    const rows = await Lead.find(filter).sort({ createdAt: 1, _id: 1 }).lean()
    addDataset(zip, 'leads', 'leads', rows as any[])
    counts.leads = rows.length
    totalRecords += rows.length
  }

  if (sections.includes('properties')) {
    const filter = scope === 'organization' ? { organizationId } : selfPropertyFilter(organizationId, userObjectId)
    const rows = await Property.find(filter).sort({ createdAt: 1, _id: 1 }).lean()
    addDataset(zip, 'properties', 'properties', rows as any[])
    counts.properties = rows.length
    totalRecords += rows.length
  }

  if (sections.includes('website_submissions')) {
    const filter = scope === 'organization'
      ? { organizationId }
      : {
          organizationId,
          $or: [
            { movedToCrmBy: userObjectId },
            ...(relationIds.propertyIds.length ? [{ propertyId: { $in: relationIds.propertyIds } }] : []),
            ...(relationIds.leadIds.length ? [{ linkedEntityType: 'Lead', linkedEntityId: { $in: relationIds.leadIds } }] : []),
            ...(relationIds.viewingIds.length ? [{ linkedEntityType: 'Viewing', linkedEntityId: { $in: relationIds.viewingIds } }] : []),
          ],
        }
    const rows = await WebsiteSubmission.find(filter).sort({ submittedAt: 1, _id: 1 }).lean()
    addDataset(zip, 'website-submissions', 'website-submissions', rows as any[])
    counts.websiteSubmissions = rows.length
    totalRecords += rows.length
  }

  if (sections.includes('other_profile_data')) {
    const other = await fetchOtherProfileData(organizationId, userObjectId, userId, relationIds, permissions, role)
    const folder = 'other-profile-data'
    for (const [name, records] of Object.entries(other)) {
      addDataset(zip, folder, name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), records as any[])
    }
    counts.otherProfileData = Object.fromEntries(Object.entries(other).map(([name, records]) => [name, records.length]))
    totalRecords += Object.values(other).reduce((sum, records) => sum + records.length, 0)
  }

  const manifest = {
    schemaVersion: 1,
    exportType: 'user_profile_data',
    generatedAt: generatedAt.toISOString(),
    organizationId,
    userId,
    userRole: role,
    scope,
    scopeDescription: scope === 'organization'
      ? 'Agency Owner export: Leads, Properties and Website Submissions are organization-wide. Profile Information and Other Profile Data remain tied to the signed-in user.'
      : 'Self export: records are included when the signed-in user is assigned, creator, handler, actor, or is connected through an exported lead/property relationship.',
    selectedSections: sections,
    counts,
    totalRecords,
    formats: ['json', 'csv'],
    relationshipFile: 'relationships.json',
    exclusions: [
      'Passwords and password hashes',
      'OTP codes/challenges and registration continuation secrets',
      'Refresh-token hashes and other authentication secrets',
      'Integration/API credentials and encrypted compliance identifiers',
      'Internal support notes and internal-only support attachments',
      'Binary file contents; stored file URLs/metadata remain inside exported records where applicable',
      'Platform security/audit telemetry not directly part of the user profile export',
    ],
  }

  jsonFile(zip, 'manifest.json', manifest)
  jsonFile(zip, 'relationships.json', RELATIONSHIPS)
  zip.file('README.txt', [
    'Opygen profile data export',
    '',
    'The JSON files are the canonical export and preserve nested fields and record relationship IDs.',
    'CSV copies are included for spreadsheet use; nested values are JSON-encoded inside CSV cells.',
    'See manifest.json for scope/counts/exclusions and relationships.json for relationship guidance.',
    '',
  ].join('\n'))

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const date = generatedAt.toISOString().slice(0, 10)
  const shortUser = idString(userObjectId).slice(-8)
  return {
    buffer,
    fileName: `opygen-profile-export-${date}-${shortUser}.zip`,
    sections,
    scope,
    counts,
    totalRecords,
  }
}

export const UserDataExportService = {
  buildUserDataExport,
}
