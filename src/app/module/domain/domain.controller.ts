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


const getSubdomainAvailability = catchAsync(async (req: Request, res: Response) => {
  const data = await DomainService.isSubdomainAvailable(req.params.value, requireTenant(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Website address availability checked', data })
})

const changeSubdomain = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const data = await DomainService.changeSubdomain(organizationId, req.body.subdomain)
  await writeAudit({ organizationId, actorId: req.user?._id || 'unknown', actorRole: req.user?.userRole || 'tenant', action: 'domain.subdomain_changed', entityType: 'organization', entityId: organizationId, requestId: req.requestId, ip: req.ip, metadata: data })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Website address changed successfully', data })
})

const resolveSubdomain = catchAsync(async (req: Request, res: Response) => {
  const data = await DomainService.resolveSubdomain(req.params.subdomain)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Subdomain resolution completed', data })
})


const resolveHost = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Host resolution completed', data: await DomainService.resolveVerifiedHost(req.params.host) }))
export const DomainController = { getCustomDomain, addCustomDomain, verifyCustomDomain, getSubdomainAvailability, changeSubdomain, resolveSubdomain, resolveHost }
