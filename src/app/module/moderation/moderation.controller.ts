import { Request, Response } from 'express'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { normalizeBangladeshPhone } from '../../helpers/identity'
import { AuditEvent } from '../audit/audit.model'
import { writeAudit } from '../audit/audit.service'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { FraudReport } from './fraudReport.model'
import ApiError from '../../../errors/ApiError'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'

const reportFraud = catchAsync(async (req: Request, res: Response) => {
  const org = await Organization.findOne({ organizationId: req.body.organizationId }).select('organizationId')
  if (!org || !await Property.exists({ _id: req.body.propertyId, organizationId: org.organizationId })) throw new ApiError(404, 'Listing not found')
  await TenantPurgeBarrier.assertTenantWritable(org.organizationId)
  let reporterPhone = ''
  try { reporterPhone = req.body.reporterPhone ? normalizeBangladeshPhone(req.body.reporterPhone) : '' }
  catch { throw new ApiError(400, 'Reporter phone must be a valid Bangladesh mobile number') }
  const data = await FraudReport.create({ ...req.body, reporterPhone,
    requestId: req.requestId, ip: req.ip })
  sendResponse(res, { statusCode: 201, success: true, message: 'Fraud report submitted for review', data: { id: data._id, status: data.status } })
})
const listings = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true,
  message: 'Listing moderation queue fetched', data: await Property.find(req.query.status ? { moderationStatus: req.query.status } : { moderationStatus: { $ne: 'approved' } }).sort({ updatedAt: 1 }).limit(200) }))
const reviewListing = catchAsync(async (req: Request, res: Response) => { const data = await Property.findByIdAndUpdate(req.params.id,
  { moderationStatus: req.body.status, moderationReason: req.body.reason, moderatedAt: new Date(), moderatedBy: req.user!._id!,
    ...(req.body.status === 'approved' ? { publishedAt: new Date() } : {}) }, { new: true }); if (!data) throw new ApiError(404, 'Listing not found')
  await writeAudit({ organizationId: data.organizationId, actorId: req.user!._id!, actorRole: 'super-admin', action: 'listing.moderated',
    entityType: 'property', entityId: data._id.toString(), reason: req.body.reason, requestId: req.requestId, ip: req.ip, metadata: { status: req.body.status } })
  sendResponse(res, { statusCode: 200, success: true, message: 'Listing moderation updated', data }) })
const reports = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true,
  message: 'Fraud reports fetched', data: await FraudReport.find(req.query.status ? { status: req.query.status } : {}).populate('propertyId', 'title organizationId').sort({ createdAt: -1 }).limit(200) }))
const reviewReport = catchAsync(async (req: Request, res: Response) => { const data = await FraudReport.findByIdAndUpdate(req.params.id,
  { status: req.body.status, resolutionReason: req.body.reason, resolvedBy: req.user!._id!, resolvedAt: new Date() }, { new: true }); if (!data) throw new ApiError(404, 'Fraud report not found')
  await writeAudit({ organizationId: data.organizationId, actorId: req.user!._id!, actorRole: 'super-admin', action: 'fraud_report.reviewed',
    entityType: 'fraudReport', entityId: data._id.toString(), reason: req.body.reason, requestId: req.requestId, ip: req.ip, metadata: { status: req.body.status } })
  sendResponse(res, { statusCode: 200, success: true, message: 'Fraud report reviewed', data }) })
const auditHistory = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true,
  message: 'Immutable admin history fetched', data: await AuditEvent.find(req.query.organizationId ? { organizationId: req.query.organizationId } : {}).sort({ createdAt: -1 }).limit(500).lean() }))
export const ModerationController = { reportFraud, listings, reviewListing, reports, reviewReport, auditHistory }
