import type { NextFunction, Request, Response } from 'express'
import httpStatus from 'http-status'
import mongoose from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { requireTenant, type Permission } from '../../middlewares/auth'
import { FinanceInvoice } from './finance.model'
import { FINANCE_ERROR_CODES } from './finance.contract'

/**
 * Invoice payments are shared by legacy Finance and Customer Finance. Booking
 * invoices must not be a permission bypass: they require the narrow
 * customerPayments.manage permission even when the caller has broad Finance
 * access. Normal invoices continue to require finance.write.
 */
export const requireInvoicePaymentPermission = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const organizationId = requireTenant(req)
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid invoice id')
    const invoice: any = await FinanceInvoice.findOne({ _id: req.params.id, organizationId, archivedAt: null })
      .select('_id bookingId')
      .lean()
    if (!invoice) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found')

    const requiredPermission: Permission = invoice.bookingId ? 'customerPayments.manage' : 'finance.write'
    if (!req.tenant?.permissions.includes(requiredPermission)) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        `Missing permission: ${requiredPermission}`,
        '',
        requiredPermission === 'finance.write' ? FINANCE_ERROR_CODES.permissionRequired : 'PERMISSION_REQUIRED',
        { requiredPermission },
      )
    }
    next()
  } catch (error) {
    next(error)
  }
}
