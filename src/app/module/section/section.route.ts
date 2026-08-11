import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { SectionController } from './section.controller'

const router = express.Router()

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  SectionController.createSection
)

router.get(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'super-admin', 'admin', 'client', 'staff'),
  SectionController.getSections
)

router.get('/public/:organizationId', SectionController.getSections)

router.patch(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  SectionController.updateSection
)

router.delete(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  SectionController.deleteSection
)

export const SectionRoute = router
