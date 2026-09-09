import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { BannerController } from './banner.controller'
import { BannerValidation } from './banner.validation'

const router = express.Router()
const publicOrganization = z.object({ params: z.object({ organizationId: z.string().trim().min(1).max(255) }).strict() })

router.post(
  '/',
  authMiddlewares.requirePermission('website.write'),
  validateRequest(BannerValidation.create),
  BannerController.createBanner,
)

router.get(
  '/',
  authMiddlewares.requirePermission('website.write'),
  BannerController.getBanners,
)

router.get('/public/:organizationId', validateRequest(publicOrganization), BannerController.getPublicBanners)

router.patch(
  '/:id',
  authMiddlewares.requirePermission('website.write'),
  validateRequest(BannerValidation.update),
  BannerController.updateBanner,
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('website.write'),
  validateRequest(BannerValidation.remove),
  BannerController.deleteBanner,
)

export const BannerRoute = router
