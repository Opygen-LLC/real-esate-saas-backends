import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { adminNetworkRateLimiter, adminOperationRateLimiter } from '../../middlewares/rateLimiter'
import { PlatformSettingsController } from './platformSettings.controller'
import { PlatformSettingsValidation } from './platformSettings.validation'

const router = express.Router()
router.get('/public', PlatformSettingsController.publicSettings)
router.get('/', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, PlatformSettingsController.get)
router.patch('/', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(PlatformSettingsValidation.update), PlatformSettingsController.update)
export const PlatformSettingsRoute = router
