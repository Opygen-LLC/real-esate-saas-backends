import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { AuthController } from './auth.controller'
import { AuthValidation } from './auth.validation'

import { authRateLimiter } from '../../middlewares/rateLimiter'

const router = express.Router()

router.post(
  '/register-agency',
  authRateLimiter,
  validateRequest(AuthValidation.registerAgencyZodSchema),
  AuthController.registerAgency
)

router.post(
  '/signup',
  authRateLimiter,
  validateRequest(AuthValidation.registerAgencyZodSchema),
  AuthController.registerAgency
)

router.post(
  '/login',
  authRateLimiter,
  validateRequest(AuthValidation.loginZodSchema),
  AuthController.loginUser
)

router.post('/verify', AuthController.verifyOtp)
router.post('/resend_otp', AuthController.resendOtp)
router.post('/refresh-token', AuthController.refreshToken)
router.post('/logout', AuthController.logoutUser)

router.post(
  '/change-password',
  authMiddlewares.auth('super-admin', 'agency_owner', 'agency_admin', 'agent', 'viewer', 'admin', 'client', 'staff'),
  validateRequest(AuthValidation.changePasswordZodSchema),
  AuthController.changePassword
)

router.post('/reset_password', AuthController.resetPassword)

export const AuthRoutes = router
