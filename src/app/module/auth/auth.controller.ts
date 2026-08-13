import { CookieOptions, Request, Response } from 'express'
import httpStatus from 'http-status'
import config from '../../../config'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { randomToken } from '../../helpers/crypto'
import { AuthResult } from './auth.interface'
import { AuthServices } from './auth.services'

const cookieBase: CookieOptions = {
  secure: config.isProduction,
  sameSite: config.isProduction ? 'none' : 'lax',
  domain: config.cookie_domain,
  path: '/',
}
const csrfCookieOptions: CookieOptions = {
  ...cookieBase,
  httpOnly: false,
  maxAge: 30 * 24 * 60 * 60 * 1000,
}

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') || '', requestId: req.requestId })

const issueCsrfToken = (res: Response): string => {
  const token = randomToken(24)
  res.cookie(config.security.csrf_cookie_name, token, csrfCookieOptions)
  return token
}

const setAuthCookies = (res: Response, result: AuthResult) => {
  res.cookie(config.security.access_cookie_name, result.accessToken, {
    ...cookieBase,
    httpOnly: true,
    maxAge: 15 * 60 * 1000,
  })
  res.cookie(config.security.refresh_cookie_name, result.refreshToken, {
    ...cookieBase,
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  })
  issueCsrfToken(res)
}

const clearAuthCookies = (res: Response) => {
  for (const name of [
    config.security.access_cookie_name,
    config.security.refresh_cookie_name,
    config.security.csrf_cookie_name,
  ]) {
    res.clearCookie(name, { ...cookieBase, httpOnly: name !== config.security.csrf_cookie_name })
  }
}

const authResponse = (res: Response, result: AuthResult, message: string) => {
  setAuthCookies(res, result)
  const { refreshToken: _refresh, accessToken: _access, ...safe } = result
  sendResponse(res, { statusCode: 200, success: true, message, data: safe })
}

const getCsrfToken = catchAsync(async (req: Request, res: Response) => {
  const current = req.cookies?.[config.security.csrf_cookie_name]
  const csrfToken = typeof current === 'string' && /^[A-Za-z0-9_-]{24,128}$/.test(current) ? current : issueCsrfToken(res)

  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'CSRF token ready',
    data: { csrfToken },
  })
})

const registerAgency = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.registerAgency(req.body, meta(req))
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Agency created. Verify your phone to activate owner access.',
    data: result,
  })
})

const loginUser = catchAsync(async (req: Request, res: Response) =>
  authResponse(res, await AuthServices.loginUser(req.body, meta(req)), 'Signed in successfully'),
)

const verifyOtp = catchAsync(async (req: Request, res: Response) =>
  authResponse(
    res,
    await AuthServices.verifyOtp(req.body.phoneNumber, req.body.verificationCode, meta(req)),
    'Phone verified successfully',
  ),
)

const resendOtp = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.resendOtp(req.body.phoneNumber, meta(req))
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'If the pending account is valid, a new code was sent.',
    data: null,
  })
})

const requestPasswordReset = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.requestPasswordReset(req.body.phoneNumber, meta(req))
  sendResponse(res, {
    statusCode: 202,
    success: true,
    message: 'If the account exists, a reset code was sent.',
    data: null,
  })
})

const verifyPasswordReset = catchAsync(async (req: Request, res: Response) =>
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Reset code verified',
    data: await AuthServices.verifyPasswordReset(req.body.phoneNumber, req.body.verificationCode),
  }),
)

const completePasswordReset = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.completePasswordReset(req.body.resetToken, req.body.newPassword, meta(req))
  clearAuthCookies(res)
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Password reset. Sign in again.',
    data: null,
  })
})

const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const token = req.cookies?.[config.security.refresh_cookie_name]
  authResponse(res, await AuthServices.refreshToken(token), 'Session refreshed')
})

const changePassword = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.changePassword(req.user!._id!, req.body, meta(req))
  clearAuthCookies(res)
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Password changed. Sign in again.',
    data: null,
  })
})

const logoutUser = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.logout(req.cookies?.[config.security.refresh_cookie_name])
  clearAuthCookies(res)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Signed out successfully', data: null })
})

export const AuthController = {
  getCsrfToken,
  registerAgency,
  loginUser,
  verifyOtp,
  resendOtp,
  requestPasswordReset,
  verifyPasswordReset,
  completePasswordReset,
  refreshToken,
  changePassword,
  logoutUser,
}
