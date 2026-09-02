import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { PropertyOwnershipService } from './propertyOwnership.service'

const actor = (req: Request) => ({
  id: String(req.user?._id || req.user?.id || ''),
  role: req.user?.userRole || req.user?.role || req.tenant?.role,
  requestId: req.requestId,
  ip: req.ip,
})

const getOwnership = catchAsync(async (req: Request, res: Response) => {
  const data = await PropertyOwnershipService.getOwnershipBundle(requireTenant(req), req.params.id)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property ownership fetched successfully', data })
})

const updateProfile = catchAsync(async (req: Request, res: Response) => {
  const data = await PropertyOwnershipService.updateProfile(requireTenant(req), req.params.id, actor(req), req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property ownership profile updated successfully', data })
})

const createOwner = catchAsync(async (req: Request, res: Response) => {
  const data = await PropertyOwnershipService.createOwner(requireTenant(req), req.params.id, actor(req), req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Property owner added successfully', data })
})

const updateOwner = catchAsync(async (req: Request, res: Response) => {
  const data = await PropertyOwnershipService.updateOwner(requireTenant(req), req.params.id, req.params.ownerId, actor(req), req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property owner updated successfully', data })
})

const deleteOwner = catchAsync(async (req: Request, res: Response) => {
  const data = await PropertyOwnershipService.deleteOwner(requireTenant(req), req.params.id, req.params.ownerId, actor(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property owner removed successfully', data })
})

const createInvestor = catchAsync(async (req: Request, res: Response) => {
  const data = await PropertyOwnershipService.createInvestor(requireTenant(req), req.params.id, actor(req), req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Property investor added successfully', data })
})

const updateInvestor = catchAsync(async (req: Request, res: Response) => {
  const data = await PropertyOwnershipService.updateInvestor(requireTenant(req), req.params.id, req.params.investorId, actor(req), req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property investor updated successfully', data })
})

const createInvestment = catchAsync(async (req: Request, res: Response) => {
  const data = await PropertyOwnershipService.createInvestment(requireTenant(req), req.params.id, req.params.investorId, actor(req), req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Property investment contribution posted successfully', data })
})

const createDistribution = catchAsync(async (req: Request, res: Response) => {
  const data = await PropertyOwnershipService.createDistribution(requireTenant(req), req.params.id, req.params.investorId, actor(req), req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Property investor distribution posted successfully', data })
})

const reverseInvestment = catchAsync(async (req: Request, res: Response) => {
  const data = await PropertyOwnershipService.reverseInvestment(requireTenant(req), req.params.id, req.params.investorId, req.params.investmentId, actor(req), req.body.reason)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property investment contribution reversed successfully', data })
})

const reverseDistribution = catchAsync(async (req: Request, res: Response) => {
  const data = await PropertyOwnershipService.reverseDistribution(requireTenant(req), req.params.id, req.params.investorId, req.params.distributionId, actor(req), req.body.reason)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property investor distribution reversed successfully', data })
})

const getActivity = catchAsync(async (req: Request, res: Response) => {
  const data = await PropertyOwnershipService.getActivity(requireTenant(req), req.params.id, Number(req.query.limit || 50))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property activity fetched successfully', data })
})

export const PropertyOwnershipController = {
  getOwnership,
  updateProfile,
  createOwner,
  updateOwner,
  deleteOwner,
  createInvestor,
  updateInvestor,
  createInvestment,
  createDistribution,
  reverseInvestment,
  reverseDistribution,
  getActivity,
}
