import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { requireTenant } from '../../middlewares/auth'
import { ActivityService } from '../activity/activity.service'
import { crmAccessFromRequest, crmRecordReadAccessFromRequest } from '../crm/crmAccess'
import { LeadService } from './lead.service'
import { LeadImportService } from './leadImport.service'
import { WebsiteSubmissionService } from '../websiteSubmission/websiteSubmission.service'

const actor = (req: Request) => req.user?._id || req.user?.id

const createLead = catchAsync(async (req, res) => sendResponse(res, {
  statusCode: 201,
  success: true,
  message: 'Lead capture completed successfully',
  data: await LeadService.createLeadWithOutcome(requireTenant(req), req.body, actor(req), crmAccessFromRequest(req), { allowanceSource: 'manual' }),
}))

const publicCaptureLead = catchAsync(async (req, res) => {
  const lead = await LeadService.publicCaptureLead(req.body, { ip: req.ip, requestId: req.requestId })
  const submission = await WebsiteSubmissionService.captureLead(req.body, lead)
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Inquiry submitted successfully.',
    data: WebsiteSubmissionService.withPublicReceipt(lead, submission),
  })
})

const getAllLeads = catchAsync(async (req, res) => {
  const filters = pick(req.query, ['searchTerm', 'leadStatus', 'source', 'assignedAgent', 'propertyType', 'minBudget', 'maxBudget', 'sla', 'minScore', 'scope', 'isConverted', 'followUpPreset', 'followUpFrom', 'followUpTo'])
  filters.organizationId = requireTenant(req)
  const access = crmAccessFromRequest(req, req.query.scope)
  const result = await LeadService.getAllLeads(filters, pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder']), access)
  sendResponse(res, { statusCode: 200, success: true, message: 'Leads fetched successfully', meta: result.meta, data: result.data })
})

const getTodayFollowUps = catchAsync(async (req, res) => {
  const access = crmAccessFromRequest(req, req.query.scope)
  const result = await LeadService.getTodayFollowUps(
    requireTenant(req),
    pick(req.query, ['page', 'limit']),
    access,
  )
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: `Today's follow-ups fetched successfully`,
    meta: { ...result.meta, ...result.day },
    data: result.data,
  })
})

const getLeadById = catchAsync(async (req, res) => sendResponse(res, {
  statusCode: 200,
  success: true,
  message: 'Lead fetched successfully',
  data: await LeadService.getLeadById(requireTenant(req), req.params.id, crmRecordReadAccessFromRequest(req)),
}))

const updateLead = catchAsync(async (req, res) => sendResponse(res, {
  statusCode: 200,
  success: true,
  message: 'Lead updated successfully',
  data: await LeadService.updateLead(requireTenant(req), req.params.id, req.body, actor(req), crmAccessFromRequest(req)),
}))

const updateLeadStatus = catchAsync(async (req, res) => sendResponse(res, {
  statusCode: 200,
  success: true,
  message: 'Lead pipeline stage updated successfully',
  data: await LeadService.updateLeadStatus(requireTenant(req), req.params.id, req.body.leadStatus, req.body.lostReason, actor(req), crmAccessFromRequest(req), req.body.reason),
}))

const assignAgent = catchAsync(async (req, res) => sendResponse(res, {
  statusCode: 200,
  success: true,
  message: 'Agent assigned successfully',
  data: await LeadService.assignAgent(requireTenant(req), req.params.id, req.body.assignedAgent, req.body.agentName, actor(req), crmAccessFromRequest(req)),
}))

const scheduleFollowUp = catchAsync(async (req, res) => sendResponse(res, {
  statusCode: 200,
  success: true,
  message: 'Lead follow-up scheduled successfully',
  data: await LeadService.scheduleFollowUp(requireTenant(req), req.params.id, req.body.followUpDate, actor(req), crmAccessFromRequest(req), req.body.reason, req.body.title, req.body.priority),
}))

const reengageLead = catchAsync(async (req, res) => sendResponse(res, {
  statusCode: 200,
  success: true,
  message: 'Lead re-engaged successfully',
  data: await LeadService.reengage(requireTenant(req), req.params.id, actor(req), crmAccessFromRequest(req), req.body.reason),
}))

const recordResponse = catchAsync(async (req, res) => sendResponse(res, {
  statusCode: 200,
  success: true,
  message: 'Lead response SLA updated',
  data: await LeadService.recordFirstResponse(requireTenant(req), req.params.id, actor(req), crmAccessFromRequest(req)),
}))


const addNote = catchAsync(async (req: Request, res: Response) => sendResponse(res, {
  statusCode: httpStatus.CREATED,
  success: true,
  message: 'Lead note added successfully',
  data: await ActivityService.createLeadNote(
    requireTenant(req),
    req.params.id,
    req.body.content,
    actor(req),
    crmAccessFromRequest(req),
  ),
}))

const getHistory = catchAsync(async (req: Request, res: Response) => {
  const result = await ActivityService.getLeadHistory(
    requireTenant(req),
    req.params.id,
    pick(req.query, ['page', 'limit']),
    crmRecordReadAccessFromRequest(req),
  )
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Lead history fetched successfully',
    meta: result.meta,
    data: result.data,
  })
})

const deleteLead = catchAsync(async (req, res) => sendResponse(res, {
  statusCode: 200,
  success: true,
  message: 'Lead deleted successfully',
  data: await LeadService.deleteLead(requireTenant(req), req.params.id, actor(req), crmAccessFromRequest(req)),
}))

const previewImport = catchAsync(async (req: Request, res: Response) => {
  const userId = String(actor(req) || '')
  const data = await LeadImportService.preview(
    requireTenant(req),
    userId,
    crmAccessFromRequest(req),
    req.file,
  )
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Lead import preview generated successfully',
    data,
  })
})

const confirmImport = catchAsync(async (req: Request, res: Response) => {
  const userId = String(actor(req) || '')
  const data = await LeadImportService.confirm(
    requireTenant(req),
    userId,
    crmAccessFromRequest(req),
    req.body.importSessionId,
  )
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Lead import completed',
    data,
  })
})

const downloadImportCsvTemplate = catchAsync(async (_req: Request, res: Response) => {
  res.status(httpStatus.OK).setHeader('content-type', 'text/csv; charset=utf-8')
  res.setHeader('content-disposition', 'attachment; filename="opygen-lead-import-template.csv"')
  res.send(`\uFEFF${LeadImportService.csvTemplate()}`)
})

const downloadImportXlsxTemplate = catchAsync(async (_req: Request, res: Response) => {
  const buffer = await LeadImportService.xlsxTemplate()
  res.status(httpStatus.OK).setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('content-disposition', 'attachment; filename="opygen-lead-import-template.xlsx"')
  res.send(buffer)
})

const leadExportFilters = (req: Request) => pick(req.query, ['searchTerm', 'leadStatus', 'source', 'assignedAgent', 'propertyType', 'minBudget', 'maxBudget', 'sla', 'minScore', 'scope', 'isConverted', 'followUpPreset', 'followUpFrom', 'followUpTo'])

const exportCsv = catchAsync(async (req: Request, res: Response) => {
  const org = requireTenant(req)
  const access = crmAccessFromRequest(req, req.query.scope)
  const csv = await LeadService.exportCsv(org, leadExportFilters(req), access)
  res.status(httpStatus.OK).setHeader('content-type', 'text/csv; charset=utf-8')
  res.setHeader('content-disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.send(`\uFEFF${csv}`)
})

const exportXlsx = catchAsync(async (req: Request, res: Response) => {
  const org = requireTenant(req)
  const access = crmAccessFromRequest(req, req.query.scope)
  const workbook = await LeadService.exportXlsx(org, leadExportFilters(req), access)
  res.status(httpStatus.OK).setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('content-disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.xlsx"`)
  res.send(workbook)
})

export const LeadController = {
  createLead,
  publicCaptureLead,
  getAllLeads,
  getTodayFollowUps,
  getLeadById,
  updateLead,
  updateLeadStatus,
  assignAgent,
  scheduleFollowUp,
  reengageLead,
  recordResponse,
  deleteLead,
  previewImport,
  confirmImport,
  downloadImportCsvTemplate,
  downloadImportXlsxTemplate,
  exportCsv,
  exportXlsx,
  addNote,
  getHistory,
}
