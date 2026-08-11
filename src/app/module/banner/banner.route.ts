import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { BannerController } from './banner.controller'

const router = express.Router()

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  BannerController.createBanner
)

router.get(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'super-admin', 'admin', 'client', 'staff'),
  BannerController.getBanners
)

router.get('/public/:organizationId', BannerController.getBanners)

router.patch(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  BannerController.updateBanner
)

router.delete(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  BannerController.deleteBanner
)

export const BannerRoute = router
