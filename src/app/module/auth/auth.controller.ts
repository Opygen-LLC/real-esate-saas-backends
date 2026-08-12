import { Request, Response } from 'express'
import httpStatus from 'http-status'
import config from '../../../config'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { AuthServices } from './auth.services'

const registerAgency = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.registerAgency(req.body)
  const { refreshToken, ...others } = result

  const cookieOptions = {
    secure: config.env === 'production',
    httpOnly: true,
    sameSite: (config.env === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  }
  res.cookie('refreshToken', refreshToken, cookieOptions)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Agency registered successfully',
    data: others,
  })
})

const loginUser = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.loginUser(req.body)
  const { refreshToken, ...others } = result

  const cookieOptions = {
    secure: config.env === 'production',
    httpOnly: true,
    sameSite: (config.env === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  }
  res.cookie('refreshToken', refreshToken, cookieOptions)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User logged in successfully',
    data: others,
  })
})

const verifyOtp = catchAsync(async (req: Request, res: Response) => {
  const { phoneNumber, verificationCode } = req.body
  const result = await AuthServices.verifyOtp(phoneNumber, verificationCode)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'OTP verified successfully',
    data: result,
  })
})

const resendOtp = catchAsync(async (req: Request, res: Response) => {
  const { phoneNumber } = req.body
  const result = await AuthServices.resendOtp(phoneNumber)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'OTP resent successfully',
    data: result,
  })
})

const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const { refreshToken } = req.body || req.cookies
  const result = await AuthServices.refreshToken(refreshToken)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Token refreshed successfully',
    data: result,
  })
})

const resetPassword = catchAsync(async (req: Request, res: Response) => {
  const { phoneNumber, password } = req.body
  await AuthServices.resetPassword(phoneNumber, password)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Password reset successfully',
    data: null,
  })
})

const changePassword = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.changePassword(req.user || null, req.body)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Password changed successfully',
    data: null,
  })
})

const logoutUser = catchAsync(async (req: Request, res: Response) => {
  res.clearCookie('refreshToken', {
    secure: config.env === 'production',
    httpOnly: true,
    sameSite: (config.env === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  })
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User logged out successfully',
    data: null,
  })
})

export const AuthController = {
  registerAgency,
  loginUser,
  verifyOtp,
  resendOtp,
  refreshToken,
  logoutUser,
  resetPassword,
  changePassword,
}
