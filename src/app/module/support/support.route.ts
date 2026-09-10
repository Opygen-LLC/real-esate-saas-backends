import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { SupportController } from './support.controller'
import { adminNetworkRateLimiter, adminOperationRateLimiter, uploadPresignRateLimiter, uploadRateLimiter } from '../../middlewares/rateLimiter'

const router = express.Router()
const priority = z.enum(['low', 'medium', 'high', 'urgent'])
const status = z.enum(['open', 'in_progress', 'resolved', 'closed'])
const mongoId = z.string().regex(/^[0-9a-fA-F]{24}$/)
const ticketParams = z.object({ id: mongoId }).strict()
const attachmentParams = z.object({ id: mongoId, attachmentId: mongoId }).strict()

router.get('/all', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(z.object({ query: z.object({ page: z.coerce.number().int().min(1).max(100000).optional(), limit: z.coerce.number().int().min(1).max(100).optional(), status: status.optional(), priority: priority.optional(), ownerId: z.union([mongoId, z.literal('unassigned')]).optional(), sla: z.literal('breached').optional(), search: z.string().trim().max(160).optional() }).strict() })), SupportController.getAllTicketsSuperAdmin)
router.post('/', authMiddlewares.auth(),
  validateRequest(z.object({ body: z.object({ subject: z.string().trim().min(3).max(200), description: z.string().trim().min(1).max(5000), category: z.string().max(80).optional(), priority: priority.optional() }).strict() })),
  SupportController.createTicket)
router.get('/', authMiddlewares.auth(), SupportController.getMyTickets)
router.post('/:id/reply', authMiddlewares.auth(),
  validateRequest(z.object({ params: ticketParams, body: z.object({ message: z.string().trim().min(1).max(5000) }).strict() })), SupportController.replyToTicket)
router.patch('/:id/status', authMiddlewares.auth('agency_owner', 'agency_admin', 'super-admin'),
  validateRequest(z.object({ params: ticketParams, body: z.object({ status: status.optional(), priority: priority.optional() }).strict().refine((value) => value.status || value.priority) })), SupportController.updateTicketStatus)
router.patch('/:id/owner', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter,
  validateRequest(z.object({ params: ticketParams, body: z.object({ ownerId: mongoId.nullable() }).strict() })), SupportController.assignOwner)
router.post('/:id/internal-notes', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter,
  validateRequest(z.object({ params: ticketParams, body: z.object({ note: z.string().trim().min(2).max(5000) }).strict() })), SupportController.addInternalNote)
router.post('/:id/attachments/presign', authMiddlewares.auth(), uploadPresignRateLimiter,
  validateRequest(z.object({ body: z.object({ originalName: z.string().trim().min(1).max(255), mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain']), size: z.number().int().min(1).max(10 * 1024 * 1024), visibility: z.enum(['customer', 'internal']).default('customer') }).strict(), params: ticketParams })), SupportController.createAttachmentUpload)
router.get('/:id/attachments/:attachmentId/download', authMiddlewares.auth(), validateRequest(z.object({ params: attachmentParams })), SupportController.getAttachmentDownload)
router.post('/:id/attachments/:attachmentId/complete', authMiddlewares.auth(), uploadRateLimiter, validateRequest(z.object({ params: attachmentParams, body: z.object({}).strict().optional() })), SupportController.completeAttachmentUpload)

export const SupportRoute = router
