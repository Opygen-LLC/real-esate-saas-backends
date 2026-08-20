import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip

let mongoose: typeof import('mongoose')
let Notification: any
let NotificationService: any
let SubscriptionPayment: any
let SubscriptionPaymentService: any
let User: any
let AgentProfile: any
let UserService: any
let Viewing: any
let ViewingService: any

suite('Phase 10 final acceptance integration matrix', () => {
  const orgA = 'org_phase10_a'
  const orgB = 'org_phase10_b'

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'false'
    process.env.WORKER_ENABLED = 'false'
    mongoose = await import('mongoose')
    await mongoose.connect(requiredDb!, { autoIndex: true })
    await mongoose.connection.dropDatabase()

    ;({ Notification } = await import('../../app/module/notification/notification.model'))
    ;({ NotificationService } = await import('../../app/module/notification/notification.service'))
    ;({ SubscriptionPayment } = await import('../../app/module/subscriptionPayment/subscriptionPayment.model'))
    ;({ SubscriptionPaymentService } = await import('../../app/module/subscriptionPayment/subscriptionPayment.service'))
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ AgentProfile } = await import('../../app/module/agentProfile/agentProfile.model'))
    ;({ UserService } = await import('../../app/module/user/user.service'))
    ;({ Viewing } = await import('../../app/module/viewing/viewing.model'))
    ;({ ViewingService } = await import('../../app/module/viewing/viewing.service'))
  }, 30_000)

  afterAll(async () => {
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('prevents User A from dismissing User B notification, then soft-dismisses it for the owner', async () => {
    const userA = new mongoose.Types.ObjectId()
    const userB = new mongoose.Types.ObjectId()
    const row = await Notification.create({
      organizationId: orgA,
      userId: userB,
      jobId: new mongoose.Types.ObjectId(),
      type: 'task_reminder',
      title: 'Private reminder',
      entityId: 'task-phase10',
    })

    await expect(NotificationService.dismiss(orgA, String(userA), String(row._id))).rejects.toMatchObject({ statusCode: 404 })
    expect((await Notification.findById(row._id).lean())?.dismissedAt ?? null).toBeNull()

    await NotificationService.dismiss(orgA, String(userB), String(row._id))
    const dismissed = await Notification.findById(row._id).lean()
    expect(dismissed?.dismissedAt).toBeTruthy()
    expect(dismissed?.readAt).toBeTruthy()
    expect(await NotificationService.list(orgA, String(userB), 20)).toHaveLength(0)
  })

  it('delivers subscription confirmation once per payment and surfaces a later renewal as a new confirmation', async () => {
    const userId = new mongoose.Types.ObjectId().toString()
    const base = Date.now() - 60_000
    const makePayment = (suffix: string, confirmedAt: Date) => ({
      paymentNumber: `PAY-P10-${suffix}`,
      receiptNumber: `RCT-P10-${suffix}`,
      organizationId: orgA,
      planId: 'professional',
      planVersion: 1,
      billingCycle: 'yearly',
      amount: 12000,
      currency: 'BDT',
      method: 'bank',
      status: 'confirmed',
      confirmedAt,
      confirmationNoticeEligible: true,
      customerAcknowledgedBy: [],
    })
    await SubscriptionPayment.create([
      makePayment('1', new Date(base)),
      makePayment('2', new Date(base + 10_000)),
    ])

    let current = await SubscriptionPaymentService.getUnacknowledgedConfirmation(orgA, userId)
    expect(current?.paymentNumber).toBe('PAY-P10-2')
    await SubscriptionPaymentService.acknowledgeConfirmation(orgA, userId, 'PAY-P10-2')
    current = await SubscriptionPaymentService.getUnacknowledgedConfirmation(orgA, userId)
    expect(current?.paymentNumber).toBe('PAY-P10-1')
    await SubscriptionPaymentService.acknowledgeConfirmation(orgA, userId, 'PAY-P10-1')
    expect(await SubscriptionPaymentService.getUnacknowledgedConfirmation(orgA, userId)).toBeNull()

    await SubscriptionPayment.create(makePayment('3', new Date(base + 20_000)))
    current = await SubscriptionPaymentService.getUnacknowledgedConfirmation(orgA, userId)
    expect(current?.paymentNumber).toBe('PAY-P10-3')
    const history = await SubscriptionPaymentService.getTenantPaymentHistory(orgA)
    expect(history[0]?.paymentNumber).toBe('PAY-P10-3')
  })

  it('keeps disabled/unlicensed brokers private and lets an active admin publish a licensed tenant member', async () => {
    const actor = await User.create({ name: 'Phase10 Admin', email: 'phase10-admin@example.com', phoneNumber: '+8801700000010', organizationId: orgA, userRole: 'agency_admin', status: 'active', isVerified: true })
    const enabled = await User.create({ name: 'Enabled Broker', email: 'phase10-enabled@example.com', phoneNumber: '+8801700000011', organizationId: orgA, userRole: 'agent', status: 'active', isVerified: true })
    const disabled = await User.create({ name: 'Disabled Broker', email: 'phase10-disabled@example.com', phoneNumber: '+8801700000012', organizationId: orgA, userRole: 'staff', status: 'active', isVerified: true })
    const foreign = await User.create({ name: 'Foreign Broker', email: 'phase10-foreign@example.com', phoneNumber: '+8801700000013', organizationId: orgB, userRole: 'agent', status: 'active', isVerified: true })
    await AgentProfile.create([
      { userId: enabled._id, organizationId: orgA, licenseNumber: 'BD-RE-10', showAsLicensedBroker: true },
      { userId: disabled._id, organizationId: orgA, licenseNumber: 'BD-RE-11', showAsLicensedBroker: false },
      { userId: foreign._id, organizationId: orgB, licenseNumber: 'BD-RE-12', showAsLicensedBroker: true },
    ])

    let publicRows = await UserService.getPublicAgents(orgA)
    expect(publicRows.map((row: any) => row._id)).toContain(String(enabled._id))
    expect(publicRows.map((row: any) => row._id)).not.toContain(String(disabled._id))
    expect(publicRows.map((row: any) => row._id)).not.toContain(String(foreign._id))
    await expect(UserService.getPublicAgentDetail(String(disabled._id))).rejects.toMatchObject({ statusCode: 404 })

    await UserService.updatePublicBrokerProfile(orgA, String(actor._id), String(disabled._id), { showAsLicensedBroker: true, licenseNumber: 'BD-RE-11' })
    publicRows = await UserService.getPublicAgents(orgA)
    expect(publicRows.map((row: any) => row._id)).toContain(String(disabled._id))
  })

  it('orders the paginated viewing table newest-first and the calendar chronologically while isolating tenants', async () => {
    const propertyId = new mongoose.Types.ObjectId()
    const agentId = new mongoose.Types.ObjectId()
    const now = Date.now()
    await Viewing.collection.insertMany([
      { _id: new mongoose.Types.ObjectId(), organizationId: orgA, propertyId, agentId, date: '2026-08-25', startTime: '11:00', endTime: '12:00', status: 'Scheduled', clientName: 'Older Created', clientPhone: '+8801711111111', createdAt: new Date(now - 20_000), updatedAt: new Date(now - 20_000) },
      { _id: new mongoose.Types.ObjectId(), organizationId: orgA, propertyId, agentId, date: '2026-08-24', startTime: '14:00', endTime: '15:00', status: 'Confirmed', clientName: 'Newest Created', clientPhone: '+8801722222222', createdAt: new Date(now - 5_000), updatedAt: new Date(now - 5_000) },
      { _id: new mongoose.Types.ObjectId(), organizationId: orgA, propertyId, agentId, date: '2026-08-24', startTime: '09:00', endTime: '10:00', status: 'Scheduled', clientName: 'Middle Created', clientPhone: '+8801733333333', createdAt: new Date(now - 10_000), updatedAt: new Date(now - 10_000) },
      { _id: new mongoose.Types.ObjectId(), organizationId: orgB, propertyId, agentId, date: '2026-08-23', startTime: '08:00', endTime: '09:00', status: 'Scheduled', clientName: 'Foreign Viewing', clientPhone: '+8801744444444', createdAt: new Date(now), updatedAt: new Date(now) },
    ])

    const table = await ViewingService.getAllViewings({ organizationId: orgA }, { page: 1, limit: 20 })
    expect(table.data.map((row: any) => row.clientName)).toEqual(['Newest Created', 'Middle Created', 'Older Created'])

    const calendar = await ViewingService.getCalendarViewings({ organizationId: orgA, startDate: '2026-08-24', endDate: '2026-08-25' })
    expect(calendar.map((row: any) => `${row.date} ${row.startTime}`)).toEqual(['2026-08-24 09:00', '2026-08-24 14:00', '2026-08-25 11:00'])
    expect(calendar.some((row: any) => row.clientName === 'Foreign Viewing')).toBe(false)
  })
})
