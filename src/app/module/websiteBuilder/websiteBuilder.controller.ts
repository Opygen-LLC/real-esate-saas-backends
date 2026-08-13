import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { WebsiteBuilderService } from './websiteBuilder.service'

const ok = (res: Response, message: string, data: any, statusCode = httpStatus.OK) => sendResponse(res, { statusCode, success: true, message, data })
const getTemplates = catchAsync(async (_req, res) => ok(res, 'Template registry fetched', WebsiteBuilderService.listTemplates()))
const getAllPages = catchAsync(async (req, res) => ok(res, 'Tenant website pages fetched successfully', await WebsiteBuilderService.getAllPages(requireTenant(req))))
const getPageById = catchAsync(async (req, res) => ok(res, 'Website page fetched successfully', await WebsiteBuilderService.getPageById(requireTenant(req), req.params.id)))
const saveDraft = catchAsync(async (req, res) => ok(res, 'Draft saved successfully', await WebsiteBuilderService.saveDraft(requireTenant(req), req.params.id, req.body.document, req.user?.userId)))
const publishPage = catchAsync(async (req, res) => ok(res, 'Page published live successfully', await WebsiteBuilderService.publishPage(requireTenant(req), req.params.id, req.user?.userId)))
const schedulePublish = catchAsync(async (req, res) => ok(res, 'Page publish scheduled successfully', await WebsiteBuilderService.schedulePublish(requireTenant(req), req.params.id, new Date(req.body.publishAt), req.user?.userId)))
const listRevisions = catchAsync(async (req, res) => ok(res, 'Website revisions fetched', await WebsiteBuilderService.listRevisions(requireTenant(req), req.params.id)))
const restoreRevision = catchAsync(async (req, res) => ok(res, 'Revision restored to draft', await WebsiteBuilderService.restoreRevision(requireTenant(req), req.params.id, Number(req.params.version), req.user?.userId)))
const createPreviewToken = catchAsync(async (req, res) => ok(res, 'Preview token created', await WebsiteBuilderService.createPreviewToken(requireTenant(req), req.params.id, req.user?.userId), httpStatus.CREATED))
const getPreview = catchAsync(async (req, res) => ok(res, 'Preview fetched', await WebsiteBuilderService.getPreview(req.params.token)))
const presignAsset = catchAsync(async (req, res) => ok(res, 'Signed asset uploads created', await WebsiteBuilderService.presignAsset(requireTenant(req), req.body), httpStatus.CREATED))
const completeAsset = catchAsync(async (req, res) => ok(res, 'Asset verified and registered', await WebsiteBuilderService.completeAsset(requireTenant(req), req.body, req.user?.userId), httpStatus.CREATED))
const listAssets = catchAsync(async (req, res) => ok(res, 'Website assets fetched', await WebsiteBuilderService.listAssets(requireTenant(req))))
const deleteAsset = catchAsync(async (req, res) => ok(res, 'Asset deleted successfully', await WebsiteBuilderService.deleteAsset(requireTenant(req), req.params.id)))
const getPublicPage = catchAsync(async (req, res) => ok(res, 'Public published page fetched successfully', await WebsiteBuilderService.getPublicPage(req.params.identifier, req.params.slug || '/')))
const sitemap = catchAsync(async (req, res) => { const data = await WebsiteBuilderService.getSitemap(req.params.identifier); res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${data.urls.map((u: any) => `<url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : ''}</url>`).join('')}</urlset>`) })
const robots = catchAsync(async (req, res) => res.type('text/plain').send(await WebsiteBuilderService.getRobots(req.params.identifier)))
const propertyShareCard = catchAsync(async (req, res) => ok(res, 'Property share metadata fetched', await WebsiteBuilderService.getPropertyShareCard(req.params.identifier, req.params.propertyId)))
const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, (char) => ({ '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;' }[char] || char))
export const WebsiteBuilderController = { getTemplates, getAllPages, getPageById, saveDraft, publishPage, schedulePublish, listRevisions, restoreRevision, createPreviewToken, getPreview, presignAsset, completeAsset, listAssets, deleteAsset, getPublicPage, sitemap, robots, propertyShareCard }
