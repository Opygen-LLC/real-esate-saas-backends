import type { ClientSession } from 'mongoose'
import { Property } from '../property/property.model'
import { Installment } from './installment.model'
import { SaleBooking } from './saleBooking.model'
import type { InstallmentStatus } from './customerFinance.interface'

const OPEN_BOOKING_STATUSES = ['Reserved', 'Active'] as const

const dateOnlyDhaka = (value: Date): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(value)

const endOfDhakaDay = (value: Date): Date => new Date(`${dateOnlyDhaka(value)}T23:59:59.999+06:00`)

export const projectedInstallmentStatus = (installment: any, paidAmountMinor: number, now = new Date()): InstallmentStatus => {
  if (installment.status === 'Waived' || installment.status === 'Cancelled') return installment.status
  if (paidAmountMinor >= Number(installment.amountMinor || 0)) return 'Paid'
  if (endOfDhakaDay(new Date(installment.dueDate)).getTime() < now.getTime()) return 'Overdue'
  if (paidAmountMinor > 0) return 'Partial'
  return 'Upcoming'
}

export const projectInstallments = (rows: any[], totalPaidMinor: number, now = new Date()) => {
  let remaining = Math.max(0, totalPaidMinor)
  return rows
    .slice()
    .sort((a, b) => Number(a.sequence) - Number(b.sequence))
    .map((row) => {
      const payable = !['Waived', 'Cancelled'].includes(row.status)
      const amountMinor = Number(row.amountMinor || 0)
      const paidAmountMinor = payable ? Math.min(amountMinor, remaining) : Number(row.paidAmountMinor || 0)
      if (payable) remaining = Math.max(0, remaining - paidAmountMinor)
      return {
        ...(typeof row.toObject === 'function' ? row.toObject() : row),
        paidAmountMinor,
        status: projectedInstallmentStatus(row, paidAmountMinor, now),
        outstandingMinor: Math.max(0, amountMinor - paidAmountMinor),
      }
    })
}

export const syncBookingPaymentProjection = async (
  organizationId: string,
  bookingId: string,
  totalPaidMinor: number,
  session?: ClientSession,
) => {
  const bookingQuery: any = SaleBooking.findOne({ _id: bookingId, organizationId })
  if (session) bookingQuery.session(session)
  const booking: any = await bookingQuery
  if (!booking) return []

  const installmentQuery: any = Installment.find({ organizationId, bookingId: booking._id }).sort({ sequence: 1 })
  if (session) installmentQuery.session(session)
  const rows: any[] = await installmentQuery.lean()
  const projected = projectInstallments(rows, totalPaidMinor)

  if (projected.length) {
    await Installment.bulkWrite(projected.map((row) => ({
      updateOne: {
        filter: { _id: row._id, organizationId, bookingId: booking._id },
        update: { $set: { paidAmountMinor: row.paidAmountMinor, status: row.status } },
      },
    })), session ? { session } : undefined)
  }

  const fullyPaid = totalPaidMinor >= Number(booking.agreedPriceMinor || 0)
  if (fullyPaid && booking.status !== 'Completed') {
    await SaleBooking.updateOne(
      { _id: booking._id, organizationId, status: { $in: OPEN_BOOKING_STATUSES } },
      { $set: { status: 'Completed' }, $unset: { activePropertyKey: 1 } },
      session ? { session } : undefined,
    )
    await Property.updateOne(
      { _id: booking.propertyId, organizationId },
      { $set: { status: 'Sold' } },
      session ? { session } : undefined,
    )
  }

  return projected
}
