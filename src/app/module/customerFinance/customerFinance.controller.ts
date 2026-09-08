import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { requireTenant } from '../../middlewares/auth'
import { crmAccessFromRequest, crmRecordReadAccessFromRequest } from '../crm/crmAccess'
import { CustomerFinanceService } from './customerFinance.service'

const actorId = (req: Request) => req.user?._id || req.user?.id || ''
const financeActor = (req: Request) => ({ id: actorId(req), role: req.user?.userRole || 'tenant', requestId: req.requestId, ip: req.ip })

const listCustomers = catchAsync(async (req: Request, res: Response) => {
  const result = await CustomerFinanceService.listCustomers(
    requireTenant(req),
    req.query,
    pick(req.query, ['page', 'limit']),
    crmRecordReadAccessFromRequest(req),
  )
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Customers fetched successfully', meta: result.meta, data: result.data })
})

const createBooking = catchAsync(async (req: Request, res: Response) => {
  const data = await CustomerFinanceService.createBooking(requireTenant(req), req.params.contactId, financeActor(req), req.body, crmAccessFromRequest(req))
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Customer booking created successfully', data })
})

const getProfile = catchAsync(async (req: Request, res: Response) => {
  const data = await CustomerFinanceService.getCustomerProfile(requireTenant(req), req.params.contactId, crmRecordReadAccessFromRequest(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Customer financial profile fetched successfully', data })
})

const listBookings = catchAsync(async (req: Request, res: Response) => {
  const result = await CustomerFinanceService.listBookings(
    requireTenant(req),
    req.params.contactId,
    pick(req.query, ['page', 'limit']),
    crmRecordReadAccessFromRequest(req),
  )
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Customer bookings fetched successfully', meta: result.meta, data: result.data })
})

const getBooking = catchAsync(async (req: Request, res: Response) => {
  const data = await CustomerFinanceService.getBookingById(requireTenant(req), req.params.bookingId, crmRecordReadAccessFromRequest(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Customer booking fetched successfully', data })
})

const recordPayment = catchAsync(async (req: Request, res: Response) => {
  const data = await CustomerFinanceService.recordPayment(requireTenant(req), req.params.bookingId, financeActor(req), req.body, crmRecordReadAccessFromRequest(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Customer payment recorded successfully', data })
})

export const CustomerFinanceController = { listCustomers, createBooking, getProfile, listBookings, getBooking, recordPayment }
