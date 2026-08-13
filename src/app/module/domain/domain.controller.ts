import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { writeAudit } from '../audit/audit.service'
import { DomainService } from './domain.service'

const getCustomDomain = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Custom domain status fetched', data: await DomainService.get(requireTenant(req)) })
})

const addCustomDomain = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const data: any = await DomainService.add(organizationId, req.body.domain)
  await writeAudit({ organizationId, actorId: req.user?._id || 'unknown', actorRole: req.user?.userRole || 'tenant', action: 'domain.configuration_started', entityType: 'domain', entityId: data?._id?.toString?.() || String(data?.domain || req.body.domain), requestId: req.requestId, ip: req.ip, metadata: { domain: data?.domain || req.body.domain, status: data?.status || 'pending' } })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Domain configuration initiated', data })
})

const verifyCustomDomain = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const data: any = await DomainService.verify(organizationId)
  await writeAudit({ organizationId, actorId: req.user?._id || 'unknown', actorRole: req.user?.userRole || 'tenant', action: 'domain.verification_checked', entityType: 'domain', entityId: data?._id?.toString?.() || String(data?.domain || ''), requestId: req.requestId, ip: req.ip, metadata: { domain: data?.domain || '', status: data?.status || '', tlsStatus: data?.tlsStatus || '' } })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Domain lifecycle check completed', data })
})

const resolveHost = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Host resolution completed', data: { organizationId: await DomainService.resolveVerifiedDomain(req.params.host) } }))
export const DomainController = { getCustomDomain, addCustomDomain, verifyCustomDomain, resolveHost }
