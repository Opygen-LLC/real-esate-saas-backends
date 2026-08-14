import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { authRateLimiter, otpRateLimiter, refreshRateLimiter } from '../../middlewares/rateLimiter'
import validateRequest from '../../middlewares/validateRequest'
import { AuthController } from './auth.controller'
import { AuthValidation } from './auth.validation'

const router = express.Router()
router.get('/csrf-token', AuthController.getCsrfToken)
router.get('/session', authMiddlewares.auth(), AuthController.getSession)
router.post('/register-agency', authRateLimiter, validateRequest(AuthValidation.registerAgencyZodSchema), AuthController.registerAgency)
router.post('/signup', authRateLimiter, validateRequest(AuthValidation.registerAgencyZodSchema), AuthController.registerAgency)
router.post('/login', authRateLimiter, validateRequest(AuthValidation.loginZodSchema), AuthController.loginUser)
router.post('/verify', otpRateLimiter, validateRequest(AuthValidation.verifyOtpZodSchema), AuthController.verifyOtp)
router.post('/resend_otp', otpRateLimiter, validateRequest(AuthValidation.emailZodSchema), AuthController.resendOtp)
router.post('/password-reset/request', otpRateLimiter, validateRequest(AuthValidation.emailZodSchema), AuthController.requestPasswordReset)
router.post('/password-reset/verify', otpRateLimiter, validateRequest(AuthValidation.resetVerifyZodSchema), AuthController.verifyPasswordReset)
router.post('/password-reset/complete', otpRateLimiter, validateRequest(AuthValidation.resetCompleteZodSchema), AuthController.completePasswordReset)
router.post('/reset_password', (_req, res) => res.status(410).json({ success: false, message: 'Use the password-reset request, verify and complete flow.' }))
router.post('/refresh-token', refreshRateLimiter, AuthController.refreshToken)
router.post('/logout', AuthController.logoutUser)
router.post('/change-password', authMiddlewares.auth(), validateRequest(AuthValidation.changePasswordZodSchema), AuthController.changePassword)
export const AuthRoutes = router
