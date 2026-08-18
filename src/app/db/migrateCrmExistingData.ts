import mongoose, { Types } from 'mongoose'
import config from '../../config'
import {
  LEAD_STATUS,
  LEAD_STATUS_VALUES,
  normalizeLeadStatus,
} from '../module/lead/leadStatus.contract'
import { CONTACT_RELATIONSHIP_STATE } from '../module/contact/contactRelationship.contract'

const MIGRATION_NAME = 'crm-phase2-existing-data'
const LEGACY_NOTE_ACTOR_LABEL = 'Legacy / System migration'

const sameKey = (left: Record<string, unknown>, right: Record<string, unknown>) =>
  JSON.stringify(left) === JSON.stringify(right)

const ensureIndex = async (
  collection: any,
  key: Record<string, 1 | -1>,
  options: Record<string, unknown>,
) => {
  let existing: any[] = []
  try {
    existing = await collection.indexes()
  } catch (error: any) {
    if (error?.code !== 26 && error?.codeName !== 'NamespaceNotFound') throw error
  }
  const equivalent = existing.find((index: any) => sameKey(index.key, key))
  if (equivalent) {
    if (options.unique === true && equivalent.unique !== true) {
      throw new Error(`Index ${equivalent.name} has the required key pattern but is not unique`)
    }
    const requiredPartial = options.partialFilterExpression
    if (
      requiredPartial &&
      JSON.stringify(equivalent.partialFilterExpression || null) !== JSON.stringify(requiredPartial)
    ) {
      throw new Error(`Index ${equivalent.name} has the required key pattern but an incompatible partial filter`)
    }
    return equivalent.name
  }
  return collection.createIndex(key, options)
}

const asDate = (value: unknown): Date | undefined => {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? undefined : date
}

const firstDate = (...values: unknown[]): Date | undefined => {
  for (const value of values) {
    const date = asDate(value)
    if (date) return date
  }
  return undefined
}

const objectIdString = (value: unknown): string | undefined => {
  if (!value) return undefined
  try {
    return String(value)
  } catch {
    return undefined
  }
}

const legacyNoteMigrationKey = (leadId: unknown) => `${MIGRATION_NAME}:lead-note:${String(leadId)}`

const run = async () => {
  const migrationStartedAt = new Date()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const leads = db.collection('leads')
  const contacts = db.collection('contacts')
  const activities = db.collection('activities')
  const domainEvents = db.collection('domainevents')

  // Preflight before mutating anything. Unknown status values need an explicit business mapping.
  const allowedBeforeMigration = [...LEAD_STATUS_VALUES, 'Qualified']
  const unknownStatuses = await leads.distinct('leadStatus', {
    leadStatus: { $exists: true, $nin: [...allowedBeforeMigration, null, ''] },
  })
  if (unknownStatuses.length) {
    throw new Error(
      `CRM Phase 2 migration stopped because unsupported lead statuses exist: ${unknownStatuses
        .map(String)
        .sort()
        .join(', ')}. Map them to the canonical CRM status contract before retrying.`,
    )
  }

  // The legacy ensureContact flow could reuse a Contact by phone/email. One Contact cannot safely
  // become the conversion source for multiple Leads in the new one-source-lead relationship.
  const ambiguousContactLinks = await leads
    .aggregate([
      { $addFields: { migrationContactId: { $ifNull: ['$convertedContactId', '$contactId'] } } },
      { $match: { migrationContactId: { $type: 'objectId' } } },
      {
        $group: {
          _id: { organizationId: '$organizationId', contactId: '$migrationContactId' },
          leadIds: { $push: '$_id' },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 20 },
    ])
    .toArray()
  if (ambiguousContactLinks.length) {
    const examples = ambiguousContactLinks
      .map((entry: any) => `${String(entry._id?.contactId)} -> ${entry.leadIds.map(String).join('|')}`)
      .join(', ')
    throw new Error(
      `CRM Phase 2 migration stopped because a legacy Contact is linked to multiple Leads. Resolve these ambiguous links first. Examples: ${examples}`,
    )
  }

  // Validate every referenced Contact before writes: no stale IDs, cross-tenant links, or a Contact
  // that is already attributed to a different source Lead.
  const invalidContactReferences = await leads
    .aggregate([
      { $addFields: { migrationContactId: { $ifNull: ['$convertedContactId', '$contactId'] } } },
      { $match: { migrationContactId: { $type: 'objectId' } } },
      {
        $lookup: {
          from: 'contacts',
          localField: 'migrationContactId',
          foreignField: '_id',
          as: 'migrationContact',
        },
      },
      { $unwind: { path: '$migrationContact', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          $or: [
            { 'migrationContact._id': { $exists: false } },
            { $expr: { $ne: ['$migrationContact.organizationId', '$organizationId'] } },
            {
              $expr: {
                $and: [
                  { $eq: [{ $type: '$migrationContact.sourceLeadId' }, 'objectId'] },
                  { $ne: ['$migrationContact.sourceLeadId', '$_id'] },
                ],
              },
            },
          ],
        },
      },
      { $project: { _id: 1, organizationId: 1, migrationContactId: 1, migrationContact: 1 } },
      { $limit: 20 },
    ])
    .toArray()
  if (invalidContactReferences.length) {
    const examples = invalidContactReferences
      .map((entry: any) => `${String(entry._id)} -> ${String(entry.migrationContactId)}`)
      .join(', ')
    throw new Error(
      `CRM Phase 2 migration stopped because invalid legacy Lead→Contact references exist (missing Contact, cross-agency Contact, or conflicting sourceLeadId). Examples: ${examples}`,
    )
  }

  // Detect inconsistent Phase 1/partial migration links instead of silently selecting one Contact.
  const conflictingConversionLinks = await leads
    .find(
      {
        contactId: { $type: 'objectId' },
        convertedContactId: { $type: 'objectId' },
        $expr: { $ne: ['$contactId', '$convertedContactId'] },
      },
      { projection: { contactId: 1, convertedContactId: 1 } },
    )
    .limit(20)
    .toArray()
  if (conflictingConversionLinks.length) {
    throw new Error(
      `CRM Phase 2 migration stopped because ${conflictingConversionLinks.length} sampled Lead(s) have conflicting contactId/convertedContactId values. Example lead ids: ${conflictingConversionLinks
        .map((lead: any) => String(lead._id))
        .join(', ')}`,
    )
  }

  // A deterministic unique key makes legacy note projection safe across retries/concurrent runs.
  await ensureIndex(
    activities,
    { organizationId: 1, 'metadata.migrationKey': 1 },
    {
      name: 'activity_tenant_migration_key_unique',
      unique: true,
      partialFilterExpression: { 'metadata.migrationKey': { $type: 'string' } },
    },
  )

  const [qualifiedResult, missingStatusResult] = await Promise.all([
    leads.updateMany({ leadStatus: 'Qualified' }, { $set: { leadStatus: LEAD_STATUS.INTERESTED } }),
    leads.updateMany(
      { $or: [{ leadStatus: { $exists: false } }, { leadStatus: null }, { leadStatus: '' }] },
      { $set: { leadStatus: LEAD_STATUS.NEW } },
    ),
  ])

  // Build the best historical Won timestamp map once instead of issuing an N+1 query per Lead.
  const wonEventByLead = new Map<string, Date>()
  for await (const row of domainEvents.aggregate([
    {
      $match: {
        eventType: 'lead.stage_changed',
        'payload.leadStatus': LEAD_STATUS.WON,
        leadId: { $type: 'objectId' },
      },
    },
    { $group: { _id: '$leadId', convertedAt: { $max: '$occurredAt' } } },
  ])) {
    const date = asDate((row as any).convertedAt)
    if (date) wonEventByLead.set(String((row as any)._id), date)
  }

  let leadsProcessed = 0
  let wonLeads = 0
  let openLeads = 0
  let contactsReused = 0
  let contactsCreated = 0
  let contactsClassifiedLegacy = 0
  let legacyNotesProjected = 0
  const missingReferencedContacts: string[] = []

  const leadCursor = leads.find(
    {},
    {
      projection: {
        organizationId: 1,
        name: 1,
        phone: 1,
        normalizedPhone: 1,
        email: 1,
        normalizedEmail: 1,
        source: 1,
        propertyInterest: 1,
        assignedAgent: 1,
        followUpDate: 1,
        nextFollowUp: 1,
        contactId: 1,
        convertedContactId: 1,
        convertedAt: 1,
        leadStatus: 1,
        notes: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  )

  for await (const lead of leadCursor) {
    leadsProcessed += 1
    const normalizedStatus = normalizeLeadStatus(lead.leadStatus) || LEAD_STATUS.NEW
    const isWon = normalizedStatus === LEAD_STATUS.WON
    const followUpDate = firstDate(lead.followUpDate, lead.nextFollowUp)
    const legacyContactId = lead.convertedContactId || lead.contactId
    let contact: any | null = null

    if (legacyContactId) {
      contact = await contacts.findOne({ _id: legacyContactId })
      if (!contact) {
        missingReferencedContacts.push(`${String(lead._id)} -> ${String(legacyContactId)}`)
        if (missingReferencedContacts.length >= 20) break
      } else if (String(contact.organizationId) !== String(lead.organizationId)) {
        throw new Error(
          `CRM Phase 2 migration stopped: Lead ${String(lead._id)} references Contact ${String(
            contact._id,
          )} from a different organization.`,
        )
      }
      if (
        contact?.sourceLeadId &&
        String(contact.sourceLeadId) !== String(lead._id)
      ) {
        throw new Error(
          `CRM Phase 2 migration stopped: Contact ${String(contact._id)} already points to sourceLeadId ${String(
            contact.sourceLeadId,
          )}, but Lead ${String(lead._id)} references it.`,
        )
      }
    }

    // Recover safely from a previously interrupted run that created/classified the Contact
    // before the Lead-side link was persisted.
    if (!contact) {
      contact = await contacts.findOne({
        organizationId: lead.organizationId,
        sourceLeadId: lead._id,
      })
    }

    if (missingReferencedContacts.length) continue

    if (isWon) {
      wonLeads += 1
      const convertedAt =
        firstDate(
          lead.convertedAt,
          contact?.convertedAt,
          wonEventByLead.get(String(lead._id)),
          lead.updatedAt,
          lead.createdAt,
        ) || migrationStartedAt

      if (!contact) {
        if (!lead.name || !lead.phone) {
          throw new Error(
            `CRM Phase 2 migration stopped: Won Lead ${String(lead._id)} has no Contact and lacks name/phone required to create one.`,
          )
        }
        const contactId = new Types.ObjectId()
        const createdAt = firstDate(lead.createdAt, convertedAt) || migrationStartedAt
        await contacts.insertOne({
          _id: contactId,
          organizationId: lead.organizationId,
          name: lead.name,
          phone: lead.phone,
          normalizedPhone: lead.normalizedPhone || lead.phone,
          ...(lead.email ? { email: lead.email } : {}),
          ...(lead.normalizedEmail ? { normalizedEmail: lead.normalizedEmail } : {}),
          type: 'Buyer',
          address: '',
          city: '',
          state: '',
          country: 'Bangladesh',
          company: '',
          notes: '',
          tags: [],
          relationshipState: CONTACT_RELATIONSHIP_STATE.ACTIVE,
          sourceLeadId: lead._id,
          ...(lead.assignedAgent ? { assignedTo: lead.assignedAgent } : {}),
          ...(lead.source ? { source: lead.source } : {}),
          propertyInterest: Array.isArray(lead.propertyInterest) ? lead.propertyInterest : [],
          ...(followUpDate ? { followUpDate } : {}),
          convertedAt,
          statusAtConversion: LEAD_STATUS.WON,
          createdAt,
          updatedAt: migrationStartedAt,
        })
        contact = { _id: contactId, convertedAt }
        contactsCreated += 1
      } else {
        const contactPatch: Record<string, unknown> = {
          relationshipState: CONTACT_RELATIONSHIP_STATE.ACTIVE,
          sourceLeadId: lead._id,
          convertedAt,
          statusAtConversion: LEAD_STATUS.WON,
          updatedAt: migrationStartedAt,
        }
        if (!contact.assignedTo && lead.assignedAgent) contactPatch.assignedTo = lead.assignedAgent
        if (!contact.source && lead.source) contactPatch.source = lead.source
        if ((!contact.propertyInterest || !contact.propertyInterest.length) && Array.isArray(lead.propertyInterest)) {
          contactPatch.propertyInterest = lead.propertyInterest
        }
        if (!contact.followUpDate && followUpDate) contactPatch.followUpDate = followUpDate
        await contacts.updateOne({ _id: contact._id }, { $set: contactPatch })
        contactsReused += 1
      }

      await leads.updateOne(
        { _id: lead._id },
        {
          $set: {
            leadStatus: LEAD_STATUS.WON,
            isConverted: true,
            convertedAt,
            convertedContactId: contact._id,
            ...(followUpDate ? { followUpDate } : {}),
          },
        },
      )
    } else {
      openLeads += 1
      const $set: Record<string, unknown> = {
        leadStatus: normalizedStatus,
        isConverted: false,
      }
      if (followUpDate) $set.followUpDate = followUpDate

      await leads.updateOne(
        { _id: lead._id },
        {
          $set,
          $unset: {
            convertedAt: '',
            convertedBy: '',
            convertedContactId: '',
          },
        },
      )

      if (contact) {
        const contactPatch: Record<string, unknown> = {
          relationshipState: CONTACT_RELATIONSHIP_STATE.LEGACY_PRECONVERSION,
          sourceLeadId: lead._id,
          updatedAt: migrationStartedAt,
        }
        if (!contact.assignedTo && lead.assignedAgent) contactPatch.assignedTo = lead.assignedAgent
        if (!contact.source && lead.source) contactPatch.source = lead.source
        if ((!contact.propertyInterest || !contact.propertyInterest.length) && Array.isArray(lead.propertyInterest)) {
          contactPatch.propertyInterest = lead.propertyInterest
        }
        if (!contact.followUpDate && followUpDate) contactPatch.followUpDate = followUpDate
        await contacts.updateOne(
          { _id: contact._id },
          {
            $set: contactPatch,
            $unset: { convertedAt: '', convertedBy: '', statusAtConversion: '' },
          },
        )
        contactsClassifiedLegacy += 1
      }
    }

    const legacyNotes = typeof lead.notes === 'string' ? lead.notes.trim() : ''
    if (legacyNotes) {
      const migrationKey = legacyNoteMigrationKey(lead._id)
      const approximateHistoricalDate =
        firstDate(lead.updatedAt, lead.createdAt) || migrationStartedAt
      const noteResult = await activities.updateOne(
        { organizationId: lead.organizationId, 'metadata.migrationKey': migrationKey },
        {
          $set: {
            leadId: lead._id,
            type: 'note',
            title: 'Legacy lead note',
            content: legacyNotes,
            updatedAt: migrationStartedAt,
            metadata: {
              migrationKey,
              migrationName: MIGRATION_NAME,
              legacySource: 'Lead.notes',
              systemActorLabel: LEGACY_NOTE_ACTOR_LABEL,
              historicalTimestampApproximate: true,
            },
          },
          $setOnInsert: {
            createdAt: approximateHistoricalDate,
          },
        },
        { upsert: true },
      )
      if (noteResult.upsertedCount || noteResult.modifiedCount) legacyNotesProjected += 1
    }
  }

  if (missingReferencedContacts.length) {
    throw new Error(
      `CRM Phase 2 migration stopped because Lead documents reference missing Contacts. No relationship should be guessed. Examples: ${missingReferencedContacts.join(', ')}`,
    )
  }

  // Contacts never linked by the legacy lead flow are real/manual contacts and remain visible.
  const manualContactResult = await contacts.updateMany(
    {
      sourceLeadId: { $exists: false },
      $or: [
        { relationshipState: { $exists: false } },
        { relationshipState: null },
        { relationshipState: '' },
      ],
    },
    { $set: { relationshipState: CONTACT_RELATIONSHIP_STATE.ACTIVE } },
  )

  await ensureIndex(
    contacts,
    { organizationId: 1, relationshipState: 1, updatedAt: -1 },
    { name: 'contact_tenant_relationship_updated' },
  )

  // Keep Phase 1 one-to-one sourceLead relationship enforced after all legacy links are populated.
  await ensureIndex(
    contacts,
    { organizationId: 1, sourceLeadId: 1 },
    {
      name: 'contact_tenant_source_lead_unique',
      unique: true,
      partialFilterExpression: { sourceLeadId: { $type: 'objectId' } },
    },
  )

  console.log(
    [
      'CRM Phase 2 existing-data migration completed successfully.',
      `${qualifiedResult.modifiedCount} Qualified leads moved to Interested.`,
      `${missingStatusResult.modifiedCount} missing statuses set to New.`,
      `${leadsProcessed} leads processed (${wonLeads} Won/converted, ${openLeads} open).`,
      `${contactsReused} existing Contacts reused for Won leads; ${contactsCreated} missing Won Contacts created.`,
      `${contactsClassifiedLegacy} open-lead Contacts classified as legacy/pre-conversion.`,
      `${manualContactResult.modifiedCount} unlinked/manual Contacts explicitly classified active.`,
      `${legacyNotesProjected} legacy Lead.notes timelines inserted/updated without inventing an author.`,
    ].join(' '),
  )

  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
