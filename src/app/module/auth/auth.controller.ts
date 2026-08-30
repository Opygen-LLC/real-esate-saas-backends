import { CookieOptions, Request, Response } from 'express'
import httpStatus from 'http-status'
import config from '../../../config'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { randomToken } from '../../helpers/crypto'
import { AuthResult } from './auth.interface'
import { AuthServices } from './auth.services'

const cookieBase: CookieOptions = {
  secure: config.cookie_secure,
  sameSite: config.cookie_same_site,
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

const clearCookieVariants = (res: Response, name: string, httpOnly: boolean) => {
  // Current auth cookies are host-only. Also clear the old domain-scoped variant
  // when COOKIE_DOMAIN is still present in the deployment environment so users
  // migrate cleanly without duplicate access/refresh cookies.
  res.clearCookie(name, { ...cookieBase, domain: undefined, httpOnly })
  if (config.legacy_cookie_domain) {
    res.clearCookie(name, { ...cookieBase, domain: config.legacy_cookie_domain, httpOnly })
  }
}

const clearAuthCookies = (res: Response) => {
  clearCookieVariants(res, config.security.access_cookie_name, true)
  clearCookieVariants(res, config.security.refresh_cookie_name, true)
  clearCookieVariants(res, config.security.csrf_cookie_name, false)
}

const setAuthCookies = (res: Response, result: AuthResult) => {
  clearAuthCookies(res)
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


const getRoutingSession = catchAsync(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Vary', 'Cookie')
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Routing session is active',
    data: await AuthServices.resolveRoutingSession(req.cookies?.[config.security.refresh_cookie_name]),
  })
})

const getSession = catchAsync(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Vary', 'Cookie')
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Session is active',
    data: {
      authenticated: true,
      user: { ...req.user, permissions: req.tenant?.permissions || (req.user as any)?.permissions || [] },
      session: await AuthServices.getCurrentSessionSummary(
        req.cookies?.[config.security.refresh_cookie_name],
        String(req.user?._id || req.user?.id || ''),
        String(req.user?.organizationId || ''),
      ),
    },
  })
})


const getSessions = catchAsync(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Vary', 'Cookie')
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Active sessions retrieved',
    data: await AuthServices.listSessions(
      req.cookies?.[config.security.refresh_cookie_name],
      String(req.user?._id || req.user?.id || ''),
      String(req.user?.organizationId || ''),
    ),
  })
})

const revokeSession = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.revokeSession(
    req.cookies?.[config.security.refresh_cookie_name],
    String(req.user?._id || req.user?.id || ''),
    String(req.user?.organizationId || ''),
    req.params.sessionId,
    meta(req),
  )
  sendResponse(res, { statusCode: 200, success: true, message: 'Session revoked', data: null })
})

const revokeOtherSessions = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Other sessions revoked',
    data: await AuthServices.revokeOtherSessions(
      req.cookies?.[config.security.refresh_cookie_name],
      String(req.user?._id || req.user?.id || ''),
      String(req.user?.organizationId || ''),
      meta(req),
    ),
  })
})

const registerAgency = catchAsync(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  const result = await AuthServices.registerAgency(req.body, meta(req))

  if (!result.verificationRequired) {
    setAuthCookies(res, result)
    const { refreshToken: _refresh, accessToken: _access, ...safe } = result
    sendResponse(res, {
      statusCode: 201,
      success: true,
      message: 'Agency created. Your account is verified and ready.',
      data: safe,
    })
    return
  }

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Agency created. Check your email for the verification code.',
    data: result,
  })
})

const loginUser = catchAsync(async (req: Request, res: Response) =>
  authResponse(res, await AuthServices.loginUser(req.body, meta(req)), 'Signed in successfully'),
)

const verifyOtp = catchAsync(async (req: Request, res: Response) =>
  authResponse(
    res,
    await (async () => {
      const result = await AuthServices.verifyOtp(req.body.email, req.body.verificationCode, meta(req))
      result.websiteUrl = await AuthServices.getWebsiteUrlForUser(result.organizationId)
      return result
    })(),
    'Email verified successfully',
  ),
)

const getRegistrationStatus = catchAsync(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Registration verification status retrieved',
    data: await AuthServices.getRegistrationStatus(req.body.registrationContinuationToken),
  })
})

const completeRegistration = catchAsync(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  authResponse(
    res,
    await AuthServices.completeRegistration(req.body.registrationContinuationToken, meta(req)),
    'Registration completed successfully',
  )
})

const resendOtp = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.resendOtp(req.body.email, meta(req))
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'If the pending account is valid, a new code was sent.',
    data: null,
  })
})

const requestPasswordReset = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.requestPasswordReset(req.body.email, meta(req))
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
    data: await AuthServices.verifyPasswordReset(req.body.email, req.body.verificationCode),
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

const getRealtimeTicket = catchAsync(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate')
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Realtime ticket issued',
    data: await AuthServices.createRealtimeTicket(req.user!._id!),
  })
})

const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const token = req.cookies?.[config.security.refresh_cookie_name]
  authResponse(res, await AuthServices.refreshToken(token, meta(req)), 'Session refreshed')
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
  getRoutingSession,
  getSession,
  getSessions,
  revokeSession,
  revokeOtherSessions,
  registerAgency,
  loginUser,
  verifyOtp,
  getRegistrationStatus,
  completeRegistration,
  resendOtp,
  requestPasswordReset,
  verifyPasswordReset,
  completePasswordReset,
  getRealtimeTicket,
  refreshToken,
  changePassword,
  logoutUser,
}
