import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { LandingPageController } from './landingPage.controller'

const router = express.Router()

router.post(
  '/',
  authMiddlewares.requirePermission('website.write'),
  LandingPageController.createLandingPage
)

router.get(
  '/',
  authMiddlewares.auth(),
  LandingPageController.getLandingPages
)

router.get('/public/:organizationId', LandingPageController.getLandingPages)

router.patch(
  '/:id',
  authMiddlewares.requirePermission('website.write'),
  LandingPageController.updateLandingPage
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('website.write'),
  LandingPageController.deleteLandingPage
)

export const LandingPageRoute = router
