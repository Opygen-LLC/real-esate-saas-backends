import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { BannerController } from './banner.controller'

const router = express.Router()

router.post(
  '/',
  authMiddlewares.requirePermission('website.write'),
  BannerController.createBanner
)

router.get(
  '/',
  authMiddlewares.requirePermission('website.write'),
  BannerController.getBanners
)

router.get('/public/:organizationId', BannerController.getBanners)

router.patch(
  '/:id',
  authMiddlewares.requirePermission('website.write'),
  BannerController.updateBanner
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('website.write'),
  BannerController.deleteBanner
)

export const BannerRoute = router
