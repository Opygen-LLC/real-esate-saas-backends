import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { BillingController } from './billing.controller'
import { agencySubscriptionChangeRequestSchema } from '../subscriptionChangeRequest/subscriptionChangeRequest.validation'

const router = express.Router()

router.get('/usage', authMiddlewares.auth(), BillingController.getSubscriptionUsage)
router.get('/history', authMiddlewares.requirePermission('billing.manage'), BillingController.getBillingHistory)
router.get('/unacknowledged-confirmation', authMiddlewares.requirePermission('billing.manage'), BillingController.getUnacknowledgedConfirmation)
router.patch('/history/:paymentNumber/acknowledge', authMiddlewares.requirePermission('billing.manage'), validateRequest(z.object({ params: z.object({ paymentNumber: z.string().trim().min(1).max(128) }) })), BillingController.acknowledgeSubscriptionConfirmation)
router.get('/change-requests', authMiddlewares.requirePermission('billing.manage'), BillingController.getChangeRequests)
router.post('/change-plan', authMiddlewares.requirePermission('billing.manage'), validateRequest(z.object({ body: agencySubscriptionChangeRequestSchema })), BillingController.changeSubscriptionPlan)
router.post('/change-requests/:id/cancel', authMiddlewares.requirePermission('billing.manage'), validateRequest(z.object({ params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) }) })), BillingController.cancelChangeRequest)
router.post('/cancel', authMiddlewares.requirePermission('billing.manage'), BillingController.cancelSubscription)
router.get('/history/:id/receipt', authMiddlewares.requirePermission('billing.manage'), BillingController.getInvoiceReceipt)

export const BillingRoute = router
