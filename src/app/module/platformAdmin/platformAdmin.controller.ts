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
const subscriptionRequests = catchAsync(async (req: Request, res: Response) => {
  const result = await PlatformAdminService.getSubscriptionRequests(req.query)
  sendResponse(res, { statusCode: 200, success: true, message: 'Subscription requests fetched', data: result.data, meta: result.meta as any })
})
const paymentLedger = catchAsync(async (req: Request, res: Response) => {
  const result = await PlatformAdminService.getPaymentLedger(req.query)
  sendResponse(res, { statusCode: 200, success: true, message: 'Manual subscription payment ledger fetched', data: result.data, meta: result.meta as any })
})
const benefitPeriodHistory = catchAsync(async (req: Request, res: Response) => {
  const result = await PlatformAdminService.getBenefitPeriodHistory(req.query)
  sendResponse(res, { statusCode: 200, success: true, message: 'Subscription benefit-period history fetched', data: result.data, meta: result.meta as any })
})
const tenantLeadEntitlement = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Tenant lead entitlement fetched', data: await PlatformAdminService.getTenantLeadEntitlement(req.params.organizationId) }))
const adjustTenantRenewalStreak = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Tenant renewal streak adjusted for future eligible renewals', data: await PlatformAdminService.adjustTenantRenewalStreak(req.params.organizationId, req.body, { id: req.user!._id!, requestId: req.requestId, ip: req.ip }) }))
const recordManualPayment = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 201, success: true, message: 'Manual subscription payment recorded and is waiting for confirmation', data: await PlatformAdminService.recordManualPayment(req.body, { id: req.user!._id!, requestId: req.requestId, ip: req.ip }) }))
const decideManualPayment = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: req.body.status === 'confirmed' ? 'Payment confirmed and subscription activated' : 'Payment rejected', data: await PlatformAdminService.decideManualPayment(req.params.paymentId, req.body, { id: req.user!._id!, requestId: req.requestId, ip: req.ip }) }))
const revenue = catchAsync(async (_req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Revenue dashboard fetched from confirmed manual subscription payments', data: await PlatformAdminService.getRevenueDashboard() }))
const audit = catchAsync(async (req: Request, res: Response) => {
  const result = await PlatformAdminService.getAuditLog(req.query)
  sendResponse(res, { statusCode: 200, success: true, message: 'Platform audit log fetched', data: result.data, meta: result.meta })
})

const subscriptionSummary = catchAsync(async (_req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Subscription summary fetched', data: await PlatformAdminService.getSubscriptionSummary() }))
const changeTenantSubscription = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Tenant subscription updated', data: await PlatformAdminService.changeTenantSubscription(req.params.organizationId, req.body, { id: req.user!._id!, requestId: req.requestId, ip: req.ip }) }))
const manageTenantTrial = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Tenant trial updated', data: await PlatformAdminService.manageTenantTrial(req.params.organizationId, req.body, { id: req.user!._id!, requestId: req.requestId, ip: req.ip }) }))
const platformSearch = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Platform search results fetched', data: await PlatformAdminService.searchPlatform(String(req.query.q || '')) }))
const platformNotifications = catchAsync(async (_req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Platform notifications fetched', data: await PlatformAdminService.getPlatformNotifications() }))
const currentImpersonation = catchAsync(async (req: Request, res: Response) => {
  const token = req.cookies?.[config.security.impersonation_cookie_name]
  if (typeof token !== 'string' || !token) {
    return sendResponse(res, { statusCode: 200, success: true, message: 'No active support impersonation session', data: { active: false, session: null } })
  }
  sendResponse(res, { statusCode: 200, success: true, message: 'Active support impersonation fetched', data: await PlatformAdminService.currentImpersonation(token) })
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

export const PlatformAdminController = { tenantHealth, suspendTenant, reactivateTenant, subscriptionRequests, paymentLedger, benefitPeriodHistory, tenantLeadEntitlement, adjustTenantRenewalStreak, recordManualPayment, decideManualPayment, revenue, audit, subscriptionSummary, changeTenantSubscription, manageTenantTrial, platformSearch, platformNotifications, startImpersonation, currentImpersonation, endImpersonation }
