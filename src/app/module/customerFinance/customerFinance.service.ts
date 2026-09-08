import { randomBytes } from 'crypto'
import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { requiredTransaction } from '../../db/requiredTransaction'
import paginationHelper from '../../helpers/paginationHelper'
import type { IPaginationOptions } from '../../../interfaces/common'
import { Contact } from '../contact/contact.model'
import { visibleContactRelationshipFilter } from '../contact/contactRelationship.contract'
import { crmMutationOwnerFilter, crmReadOwnerFilter, type CrmAccessContext } from '../crm/crmAccess'
import { Property } from '../property/property.model'
import { Lead } from '../lead/lead.model'
import { Task } from '../task/task.model'
import { FinanceInvoice } from '../finance/finance.model'
import { FinanceService, type FinanceActorContext } from '../finance/finance.service'
import { moneyFromMinorUnits, moneyToMinorUnits } from '../finance/finance.money'
import { ActivityService } from '../activity/activity.service'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { Installment } from './installment.model'
import { SaleBooking } from './saleBooking.model'
import type { IPaymentPlanSnapshot, InstallmentKind } from './customerFinance.interface'
import { projectInstallments, projectedInstallmentStatus } from './customerFinanceProjection.service'

const OPEN_BOOKING_STATUSES = ['Reserved', 'Active'] as const
const BOOKABLE_PROPERTY_STATUSES = ['Available', 'UnderOffer', 'ComingSoon'] as const

const actorObjectId = (actorId: string) => {
  if (!mongoose.isValidObjectId(actorId)) throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid authenticated user')
  return new mongoose.Types.ObjectId(actorId)
}

const asDate = (value: unknown, fallback = new Date()): Date => {
  if (!value) return fallback
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid date')
    return value
  }
  const raw = String(value).trim()
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00+06:00`)
    : new Date(raw)
  if (Number.isNaN(parsed.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid date')
  return parsed
}

const dateOnlyDhaka = (value: Date): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(value)

const dhakaDateFromParts = (year: number, month: number, day: number): Date => {
  const normalizedMonth = Math.max(1, Math.min(12, month))
  const lastDay = new Date(Date.UTC(year, normalizedMonth, 0)).getUTCDate()
  const safeDay = Math.max(1, Math.min(lastDay, day))
  return new Date(`${year}-${String(normalizedMonth).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}T00:00:00+06:00`)
}

const addFrequency = (date: Date, frequency: string, steps: number): Date => {
  const [year, month, day] = dateOnlyDhaka(date).split('-').map(Number)
  const monthsPerStep = frequency === 'MONTHLY' ? 1 : frequency === 'QUARTERLY' ? 3 : frequency === 'BIANNUAL' ? 6 : frequency === 'ANNUAL' ? 12 : 0
  if (!monthsPerStep) throw new ApiError(httpStatus.BAD_REQUEST, 'Custom installment frequency is not supported for automatic schedules')
  const monthIndex = (month - 1) + (monthsPerStep * steps)
  const targetYear = year + Math.floor(monthIndex / 12)
  const targetMonth = ((monthIndex % 12) + 12) % 12 + 1
  return dhakaDateFromParts(targetYear, targetMonth, day)
}

const generateBookingNumber = () => `BKG-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`

const nonNegativeMoneyMinor = (value: unknown, fallback = 0): number => {
  if (value === undefined || value === null || value === '') return moneyToMinorUnits(fallback)
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid payment-plan amount')
  return moneyToMinorUnits(number)
}

const buildPaymentPlan = (property: any, payload: any, bookingDate: Date, agreedPriceMinor: number) => {
  const plan = property.paymentPlan || {}
  const advertisedPrice = Number(property.pricing?.askingPrice ?? property.price ?? 0)
  const advertisedPriceMinor = nonNegativeMoneyMinor(advertisedPrice)
  const paymentType = String(plan.type || 'INSTALLMENT') as IPaymentPlanSnapshot['paymentType']
  const bookingAmountMinor = nonNegativeMoneyMinor(payload.bookingAmount, Number(plan.bookingAmount || 0))

  const downPaymentPercent = payload.downPaymentPercent !== undefined
    ? Number(payload.downPaymentPercent)
    : plan.downPaymentPercent !== undefined
      ? Number(plan.downPaymentPercent)
      : undefined
  const planDownPayment = payload.downPaymentAmount !== undefined
    ? Number(payload.downPaymentAmount)
    : plan.downPaymentAmount !== undefined
      ? Number(plan.downPaymentAmount)
      : downPaymentPercent !== undefined
        ? moneyFromMinorUnits(agreedPriceMinor) * (downPaymentPercent / 100)
        : 0
  const downPaymentAmountMinor = nonNegativeMoneyMinor(planDownPayment)
  const handoverPaymentMinor = nonNegativeMoneyMinor(payload.handoverPayment, Number(plan.handoverPayment || 0))
  const registrationPaymentMinor = nonNegativeMoneyMinor(payload.registrationPayment, Number(plan.registrationPayment || 0))

  let installmentCount = payload.installmentCount !== undefined
    ? Number(payload.installmentCount)
    : Number(plan.installmentCount || 0)
  let installmentFrequency = String(payload.installmentFrequency || plan.installmentFrequency || 'MONTHLY') as IPaymentPlanSnapshot['installmentFrequency']

  const fixedMinor = bookingAmountMinor + downPaymentAmountMinor + handoverPaymentMinor + registrationPaymentMinor
  if (fixedMinor > agreedPriceMinor) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Booking, down payment, handover and registration amounts cannot exceed the agreed price')
  }

  const remainingMinor = agreedPriceMinor - fixedMinor
  if (remainingMinor > 0 && installmentCount <= 0) installmentCount = 1
  if (remainingMinor > 0 && installmentCount > 0 && installmentFrequency === 'CUSTOM') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Custom installment frequency is not supported for automatic schedules')
  }
  if (remainingMinor > 0 && installmentCount > remainingMinor) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Installment count is too high for the remaining payable amount')
  }
  if (paymentType === 'FULL_PAYMENT' && fixedMinor === 0) {
    installmentCount = 1
    installmentFrequency = 'MONTHLY'
  }

  const snapshot: IPaymentPlanSnapshot = {
    paymentType,
    advertisedPriceMinor,
    bookingAmountMinor,
    downPaymentAmountMinor,
    ...(downPaymentPercent !== undefined ? { downPaymentPercent } : {}),
    installmentCount,
    installmentFrequency,
    installmentAmountMinor: installmentCount > 0 ? Math.floor(remainingMinor / installmentCount) : 0,
    handoverPaymentMinor,
    registrationPaymentMinor,
    ...(property.handoverDate ? { propertyHandoverDate: asDate(property.handoverDate) } : {}),
    capturedAt: new Date(),
  }

  const rows: Array<{ kind: InstallmentKind; title: string; dueDate: Date; amountMinor: number }> = []
  if (bookingAmountMinor > 0) rows.push({ kind: 'Booking', title: 'Booking Amount', dueDate: bookingDate, amountMinor: bookingAmountMinor })
  if (downPaymentAmountMinor > 0) rows.push({
    kind: 'DownPayment', title: 'Down Payment', dueDate: asDate(payload.downPaymentDueDate, bookingDate), amountMinor: downPaymentAmountMinor,
  })

  if (remainingMinor > 0) {
    if (installmentCount <= 1 && paymentType === 'FULL_PAYMENT') {
      rows.push({ kind: 'Balance', title: 'Balance Payment', dueDate: asDate(payload.firstInstallmentDate, bookingDate), amountMinor: remainingMinor })
    } else {
      const first = asDate(payload.firstInstallmentDate, addFrequency(bookingDate, installmentFrequency, 1))
      const baseAmount = Math.floor(remainingMinor / Math.max(1, installmentCount))
      for (let index = 0; index < installmentCount; index += 1) {
        const amountMinor = index === installmentCount - 1
          ? remainingMinor - (baseAmount * (installmentCount - 1))
          : baseAmount
        rows.push({
          kind: 'Installment',
          title: `Installment ${index + 1}`,
          dueDate: index === 0 ? first : addFrequency(first, installmentFrequency, index),
          amountMinor,
        })
      }
    }
  }

  const lastScheduledDate = rows.length ? rows[rows.length - 1].dueDate : bookingDate
  if (handoverPaymentMinor > 0) rows.push({
    kind: 'Handover', title: 'Handover Payment', dueDate: asDate(payload.handoverDate, property.handoverDate ? asDate(property.handoverDate) : lastScheduledDate), amountMinor: handoverPaymentMinor,
  })
  if (registrationPaymentMinor > 0) rows.push({
    kind: 'Registration', title: 'Registration Payment', dueDate: asDate(payload.registrationDate, rows.length ? rows[rows.length - 1].dueDate : lastScheduledDate), amountMinor: registrationPaymentMinor,
  })

  if (!rows.length && agreedPriceMinor > 0) rows.push({ kind: 'Balance', title: 'Full Payment', dueDate: bookingDate, amountMinor: agreedPriceMinor })
  const scheduleTotal = rows.reduce((sum, row) => sum + row.amountMinor, 0)
  if (scheduleTotal !== agreedPriceMinor) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Installment schedule total does not match agreed price')
  return { snapshot, rows }
}

const scheduleInstallmentReminders = async (organizationId: string, installments: any[], session?: ClientSession) => {
  const jobs: Array<{ organizationId: string; type: 'installment_reminder'; entityId: string; runAt: Date; payload: Record<string, string> }> = []
  for (const installment of installments) {
    const installmentId = String(installment._id)
    const dueDate = new Date(installment.dueDate)
    const dueDateOnly = dateOnlyDhaka(dueDate)
    const dueMidnight = new Date(`${dueDateOnly}T00:00:00+06:00`)
    const reminders = [
      { kind: 'due_7_days', runAt: new Date(dueMidnight.getTime() - (7 * 86_400_000) + (9 * 3_600_000)) },
      { kind: 'due_tomorrow', runAt: new Date(dueMidnight.getTime() - 86_400_000 + (9 * 3_600_000)) },
      { kind: 'overdue', runAt: new Date(Math.max(dueMidnight.getTime() + 86_400_000 + (9 * 3_600_000), Date.now() + 60_000)) },
    ]
    for (const reminder of reminders) {
      jobs.push({
        organizationId,
        type: 'installment_reminder',
        entityId: `${installmentId}:${reminder.kind}`,
        runAt: reminder.runAt,
        payload: { installmentId, reminderKind: reminder.kind },
      })
    }
  }
  await OperationsQueueService.scheduleMany(jobs, session ? { session } : {})
}

const createBooking = async (
  organizationId: string,
  contactId: string,
  actor: FinanceActorContext,
  payload: any,
  access?: CrmAccessContext,
) => {
  const actorId = actor.id
  const actorIdObject = actorObjectId(actorId)
  const bookingDate = asDate(payload.bookingDate)
  const agreedPriceMinor = moneyToMinorUnits(Number(payload.agreedPrice))
  if (agreedPriceMinor <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Agreed price must be greater than zero')
  const bookingNumber = generateBookingNumber()

  let created: any
  try {
    created = await requiredTransaction(async (session) => {
      const contact: any = await Contact.findOne({
        _id: contactId,
        organizationId,
        ...crmMutationOwnerFilter('assignedTo', access),
        ...visibleContactRelationshipFilter,
      }).session(session)
      if (!contact) throw new ApiError(httpStatus.NOT_FOUND, 'Contact not found')
      if (contact.type !== 'Buyer' && contact.type !== 'Investor') {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Only Buyer or Investor contacts can create a sale booking')
      }

      const property: any = await Property.findOne({ _id: payload.propertyId, organizationId }).session(session)
      if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
      if (property.listingType !== 'ForSale') throw new ApiError(httpStatus.BAD_REQUEST, 'Only properties listed for sale can be booked')
      if (!BOOKABLE_PROPERTY_STATUSES.includes(property.status)) throw new ApiError(httpStatus.CONFLICT, `Property cannot be booked while its status is ${property.status}`)

      const existing = await SaleBooking.exists({ organizationId, propertyId: property._id, status: { $in: OPEN_BOOKING_STATUSES } }).session(session)
      if (existing) throw new ApiError(httpStatus.CONFLICT, 'This property already has an active booking')

      let originatingLeadId = contact.sourceLeadId || undefined
      if (payload.originatingLeadId) {
        const lead: any = await Lead.findOne({ _id: payload.originatingLeadId, organizationId, convertedContactId: contact._id }).select('_id').session(session).lean()
        if (!lead) throw new ApiError(httpStatus.BAD_REQUEST, 'Originating lead is not linked to this contact')
        originatingLeadId = lead._id
      }

      const { snapshot, rows } = buildPaymentPlan(property, payload, bookingDate, agreedPriceMinor)
      const bookingId = new mongoose.Types.ObjectId()
      const activePropertyKey = `${organizationId}:${String(property._id)}`
      const bookingDocs: any[] = await SaleBooking.create([{
        _id: bookingId,
        organizationId,
        bookingNumber,
        contactId: contact._id,
        propertyId: property._id,
        originatingLeadId,
        agreedPriceMinor,
        currency: 'BDT',
        bookingDate,
        status: payload.status || 'Reserved',
        activePropertyKey,
        paymentPlanSnapshot: snapshot,
        createdBy: actorIdObject,
        updatedBy: actorIdObject,
      }], { session })
      const booking = bookingDocs[0]

      const orderedRows = rows
        .map((row, originalIndex) => ({ row, originalIndex }))
        .sort((a, b) => new Date(a.row.dueDate).getTime() - new Date(b.row.dueDate).getTime() || a.originalIndex - b.originalIndex)
        .map(({ row }) => row)
      const installmentDocs: any[] = await Installment.create(orderedRows.map((row, index) => ({
        organizationId,
        bookingId,
        sequence: index + 1,
        ...row,
        status: projectedInstallmentStatus(row, 0),
        paidAmountMinor: 0,
      })), { session })

      const lastDueDate = installmentDocs.reduce((latest, row) => row.dueDate > latest ? row.dueDate : latest, bookingDate)
      const agreedPrice = moneyFromMinorUnits(agreedPriceMinor)
      const invoice: any = await FinanceService.createCustomerFinanceBookingInvoice(organizationId, actor, {
        bookingId,
        propertyId: property._id,
        contactId: contact._id,
        leadId: originatingLeadId,
        bookingNumber,
        propertyTitle: property.title,
        clientName: contact.name,
        clientPhone: contact.phone || '',
        clientEmail: contact.email || '',
        issueDate: bookingDate,
        dueDate: lastDueDate,
        amount: agreedPrice,
      }, session)
      booking.financeInvoiceId = invoice._id
      await booking.save({ session })

      const reserveResult = await Property.updateOne(
        { _id: property._id, organizationId, status: { $in: BOOKABLE_PROPERTY_STATUSES } },
        { $set: { status: 'Reserved' } },
        { session },
      )
      if (reserveResult.matchedCount !== 1) throw new ApiError(httpStatus.CONFLICT, 'Property availability changed while creating the booking')
      await scheduleInstallmentReminders(organizationId, installmentDocs, session)
      return { booking, installments: installmentDocs }
    })
  } catch (error: any) {
    if (error?.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'This property already has an active booking')
    throw error
  }

  await DomainEventService.emit({
    organizationId,
    aggregateType: 'sale_booking',
    aggregateId: String(created.booking._id),
    eventType: 'customer_finance.booking_created',
    contactId,
    leadId: created.booking.originatingLeadId ? String(created.booking.originatingLeadId) : undefined,
    actorId,
    payload: { summary: `Booking ${created.booking.bookingNumber} created`, bookingNumber: created.booking.bookingNumber },
  }).catch(() => undefined)

  return getBookingById(organizationId, String(created.booking._id), access)
}

const bookingAccessFilter = async (organizationId: string, bookingId: string, access?: CrmAccessContext) => {
  const booking: any = await SaleBooking.findOne({ _id: bookingId, organizationId }).lean()
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found')
  const contact = await Contact.exists({ _id: booking.contactId, organizationId, ...crmReadOwnerFilter('assignedTo', access), ...visibleContactRelationshipFilter })
  if (!contact) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found')
  return booking
}

const getBookingById = async (organizationId: string, bookingId: string, access?: CrmAccessContext) => {
  const booking = await bookingAccessFilter(organizationId, bookingId, access)
  const [property, installments, invoice] = await Promise.all([
    Property.findOne({ _id: booking.propertyId, organizationId }).select('title slug status price pricing currency buildingName floorNumber address city images handoverDate').lean(),
    Installment.find({ organizationId, bookingId: booking._id }).sort({ sequence: 1 }).lean(),
    booking.financeInvoiceId ? FinanceInvoice.findOne({ _id: booking.financeInvoiceId, organizationId }).lean() : null,
  ])
  const totalPaidMinor = invoice ? moneyToMinorUnits(Number(invoice.paidAmount || 0)) : 0
  return {
    booking,
    property,
    installments: projectInstallments(installments as any[], totalPaidMinor),
    financialSummary: {
      agreedPriceMinor: Number(booking.agreedPriceMinor || 0),
      totalPaidMinor,
      outstandingMinor: Math.max(0, Number(booking.agreedPriceMinor || 0) - totalPaidMinor),
      currency: booking.currency,
    },
  }
}

const listBookings = async (organizationId: string, contactId: string, options: IPaginationOptions, access?: CrmAccessContext) => {
  const contact = await Contact.exists({ _id: contactId, organizationId, ...crmReadOwnerFilter('assignedTo', access), ...visibleContactRelationshipFilter })
  if (!contact) throw new ApiError(httpStatus.NOT_FOUND, 'Contact not found')
  const { page, limit, skip } = paginationHelper.calculatePagination(options)
  const where = { organizationId, contactId }
  const [rows, total] = await Promise.all([
    SaleBooking.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).populate({ path: 'propertyId', select: 'title status buildingName floorNumber', match: { organizationId } }).lean(),
    SaleBooking.countDocuments(where),
  ])
  return { meta: { page, limit, total }, data: rows }
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const listCustomers = async (organizationId: string, query: Record<string, unknown>, options: IPaginationOptions, access?: CrmAccessContext) => {
  const { page, limit, skip } = paginationHelper.calculatePagination(options)
  const searchTerm = typeof query.searchTerm === 'string' ? query.searchTerm.trim() : ''
  const where: Record<string, any> = {
    organizationId,
    type: { $in: ['Buyer', 'Investor'] },
    ...crmReadOwnerFilter('assignedTo', access),
    ...visibleContactRelationshipFilter,
  }
  if (searchTerm) {
    const regex = new RegExp(escapeRegex(searchTerm), 'i')
    where.$or = [{ name: regex }, { phone: regex }, { email: regex }, { company: regex }]
  }
  const [contacts, total] = await Promise.all([
    Contact.find(where).sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Contact.countDocuments(where),
  ])
  const contactIds = contacts.map((row: any) => row._id)
  const bookings: any[] = contactIds.length
    ? await SaleBooking.find({ organizationId, contactId: { $in: contactIds } }).sort({ createdAt: -1 }).lean()
    : []
  const bookingByContact = new Map<string, any>()
  for (const booking of bookings) {
    const key = String(booking.contactId)
    const current = bookingByContact.get(key)
    if (!current || (OPEN_BOOKING_STATUSES.includes(booking.status) && !OPEN_BOOKING_STATUSES.includes(current.status))) bookingByContact.set(key, booking)
  }
  const propertyIds = Array.from(new Set(Array.from(bookingByContact.values()).map((booking) => String(booking.propertyId))))
  const properties: any[] = propertyIds.length
    ? await Property.find({ organizationId, _id: { $in: propertyIds } }).select('title status buildingName floorNumber').lean()
    : []
  const propertyById = new Map(properties.map((row) => [String(row._id), row]))
  const data = contacts.map((contact: any) => {
    const booking = bookingByContact.get(String(contact._id)) || null
    return {
      ...contact,
      booking: booking ? {
        _id: booking._id,
        bookingNumber: booking.bookingNumber,
        status: booking.status,
        agreedPriceMinor: booking.agreedPriceMinor,
        property: propertyById.get(String(booking.propertyId)) || null,
      } : null,
    }
  })
  return { meta: { page, limit, total }, data }
}

const getCustomerProfile = async (organizationId: string, contactId: string, access?: CrmAccessContext) => {
  const contact: any = await Contact.findOne({ _id: contactId, organizationId, ...crmReadOwnerFilter('assignedTo', access), ...visibleContactRelationshipFilter }).lean()
  if (!contact) throw new ApiError(httpStatus.NOT_FOUND, 'Contact not found')

  const bookings: any[] = await SaleBooking.find({ organizationId, contactId }).sort({ createdAt: -1 }).lean()
  const booking = bookings.find((row) => OPEN_BOOKING_STATUSES.includes(row.status)) || bookings[0] || null
  const activitiesPromise = ActivityService.getContactHistory(organizationId, contactId, { page: 1, limit: 50 }, access)
  if (!booking) {
    const [activities, lead, followUpTask] = await Promise.all([
      activitiesPromise,
      contact.sourceLeadId ? Lead.findOne({ _id: contact.sourceLeadId, organizationId }).select('_id followUpDate').lean() : null,
      contact.sourceLeadId ? Task.findOne({ organizationId, linkedLead: contact.sourceLeadId, taskType: 'lead_follow_up', status: { $in: ['Pending', 'InProgress', 'Overdue'] } }).sort({ dueAt: 1 }).select('title description dueAt').lean() : null,
    ])
    const nextFollowUpDate = (lead as any)?.followUpDate || (followUpTask as any)?.dueAt || contact.followUpDate
    return {
      customer: contact,
      booking: null,
      bookings: [],
      property: null,
      financialSummary: { agreedPriceMinor: 0, downPaymentMinor: 0, totalPaidMinor: 0, outstandingMinor: 0, overdueMinor: 0, currency: 'BDT' },
      nextInstallment: null,
      installments: [],
      payments: [],
      nextFollowUp: nextFollowUpDate ? { date: nextFollowUpDate, leadId: contact.sourceLeadId ? String(contact.sourceLeadId) : null, title: (followUpTask as any)?.title || undefined, note: (followUpTask as any)?.description || undefined } : null,
      recentActivities: activities.data,
    }
  }

  const followUpLeadId = booking.originatingLeadId || contact.sourceLeadId
  const [property, installments, invoice, activities, lead, followUpTask] = await Promise.all([
    Property.findOne({ _id: booking.propertyId, organizationId }).select('title slug status price pricing currency buildingName floorNumber address city images handoverDate').lean(),
    Installment.find({ organizationId, bookingId: booking._id }).sort({ sequence: 1 }).lean(),
    booking.financeInvoiceId ? FinanceInvoice.findOne({ _id: booking.financeInvoiceId, organizationId }).populate('payments.recordedBy', 'name email').lean() : null,
    activitiesPromise,
    followUpLeadId ? Lead.findOne({ _id: followUpLeadId, organizationId }).select('_id followUpDate').lean() : null,
    followUpLeadId ? Task.findOne({ organizationId, linkedLead: followUpLeadId, taskType: 'lead_follow_up', status: { $in: ['Pending', 'InProgress', 'Overdue'] } }).sort({ dueAt: 1 }).select('title description dueAt').lean() : null,
  ])
  const totalPaidMinor = invoice ? moneyToMinorUnits(Number((invoice as any).paidAmount || 0)) : 0
  const projected = projectInstallments(installments as any[], totalPaidMinor)
  const nextInstallment = projected
    .filter((row) => !['Paid', 'Waived', 'Cancelled'].includes(row.status))
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0] || null
  const overdueMinor = projected.filter((row) => row.status === 'Overdue').reduce((sum, row) => sum + Number(row.outstandingMinor || 0), 0)
  const payments = ((invoice as any)?.payments || []).slice().sort((a: any, b: any) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime()).map((payment: any) => ({
    _id: payment._id,
    amountMinor: moneyToMinorUnits(Number(payment.amount || 0)),
    paidAt: payment.paidAt,
    paymentMethod: payment.paymentMethod,
    reference: payment.reference,
    notes: payment.notes,
    recordedBy: payment.recordedBy,
    transactionId: payment.transactionId,
    status: payment.status || 'posted',
    voidedAt: payment.voidedAt || null,
    voidReason: payment.voidReason || '',
  }))
  const followUpDate = (lead as any)?.followUpDate || (followUpTask as any)?.dueAt || contact.followUpDate
  return {
    customer: contact,
    booking,
    bookings,
    property,
    financialSummary: {
      agreedPriceMinor: Number(booking.agreedPriceMinor || 0),
      downPaymentMinor: Number(booking.paymentPlanSnapshot?.downPaymentAmountMinor || 0),
      totalPaidMinor,
      outstandingMinor: Math.max(0, Number(booking.agreedPriceMinor || 0) - totalPaidMinor),
      overdueMinor,
      currency: booking.currency,
    },
    nextInstallment,
    installments: projected,
    payments,
    nextFollowUp: followUpDate ? { date: followUpDate, leadId: (lead as any)?._id ? String((lead as any)._id) : null, title: (followUpTask as any)?.title || undefined, note: (followUpTask as any)?.description || undefined } : null,
    recentActivities: activities.data,
  }
}

const recordPayment = async (
  organizationId: string,
  bookingId: string,
  actor: FinanceActorContext,
  payload: any,
  access?: CrmAccessContext,
) => {
  const booking = await bookingAccessFilter(organizationId, bookingId, access)
  if (booking.status === 'Cancelled') throw new ApiError(httpStatus.CONFLICT, 'Cannot record a payment for a cancelled booking')
  if (!booking.financeInvoiceId) throw new ApiError(httpStatus.CONFLICT, 'Booking finance invoice is missing')
  const paymentResult: any = await FinanceService.recordInvoicePayment(organizationId, actor, String(booking.financeInvoiceId), payload, { includeReplayMetadata: true })
  const invoice: any = paymentResult.invoice
  if (!paymentResult.replayed) await DomainEventService.emit({
    organizationId,
    aggregateType: 'sale_booking',
    aggregateId: bookingId,
    eventType: 'customer_finance.payment_recorded',
    contactId: String(booking.contactId),
    leadId: booking.originatingLeadId ? String(booking.originatingLeadId) : undefined,
    actorId: actor.id,
    payload: { summary: `Payment recorded for booking ${booking.bookingNumber}`, amountMinor: moneyToMinorUnits(Number(payload.amount)) },
  }).catch(() => undefined)
  return getBookingById(organizationId, bookingId, access)
}


const voidPayment = async (
  organizationId: string,
  bookingId: string,
  paymentId: string,
  actor: FinanceActorContext,
  reason: string,
  access?: CrmAccessContext,
) => {
  const booking = await bookingAccessFilter(organizationId, bookingId, access)
  if (!booking.financeInvoiceId) throw new ApiError(httpStatus.CONFLICT, 'Booking finance invoice is missing')
  await FinanceService.voidInvoicePayment(organizationId, actor, String(booking.financeInvoiceId), paymentId, reason)
  await DomainEventService.emit({
    organizationId,
    aggregateType: 'sale_booking',
    aggregateId: bookingId,
    eventType: 'customer_finance.payment_voided',
    contactId: String(booking.contactId),
    leadId: booking.originatingLeadId ? String(booking.originatingLeadId) : undefined,
    actorId: actor.id,
    payload: { summary: `Customer payment reversed for booking ${booking.bookingNumber}`, paymentId, reason },
  }).catch(() => undefined)
  return getBookingById(organizationId, bookingId, access)
}

export const CustomerFinanceService = { createBooking, listCustomers, getCustomerProfile, listBookings, getBookingById, recordPayment, voidPayment, projectInstallments }
