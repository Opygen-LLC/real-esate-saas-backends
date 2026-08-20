import crypto from 'crypto'
import ExcelJS from 'exceljs'
import ApiError from '../../../errors/ApiError'
import config from '../../../config'
import { RedisClient } from '../../../shared/redisClient'
import { EntitlementService } from '../entitlement/entitlement.service'
import { csvCell, parseSpreadsheetUpload } from '../import/spreadsheetImport.service'
import { User } from '../user/user.model'
import {
  AREA_UNITS,
  LISTING_TYPES,
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  type AreaUnit,
  type ListingType,
  type PropertyStatus,
  type PropertyType,
} from './property.constants'
import { normalizeBangladeshDigits } from './property.normalization'
import { PropertyService } from './property.service'
import { PropertyValidation } from './property.validation'

const IMPORT_SESSION_NAMESPACE = 'property-import'
const IMPORT_SESSION_TTL_SECONDS = 30 * 60
const MAX_IMPORT_ROWS = 2_000
const MAX_SESSION_BYTES = 8 * 1024 * 1024

export type PropertyImportRowStatus = 'valid' | 'invalid'

type ImportColumn =
  | 'title'
  | 'propertyType'
  | 'listingType'
  | 'status'
  | 'price'
  | 'currency'
  | 'postalCode'
  | 'city'
  | 'state'
  | 'address'
  | 'bedrooms'
  | 'bathrooms'
  | 'area'
  | 'areaUnit'
  | 'agent'
  | 'furnished'
  | 'isFeatured'
  | 'description'

type NormalizedImportRow = {
  title: string
  propertyType: PropertyType
  listingType: ListingType
  status: PropertyStatus
  price: number
  currency: 'BDT'
  city?: string
  state?: string
  address?: string
  bedrooms?: number
  bathrooms?: number
  area?: number
  areaUnit: AreaUnit
  agentId?: string
  agentName?: string
  furnished?: boolean
  isFeatured?: boolean
  description?: string
  bangladeshAddress?: { postalCode?: string }
}

type PreviewRow = {
  row: number
  status: PropertyImportRowStatus
  reason: string
  normalized: Partial<NormalizedImportRow>
}

type ImportIssue = {
  row: number
  type: 'invalid' | 'failed'
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
  preflightIssues: ImportIssue[]
  validRows: Array<{ row: number; data: NormalizedImportRow }>
}

type ImportActor = {
  id: string
  role?: string
  canPublish: boolean
}

type Assignee = { _id: unknown; name?: string; email?: string; userRole?: string }

const normalizeHeader = (value: unknown): string => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
const normalizeToken = (value: unknown): string => normalizeHeader(value)

const FIELD_ALIASES: Record<ImportColumn, string[]> = {
  title: ['title', 'propertytitle', 'listingtitle', 'name'],
  propertyType: ['propertytype', 'type'],
  listingType: ['listingtype', 'listing', 'saletype'],
  status: ['status', 'propertystatus'],
  price: ['price', 'listingprice', 'amount'],
  currency: ['currency'],
  postalCode: ['postalcode', 'postcode', 'zipcode', 'zip'],
  city: ['city'],
  state: ['state', 'district'],
  address: ['address', 'streetaddress'],
  bedrooms: ['bedrooms', 'beds', 'bedroom'],
  bathrooms: ['bathrooms', 'baths', 'bathroom'],
  area: ['area', 'size'],
  areaUnit: ['areaunit', 'unit', 'sizeunit'],
  agent: ['agent', 'assignedagent', 'assignedto', 'agentemail', 'agentid'],
  furnished: ['furnished', 'isfurnished'],
  isFeatured: ['featured', 'isfeatured'],
  description: ['description', 'details'],
}

const SYSTEM_MANAGED_HEADERS = new Set([
  'organizationid', 'createdby', 'updatedby', 'slug', 'views', 'publishedat', 'ownerid',
  'images', 'medialinks', '_id', 'id', 'createdat', 'updatedat',
])

const HEADER_TO_FIELD = new Map<string, ImportColumn>()
for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<[ImportColumn, string[]]>) {
  for (const alias of aliases) HEADER_TO_FIELD.set(alias, field)
}

const propertyTypeByToken = new Map<string, PropertyType>(PROPERTY_TYPES.map((value) => [normalizeToken(value), value]))
const listingTypeByToken = new Map<string, ListingType>(LISTING_TYPES.map((value) => [normalizeToken(value), value]))
const statusByToken = new Map<string, PropertyStatus>(PROPERTY_STATUSES.map((value) => [normalizeToken(value), value]))
const areaUnitByToken = new Map<string, AreaUnit>(AREA_UNITS.map((value) => [normalizeToken(value), value]))
areaUnitByToken.set('sqft', 'sqft')
areaUnitByToken.set('squarefeet', 'sqft')
areaUnitByToken.set('squarefoot', 'sqft')
areaUnitByToken.set('shotok', 'shotok')

const buildColumnMap = (headers: string[]): Map<ImportColumn, number> => {
  const mapped = new Map<ImportColumn, number>()
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header)
    if (!normalized) return
    if (SYSTEM_MANAGED_HEADERS.has(normalized)) throw new ApiError(400, `Property import cannot set system-managed column: ${header}`)
    const field = HEADER_TO_FIELD.get(normalized)
    if (!field) throw new ApiError(400, `Unsupported property import column: ${header}`)
    if (mapped.has(field)) throw new ApiError(400, `Import contains multiple columns for ${field}`)
    mapped.set(field, index)
  })
  for (const required of ['title', 'propertyType', 'listingType', 'price'] as ImportColumn[]) {
    if (!mapped.has(required)) throw new ApiError(400, `Property import requires a ${required} column`)
  }
  return mapped
}

const rawAt = (values: unknown[], map: Map<ImportColumn, number>, field: ImportColumn): unknown => {
  const index = map.get(field)
  return index == null ? undefined : values[index]
}

const textAt = (values: unknown[], map: Map<ImportColumn, number>, field: ImportColumn): string => {
  const value = rawAt(values, map, field)
  return value == null ? '' : String(value).trim()
}

const parseNumber = (value: unknown, label: string, options: { integer?: boolean; positive?: boolean } = {}): { value?: number; error?: string } => {
  if (value == null || String(value).trim() === '') return {}
  const normalized = typeof value === 'string' ? normalizeBangladeshDigits(value).replace(/,/g, '').trim() : value
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return { error: `${label} must be a valid number` }
  if (options.positive ? parsed <= 0 : parsed < 0) return { error: `${label} must be ${options.positive ? 'greater than zero' : 'non-negative'}` }
  if (options.integer && !Number.isInteger(parsed)) return { error: `${label} must be a whole number` }
  return { value: parsed }
}

const parseBoolean = (value: unknown, label: string): { value?: boolean; error?: string } => {
  if (value == null || String(value).trim() === '') return {}
  if (typeof value === 'boolean') return { value }
  const token = normalizeToken(value)
  if (['true', 'yes', 'y', '1'].includes(token)) return { value: true }
  if (['false', 'no', 'n', '0'].includes(token)) return { value: false }
  return { error: `${label} must be Yes/No, True/False, or 1/0` }
}

const getImportAssignees = (organizationId: string): Promise<Assignee[]> => User.find({
  organizationId,
  status: 'active',
  userRole: { $in: ['agency_owner', 'agency_admin', 'agent'] },
}).select('_id name email userRole').lean() as unknown as Promise<Assignee[]>

const buildAssigneeResolver = (assignees: Assignee[]) => {
  const byId = new Map<string, Assignee>()
  const byEmail = new Map<string, Assignee>()
  const byName = new Map<string, Assignee[]>()
  for (const assignee of assignees) {
    const id = String(assignee._id)
    byId.set(id, assignee)
    if (assignee.email) byEmail.set(assignee.email.trim().toLowerCase(), assignee)
    if (assignee.name) {
      const key = assignee.name.trim().toLowerCase()
      byName.set(key, [...(byName.get(key) || []), assignee])
    }
  }
  return (value: string): { assignee?: Assignee; error?: string } => {
    if (!value) return {}
    if (/^[0-9a-fA-F]{24}$/.test(value)) {
      const assignee = byId.get(value)
      return assignee ? { assignee } : { error: 'Agent ID is not an active assignable member of this agency' }
    }
    if (value.includes('@')) {
      const assignee = byEmail.get(value.toLowerCase())
      return assignee ? { assignee } : { error: 'Agent email does not match an active assignable member of this agency' }
    }
    const matches = byName.get(value.toLowerCase()) || []
    if (matches.length === 1) return { assignee: matches[0] }
    if (matches.length > 1) return { error: 'Agent name is ambiguous; use the agent email or ID' }
    return { error: 'Agent does not match an active assignable member of this agency' }
  }
}

const zodReason = (issues: Array<{ path: Array<string | number>; message: string }>): string => issues
  .map((issue) => `${issue.path.filter((part) => part !== 'body').join('.') || 'row'}: ${issue.message}`)
  .join('; ')

const validateRow = (
  values: unknown[],
  columns: Map<ImportColumn, number>,
  resolveAssignee: ReturnType<typeof buildAssigneeResolver>,
  canPublish: boolean,
): { normalized: Partial<NormalizedImportRow>; errors: string[] } => {
  const errors: string[] = []
  const normalized: Partial<NormalizedImportRow> = {}

  const title = textAt(values, columns, 'title')
  if (!title) errors.push('title is required')
  else normalized.title = title

  const propertyTypeRaw = textAt(values, columns, 'propertyType')
  const propertyType = propertyTypeByToken.get(normalizeToken(propertyTypeRaw))
  if (!propertyType) errors.push(`propertyType must be one of: ${PROPERTY_TYPES.join(', ')}`)
  else normalized.propertyType = propertyType

  const listingTypeRaw = textAt(values, columns, 'listingType')
  const listingType = listingTypeByToken.get(normalizeToken(listingTypeRaw))
  if (!listingType) errors.push(`listingType must be one of: ${LISTING_TYPES.join(', ')}`)
  else normalized.listingType = listingType

  const statusRaw = textAt(values, columns, 'status')
  const requestedStatus = statusRaw ? statusByToken.get(normalizeToken(statusRaw)) : 'Draft'
  if (!requestedStatus) errors.push(`status must be one of: ${PROPERTY_STATUSES.join(', ')}`)
  else normalized.status = canPublish ? requestedStatus : 'Draft'

  const price = parseNumber(rawAt(values, columns, 'price'), 'price', { positive: true })
  if (price.error) errors.push(price.error)
  else if (price.value === undefined) errors.push('price is required')
  else normalized.price = price.value

  const currency = textAt(values, columns, 'currency').toUpperCase() || 'BDT'
  if (currency !== 'BDT') errors.push('currency must be BDT')
  else normalized.currency = 'BDT'

  const city = textAt(values, columns, 'city')
  if (city) normalized.city = city
  const state = textAt(values, columns, 'state')
  if (state) normalized.state = state
  const address = textAt(values, columns, 'address')
  if (address) normalized.address = address
  const description = textAt(values, columns, 'description')
  if (description) normalized.description = description

  const postalRaw = textAt(values, columns, 'postalCode')
  if (postalRaw) {
    const postalCode = normalizeBangladeshDigits(postalRaw).trim()
    if (!/^\d{4}$/.test(postalCode)) errors.push('postalCode must contain exactly 4 digits')
    else normalized.bangladeshAddress = { postalCode }
  }

  const bedrooms = parseNumber(rawAt(values, columns, 'bedrooms'), 'bedrooms', { integer: true })
  if (bedrooms.error) errors.push(bedrooms.error)
  else if (bedrooms.value !== undefined) normalized.bedrooms = bedrooms.value

  const bathrooms = parseNumber(rawAt(values, columns, 'bathrooms'), 'bathrooms')
  if (bathrooms.error) errors.push(bathrooms.error)
  else if (bathrooms.value !== undefined) normalized.bathrooms = bathrooms.value

  const area = parseNumber(rawAt(values, columns, 'area'), 'area')
  if (area.error) errors.push(area.error)
  else if (area.value !== undefined) normalized.area = area.value

  const areaUnitRaw = textAt(values, columns, 'areaUnit')
  const areaUnit = areaUnitRaw ? areaUnitByToken.get(normalizeToken(areaUnitRaw)) : 'sqft'
  if (!areaUnit) errors.push(`areaUnit must be one of: ${AREA_UNITS.join(', ')}`)
  else normalized.areaUnit = areaUnit

  const furnished = parseBoolean(rawAt(values, columns, 'furnished'), 'furnished')
  if (furnished.error) errors.push(furnished.error)
  else if (furnished.value !== undefined) normalized.furnished = furnished.value

  const featured = parseBoolean(rawAt(values, columns, 'isFeatured'), 'isFeatured')
  if (featured.error) errors.push(featured.error)
  else if (featured.value !== undefined) normalized.isFeatured = featured.value

  const agentRaw = textAt(values, columns, 'agent')
  if (agentRaw) {
    const resolved = resolveAssignee(agentRaw)
    if (resolved.error) errors.push(resolved.error)
    else if (resolved.assignee) {
      normalized.agentId = String(resolved.assignee._id)
      normalized.agentName = resolved.assignee.name || resolved.assignee.email || 'Team member'
    }
  }

  if (errors.length === 0) {
    const { agentName: _agentName, ...candidate } = normalized
    const result = PropertyValidation.createPropertyZodSchema.safeParse({ body: candidate })
    if (!result.success) errors.push(zodReason(result.error.issues as any))
  }

  return { normalized, errors }
}

const assertRedisSessionsAvailable = async (): Promise<void> => {
  if (!config.redis.enabled || !(await RedisClient.ping())) {
    throw new ApiError(503, 'Secure property import sessions require Redis to be enabled and available')
  }
}

const sessionRedisKey = (organizationId: string, userId: string, sessionId: string): string => `${organizationId}:${userId}:${sessionId}`

const storeSession = async (key: string, session: ImportSession): Promise<void> => {
  try {
    await RedisClient.command(['SET', RedisClient.key(IMPORT_SESSION_NAMESPACE, key), JSON.stringify(session), 'EX', IMPORT_SESSION_TTL_SECONDS])
  } catch {
    throw new ApiError(503, 'Property import preview could not be stored securely. Please retry')
  }
}

const consumeSession = async (key: string): Promise<ImportSession | null> => {
  try {
    const redisKey = RedisClient.key(IMPORT_SESSION_NAMESPACE, key)
    const script = "local value=redis.call('GET',KEYS[1]); if value then redis.call('DEL',KEYS[1]); end; return value"
    const value = await RedisClient.command(['EVAL', script, 1, redisKey])
    if (typeof value !== 'string') return null
    return JSON.parse(value) as ImportSession
  } catch {
    throw new ApiError(503, 'Property import session could not be confirmed because Redis is unavailable')
  }
}

const preview = async (organizationId: string, actor: ImportActor, file?: Express.Multer.File) => {
  if (!file?.buffer?.length) throw new ApiError(400, 'Choose a CSV or XLSX file to import')
  await assertRedisSessionsAvailable()
  const parsed = await parseSpreadsheetUpload(file, { maxRows: MAX_IMPORT_ROWS, entityLabel: 'Property' })
  const columns = buildColumnMap(parsed.headers)
  const assignees = await getImportAssignees(organizationId)
  const resolveAssignee = buildAssigneeResolver(assignees)

  const previewRows: PreviewRow[] = []
  const validRows: ImportSession['validRows'] = []
  const preflightIssues: ImportIssue[] = []

  for (const row of parsed.rows) {
    const { normalized, errors } = validateRow(row.values, columns, resolveAssignee, actor.canPublish)
    if (errors.length) {
      const reason = errors.join('; ')
      previewRows.push({ row: row.row, status: 'invalid', reason, normalized })
      preflightIssues.push({ row: row.row, type: 'invalid', reason })
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
    userId: actor.id,
    fileName: file.originalname,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + IMPORT_SESSION_TTL_SECONDS * 1000).toISOString(),
    total: previewRows.length,
    preflightIssues,
    validRows,
  }
  if (Buffer.byteLength(JSON.stringify(session), 'utf8') > MAX_SESSION_BYTES) {
    throw new ApiError(413, 'Validated property import is too large to store securely. Split the file into smaller imports')
  }
  await storeSession(sessionRedisKey(organizationId, actor.id, sessionId), session)

  return {
    importSessionId: sessionId,
    expiresAt: session.expiresAt,
    fileName: file.originalname,
    sheetName: parsed.sheetName,
    headers: parsed.headers,
    total: previewRows.length,
    valid: validRows.length,
    invalid: preflightIssues.length,
    rows: previewRows,
  }
}

const confirm = async (organizationId: string, actor: ImportActor, importSessionId: string) => {
  await assertRedisSessionsAvailable()
  const previewSession = await consumeSession(sessionRedisKey(organizationId, actor.id, importSessionId))
  if (!previewSession || previewSession.version !== 1) throw new ApiError(410, 'Import preview expired, was already confirmed, or is no longer available')
  if (previewSession.organizationId !== organizationId || previewSession.userId !== actor.id) throw new ApiError(403, 'Import session does not belong to this user and agency')

  return EntitlementService.withPropertyQuotaGuard(organizationId, async (dbSession) => {
    const issues: ImportIssue[] = [...previewSession.preflightIssues]
    let created = 0
    let failed = previewSession.preflightIssues.length

    if (previewSession.validRows.length) {
      await EntitlementService.assertPropertyCapacity(organizationId, { additionalCommitments: previewSession.validRows.length, session: dbSession })
    }

    const assignedIds = [...new Set(previewSession.validRows.map((row) => row.data.agentId).filter(Boolean) as string[])]
    const assignedQuery = User.find({
      _id: { $in: assignedIds },
      organizationId,
      status: 'active',
      userRole: { $in: ['agency_owner', 'agency_admin', 'agent'] },
    }).select('_id')
    if (dbSession) assignedQuery.session(dbSession)
    const activeAssignedIds = assignedIds.length
      ? new Set((await assignedQuery.lean()).map((user: any) => String(user._id)))
      : new Set<string>()

    for (const row of previewSession.validRows) {
      try {
        if (row.data.agentId && !activeAssignedIds.has(row.data.agentId)) {
          throw new ApiError(400, 'Assigned agent is no longer an active assignable member of this agency')
        }
        const { agentName: _agentName, ...payload } = row.data
        await PropertyService.createProperty(organizationId, payload, actor, { session: dbSession })
        created += 1
      } catch (error: any) {
        failed += 1
        issues.push({ row: row.row, type: 'failed', reason: error instanceof Error ? error.message : 'Property import failed' })
      }
    }

    return {
      total: previewSession.total,
      created,
      failed,
      errors: issues.sort((a, b) => a.row - b.row),
    }
  })
}

const csvTemplate = (): string => {
  const headers = ['title', 'propertyType', 'listingType', 'status', 'price', 'currency', 'postalCode', 'city', 'state', 'address', 'bedrooms', 'bathrooms', 'area', 'areaUnit', 'agent', 'furnished', 'isFeatured', 'description']
  const sample = ['Sample Apartment', 'Apartment', 'ForSale', 'Draft', '12500000', 'BDT', '1212', 'Dhaka', 'Dhaka', 'Gulshan Avenue', '3', '3', '1850', 'sqft', 'agent@example.com', 'Yes', 'No', 'Optional property description']
  return [headers.map(csvCell).join(','), sample.map(csvCell).join(',')].join('\r\n')
}

const xlsxTemplate = async (): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Opygen Estate'
  workbook.company = 'Opygen Estate'
  const sheet = workbook.addWorksheet('Properties')
  sheet.columns = [
    ['title', 28], ['propertyType', 18], ['listingType', 16], ['status', 16], ['price', 16], ['currency', 12], ['postalCode', 12], ['city', 18], ['state', 18], ['address', 32],
    ['bedrooms', 12], ['bathrooms', 12], ['area', 14], ['areaUnit', 12], ['agent', 28], ['furnished', 12], ['isFeatured', 12], ['description', 45],
  ].map(([header, width]) => ({ header: String(header), key: String(header), width: Number(width) }))
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.getRow(1).font = { bold: true }
  sheet.addRow({
    title: 'Sample Apartment', propertyType: 'Apartment', listingType: 'ForSale', status: 'Draft', price: 12500000, currency: 'BDT', postalCode: '1212', city: 'Dhaka', state: 'Dhaka', address: 'Gulshan Avenue', bedrooms: 3, bathrooms: 3, area: 1850, areaUnit: 'sqft', agent: 'agent@example.com', furnished: 'Yes', isFeatured: 'No', description: 'Optional property description',
  })

  const instructions = workbook.addWorksheet('Instructions')
  instructions.columns = [
    { header: 'Column', key: 'column', width: 20 },
    { header: 'Required', key: 'required', width: 12 },
    { header: 'Rules', key: 'rules', width: 100 },
  ]
  instructions.getRow(1).font = { bold: true }
  const rows = [
    ['title', 'Yes', '3–180 characters.'],
    ['propertyType', 'Yes', `Allowed: ${PROPERTY_TYPES.join(', ')}.`],
    ['listingType', 'Yes', `Allowed: ${LISTING_TYPES.join(', ')}.`],
    ['status', 'No', `Allowed: ${PROPERTY_STATUSES.join(', ')}. Blank defaults to Draft. Users without publish permission import as Draft.`],
    ['price', 'Yes', 'Positive number, maximum 1,000,000,000,000.'],
    ['currency', 'No', 'BDT only. Blank defaults to BDT.'],
    ['postalCode', 'No', 'Exactly four Bangladesh postal-code digits.'],
    ['city/state/address', 'No', 'Location text. City/state maximum 100 characters; address maximum 500.'],
    ['bedrooms', 'No', 'Whole number from 0 to 100.'],
    ['bathrooms', 'No', 'Number from 0 to 100.'],
    ['area', 'No', 'Non-negative number.'],
    ['areaUnit', 'No', `Allowed: ${AREA_UNITS.join(', ')}. Blank defaults to sqft.`],
    ['agent', 'No', 'Active agency owner/admin/agent by exact email, user ID, or unique exact name. Cross-agency IDs are rejected.'],
    ['furnished/isFeatured', 'No', 'Yes/No, True/False, or 1/0.'],
    ['description', 'No', 'Optional description, maximum 20,000 characters.'],
  ]
  for (const row of rows) instructions.addRow({ column: row[0], required: row[1], rules: row[2] })
  instructions.addRow({ column: 'Security', required: '', rules: 'organizationId, createdBy, updatedBy, slug, views, publishedAt, ownerId, IDs, images and mediaLinks cannot be imported.' })

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export const PropertyImportService = {
  preview,
  confirm,
  csvTemplate,
  xlsxTemplate,
  constants: { maxRows: MAX_IMPORT_ROWS, sessionTtlSeconds: IMPORT_SESSION_TTL_SECONDS },
}
