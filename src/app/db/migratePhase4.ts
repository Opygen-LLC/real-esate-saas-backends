import mongoose from 'mongoose'
import config from '../../config'
import { normalizeBangladeshPhone, normalizeEmail } from '../helpers/identity'

type RawLead = Record<string, any> & { _id: any; organizationId: string }

const safePhone = (value: unknown) => {
  try { return normalizeBangladeshPhone(String(value || '')) } catch { return '' }
}
const safeEmail = (value: unknown) => String(value || '').trim() ? normalizeEmail(String(value)) : ''
const uniqueIds = (items: any[] = []) => [...new Map(items.filter(Boolean).map((value) => [String(value?._id || value), value])).values()]

const mergeGroup = (group: RawLead[]) => {
  const sorted = [...group].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
  const target = { ...sorted[0] }
  const duplicateIds = sorted.slice(1).map((lead) => lead._id)
  const history = [...(target.mergeHistory || [])]
  const notes: string[] = []
  const addNote = (value: unknown) => { const note = String(value || '').trim(); if (note && !notes.includes(note)) notes.push(note) }
  sorted.forEach((lead, index) => {
    addNote(lead.notes)
    target.propertyInterest = uniqueIds([...(target.propertyInterest || []), ...(lead.propertyInterest || [])])
    if (!target.email && lead.email) target.email = lead.email
    if (!target.assignedAgent && lead.assignedAgent) target.assignedAgent = lead.assignedAgent
    if (!target.contactId && lead.contactId) target.contactId = lead.contactId
    if (lead.nextFollowUp && (!target.nextFollowUp || new Date(lead.nextFollowUp) < new Date(target.nextFollowUp))) target.nextFollowUp = lead.nextFollowUp
    if (index > 0) history.push({ mergedAt: new Date(), duplicateLeadId: String(lead._id), source: 'phase4-migration', changedFields: ['identity', 'notes', 'propertyInterest'] })
    if (new Date(lead.updatedAt || 0) > new Date(target.updatedAt || 0)) {
      target.leadStatus = lead.leadStatus || target.leadStatus
      target.lastContact = lead.lastContact || target.lastContact
      target.lostReason = lead.lostReason || target.lostReason
    }
  })
  target.notes = notes.join('\n\n--- merged duplicate ---\n\n')
  target.mergeHistory = history
  target.normalizedPhone = safePhone(target.phone) || sorted.map((lead) => safePhone(lead.phone)).find(Boolean)
  target.phone = target.normalizedPhone || target.phone
  target.normalizedEmail = safeEmail(target.email) || sorted.map((lead) => safeEmail(lead.email)).find(Boolean) || undefined
  target.email = target.normalizedEmail || undefined
  delete target._id
  return { target, duplicateIds }
}

const run = async () => {
  await mongoose.connect(config.database_string, { autoIndex: false })
  const leads = mongoose.connection.collection('leads')
  const all = await leads.find({}).sort({ organizationId: 1, createdAt: 1 }).toArray() as RawLead[]
  const byOrg = new Map<string, RawLead[]>()
  for (const lead of all) {
    const org = String(lead.organizationId || '')
    if (!byOrg.has(org)) byOrg.set(org, [])
    byOrg.get(org)!.push(lead)
  }

  let merged = 0
  let normalized = 0
  let invalidPhones = 0
  for (const [organizationId, orgLeads] of byOrg) {
    const parent = new Map<string, string>()
    const docById = new Map(orgLeads.map((lead) => [String(lead._id), lead]))
    const find = (id: string): string => { const p = parent.get(id) || id; if (p === id) return id; const root = find(p); parent.set(id, root); return root }
    const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra) }
    const phoneOwner = new Map<string, string>()
    const emailOwner = new Map<string, string>()
    for (const lead of orgLeads) {
      const id = String(lead._id); parent.set(id, id)
      const phone = safePhone(lead.phone || lead.normalizedPhone)
      const email = safeEmail(lead.email || lead.normalizedEmail)
      if (!phone) invalidPhones += 1
      if (phone) { const owner = phoneOwner.get(phone); if (owner) union(owner, id); else phoneOwner.set(phone, id) }
      if (email) { const owner = emailOwner.get(email); if (owner) union(owner, id); else emailOwner.set(email, id) }
    }
    const groups = new Map<string, RawLead[]>()
    for (const id of docById.keys()) { const root = find(id); if (!groups.has(root)) groups.set(root, []); groups.get(root)!.push(docById.get(id)!) }
    for (const group of groups.values()) {
      const valid = group.filter((lead) => safePhone(lead.phone || lead.normalizedPhone))
      if (!valid.length) continue
      const { target, duplicateIds } = mergeGroup(group)
      const targetDoc = [...group].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())[0]
      if (duplicateIds.length) { await leads.deleteMany({ _id: { $in: duplicateIds } }); merged += duplicateIds.length }
      await leads.updateOne({ _id: targetDoc._id, organizationId }, { $set: target, ...(target.normalizedEmail ? {} : { $unset: { normalizedEmail: '', email: '' } }) })
      normalized += 1
    }
  }

  const indexes = await leads.indexes().catch(() => [] as any[])
  for (const name of ['organizationId_1_normalizedPhone_1', 'organizationId_1_normalizedEmail_1']) {
    if (indexes.some((index: any) => index.name === name)) await leads.dropIndex(name)
  }
  await leads.createIndex({ organizationId: 1, normalizedPhone: 1 }, { name: 'organizationId_1_normalizedPhone_1', unique: true, partialFilterExpression: { normalizedPhone: { $type: 'string' } } })
  await leads.createIndex({ organizationId: 1, normalizedEmail: 1 }, { name: 'organizationId_1_normalizedEmail_1', unique: true, partialFilterExpression: { normalizedEmail: { $type: 'string', $gt: '' } } })
  console.log(`Phase 4 migration completed: ${normalized} lead identities normalized, ${merged} duplicate rows consolidated, ${invalidPhones} legacy rows require phone cleanup.`)
  await mongoose.disconnect()
}

run().catch(async (error) => { console.error(error); await mongoose.disconnect().catch(() => undefined); process.exit(1) })
