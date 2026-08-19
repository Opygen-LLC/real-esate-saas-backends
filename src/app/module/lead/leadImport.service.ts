import crypto from 'crypto'
import ExcelJS from 'exceljs'
import ApiError from '../../../errors/ApiError'
import { csvCell, parseSpreadsheetUpload } from '../import/spreadsheetImport.service'
import { normalizeBangladeshPhone, normalizeEmail } from '../../helpers/identity'
import { canAssignLeadTo, type CrmAccessContext } from '../crm/crmAccess'
import { Contact } from '../contact/contact.model'
import { User } from '../user/user.model'
import { Lead } from './lead.model'
import { LeadService } from './lead.service'
import { LeadImportSession } from './leadImportSession.model'
import {
  LEAD_STATUS,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_VALUES,
  type LeadStatus,
} from './leadStatus.contract'

const IMPORT_SESSION_TTL_SECONDS = 30 * 60
const MAX_IMPORT_ROWS = 2_000
const MAX_SESSION_BYTES = 8 * 1024 * 1024

const LEAD_SOURCES = ['Website','WhatsApp','Facebook','Instagram','Google','Referral','WalkIn','Portal','Phone','Email','Ad','Other'] as const
type LeadSource = (typeof LEAD_SOURCES)[number]

type ImportRowStatus = 'valid' | 'invalid' | 'duplicate'

type ParsedUpload = {
  headers: string[]
  rows: Array<{ row: number; values: unknown[] }>
  sheetName?: string
}

type NormalizedImportRow = {
  name: string
  phone: string
  email?: string
  source: LeadSource
  leadStatus: LeadStatus
  assignedAgent?: string
  assignedToName?: string
  followUpDate?: string
  notes?: string
}

type PreviewRow = {
  row: number
  status: ImportRowStatus
  reason: string
  normalized: Partial<NormalizedImportRow>
}

type ImportIssue = {
  row: number
  type: 'invalid' | 'duplicate' | 'failed'
  reason: string
}

type ImportSession = {
  version: 1
  organizationId: string
  userId: string
  fileName: string
  createdAt: string
  expiresAt: string
  total: number
  skippedDuplicates: number
  preflightIssues: ImportIssue[]
  validRows: Array<{ row: number; data: NormalizedImportRow }>
}

const normalizeHeader = (value: unknown): string => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')

type ImportColumn = 'name' | 'phone' | 'email' | 'source' | 'status' | 'assignedTo' | 'followUpDate' | 'notes'

const FIELD_ALIASES: Record<ImportColumn, string[]> = {
  name: ['name', 'fullname', 'leadname', 'clientname'],
  phone: ['phone', 'mobile', 'phonenumber', 'mobilenumber'],
  email: ['email', 'emailaddress'],
  source: ['source', 'leadsource'],
  status: ['status', 'leadstatus', 'pipelinestatus', 'stage'],
  assignedTo: ['assignedto', 'assignedagent', 'assignee', 'agent'],
  followUpDate: ['followupdate', 'nextfollowup', 'followup', 'followupdatetime'],
  notes: ['notes', 'note', 'initialnote'],
}

const HEADER_TO_FIELD = new Map<string, ImportColumn>()
for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<[ImportColumn, string[]]>) {
  for (const alias of aliases) HEADER_TO_FIELD.set(alias, field)
}

const sourceByToken = new Map<string, LeadSource>(LEAD_SOURCES.map((source) => [normalizeHeader(source), source]))
const statusByToken = new Map<string, LeadStatus>()
for (const status of LEAD_STATUS_VALUES) {
  statusByToken.set(normalizeHeader(status), status)
  statusByToken.set(normalizeHeader(LEAD_STATUS_LABELS[status]), status)
}
statusByToken.set('qualified', LEAD_STATUS.INTERESTED)

const parseUpload = async (file: Express.Multer.File): Promise<ParsedUpload> => parseSpreadsheetUpload(file, {
  maxRows: MAX_IMPORT_ROWS,
  entityLabel: 'Lead',
})

const buildColumnMap = (headers: string[]): Map<ImportColumn, number> => {
  const mapped = new Map<ImportColumn, number>()
  headers.forEach((header, index) => {
    const field = HEADER_TO_FIELD.get(normalizeHeader(header))
    if (!field) return
    if (mapped.has(field)) throw new ApiError(400, `Import contains multiple columns for ${field}`)
    mapped.set(field, index)
  })
  if (!mapped.has('name') || !mapped.has('phone')) throw new ApiError(400, 'Import requires name and phone columns')
  return mapped
}

const rawAt = (values: unknown[], map: Map<ImportColumn, number>, field: ImportColumn): unknown => {
  const index = map.get(field)
  return index == null ? undefined : values[index]
}

const stringAt = (values: unknown[], map: Map<ImportColumn, number>, field: ImportColumn): string => {
  const value = rawAt(values, map, field)
  return value == null ? '' : String(value).trim()
}

const localDhakaDate = (date: Date): Date => {
  const pad = (value: number) => String(value).padStart(2, '0')
  const iso = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}+06:00`
  return new Date(iso)
}

const excelSerialToDhakaDate = (serial: number): Date | undefined => {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 100_000) return undefined
  const utc = new Date(Math.round((serial - 25_569) * 86_400_000))
  return Number.isNaN(utc.getTime()) ? undefined : localDhakaDate(utc)
}

const parseFollowUpDate = (value: unknown): Date | undefined => {
  if (value == null || String(value).trim() === '') return undefined
  if (value instanceof Date) return localDhakaDate(value)
  if (typeof value === 'number') return excelSerialToDhakaDate(value)
  const text = String(value).trim()
  const localMatch = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/)
  const candidate = localMatch
    ? `${localMatch[1]}T${localMatch[2]}:${localMatch[3] || '00'}+06:00`
    : text
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(candidate)) return undefined
  const parsed = new Date(candidate)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

const normalizeSource = (value: string): LeadSource | undefined => value ? sourceByToken.get(normalizeHeader(value)) : 'Other'
const normalizeStatus = (value: string): LeadStatus | undefined => value ? statusByToken.get(normalizeHeader(value)) : LEAD_STATUS.NEW

const resolveAssignee = (
  raw: string,
  assignees: any[],
  access: CrmAccessContext,
): { id?: string; name?: string; error?: string } => {
  if (!raw) {
    if (!access.isManager && !access.permissions.includes('leads.assign')) {
      const self = assignees.find((user) => String(user._id) === access.userId)
      return { id: access.userId, name: self?.name || 'Current user' }
    }
    return {}
  }
  const token = raw.trim()
  const lower = token.toLowerCase()
  let matches: any[] = []
  if (/^[0-9a-fA-F]{24}$/.test(token)) matches = assignees.filter((user) => String(user._id) === token)
  else if (token.includes('@')) matches = assignees.filter((user) => String(user.email || '').toLowerCase() === lower)
  else matches = assignees.filter((user) => String(user.name || '').trim().toLowerCase() === lower)

  if (!matches.length) return { error: `Assigned team member '${raw}' was not found or is inactive` }
  if (matches.length > 1) return { error: `Assigned team member name '${raw}' is ambiguous; use email or user ID` }
  const user = matches[0]
  const id = String(user._id)
  if (!canAssignLeadTo(access, id)) return { error: 'You do not have permission to assign imported leads to another team member' }
  return { id, name: String(user.name || user.email || id) }
}

const validateBaseRow = (
  row: { row: number; values: unknown[] },
  columns: Map<ImportColumn, number>,
  assignees: any[],
  access: CrmAccessContext,
): { normalized: Partial<NormalizedImportRow>; errors: string[] } => {
  const errors: string[] = []
  const normalized: Partial<NormalizedImportRow> = {}

  const name = stringAt(row.values, columns, 'name')
  if (!name) errors.push('Name is required')
  else if (name.length > 120) errors.push('Name must be 120 characters or fewer')
  else normalized.name = name

  const rawPhone = stringAt(row.values, columns, 'phone')
  if (!rawPhone) errors.push('Phone is required')
  else {
    try { normalized.phone = normalizeBangladeshPhone(rawPhone) }
    catch { errors.push('Phone must be a valid Bangladesh mobile number') }
  }

  const rawEmail = stringAt(row.values, columns, 'email')
  if (rawEmail) {
    const email = normalizeEmail(rawEmail)
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email is invalid')
    else normalized.email = email
  }

  const rawSource = stringAt(row.values, columns, 'source')
  const source = normalizeSource(rawSource)
  if (!source) errors.push(`Source '${rawSource}' is invalid`)
  else normalized.source = source

  const rawStatus = stringAt(row.values, columns, 'status')
  const status = normalizeStatus(rawStatus)
  if (!status) errors.push(`Status '${rawStatus}' is invalid`)
  else normalized.leadStatus = status

  const rawAssignee = stringAt(row.values, columns, 'assignedTo')
  const assignee = resolveAssignee(rawAssignee, assignees, access)
  if (assignee.error) errors.push(assignee.error)
  else if (assignee.id) {
    normalized.assignedAgent = assignee.id
    normalized.assignedToName = assignee.name
  }

  const rawFollowUp = rawAt(row.values, columns, 'followUpDate')
  if (rawFollowUp != null && String(rawFollowUp).trim()) {
    const followUpDate = parseFollowUpDate(rawFollowUp)
    if (!followUpDate) errors.push('followUpDate must be an Excel date or ISO date/time (for example 2026-08-20T15:30:00+06:00)')
    else normalized.followUpDate = followUpDate.toISOString()
  }
  if (status === LEAD_STATUS.FOLLOW_UP_SCHEDULED && !normalized.followUpDate) {
    errors.push('Follow-up Scheduled status requires followUpDate')
  }

  const notes = stringAt(row.values, columns, 'notes')
  if (notes.length > 10_000) errors.push('Notes must be 10,000 characters or fewer')
  else if (notes) normalized.notes = notes

  return { normalized, errors }
}

const identityReason = (row: Partial<NormalizedImportRow>, existing: { leadPhones: Set<string>; leadEmails: Set<string>; contactPhones: Set<string>; contactEmails: Set<string> }): string | undefined => {
  if (row.phone && existing.leadPhones.has(row.phone)) return 'Duplicate phone matches an existing Lead'
  if (row.email && existing.leadEmails.has(row.email)) return 'Duplicate email matches an existing Lead'
  if (row.phone && existing.contactPhones.has(row.phone)) return 'Duplicate phone matches an existing Contact'
  if (row.email && existing.contactEmails.has(row.email)) return 'Duplicate email matches an existing Contact'
  return undefined
}

const loadExistingIdentities = async (organizationId: string, rows: Array<Partial<NormalizedImportRow>>) => {
  const phones = [...new Set(rows.map((row) => row.phone).filter(Boolean) as string[])]
  const emails = [...new Set(rows.map((row) => row.email).filter(Boolean) as string[])]
  const or: Record<string, unknown>[] = []
  if (phones.length) or.push({ normalizedPhone: { $in: phones } }, { phone: { $in: phones } })
  if (emails.length) or.push({ normalizedEmail: { $in: emails } }, { email: { $in: emails } })
  if (!or.length) return { leadPhones: new Set<string>(), leadEmails: new Set<string>(), contactPhones: new Set<string>(), contactEmails: new Set<string>() }

  const [leads, contacts] = await Promise.all([
    Lead.find({ organizationId, $or: or }).select('normalizedPhone phone normalizedEmail email').lean(),
    Contact.find({ organizationId, $or: or }).select('normalizedPhone phone normalizedEmail email').lean(),
  ])
  const leadPhones = new Set<string>()
  const leadEmails = new Set<string>()
  const contactPhones = new Set<string>()
  const contactEmails = new Set<string>()
  for (const lead of leads as any[]) {
    if (lead.normalizedPhone || lead.phone) leadPhones.add(String(lead.normalizedPhone || lead.phone))
    if (lead.normalizedEmail || lead.email) leadEmails.add(String(lead.normalizedEmail || lead.email).toLowerCase())
  }
  for (const contact of contacts as any[]) {
    if (contact.normalizedPhone || contact.phone) contactPhones.add(String(contact.normalizedPhone || contact.phone))
    if (contact.normalizedEmail || contact.email) contactEmails.add(String(contact.normalizedEmail || contact.email).toLowerCase())
  }
  return { leadPhones, leadEmails, contactPhones, contactEmails }
}

const getImportAssignees = (organizationId: string) => User.find({
  organizationId,
  status: 'active',
  userRole: { $in: ['agency_owner', 'agency_admin', 'agent'] },
}).select('_id name email userRole').lean()

const storeSession = async (sessionId: string, session: ImportSession): Promise<void> => {
  try {
    await LeadImportSession.create({
      sessionId,
      organizationId: session.organizationId,
      userId: session.userId,
      payload: session,
      createdAt: new Date(session.createdAt),
      expiresAt: new Date(session.expiresAt),
    })
  } catch {
    throw new ApiError(503, 'Lead import preview could not be stored securely. Please retry')
  }
}

const consumeSession = async (organizationId: string, userId: string, sessionId: string): Promise<ImportSession | null> => {
  try {
    // findOneAndDelete makes confirmation one-time and atomic across every API instance.
    // expiresAt is checked in the same query, while a TTL index removes stale previews.
    const stored = await LeadImportSession.findOneAndDelete({
      organizationId,
      userId,
      sessionId,
      expiresAt: { $gt: new Date() },
    }).lean()
    if (!stored?.payload) return null
    return stored.payload as unknown as ImportSession
  } catch {
    throw new ApiError(503, 'Lead import session could not be confirmed because temporary storage is unavailable')
  }
}

const preview = async (organizationId: string, userId: string, access: CrmAccessContext, file?: Express.Multer.File) => {
  if (!file?.buffer?.length) throw new ApiError(400, 'Choose a CSV or XLSX file to import')
  const parsed = await parseUpload(file)
  const columns = buildColumnMap(parsed.headers)
  const assignees = await getImportAssignees(organizationId)

  const validated = parsed.rows.map((row) => ({ row: row.row, ...validateBaseRow(row, columns, assignees, access) }))
  const existing = await loadExistingIdentities(organizationId, validated.map((row) => row.normalized))
  const seenPhones = new Set<string>()
  const seenEmails = new Set<string>()
  const previewRows: PreviewRow[] = []
  const validRows: ImportSession['validRows'] = []
  const preflightIssues: ImportIssue[] = []

  for (const row of validated) {
    const errors = [...row.errors]
    const normalized = row.normalized
    if (errors.length) {
      const reason = errors.join('; ')
      previewRows.push({ row: row.row, status: 'invalid', reason, normalized })
      preflightIssues.push({ row: row.row, type: 'invalid', reason })
      continue
    }

    const phone = normalized.phone as string
    const email = normalized.email
    let duplicateReason: string | undefined
    if (seenPhones.has(phone)) duplicateReason = 'Duplicate phone appears earlier in this import file'
    else if (email && seenEmails.has(email)) duplicateReason = 'Duplicate email appears earlier in this import file'
    else duplicateReason = identityReason(normalized, existing)

    seenPhones.add(phone)
    if (email) seenEmails.add(email)

    if (duplicateReason) {
      previewRows.push({ row: row.row, status: 'duplicate', reason: duplicateReason, normalized })
      preflightIssues.push({ row: row.row, type: 'duplicate', reason: duplicateReason })
      continue
    }

    const data = normalized as NormalizedImportRow
    previewRows.push({ row: row.row, status: 'valid', reason: '', normalized: data })
    validRows.push({ row: row.row, data })
  }

  const sessionId = crypto.randomUUID()
  const now = new Date()
  const session: ImportSession = {
    version: 1,
    organizationId,
    userId,
    fileName: file.originalname,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + IMPORT_SESSION_TTL_SECONDS * 1000).toISOString(),
    total: previewRows.length,
    skippedDuplicates: preflightIssues.filter((issue) => issue.type === 'duplicate').length,
    preflightIssues,
    validRows,
  }
  const serializedSize = Buffer.byteLength(JSON.stringify(session), 'utf8')
  if (serializedSize > MAX_SESSION_BYTES) throw new ApiError(413, 'Validated import is too large to store securely. Split the file into smaller imports')
  await storeSession(sessionId, session)

  return {
    importSessionId: sessionId,
    expiresAt: session.expiresAt,
    fileName: file.originalname,
    sheetName: parsed.sheetName,
    headers: parsed.headers,
    total: previewRows.length,
    valid: validRows.length,
    invalid: preflightIssues.filter((issue) => issue.type === 'invalid').length,
    duplicate: session.skippedDuplicates,
    rows: previewRows,
  }
}

const confirm = async (organizationId: string, userId: string, access: CrmAccessContext, importSessionId: string) => {
  const session = await consumeSession(organizationId, userId, importSessionId)
  if (!session || session.version !== 1) throw new ApiError(410, 'Import preview expired, was already confirmed, or is no longer available')
  if (session.organizationId !== organizationId || session.userId !== userId) {
    throw new ApiError(403, 'Import session does not belong to this user and agency')
  }

  const issues: ImportIssue[] = [...session.preflightIssues]
  let created = 0
  let skippedDuplicates = session.skippedDuplicates
  let failed = session.preflightIssues.filter((issue) => issue.type === 'invalid').length

  // Re-check the complete valid batch once at confirmation time. This catches Leads
  // or Contacts created after preview without an N-query-per-row import pattern.
  const existingNow = await loadExistingIdentities(organizationId, session.validRows.map((row) => row.data))
  const rowsToCreate: ImportSession['validRows'] = []
  for (const row of session.validRows) {
    const reason = identityReason(row.data, existingNow)
    if (reason) {
      skippedDuplicates += 1
      issues.push({ row: row.row, type: 'duplicate', reason: `${reason} (created after preview)` })
    } else rowsToCreate.push(row)
  }

  for (const row of rowsToCreate) {
    try {
      const data = row.data
      await LeadService.createLead(organizationId, {
        name: data.name,
        phone: data.phone,
        email: data.email,
        source: data.source,
        leadStatus: data.leadStatus,
        assignedAgent: data.assignedAgent,
        followUpDate: data.followUpDate ? new Date(data.followUpDate) : undefined,
        notes: data.notes,
      }, userId, access, { duplicatePolicy: 'reject' })
      created += 1
    } catch (error: any) {
      const message = error instanceof Error ? error.message : 'Lead import failed'
      if (error?.statusCode === 409 || error?.code === 11000 || /same phone or email|already exists|duplicate/i.test(message)) {
        skippedDuplicates += 1
        issues.push({ row: row.row, type: 'duplicate', reason: message })
      } else {
        failed += 1
        issues.push({ row: row.row, type: 'failed', reason: message })
      }
    }
  }

  return {
    total: session.total,
    created,
    skippedDuplicates,
    failed,
    errors: issues.sort((a, b) => a.row - b.row),
  }
}

const csvTemplate = (): string => {
  const headers = ['name','phone','email','source','status','assignedTo','followUpDate','notes']
  const sample = ['Sample Client','01712345678','client@example.com','Facebook','New','agent@example.com','2026-08-20T15:30:00+06:00','Optional initial note']
  return [headers.map(csvCell).join(','), sample.map(csvCell).join(',')].join('\r\n')
}

const xlsxTemplate = async (): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Opygen Estate'
  workbook.created = new Date()

  const leads = workbook.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 1 }] })
  leads.columns = [
    { header: 'name', key: 'name', width: 24 },
    { header: 'phone', key: 'phone', width: 18 },
    { header: 'email', key: 'email', width: 28 },
    { header: 'source', key: 'source', width: 16 },
    { header: 'status', key: 'status', width: 22 },
    { header: 'assignedTo', key: 'assignedTo', width: 28 },
    { header: 'followUpDate', key: 'followUpDate', width: 30 },
    { header: 'notes', key: 'notes', width: 40 },
  ]
  leads.getRow(1).font = { bold: true }
  leads.addRow({
    name: 'Sample Client',
    phone: '01712345678',
    email: 'client@example.com',
    source: 'Facebook',
    status: 'New',
    assignedTo: 'agent@example.com',
    followUpDate: '2026-08-20T15:30:00+06:00',
    notes: 'Optional initial note',
  })

  const instructions = workbook.addWorksheet('Instructions')
  instructions.columns = [
    { header: 'Column', key: 'column', width: 20 },
    { header: 'Required', key: 'required', width: 12 },
    { header: 'Rules', key: 'rules', width: 90 },
  ]
  instructions.getRow(1).font = { bold: true }
  const rows = [
    ['name', 'Yes', 'Lead/client name. Maximum 120 characters.'],
    ['phone', 'Yes', 'Bangladesh mobile number, e.g. 01712345678 or +8801712345678.'],
    ['email', 'No', 'Valid email address. Duplicate phone OR email is skipped.'],
    ['source', 'No', `Allowed: ${LEAD_SOURCES.join(', ')}. Blank defaults to Other.`],
    ['status', 'No', `Blank defaults to New. Allowed internal keys: ${LEAD_STATUS_VALUES.join(', ')}.`],
    ['assignedTo', 'No', 'Active agency assignee by exact email, user ID, or unique exact name. Assignment permission is enforced.'],
    ['followUpDate', 'No', 'Excel date or ISO date/time. Recommended: 2026-08-20T15:30:00+06:00. FollowUpScheduled requires this value.'],
    ['notes', 'No', 'Optional initial note, maximum 10,000 characters. It is written to the Activity timeline.'],
  ]
  for (const row of rows) instructions.addRow({ column: row[0], required: row[1], rules: row[2] })
  instructions.addRow({ column: 'Statuses', required: '', rules: LEAD_STATUS_VALUES.map((status) => `${status} = ${LEAD_STATUS_LABELS[status]}`).join(' | ') })

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export const LeadImportService = {
  preview,
  confirm,
  csvTemplate,
  xlsxTemplate,
  constants: {
    maxRows: MAX_IMPORT_ROWS,
    sessionTtlSeconds: IMPORT_SESSION_TTL_SECONDS,
    sources: LEAD_SOURCES,
    statuses: LEAD_STATUS_VALUES,
  },
}
