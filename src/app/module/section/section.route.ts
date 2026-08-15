import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { SectionController } from './section.controller'

const router = express.Router()

router.post(
  '/',
  authMiddlewares.requirePermission('website.write'),
  SectionController.createSection
)

router.get(
  '/',
  authMiddlewares.requirePermission('website.write'),
  SectionController.getSections
)

router.get('/public/:organizationId', SectionController.getSections)

router.patch(
  '/:id',
  authMiddlewares.requirePermission('website.write'),
  SectionController.updateSection
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('website.write'),
  SectionController.deleteSection
)

export const SectionRoute = router
