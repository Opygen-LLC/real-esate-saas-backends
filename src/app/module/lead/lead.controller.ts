import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { LeadService } from './lead.service'
import { requireTenant } from '../../middlewares/auth'
import { EntitlementService } from '../entitlement/entitlement.service'

const createLead = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  await EntitlementService.assertLimit(organizationId, 'leads')
  const agentId = req.user?._id || req.user?.id
  const result = await LeadService.createLead(organizationId, req.body, agentId)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Lead created successfully',
    data: result,
  })
})

const publicCaptureLead = catchAsync(async (req: Request, res: Response) => {
  const result = await LeadService.publicCaptureLead(req.body, { ip: req.ip, requestId: req.requestId })

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Inquiry submitted successfully. A licensed agent will contact you shortly.',
    data: result,
  })
})

const getAllLeads = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, [
    'searchTerm',
    'organizationId',
    'leadStatus',
    'source',
    'assignedAgent',
    'propertyType',
    'minBudget',
    'maxBudget',
  ])

  filters.organizationId = requireTenant(req)

  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])
  const result = await LeadService.getAllLeads(filters, paginationOptions)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Leads fetched successfully',
    meta: result.meta,
    data: result.data,
  })
})

const getLeadById = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { id } = req.params
  const result = await LeadService.getLeadById(organizationId, id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Lead fetched successfully',
    data: result,
  })
})

const updateLead = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { id } = req.params
  const result = await LeadService.updateLead(organizationId, id, req.body)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Lead updated successfully',
    data: result,
  })
})

const updateLeadStatus = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { id } = req.params
  const { leadStatus, lostReason } = req.body
  const agentId = req.user?._id || req.user?.id
  const result = await LeadService.updateLeadStatus(organizationId, id, leadStatus, lostReason, agentId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Lead pipeline stage updated successfully',
    data: result,
  })
})

const assignAgent = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { id } = req.params
  const { assignedAgent, agentName } = req.body
  const result = await LeadService.assignAgent(organizationId, id, assignedAgent, agentName)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Agent assigned successfully',
    data: result,
  })
})

const deleteLead = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { id } = req.params
  const result = await LeadService.deleteLead(organizationId, id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Lead deleted successfully',
    data: result,
  })
})

export const LeadController = {
  createLead,
  publicCaptureLead,
  getAllLeads,
  getLeadById,
  updateLead,
  updateLeadStatus,
  assignAgent,
  deleteLead,
}
