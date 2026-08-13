import { CookieOptions, Request, Response } from 'express'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { PlatformAdminService } from './platformAdmin.service'

const impersonationCookie: CookieOptions = { httpOnly: true, secure: config.cookie_secure, sameSite: config.cookie_same_site, domain: config.cookie_domain, path: '/' }

const tenantHealth = catchAsync(async (req: Request, res: Response) => {
  const result = await PlatformAdminService.getTenantHealth(req.query)
  sendResponse(res, { statusCode: 200, success: true, message: 'Tenant health fetched', data: result.data, meta: result.meta })
})
const suspendTenant = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Organization suspended without deleting tenant data', data: await PlatformAdminService.suspendTenant(req.params.organizationId, { id: req.user!._id!, reason: req.body.reason, requestId: req.requestId, ip: req.ip }) }))
const reactivateTenant = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Organization reactivated', data: await PlatformAdminService.reactivateTenant(req.params.organizationId, { id: req.user!._id!, reason: req.body.reason, requestId: req.requestId, ip: req.ip }) }))
const paymentLedger = catchAsync(async (req: Request, res: Response) => {
  const result = await PlatformAdminService.getPaymentLedger(req.query)
  sendResponse(res, { statusCode: 200, success: true, message: 'Payment ledger fetched', data: result.data, meta: { ...result.meta, summary: result.summary } as any })
})
const addPaymentNote = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Reconciliation note saved', data: await PlatformAdminService.addPaymentNote(req.params.paymentId, req.body.note, { id: req.user!._id!, requestId: req.requestId, ip: req.ip }) }))
const revenue = catchAsync(async (_req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Revenue dashboard fetched from paid billing records', data: await PlatformAdminService.getRevenueDashboard() }))
const audit = catchAsync(async (req: Request, res: Response) => {
  const result = await PlatformAdminService.getAuditLog(req.query)
  sendResponse(res, { statusCode: 200, success: true, message: 'Platform audit log fetched', data: result.data, meta: result.meta })
})
const startImpersonation = catchAsync(async (req: Request, res: Response) => {
  const result = await PlatformAdminService.startImpersonation({ adminUserId: req.user!._id!, organizationId: req.body.organizationId, targetUserId: req.body.targetUserId, reason: req.body.reason, durationMinutes: req.body.durationMinutes, requestId: req.requestId, ip: req.ip, userAgent: req.get('user-agent') || '' })
  const maxAge = Math.max(0, new Date(result.session.expiresAt).getTime() - Date.now())
  res.cookie(config.security.impersonation_cookie_name, result.token, { ...impersonationCookie, maxAge })
  sendResponse(res, { statusCode: 201, success: true, message: 'Read-only support impersonation started', data: result.session })
})
const endImpersonation = catchAsync(async (req: Request, res: Response) => {
  const token = req.cookies?.[config.security.impersonation_cookie_name]
  if (typeof token !== 'string' || !token) throw new ApiError(401, 'No active support impersonation session')
  const result = await PlatformAdminService.endImpersonation(token, req.user?._id, req.requestId, req.ip)
  res.clearCookie(config.security.impersonation_cookie_name, impersonationCookie)
  sendResponse(res, { statusCode: 200, success: true, message: 'Support impersonation ended', data: result })
})

export const PlatformAdminController = { tenantHealth, suspendTenant, reactivateTenant, paymentLedger, addPaymentNote, revenue, audit, startImpersonation, endImpersonation }
