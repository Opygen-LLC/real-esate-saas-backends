import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { PlatformSettingsController } from './platformSettings.controller'
import { PlatformSettingsValidation } from './platformSettings.validation'

const router = express.Router()
router.get('/public', PlatformSettingsController.publicSettings)
router.get('/', authMiddlewares.authSuperAdmin, PlatformSettingsController.get)
router.patch('/', authMiddlewares.authSuperAdmin, validateRequest(PlatformSettingsValidation.update), PlatformSettingsController.update)
export const PlatformSettingsRoute = router
