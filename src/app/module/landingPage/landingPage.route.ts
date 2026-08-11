import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { LandingPageController } from './landingPage.controller'

const router = express.Router()

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  LandingPageController.createLandingPage
)

router.get(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'super-admin', 'admin', 'client', 'staff'),
  LandingPageController.getLandingPages
)

router.get('/public/:organizationId', LandingPageController.getLandingPages)

router.patch(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  LandingPageController.updateLandingPage
)

router.delete(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  LandingPageController.deleteLandingPage
)

export const LandingPageRoute = router
