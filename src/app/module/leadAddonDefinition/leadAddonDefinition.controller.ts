import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { Organization } from '../organization/organization.model'
import { writeAudit } from '../audit/audit.service'
import { LeadAddonDefinitionService } from './leadAddonDefinition.service'

const listEligible = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const org: any = await Organization.findOne({ organizationId }).select('subscription.plan').lean()
  const planId = String(org?.subscription?.plan || 'trial')
  const data = planId === 'trial' ? [] : await LeadAddonDefinitionService.listEligible(planId)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Recurring lead add-on catalog fetched successfully', data })
})

const listAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await LeadAddonDefinitionService.listAdmin(req.query)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Recurring lead add-on catalog fetched successfully', data: result.data, meta: result.meta })
})

const create = catchAsync(async (req: Request, res: Response) => {
  const row: any = await LeadAddonDefinitionService.create(req.body, req.user!._id!)
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'lead_addon.definition_created', entityType: 'leadAddonDefinition', entityId: String(row._id), reason: req.body.reason, requestId: req.requestId, ip: req.ip, metadata: { slug: row.slug, leadCapacity: row.leadCapacity, priceMonthly: row.priceMonthly, eligiblePlans: row.eligiblePlans } })
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Recurring lead add-on created successfully', data: row })
})

const update = catchAsync(async (req: Request, res: Response) => {
  const row: any = await LeadAddonDefinitionService.update(req.params.id, req.body, req.user!._id!)
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'lead_addon.definition_updated', entityType: 'leadAddonDefinition', entityId: String(row._id), reason: req.body.reason, requestId: req.requestId, ip: req.ip, metadata: { fields: Object.keys(req.body) } })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Recurring lead add-on updated successfully', data: row })
})

const archive = catchAsync(async (req: Request, res: Response) => {
  const row: any = await LeadAddonDefinitionService.archive(req.params.id, req.user!._id!)
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'lead_addon.definition_archived', entityType: 'leadAddonDefinition', entityId: String(row._id), reason: req.body.reason, requestId: req.requestId, ip: req.ip })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Recurring lead add-on archived successfully', data: row })
})

export const LeadAddonDefinitionController = { listEligible, listAdmin, create, update, archive }
