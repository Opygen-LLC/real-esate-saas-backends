import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { writeAudit } from '../audit/audit.service'
import { PlatformSettings } from '../platformSettings/platformSettings.model'
import { ComplianceProfile, DataSubjectRequest } from './compliance.model'
import { ComplianceService } from './compliance.service'

const getProfile = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true,
  message: 'Compliance profile fetched', data: await ComplianceService.getProfile(requireTenant(req)) }))
const updateProfile = catchAsync(async (req: Request, res: Response) => {
  const orgId = requireTenant(req); const data = await ComplianceService.upsertProfile(orgId, req.body)
  await writeAudit({ organizationId: orgId, actorId: req.user!._id!, actorRole: req.user!.userRole,
    action: 'compliance.profile_submitted', entityType: 'complianceProfile', entityId: data._id.toString(), requestId: req.requestId })
  sendResponse(res, { statusCode: 200, success: true, message: 'Compliance profile submitted for verification', data: await ComplianceService.getProfile(orgId) })
})
const consent = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 201, success: true,
  message: 'Consent preference recorded', data: await ComplianceService.recordConsent(requireTenant(req), req.user!._id!, req.body, { ip: req.ip, requestId: req.requestId }) }))
const createRequest = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 201, success: true,
  message: 'Data rights request created', data: await ComplianceService.createRequest(requireTenant(req), req.user!._id!, req.body) }))
const requests = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true,
  message: 'Data rights requests fetched', data: await ComplianceService.listRequests(requireTenant(req)) }))
const download = catchAsync(async (req: Request, res: Response) => { const data = await ComplianceService.downloadExport(requireTenant(req), req.params.id)
  res.setHeader('Content-Disposition', `attachment; filename="tenant-export-${req.params.id}.json"`); res.status(200).json(data) })
const adminProfiles = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true,
  message: 'Agency verification queue fetched', data: await ComplianceProfile.find(req.query.status ? { verificationStatus: req.query.status } : {}).sort({ submittedAt: 1 }).limit(200) }))
const adminRequests = catchAsync(async (_req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true,
  message: 'Data rights request queue fetched', data: await DataSubjectRequest.find().sort({ createdAt: -1 }).limit(200) }))
const reviewProfile = catchAsync(async (req: Request, res: Response) => { const data = await ComplianceService.reviewProfile(req.params.organizationId, req.body.status, req.body.reason, req.user!._id!)
  await writeAudit({ organizationId: req.params.organizationId, actorId: req.user!._id!, actorRole: 'super-admin', action: 'agency.verification_reviewed',
    entityType: 'complianceProfile', entityId: data._id.toString(), reason: req.body.reason, requestId: req.requestId, ip: req.ip,
    metadata: { status: req.body.status } }); sendResponse(res, { statusCode: 200, success: true, message: 'Agency verification reviewed', data }) })
const processRequest = catchAsync(async (req: Request, res: Response) => { const settings = await PlatformSettings.findOne({ key: 'platform' });
  const data = await ComplianceService.processRequest(req.params.id, req.body.status, req.body.reason, req.user!._id!, settings?.privacy?.retentionDays || 365)
  await writeAudit({ organizationId: data.organizationId, actorId: req.user!._id!, actorRole: 'super-admin', action: 'privacy.request_processed',
    entityType: 'dataSubjectRequest', entityId: data._id.toString(), reason: req.body.reason, requestId: req.requestId, ip: req.ip,
    metadata: { status: req.body.status, type: data.type } }); sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Data request processed', data }) })

export const ComplianceController = { getProfile, updateProfile, consent, createRequest, requests, download,
  adminProfiles, adminRequests, reviewProfile, processRequest }
