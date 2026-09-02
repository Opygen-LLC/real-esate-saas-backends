import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { WebsiteSubmissionController } from './websiteSubmission.controller'
import { WebsiteSubmissionValidation } from './websiteSubmission.validation'

const router = express.Router()

router.get(
  '/',
  authMiddlewares.requirePermission('website.submissions.read'),
  validateRequest(WebsiteSubmissionValidation.listQuery),
  WebsiteSubmissionController.list,
)

router.get(
  '/analytics/inquiry-purposes',
  authMiddlewares.requirePermission('website.submissions.read'),
  WebsiteSubmissionController.inquiryPurposeAnalytics,
)

router.get(
  '/:id',
  authMiddlewares.requirePermission('website.submissions.read'),
  validateRequest(WebsiteSubmissionValidation.idParams),
  WebsiteSubmissionController.getById,
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('website.submissions.delete'),
  validateRequest(WebsiteSubmissionValidation.deleteSubmission),
  WebsiteSubmissionController.deleteSubmission,
)

router.post(
  '/:id/move-to-crm',
  authMiddlewares.requirePermission('website.submissions.manage'),
  authMiddlewares.requirePermission('leads.write'),
  validateRequest(WebsiteSubmissionValidation.idParams),
  WebsiteSubmissionController.moveToCrm,
)

router.patch(
  '/:id/status',
  authMiddlewares.requirePermission('website.submissions.manage'),
  validateRequest(WebsiteSubmissionValidation.updateStatus),
  WebsiteSubmissionController.updateStatus,
)

export const WebsiteSubmissionRoute = router
