import { Activity } from './activity.model'

export type ExportActivitySummary = {
  title: string
  content: string
  type: string
  occurredAt?: Date
}

export type ExportActivityProjection = {
  latestNote?: ExportActivitySummary
  latestInteraction?: ExportActivitySummary
}

type AggregateRow = {
  _id: unknown
  activity?: {
    title?: string
    content?: string
    type?: string
    metadata?: Record<string, unknown>
    createdAt?: Date
  }
}

const interactionMatch = {
  $or: [
    { type: { $in: ['call', 'email', 'whatsapp', 'meeting', 'viewing', 'offer'] } },
    { 'metadata.eventType': { $regex: '^sms\\.' } },
  ],
}

const summary = (activity?: AggregateRow['activity']): ExportActivitySummary | undefined => activity ? {
  title: String(activity.title || 'CRM interaction'),
  content: String(activity.content || ''),
  type: String(activity.metadata?.eventType || activity.type || 'interaction'),
  occurredAt: activity.createdAt,
} : undefined

const latestByReference = async (
  organizationId: string,
  field: 'leadId' | 'contactId',
  ids: unknown[],
  kind: 'note' | 'interaction',
): Promise<Map<string, ExportActivitySummary>> => {
  const result = new Map<string, ExportActivitySummary>()
  if (!ids.length) return result
  const kindMatch = kind === 'note' ? { type: 'note' } : interactionMatch
  const rows = await Activity.aggregate<AggregateRow>([
    { $match: { organizationId, [field]: { $in: ids }, ...kindMatch } },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $group: {
        _id: `$${field}`,
        activity: {
          $first: {
            title: '$title',
            content: '$content',
            type: '$type',
            metadata: '$metadata',
            createdAt: '$createdAt',
          },
        },
      },
    },
  ])
  for (const row of rows) {
    const value = summary(row.activity)
    if (value) result.set(String(row._id), value)
  }
  return result
}

const later = (a?: ExportActivitySummary, b?: ExportActivitySummary): ExportActivitySummary | undefined => {
  if (!a) return b
  if (!b) return a
  const aTime = a.occurredAt ? new Date(a.occurredAt).getTime() : 0
  const bTime = b.occurredAt ? new Date(b.occurredAt).getTime() : 0
  return aTime >= bTime ? a : b
}

const getLeadExportActivityProjection = async (
  organizationId: string,
  leads: Array<{ _id: unknown }>,
): Promise<Map<string, ExportActivityProjection>> => {
  const ids = leads.map((lead) => lead._id).filter(Boolean)
  const [notes, interactions] = await Promise.all([
    latestByReference(organizationId, 'leadId', ids, 'note'),
    latestByReference(organizationId, 'leadId', ids, 'interaction'),
  ])
  const result = new Map<string, ExportActivityProjection>()
  for (const id of ids) {
    const key = String(id)
    result.set(key, { latestNote: notes.get(key), latestInteraction: interactions.get(key) })
  }
  return result
}

const getContactExportActivityProjection = async (
  organizationId: string,
  contacts: Array<{ _id: unknown; sourceLeadId?: unknown }>,
): Promise<Map<string, ExportActivityProjection>> => {
  const contactIds = contacts.map((contact) => contact._id).filter(Boolean)
  const sourceLeadEntries = contacts
    .map((contact) => {
      const source = contact.sourceLeadId as any
      return { contactId: String(contact._id), leadId: source?._id || source }
    })
    .filter((entry) => Boolean(entry.leadId))
  const leadIds = sourceLeadEntries.map((entry) => entry.leadId)

  const [contactNotes, contactInteractions, leadNotes, leadInteractions] = await Promise.all([
    latestByReference(organizationId, 'contactId', contactIds, 'note'),
    latestByReference(organizationId, 'contactId', contactIds, 'interaction'),
    latestByReference(organizationId, 'leadId', leadIds, 'note'),
    latestByReference(organizationId, 'leadId', leadIds, 'interaction'),
  ])

  const sourceLeadByContact = new Map(sourceLeadEntries.map((entry) => [entry.contactId, String(entry.leadId)]))
  const result = new Map<string, ExportActivityProjection>()
  for (const contactIdRaw of contactIds) {
    const contactId = String(contactIdRaw)
    const leadId = sourceLeadByContact.get(contactId)
    result.set(contactId, {
      latestNote: later(contactNotes.get(contactId), leadId ? leadNotes.get(leadId) : undefined),
      latestInteraction: later(contactInteractions.get(contactId), leadId ? leadInteractions.get(leadId) : undefined),
    })
  }
  return result
}

export const ActivityExportService = {
  getLeadExportActivityProjection,
  getContactExportActivityProjection,
}
