import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { SectionController } from './section.controller'
import { SectionValidation } from './section.validation'

const router = express.Router()
const publicOrganization = z.object({ params: z.object({ organizationId: z.string().trim().min(1).max(255) }).strict() })

router.post(
  '/',
  authMiddlewares.requirePermission('website.write'),
  validateRequest(SectionValidation.create),
  SectionController.createSection,
)

router.get(
  '/',
  authMiddlewares.requirePermission('website.write'),
  SectionController.getSections,
)

router.get('/public/:organizationId', validateRequest(publicOrganization), SectionController.getPublicSections)

router.patch(
  '/:id',
  authMiddlewares.requirePermission('website.write'),
  validateRequest(SectionValidation.update),
  SectionController.updateSection,
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('website.write'),
  validateRequest(SectionValidation.remove),
  SectionController.deleteSection,
)

export const SectionRoute = router
