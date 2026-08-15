import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { writeAudit } from '../audit/audit.service'
import { PlatformSettings } from './platformSettings.model'
import { encryptField, maskSensitive, decryptField } from '../../helpers/fieldEncryption'
import { invalidateTrialPolicy } from './trialPolicy.service'

const publicSettings = catchAsync(async (_req: Request, res: Response) => {
  const settings = await PlatformSettings.findOneAndUpdate({ key: 'platform' }, { $setOnInsert: { key: 'platform' } }, { upsert: true, new: true })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Public localization settings fetched', data: {
    currency: 'BDT', supportedLanguages: ['en', 'bn'], areaConversion: settings.areaConversion,
    privacy: { policyUrl: settings.privacy?.policyUrl || '', policyVersion: settings.privacy?.policyVersion || '',
      legalReviewStatus: settings.privacy?.legalReviewStatus || 'required' },
    taxInvoiceEnabled: Boolean(settings.tax?.invoiceEnabled && settings.tax?.registrationStatus === 'registered'),
  } })
})

const get = catchAsync(async (_req: Request, res: Response) => {
  const settings = await PlatformSettings.findOneAndUpdate({ key: 'platform' }, { $setOnInsert: { key: 'platform' } }, { upsert: true, new: true }).select('+tax.binEncrypted').lean()
  const result: any = settings; const encrypted = result?.tax?.binEncrypted
  if (result?.tax) { result.tax.bin = encrypted ? maskSensitive(decryptField(encrypted)) : ''; delete result.tax.binEncrypted }
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Platform settings fetched', data: result })
})

const update = catchAsync(async (req: Request, res: Response) => {
  const { reason, ...payload } = req.body
  const $set: Record<string, unknown> = {}
  for (const [group, values] of Object.entries(payload)) {
    for (const [field, value] of Object.entries(values as Record<string, unknown>)) {
      if (group === 'tax' && field === 'bin') { if (value) $set['tax.binEncrypted'] = encryptField(String(value)); continue }
      $set[`${group}.${field}`] = value
    }
  }
  if (payload.privacy?.legalReviewStatus === 'approved') $set['privacy.legalReviewedAt'] = new Date()
  const settings = await PlatformSettings.findOneAndUpdate({ key: 'platform' }, { $set, $setOnInsert: { key: 'platform' } }, { upsert: true, new: true })
  if (payload.trial) await invalidateTrialPolicy()
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'platform.settings_updated',
    entityType: 'platformSettings', entityId: settings._id.toString(), reason, requestId: req.requestId, ip: req.ip,
    metadata: { fields: Object.keys($set) } })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Platform settings updated', data: settings })
})

export const PlatformSettingsController = { publicSettings, get, update }
