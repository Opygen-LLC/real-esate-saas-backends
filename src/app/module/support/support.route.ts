import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { SupportController } from './support.controller'

const router = express.Router()
const priority = z.enum(['low', 'medium', 'high', 'urgent'])
const status = z.enum(['open', 'in_progress', 'resolved', 'closed'])

router.get('/all', authMiddlewares.authSuperAdmin, SupportController.getAllTicketsSuperAdmin)
router.post('/', authMiddlewares.auth(),
  validateRequest(z.object({ body: z.object({ subject: z.string().trim().min(3).max(200), description: z.string().trim().min(1).max(5000), category: z.string().max(80).optional(), priority: priority.optional() }) })),
  SupportController.createTicket)
router.get('/', authMiddlewares.auth(), SupportController.getMyTickets)
router.post('/:id/reply', authMiddlewares.auth(),
  validateRequest(z.object({ body: z.object({ message: z.string().trim().min(1).max(5000) }) })), SupportController.replyToTicket)
router.patch('/:id/status', authMiddlewares.auth('agency_owner', 'agency_admin', 'super-admin'),
  validateRequest(z.object({ body: z.object({ status: status.optional(), priority: priority.optional() }).refine((value) => value.status || value.priority) })), SupportController.updateTicketStatus)
router.patch('/:id/owner', authMiddlewares.authSuperAdmin,
  validateRequest(z.object({ body: z.object({ ownerId: z.string().regex(/^[0-9a-fA-F]{24}$/).nullable() }) })), SupportController.assignOwner)
router.post('/:id/internal-notes', authMiddlewares.authSuperAdmin,
  validateRequest(z.object({ body: z.object({ note: z.string().trim().min(2).max(5000) }) })), SupportController.addInternalNote)
router.post('/:id/attachments/presign', authMiddlewares.auth(),
  validateRequest(z.object({ body: z.object({ originalName: z.string().trim().min(1).max(255), mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain']), size: z.number().int().min(1).max(10 * 1024 * 1024), visibility: z.enum(['customer', 'internal']).default('customer') }) })), SupportController.createAttachmentUpload)
router.get('/:id/attachments/:attachmentId/download', authMiddlewares.auth(), SupportController.getAttachmentDownload)
router.post('/:id/attachments/:attachmentId/complete', authMiddlewares.auth(), SupportController.completeAttachmentUpload)

export const SupportRoute = router
