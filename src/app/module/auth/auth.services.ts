import bcrypt from 'bcryptjs'
import httpStatus from 'http-status'
import { JwtPayload, Secret } from 'jsonwebtoken'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import generateRandomCode from '../../../shared/generateRandomCode'
import hashPassword from '../../helpers/hashPassword'
import { jwtHelpers } from '../../helpers/jwtHelpers'
import sendOtp from '../../helpers/sendOtp'
import { Organization } from '../organization/organization.model'
import { User } from '../user/user.model'
import {
  IChangePassword,
  ILoginUser,
  ILoginUserResponse,
  IRefreshTokenResponse,
  IRegisterAgency,
} from './auth.interface'

const registerAgency = async (payload: IRegisterAgency): Promise<ILoginUserResponse> => {
  const { name, email, phoneNumber, password, agencyName, agencyType, licenseNumber } = payload

  // Check if email or phone already exists
  const existingUser = await User.findOne({
    $or: [{ email }, { phoneNumber }],
  })

  if (existingUser) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'A user with this email or phone number is already registered'
    )
  }

  // Generate unique organizationId
  const organizationId = 'org_' + Math.random().toString(36).substring(2, 8)
  const sub_domain = agencyName.toLowerCase().replace(/[^a-z0-9]/g, '')

  // Create Organization
  const organization = await Organization.create({
    organizationId,
    agencyName,
    agencyType: (agencyType as any) || 'residential',
    licenseNumber: licenseNumber || '',
    email,
    phone: phoneNumber,
    sub_domain: sub_domain || organizationId,
    subscription: {
      plan: 'trial',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      lastPaymentDate: new Date(),
    },
  })

  // Create User as agency_owner
  const hashedPassword = await hashPassword(password || '12345678')
  const user = await User.create({
    name,
    email,
    phoneNumber,
    password: hashedPassword,
    organizationId,
    userRole: 'agency_owner',
    status: 'active',
    isVerified: true,
    isAddProfile: true,
    licenseNumber,
  })

  // Link ownerId to organization
  organization.ownerId = user._id
  await organization.save()

  // Generate tokens
  const accessToken = jwtHelpers.createToken(
    {
      _id: user._id,
      number: user.phoneNumber,
      phoneNumber: user.phoneNumber,
      email: user.email,
      userRole: user.userRole,
      role: user.userRole,
      organizationId: user.organizationId,
      storeId: user.organizationId,
    },
    config.jwt.secret as Secret,
    config.jwt.expires_in as string
  )

  const refreshToken = jwtHelpers.createToken(
    {
      _id: user._id,
      number: user.phoneNumber,
      userRole: user.userRole,
      organizationId: user.organizationId,
    },
    config.jwt.refresh_secret as Secret,
    config.jwt.refresh_expires_in as string
  )

  return {
    accessToken,
    refreshToken,
    userRole: user.userRole,
    organizationId: user.organizationId,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      userRole: user.userRole,
      organizationId: user.organizationId,
    },
    isVerified: user.isVerified,
  }
}

const loginUser = async (payload: ILoginUser): Promise<ILoginUserResponse> => {
  const { phoneNumber, email, password } = payload

  if (!password) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Password is required')
  }

  const query: Record<string, unknown> = {}
  if (phoneNumber) query.phoneNumber = phoneNumber
  if (email) query.email = email

  if (!phoneNumber && !email) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email or Phone number is required')
  }

  const user = await User.findOne(query)
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found!')
  }

  if (user.status === 'blocked') {
    throw new ApiError(httpStatus.FORBIDDEN, 'Your account has been blocked. Please contact support.')
  }

  const isPasswordMatch = await bcrypt.compare(password, user.password as string)
  if (!isPasswordMatch) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect password!')
  }

  const { _id, phoneNumber: number, email: userEmail, userRole, organizationId, isVerified } = user

  const accessToken = jwtHelpers.createToken(
    {
      _id,
      number,
      phoneNumber: number,
      email: userEmail,
      userRole,
      role: userRole,
      organizationId,
      storeId: organizationId,
    },
    config.jwt.secret as Secret,
    config.jwt.expires_in as string
  )

  const refreshToken = jwtHelpers.createToken(
    {
      _id,
      number,
      userRole,
      organizationId,
    },
    config.jwt.refresh_secret as Secret,
    config.jwt.refresh_expires_in as string
  )

  return {
    accessToken,
    refreshToken,
    userRole,
    organizationId,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      userRole: user.userRole,
      organizationId: user.organizationId,
    },
    isVerified,
  }
}

const verifyOtp = async (phoneNumber: string, verificationCode: string): Promise<ILoginUserResponse> => {
  const user = await User.findOne({ phoneNumber })
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found')

  if (user.verificationCode !== verificationCode) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect verification code')
  }

  user.isVerified = true
  user.verificationCode = ''
  user.codeGenerationTimestamp = ''
  await user.save()

  const accessToken = jwtHelpers.createToken(
    {
      _id: user._id,
      number: user.phoneNumber,
      phoneNumber: user.phoneNumber,
      email: user.email,
      userRole: user.userRole,
      role: user.userRole,
      organizationId: user.organizationId,
      storeId: user.organizationId,
    },
    config.jwt.secret as Secret,
    config.jwt.expires_in as string
  )

  const refreshToken = jwtHelpers.createToken(
    {
      _id: user._id,
      number: user.phoneNumber,
      userRole: user.userRole,
      organizationId: user.organizationId,
    },
    config.jwt.refresh_secret as Secret,
    config.jwt.refresh_expires_in as string
  )

  return {
    accessToken,
    refreshToken,
    userRole: user.userRole,
    organizationId: user.organizationId,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      userRole: user.userRole,
      organizationId: user.organizationId,
    },
    isVerified: true,
  }
}

const resendOtp = async (phoneNumber: string): Promise<{ verificationCode: string }> => {
  const verificationCode = generateRandomCode()
  const codeGenerationTimestamp = Date.now().toString()

  const user = await User.findOneAndUpdate(
    { phoneNumber },
    { verificationCode, codeGenerationTimestamp },
    { new: true }
  )

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found with this phone number')
  }

  await sendOtp(phoneNumber, verificationCode)

  return { verificationCode }
}

const refreshToken = async (token: string): Promise<IRefreshTokenResponse> => {
  let verifiedToken = null
  try {
    verifiedToken = jwtHelpers.verifyToken(token, config.jwt.refresh_secret as Secret)
  } catch (error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid refresh token')
  }

  const { _id } = verifiedToken as { _id: string }
  const user = await User.findById(_id)
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found!')
  }

  const newAccessToken = jwtHelpers.createToken(
    {
      _id: user._id,
      number: user.phoneNumber,
      phoneNumber: user.phoneNumber,
      email: user.email,
      userRole: user.userRole,
      role: user.userRole,
      organizationId: user.organizationId,
      storeId: user.organizationId,
    },
    config.jwt.secret as Secret,
    config.jwt.expires_in as string
  )

  return { accessToken: newAccessToken }
}

const resetPassword = async (phoneNumber: string, newPassword: string): Promise<void> => {
  const user = await User.findOne({ phoneNumber })
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found')

  const hashedPassword = await hashPassword(newPassword)
  user.password = hashedPassword
  await user.save()
}

const changePassword = async (userPayload: JwtPayload | null, payload: IChangePassword): Promise<void> => {
  const { oldPassword, newPassword } = payload
  if (!oldPassword || !newPassword) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Old and new passwords are required')
  }

  const user = await User.findById(userPayload?._id)
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User does not exist')
  }

  const isMatch = await bcrypt.compare(oldPassword, user.password as string)
  if (!isMatch) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Old password is incorrect')
  }

  user.password = await hashPassword(newPassword)
  await user.save()
}

export const AuthServices = {
  registerAgency,
  loginUser,
  verifyOtp,
  resendOtp,
  refreshToken,
  resetPassword,
  changePassword,
}
