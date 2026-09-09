import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { LandingPageController } from './landingPage.controller'
import { LandingPageValidation } from './landingPage.validation'

const router = express.Router()
const publicOrganization = z.object({ params: z.object({ organizationId: z.string().trim().min(1).max(255) }).strict() })

router.post(
  '/',
  authMiddlewares.requirePermission('website.write'),
  validateRequest(LandingPageValidation.create),
  LandingPageController.createLandingPage,
)

router.get(
  '/',
  authMiddlewares.requirePermission('website.write'),
  LandingPageController.getLandingPages,
)

router.get('/public/:organizationId', validateRequest(publicOrganization), LandingPageController.getPublicLandingPages)

router.patch(
  '/:id',
  authMiddlewares.requirePermission('website.write'),
  validateRequest(LandingPageValidation.update),
  LandingPageController.updateLandingPage,
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('website.write'),
  validateRequest(LandingPageValidation.remove),
  LandingPageController.deleteLandingPage,
)

export const LandingPageRoute = router
