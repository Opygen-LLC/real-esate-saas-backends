import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { loginRateLimiter, otpSendRateLimiter, otpVerifyRateLimiter, passwordResetCompleteRateLimiter, passwordResetRequestRateLimiter, passwordResetVerifyRateLimiter, refreshRateLimiter, registrationRateLimiter, registrationStatusRateLimiter } from '../../middlewares/rateLimiter'
import validateRequest from '../../middlewares/validateRequest'
import { AuthController } from './auth.controller'
import { AuthValidation } from './auth.validation'

const router = express.Router()
router.get('/csrf-token', AuthController.getCsrfToken)
router.get('/routing-session', AuthController.getRoutingSession)
router.get('/session', authMiddlewares.auth(), AuthController.getSession)
router.get('/sessions', authMiddlewares.auth(), AuthController.getSessions)
router.delete('/sessions/:sessionId', authMiddlewares.auth(), validateRequest(AuthValidation.sessionIdZodSchema), AuthController.revokeSession)
router.post('/sessions/revoke-others', authMiddlewares.auth(), AuthController.revokeOtherSessions)
router.get('/realtime-ticket', authMiddlewares.auth(), AuthController.getRealtimeTicket)
router.post('/register-agency', registrationRateLimiter, validateRequest(AuthValidation.registerAgencyZodSchema), AuthController.registerAgency)
router.post('/signup', registrationRateLimiter, validateRequest(AuthValidation.registerAgencyZodSchema), AuthController.registerAgency)
router.post('/login', loginRateLimiter, validateRequest(AuthValidation.loginZodSchema), AuthController.loginUser)
router.post('/verify', otpVerifyRateLimiter, validateRequest(AuthValidation.verifyOtpZodSchema), AuthController.verifyOtp)
router.post('/registration-status', registrationStatusRateLimiter, validateRequest(AuthValidation.registrationContinuationZodSchema), AuthController.getRegistrationStatus)
router.post('/registration/complete', registrationRateLimiter, validateRequest(AuthValidation.registrationContinuationZodSchema), AuthController.completeRegistration)
router.post('/resend_otp', otpSendRateLimiter, validateRequest(AuthValidation.emailZodSchema), AuthController.resendOtp)
router.post('/password-reset/request', passwordResetRequestRateLimiter, validateRequest(AuthValidation.emailZodSchema), AuthController.requestPasswordReset)
router.post('/password-reset/verify', passwordResetVerifyRateLimiter, validateRequest(AuthValidation.resetVerifyZodSchema), AuthController.verifyPasswordReset)
router.post('/password-reset/complete', passwordResetCompleteRateLimiter, validateRequest(AuthValidation.resetCompleteZodSchema), AuthController.completePasswordReset)
router.post('/reset_password', (_req, res) => res.status(410).json({ success: false, message: 'Use the password-reset request, verify and complete flow.' }))
router.post('/refresh-token', refreshRateLimiter, AuthController.refreshToken)
router.post('/logout', AuthController.logoutUser)
router.post('/change-password', authMiddlewares.auth(), validateRequest(AuthValidation.changePasswordZodSchema), AuthController.changePassword)
export const AuthRoutes = router
