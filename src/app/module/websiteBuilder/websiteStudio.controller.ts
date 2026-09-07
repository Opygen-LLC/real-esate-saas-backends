import { WebsiteAsset } from './websiteAsset.model'
import type { Request, Response } from 'express'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { WebsiteStudioService } from './websiteStudio.service'
import { WebsiteAssetUsageService } from './websiteAssetUsage.service'
const actor = (req: Request) => ({ actorId: String(req.user?._id || req.user?.userId || ''), actorRole: req.user?.userRole, requestId: req.requestId, ip: req.ip })
const reply = (res: Response, data: unknown, message: string) => {
  res.set('Cache-Control', 'private, no-store').set('Pragma', 'no-cache').set('Vary', 'Cookie')
  return sendResponse(res, { statusCode: 200, success: true, message, data })
}
export const WebsiteStudioController = {
  assets: catchAsync(async (req, res) => {
    const cursor = String(req.query.cursor || '')
    const search = String(req.query.search || '').trim()
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const assets = await WebsiteAsset.find({ organizationId: requireTenant(req), context: { $nin: ['property', 'property-draft'] }, mimeType: /^image\//, ...(cursor ? { _id: { $lt: cursor } } : {}), ...(search ? { originalName: { $regex: escaped, $options: 'i' } } : {}) }).sort({ _id: -1 }).limit(41).lean()
    const hasMore = assets.length > 40
    const data = assets.slice(0, 40)
    res.set('Cache-Control', 'private, no-store')
    return sendResponse(res, { statusCode: 200, success: true, message: 'Website image library', data, meta: { nextCursor: hasMore ? String(data[data.length - 1]._id) : null } } as any)
  }),
  state: catchAsync(async (req, res) => reply(res, await WebsiteStudioService.getState(requireTenant(req)), 'Website draft loaded')),
  save: catchAsync(async (req, res) => reply(res, await WebsiteStudioService.saveDraft(requireTenant(req), req.body, actor(req)), 'Draft saved. Live website unchanged.')),
  publish: catchAsync(async (req, res) => reply(res, await WebsiteStudioService.publish(requireTenant(req), req.body, actor(req)), 'Website revision published')),
  restore: catchAsync(async (req, res) => reply(res, await WebsiteStudioService.restore(requireTenant(req), req.body, actor(req)), 'Revision restored to draft. Preview and publish to make it live.')),
  reset: catchAsync(async (req, res) => reply(res, await WebsiteStudioService.resetFromPublished(requireTenant(req), req.body, actor(req)), 'Draft reset to the live website')),
  history: catchAsync(async (req, res) => reply(res, await WebsiteStudioService.history(requireTenant(req)), 'Publication history loaded')),
  preview: catchAsync(async (req, res) => reply(res, await WebsiteStudioService.preview(requireTenant(req), Number(req.query.draftRevision)), 'Saved draft preview loaded')),
  assetUsage: catchAsync(async (req, res) => reply(res, await WebsiteAssetUsageService.getUsage(requireTenant(req), req.params.id), 'Image usage loaded')),
}
