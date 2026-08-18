import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip

suite('CRM Phase 14 production integration matrix', () => {
  const runId = `${process.pid}-${Date.now()}`
  const orgA = `crm14-a-${runId}`
  const orgB = `crm14-b-${runId}`

  let mongoose: typeof import('mongoose')
  let Lead: any
  let Contact: any
  let Task: any
  let Activity: any
  let DomainEvent: any
  let User: any
  let Organization: any
  let CrmConfig: any
  let LeadAssignmentAudit: any
  let OperationsJob: any
  let LeadService: any
  let ContactService: any
  let TaskService: any
  let ActivityService: any
  let LeadLifecycleService: any
  let LeadImportService: any
  let RedisClient: any
  let getDayBoundsInTimeZone: any
  let LEAD_STATUS: any
  let LEAD_STATUS_VALUES: readonly string[]
  let LeadValidation: any
  let ActivityValidation: any

  let ownerA: any
  let agentA1: any
  let agentA2: any
  let ownerB: any
  let agentB: any

  const managerAccess = (user: any, organizationId = orgA) => ({
    userId: String(user._id),
    role: 'agency_owner',
    permissions: ['leads.read', 'leads.write', 'leads.assign', 'contacts.read', 'contacts.write', 'tasks.read', 'tasks.write', 'crm.team.read', 'crm.export'],
    isManager: true,
    canReadTeam: true,
    scope: 'team' as const,
    organizationId,
  })
  const memberAccess = (user: any, team = false) => ({
    userId: String(user._id),
    role: 'agent',
    permissions: ['leads.read', 'leads.write', 'contacts.read', 'contacts.write', 'tasks.read', 'tasks.write', 'crm.export', ...(team ? ['crm.team.read'] : [])],
    isManager: false,
    canReadTeam: team,
    scope: (team ? 'team' : 'mine') as 'mine' | 'team',
  })

  const phone = (seed: number) => `+88017${String(seed).padStart(8, '0').slice(-8)}`
  let phoneSeed = 1000
  const nextPhone = () => phone(phoneSeed++)

  const seedUser = (organizationId: string, name: string, role: 'agency_owner' | 'agent') => User.create({
    name,
    email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${runId}@example.test`,
    phoneNumber: nextPhone(),
    organizationId,
    userRole: role,
    status: 'active',
    isVerified: true,
  })

  const createLead = async (input: Record<string, unknown> = {}) => {
    const mobile = nextPhone()
    return Lead.create({
      organizationId: orgA,
      name: `Lead ${phoneSeed}`,
      phone: mobile,
      normalizedPhone: mobile,
      source: 'Website',
      leadStatus: LEAD_STATUS.NEW,
      assignedAgent: agentA1._id,
      createdBy: ownerA._id,
      updatedBy: ownerA._id,
      currency: 'BDT',
      ...input,
    })
  }

  const makeUpload = (name: string, buffer: Buffer, mime: string): Express.Multer.File => ({
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: mime,
    size: buffer.length,
    destination: '',
    filename: name,
    path: '',
    buffer,
    stream: undefined as any,
  })

  const redisStore = new Map<string, string>()

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'true'
    process.env.WORKER_ENABLED = 'false'
    process.env.SMS_DEV_MODE = 'true'
    process.env.CLIENT_URL = 'http://localhost:3000'
    process.env.PUBLIC_API_URL = 'http://127.0.0.1:5000'
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

    mongoose = await import('mongoose')
    if (mongoose.connection.readyState === 0) await mongoose.connect(requiredDb!, { autoIndex: true })

    ;({ Lead } = await import('../../app/module/lead/lead.model'))
    ;({ Contact } = await import('../../app/module/contact/contact.model'))
    ;({ Task } = await import('../../app/module/task/task.model'))
    ;({ Activity } = await import('../../app/module/activity/activity.model'))
    ;({ DomainEvent } = await import('../../app/module/domainEvent/domainEvent.model'))
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ CrmConfig, LeadAssignmentAudit } = await import('../../app/module/crm/crm.model'))
    ;({ OperationsJob } = await import('../../app/module/operationsQueue/operationsJob.model'))
    ;({ LeadService } = await import('../../app/module/lead/lead.service'))
    ;({ ContactService } = await import('../../app/module/contact/contact.service'))
    ;({ TaskService } = await import('../../app/module/task/task.service'))
    ;({ ActivityService } = await import('../../app/module/activity/activity.service'))
    ;({ LeadLifecycleService } = await import('../../app/module/lead/leadLifecycle.service'))
    ;({ LeadImportService } = await import('../../app/module/lead/leadImport.service'))
    ;({ RedisClient } = await import('../../shared/redisClient'))
    ;({ getDayBoundsInTimeZone } = await import('../../app/module/lead/leadFollowUpTime'))
    ;({ LEAD_STATUS, LEAD_STATUS_VALUES } = await import('../../app/module/lead/leadStatus.contract'))
    ;({ LeadValidation } = await import('../../app/module/lead/lead.validation'))
    ;({ ActivityValidation } = await import('../../app/module/activity/activity.validation'))

    await Organization.create([
      { organizationId: orgA, agencyName: 'CRM 14 Agency A', email: `org-a-${runId}@example.test`, phone: nextPhone(), sub_domain: `crm14-a-${runId}`.slice(0, 60), subscription: { plan: 'trial', status: 'trialing', maxProperties: 100, maxAgents: 10 } },
      { organizationId: orgB, agencyName: 'CRM 14 Agency B', email: `org-b-${runId}@example.test`, phone: nextPhone(), sub_domain: `crm14-b-${runId}`.slice(0, 60), subscription: { plan: 'trial', status: 'trialing', maxProperties: 100, maxAgents: 10 } },
    ])
    ownerA = await seedUser(orgA, 'CRM14 Owner A', 'agency_owner')
    agentA1 = await seedUser(orgA, 'CRM14 Agent A1', 'agent')
    agentA2 = await seedUser(orgA, 'CRM14 Agent A2', 'agent')
    ownerB = await seedUser(orgB, 'CRM14 Owner B', 'agency_owner')
    agentB = await seedUser(orgB, 'CRM14 Agent B', 'agent')

    vi.spyOn(RedisClient, 'ping').mockResolvedValue(true)
    vi.spyOn(RedisClient, 'getJson').mockResolvedValue(null)
    vi.spyOn(RedisClient, 'setJson').mockResolvedValue(undefined)
    vi.spyOn(RedisClient, 'del').mockResolvedValue(undefined)
    vi.spyOn(RedisClient, 'command').mockImplementation(async (parts: Array<string | number>) => {
      const command = String(parts[0] || '').toUpperCase()
      if (command === 'SET') {
        redisStore.set(String(parts[1]), String(parts[2]))
        return 'OK'
      }
      if (command === 'EVAL') {
        const key = String(parts[3])
        const value = redisStore.get(key) ?? null
        if (value !== null) redisStore.delete(key)
        return value
      }
      if (command === 'GET') return redisStore.get(String(parts[1])) ?? null
      if (command === 'DEL') {
        let removed = 0
        for (const key of parts.slice(1)) removed += redisStore.delete(String(key)) ? 1 : 0
        return removed
      }
      if (command === 'PING') return 'PONG'
      return null
    })
  }, 30_000)

  beforeEach(() => {
    redisStore.clear()
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    const orgFilter = { organizationId: { $in: [orgA, orgB] } }
    await Promise.all([
      Lead.deleteMany(orgFilter),
      Contact.deleteMany(orgFilter),
      Task.deleteMany(orgFilter),
      Activity.deleteMany(orgFilter),
      DomainEvent.deleteMany(orgFilter),
      User.deleteMany(orgFilter),
      CrmConfig.deleteMany(orgFilter),
      LeadAssignmentAudit.deleteMany(orgFilter),
      OperationsJob.deleteMany(orgFilter),
      Organization.deleteMany({ organizationId: { $in: [orgA, orgB] } }),
    ]).catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('enforces tenant isolation, member ownership and server-owned fields', async () => {
    const foreignLeadPhone = nextPhone()
    const foreignLead = await Lead.create({
      organizationId: orgB,
      name: 'Tenant B Lead',
      phone: foreignLeadPhone,
      normalizedPhone: foreignLeadPhone,
      source: 'Website',
      leadStatus: LEAD_STATUS.NEW,
      assignedAgent: agentB._id,
      currency: 'BDT',
    })
    const foreignContactPhone = nextPhone()
    const foreignContact = await Contact.create({
      organizationId: orgB,
      name: 'Tenant B Contact',
      phone: foreignContactPhone,
      normalizedPhone: foreignContactPhone,
      relationshipState: 'active',
      assignedTo: agentB._id,
    })
    const teammateLead = await createLead({ name: 'Agent 2 Private Lead', assignedAgent: agentA2._id })

    await expect(LeadService.getLeadById(orgA, String(foreignLead._id), managerAccess(ownerA))).rejects.toMatchObject({ statusCode: 404 })
    await expect(ContactService.getContactById(orgA, String(foreignContact._id), managerAccess(ownerA))).rejects.toMatchObject({ statusCode: 404 })
    await expect(LeadService.getLeadById(orgA, String(teammateLead._id), memberAccess(agentA1))).rejects.toMatchObject({ statusCode: 404 })
    await expect(LeadService.getLeadById(orgA, String(teammateLead._id), memberAccess(agentA1, true))).resolves.toBeTruthy()

    await expect(TaskService.createTask(orgA, {
      title: 'Cross-tenant relation attempt',
      dueAt: new Date(Date.now() + 60_000),
      taskType: 'general',
      linkedLead: foreignLead._id,
      assignedAgent: agentA1._id,
    }, String(ownerA._id), managerAccess(ownerA))).rejects.toThrow(/Linked lead must belong to this agency/i)

    for (const field of ['leadStatus', 'assignedAgent', 'createdBy', 'updatedBy', 'convertedAt', 'convertedContactId', 'isConverted', 'contactId']) {
      const parsed = LeadValidation.updateLeadZodSchema.safeParse({ body: { [field]: field === 'isConverted' ? true : '507f1f77bcf86cd799439011' } })
      expect(parsed.success, field).toBe(false)
    }
    expect(ActivityValidation.appendNoteZodSchema.safeParse({ body: { content: 'note', authorId: String(agentA2._id) } }).success).toBe(false)
  })

  it('supports all fourteen statuses and performs idempotent Won conversion with archived history', async () => {
    expect(LEAD_STATUS_VALUES).toHaveLength(14)
    const access = managerAccess(ownerA)

    for (const status of LEAD_STATUS_VALUES) {
      const lead = await createLead({ name: `Status ${status}` })
      if (status === LEAD_STATUS.FOLLOW_UP_SCHEDULED) {
        await LeadLifecycleService.scheduleFollowUp(orgA, String(lead._id), new Date(Date.now() + 86_400_000), { actorId: String(ownerA._id), access })
      }
      const options: any = { actorId: String(ownerA._id), access, reason: `Phase 14 verifies ${status}` }
      if (status === LEAD_STATUS.LOST) options.lostReason = 'Other'
      const result = await LeadLifecycleService.changeStatus(orgA, String(lead._id), status, options)
      expect(result.lead.leadStatus).toBe(status)
      if (status === LEAD_STATUS.WON) expect(result.lead.isConverted).toBe(true)
    }

    const lead = await createLead({ name: 'Lifecycle Main Path' })
    await LeadLifecycleService.recordContact(orgA, String(lead._id), { actorId: String(agentA1._id), access, channel: 'call', reason: 'First call answered' })
    let current = await Lead.findById(lead._id)
    expect(current.leadStatus).toBe(LEAD_STATUS.CONTACTED)
    expect(current.firstResponseAt).toBeTruthy()
    expect(current.firstContactedAt).toBeTruthy()

    await LeadLifecycleService.scheduleFollowUp(orgA, String(lead._id), new Date(Date.now() + 3_600_000), { actorId: String(ownerA._id), access })
    for (const status of [
      LEAD_STATUS.FOLLOW_UP_SCHEDULED,
      LEAD_STATUS.INTERESTED,
      LEAD_STATUS.VIEWING_SCHEDULED,
      LEAD_STATUS.VIEWING_COMPLETED,
      LEAD_STATUS.NEGOTIATION,
      LEAD_STATUS.OFFER_MADE,
    ]) {
      await LeadLifecycleService.changeStatus(orgA, String(lead._id), status, { actorId: String(ownerA._id), access, reason: `Advance to ${status}` })
    }
    const firstWin = await LeadLifecycleService.changeStatus(orgA, String(lead._id), LEAD_STATUS.WON, { actorId: String(ownerA._id), access, reason: 'Deal completed' })
    const secondWin = await LeadLifecycleService.changeStatus(orgA, String(lead._id), LEAD_STATUS.WON, { actorId: String(ownerA._id), access, reason: 'Duplicate win request' })

    expect(firstWin.contact?._id).toBeTruthy()
    expect(secondWin.contact?._id).toBe(firstWin.contact?._id)
    expect(await Contact.countDocuments({ organizationId: orgA, sourceLeadId: lead._id })).toBe(1)
    current = await Lead.findById(lead._id)
    expect(current.isConverted).toBe(true)
    expect(String(current.convertedContactId)).toBe(firstWin.contact?._id)

    const pipeline = await LeadService.getAllLeads({ organizationId: orgA, searchTerm: 'Lifecycle Main Path' }, { page: 1, limit: 20 }, access)
    expect(pipeline.data).toHaveLength(0)
    const archived = await LeadService.getLeadById(orgA, String(lead._id), access)
    expect(archived).toBeTruthy()
    const history = await ActivityService.getLeadHistory(orgA, String(lead._id), { page: 1, limit: 100 }, access)
    expect(history.data.some((entry: any) => entry.eventType === 'lead.converted')).toBe(true)
  }, 30_000)

  it('keeps one generated follow-up Task, respects Dhaka today boundaries, and scopes member/owner results', async () => {
    const access = managerAccess(ownerA)
    const createdDue = new Date(Date.now() + 90 * 60 * 1000)
    const createdWithFollowUp = await LeadService.createLead(orgA, {
      name: 'Created With Follow-up',
      phone: nextPhone(),
      source: 'Referral',
      assignedAgent: String(agentA1._id),
      followUpDate: createdDue,
      notes: 'Initial follow-up creation test',
    }, String(ownerA._id), access, { duplicatePolicy: 'reject' })
    expect(createdWithFollowUp.followUpDate?.toISOString()).toBe(createdDue.toISOString())
    expect(await Task.countDocuments({ organizationId: orgA, linkedLead: createdWithFollowUp._id, taskType: 'lead_follow_up', status: { $in: ['Pending', 'InProgress', 'Overdue'] } })).toBe(1)
    const lead = await createLead({ name: 'Reschedule Lead' })
    const firstDue = new Date(Date.now() + 2 * 60 * 60 * 1000)
    const secondDue = new Date(firstDue.getTime() + 2 * 60 * 60 * 1000)

    await LeadLifecycleService.scheduleFollowUp(orgA, String(lead._id), firstDue, { actorId: String(ownerA._id), access })
    await LeadLifecycleService.scheduleFollowUp(orgA, String(lead._id), secondDue, { actorId: String(ownerA._id), access })

    const generated = await Task.find({ organizationId: orgA, linkedLead: lead._id, taskType: 'lead_follow_up', status: { $in: ['Pending', 'InProgress', 'Overdue'] } })
    expect(generated).toHaveLength(1)
    expect(generated[0].dueAt.toISOString()).toBe(secondDue.toISOString())
    expect((await Lead.findById(lead._id)).followUpDate.toISOString()).toBe(secondDue.toISOString())

    const bounds = getDayBoundsInTimeZone(new Date())
    const todayA1 = new Date(bounds.start.getTime() + 60 * 60 * 1000)
    const todayA2 = new Date(bounds.start.getTime() + 2 * 60 * 60 * 1000)
    const tomorrow = new Date(bounds.endExclusive.getTime() + 60 * 60 * 1000)
    await createLead({ name: 'Today Agent 1', assignedAgent: agentA1._id, followUpDate: todayA1 })
    await createLead({ name: 'Today Agent 2', assignedAgent: agentA2._id, followUpDate: todayA2 })
    await createLead({ name: 'Tomorrow Agent 1', assignedAgent: agentA1._id, followUpDate: tomorrow })

    const ownerToday = await LeadService.getTodayFollowUps(orgA, { page: 1, limit: 100 }, access)
    expect(ownerToday.data.some((row: any) => row.name === 'Today Agent 1')).toBe(true)
    expect(ownerToday.data.some((row: any) => row.name === 'Today Agent 2')).toBe(true)
    expect(ownerToday.data.some((row: any) => row.name === 'Tomorrow Agent 1')).toBe(false)

    const agentToday = await LeadService.getTodayFollowUps(orgA, { page: 1, limit: 100 }, memberAccess(agentA1))
    expect(agentToday.data.some((row: any) => row.name === 'Today Agent 1')).toBe(true)
    expect(agentToday.data.some((row: any) => row.name === 'Today Agent 2')).toBe(false)
  })

  it('attributes notes to the logged-in user, keeps append-only timeline order, and lets Contacts inherit Lead history', async () => {
    const access = managerAccess(ownerA)
    const lead = await createLead({ name: 'History Lead' })
    await ActivityService.createLeadNote(orgA, String(lead._id), 'First timeline note', String(agentA1._id), access)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await ActivityService.createLeadNote(orgA, String(lead._id), 'Second timeline note', String(ownerA._id), access)

    const rawNotes = await Activity.find({ organizationId: orgA, leadId: lead._id, type: 'note' }).sort({ createdAt: 1 }).lean()
    expect(rawNotes).toHaveLength(2)
    expect(String(rawNotes[0].agentId)).toBe(String(agentA1._id))
    expect(String(rawNotes[1].agentId)).toBe(String(ownerA._id))

    const history = await ActivityService.getLeadHistory(orgA, String(lead._id), { page: 1, limit: 100 }, access)
    const firstIndex = history.data.findIndex((entry: any) => entry.content === 'First timeline note')
    const secondIndex = history.data.findIndex((entry: any) => entry.content === 'Second timeline note')
    expect(secondIndex).toBeGreaterThanOrEqual(0)
    expect(firstIndex).toBeGreaterThan(secondIndex)

    const conversion = await LeadLifecycleService.changeStatus(orgA, String(lead._id), LEAD_STATUS.WON, { actorId: String(ownerA._id), access, reason: 'Converted after notes' })
    await ActivityService.createContactNote(orgA, String(conversion.contact!._id), 'Post-conversion relationship note', String(ownerA._id), access)
    const contactHistory = await ActivityService.getContactHistory(orgA, String(conversion.contact!._id), { page: 1, limit: 100 }, access)
    const contents = contactHistory.data.map((entry: any) => entry.content)
    expect(contents).toContain('First timeline note')
    expect(contents).toContain('Second timeline note')
    expect(contents).toContain('Post-conversion relationship note')
    expect(contactHistory.data.some((entry: any) => entry.eventType === 'lead.converted')).toBe(true)
  })

  it('validates CSV/XLSX imports, skips duplicates, secures sessions, and creates only confirmed normalized rows', async () => {
    const access = managerAccess(ownerA)
    const existingPhone = nextPhone()
    await Lead.create({ organizationId: orgA, name: 'Existing DB Lead', phone: existingPhone, normalizedPhone: existingPhone, source: 'Website', leadStatus: LEAD_STATUS.NEW, assignedAgent: agentA1._id, currency: 'BDT' })

    const validPhone = nextPhone()
    const duplicateInFilePhone = validPhone
    const csv = [
      'name,phone,email,source,status,assignedTo,followUpDate,notes',
      `Valid Import,${validPhone},valid-import-${runId}@example.test,Facebook,Interested,${agentA1.email},2026-08-20T10:30:00+06:00,Initial note`,
      'Missing Phone,,missing@example.test,Website,New,,,',
      `Bad Email,${nextPhone()},not-an-email,Website,New,,,`,
      `Bad Status,${nextPhone()},,Website,ImpossibleStatus,,,`,
      `Bad Date,${nextPhone()},,Website,FollowUpScheduled,,tomorrow-ish,`,
      `Unknown Assignee,${nextPhone()},,Website,New,nobody-${runId}@example.test,,`,
      `Existing Duplicate,${existingPhone},,Website,New,,,`,
      `File Duplicate,${duplicateInFilePhone},,Website,New,,,`,
      `Bad Source,${nextPhone()},,CarrierPigeon,New,,,`,
    ].join('\n')

    const preview = await LeadImportService.preview(orgA, String(ownerA._id), access, makeUpload('leads.csv', Buffer.from(csv), 'text/csv'))
    expect(preview.valid).toBe(1)
    expect(preview.duplicate).toBe(2)
    expect(preview.invalid).toBe(6)
    expect(preview.rows.some((row: any) => row.reason.includes('Phone is required'))).toBe(true)
    expect(preview.rows.some((row: any) => row.reason.includes('Email is invalid'))).toBe(true)
    expect(preview.rows.some((row: any) => row.reason.includes('Status'))).toBe(true)
    expect(preview.rows.some((row: any) => row.reason.includes('followUpDate'))).toBe(true)
    expect(preview.rows.some((row: any) => row.reason.includes('was not found'))).toBe(true)
    expect(preview.rows.some((row: any) => row.reason.includes('existing Lead'))).toBe(true)
    expect(preview.rows.some((row: any) => row.reason.includes('earlier in this import file'))).toBe(true)

    await expect(LeadImportService.confirm(orgA, String(agentA1._id), memberAccess(agentA1), preview.importSessionId)).rejects.toMatchObject({ statusCode: 410 })
    await expect(LeadImportService.confirm(orgB, String(ownerB._id), managerAccess(ownerB, orgB), preview.importSessionId)).rejects.toMatchObject({ statusCode: 410 })

    const report = await LeadImportService.confirm(orgA, String(ownerA._id), access, preview.importSessionId)
    expect(report.total).toBe(9)
    expect(report.created).toBe(1)
    expect(report.skippedDuplicates).toBe(2)
    expect(report.failed).toBe(6)
    const imported = await Lead.findOne({ organizationId: orgA, normalizedPhone: validPhone })
    expect(imported).toBeTruthy()
    expect(String(imported.createdBy)).toBe(String(ownerA._id))
    expect(imported.leadStatus).toBe(LEAD_STATUS.INTERESTED)
    await expect(LeadImportService.confirm(orgA, String(ownerA._id), access, preview.importSessionId)).rejects.toMatchObject({ statusCode: 410 })

    const expiredPhone = nextPhone()
    const expired = await LeadImportService.preview(orgA, String(ownerA._id), access, makeUpload('expired.csv', Buffer.from(`name,phone\nExpired,${expiredPhone}`), 'text/csv'))
    redisStore.clear()
    await expect(LeadImportService.confirm(orgA, String(ownerA._id), access, expired.importSessionId)).rejects.toMatchObject({ statusCode: 410 })

    const excelModule: any = await import('exceljs')
    const ExcelJS = excelModule.default || excelModule
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Leads')
    sheet.addRow(['name', 'phone', 'status'])
    const xlsxPhone = nextPhone()
    sheet.addRow(['XLSX Lead', xlsxPhone, ''])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    const xlsxPreview = await LeadImportService.preview(orgA, String(ownerA._id), access, makeUpload('leads.xlsx', buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
    expect(xlsxPreview.valid).toBe(1)
    const xlsxReport = await LeadImportService.confirm(orgA, String(ownerA._id), access, xlsxPreview.importSessionId)
    expect(xlsxReport.created).toBe(1)
    expect((await Lead.findOne({ organizationId: orgA, normalizedPhone: xlsxPhone })).leadStatus).toBe(LEAD_STATUS.NEW)
  }, 30_000)

  it('exports exactly the filtered records allowed by workspace visibility for Leads and Contacts', async () => {
    const bounds = getDayBoundsInTimeZone(new Date())
    const followUp = new Date(bounds.start.getTime() + 3 * 60 * 60 * 1000)
    const leadMine = await createLead({ name: 'Export Mine Match', source: 'Facebook', leadStatus: LEAD_STATUS.INTERESTED, assignedAgent: agentA1._id, followUpDate: followUp })
    await createLead({ name: 'Export Team Match', source: 'Facebook', leadStatus: LEAD_STATUS.INTERESTED, assignedAgent: agentA2._id, followUpDate: followUp })
    await createLead({ name: 'Export Mine Wrong Source', source: 'Google', leadStatus: LEAD_STATUS.INTERESTED, assignedAgent: agentA1._id, followUpDate: followUp })
    await ActivityService.createLeadNote(orgA, String(leadMine._id), 'Latest export note', String(agentA1._id), managerAccess(ownerA))

    const filters = {
      source: 'Facebook',
      leadStatus: LEAD_STATUS.INTERESTED,
      followUpFrom: bounds.start.toISOString(),
      followUpTo: bounds.endExclusive.toISOString(),
    }
    const memberCsv = await LeadService.exportCsv(orgA, filters, memberAccess(agentA1))
    expect(memberCsv).toContain('Export Mine Match')
    expect(memberCsv).not.toContain('Export Team Match')
    expect(memberCsv).not.toContain('Export Mine Wrong Source')
    expect(memberCsv).toContain('Latest export note')

    const ownerCsv = await LeadService.exportCsv(orgA, filters, managerAccess(ownerA))
    expect(ownerCsv).toContain('Export Mine Match')
    expect(ownerCsv).toContain('Export Team Match')

    await ContactService.createContact(orgA, { name: 'Contact Mine Match', phone: nextPhone(), source: 'Referral', assignedTo: String(agentA1._id) }, String(ownerA._id), managerAccess(ownerA))
    await ContactService.createContact(orgA, { name: 'Contact Team Match', phone: nextPhone(), source: 'Referral', assignedTo: String(agentA2._id) }, String(ownerA._id), managerAccess(ownerA))
    await ContactService.createContact(orgA, { name: 'Contact Mine Wrong Source', phone: nextPhone(), source: 'Google', assignedTo: String(agentA1._id) }, String(ownerA._id), managerAccess(ownerA))

    const contactMemberCsv = await ContactService.exportCsv(orgA, { source: 'Referral' }, memberAccess(agentA1))
    expect(contactMemberCsv).toContain('Contact Mine Match')
    expect(contactMemberCsv).not.toContain('Contact Team Match')
    expect(contactMemberCsv).not.toContain('Contact Mine Wrong Source')

    const contactOwnerCsv = await ContactService.exportCsv(orgA, { source: 'Referral' }, managerAccess(ownerA))
    expect(contactOwnerCsv).toContain('Contact Mine Match')
    expect(contactOwnerCsv).toContain('Contact Team Match')
  }, 30_000)
})
