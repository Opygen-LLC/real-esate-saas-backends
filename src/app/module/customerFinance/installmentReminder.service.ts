import { EntitlementService } from '../entitlement/entitlement.service'
import { Contact } from '../contact/contact.model'
import { NotificationService } from '../notification/notification.service'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { Installment } from './installment.model'
import { SaleBooking } from './saleBooking.model'
import { FinanceInvoice } from '../finance/finance.model'
import { moneyToMinorUnits } from '../finance/finance.money'
import { projectInstallments } from './customerFinanceProjection.service'

const moneyLabel = (minor: number) => `BDT ${(Math.max(0, Number(minor || 0)) / 100).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`
const dateLabel = (value: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric' }).format(value)

type InstallmentReminderKind = 'due_7_days' | 'due_tomorrow' | 'overdue'

export const deliverInstallmentReminder = async (job: any) => {
  const installmentId = String(job.payload?.installmentId || '')
  const reminderKind = String(job.payload?.reminderKind || '') as InstallmentReminderKind
  if (!installmentId || !['due_7_days', 'due_tomorrow', 'overdue'].includes(reminderKind)) return

  const entitlement = await EntitlementService.resolve(job.organizationId, undefined, { allowInactive: true })
  if (!entitlement.limits?.entitlements?.customerFinance?.enabled) return

  const installment: any = await Installment.findOne({ _id: installmentId, organizationId: job.organizationId }).lean()
  if (!installment || ['Waived', 'Cancelled'].includes(installment.status)) return

  const booking: any = await SaleBooking.findOne({ _id: installment.bookingId, organizationId: job.organizationId }).lean()
  if (!booking || ['Completed', 'Cancelled'].includes(booking.status)) return

  const [scheduleRows, invoice]: any[] = await Promise.all([
    Installment.find({ organizationId: job.organizationId, bookingId: booking._id }).sort({ sequence: 1 }).lean(),
    booking.financeInvoiceId ? FinanceInvoice.findOne({ _id: booking.financeInvoiceId, organizationId: job.organizationId }).select('paidAmount').lean() : null,
  ])
  const totalPaidMinor = invoice ? moneyToMinorUnits(Number(invoice.paidAmount || 0)) : 0
  const projected = projectInstallments(scheduleRows, totalPaidMinor)
  const current = projected.find((row) => String(row._id) === installmentId)
  if (!current || ['Paid', 'Waived', 'Cancelled'].includes(current.status) || Number(current.outstandingMinor || 0) <= 0) return

  const contact: any = await Contact.findOne({ _id: booking.contactId, organizationId: job.organizationId }).select('_id name assignedTo').lean()
  if (!contact) return
  const userId = contact.assignedTo?.toString() || booking.createdBy?.toString()
  if (!userId) return

  const outstandingMinor = Number(current.outstandingMinor || 0)
  const prefix = reminderKind === 'due_7_days'
    ? 'Installment due in 7 days'
    : reminderKind === 'due_tomorrow'
      ? 'Installment due tomorrow'
      : 'Installment overdue'
  const title = `${prefix}: ${contact.name}`
  const body = `${installment.title} · ${moneyLabel(outstandingMinor)} · Due ${dateLabel(new Date(installment.dueDate))}`
  await NotificationService.createFromJob({
    organizationId: job.organizationId,
    userId,
    jobId: job._id.toString(),
    type: 'installment_reminder',
    title,
    body,
    entityId: String(contact._id),
    leadId: booking.originatingLeadId?.toString(),
  })
  await DomainEventService.emit({
    organizationId: job.organizationId,
    aggregateType: 'sale_booking',
    aggregateId: String(booking._id),
    eventType: 'customer_finance.installment_reminder_due',
    contactId: String(contact._id),
    leadId: booking.originatingLeadId?.toString(),
    actorId: userId,
    payload: { summary: title, installmentId, reminderKind, dueDate: installment.dueDate, outstandingMinor },
  }).catch(() => undefined)
}
