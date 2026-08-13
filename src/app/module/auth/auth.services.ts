import bcrypt from 'bcryptjs'
import httpStatus from 'http-status'
import mongoose, { Types } from 'mongoose'
import { Secret } from 'jsonwebtoken'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { generateOtp, hashOtp, randomToken, safeEqual, sha256 } from '../../helpers/crypto'
import hashPassword from '../../helpers/hashPassword'
import { normalizeBangladeshPhone, normalizeEmail, normalizeSubdomain, RESERVED_SUBDOMAINS } from '../../helpers/identity'
import { jwtHelpers } from '../../helpers/jwtHelpers'
import sendOtp from '../../helpers/sendOtp'
import { writeAudit } from '../audit/audit.service'
import { Organization } from '../organization/organization.model'
import { User } from '../user/user.model'
import { WebsitePage } from '../websiteBuilder/websitePage.model'
import { AuthResult, IChangePassword, ILoginUser, IRegisterAgency, RequestMeta } from './auth.interface'
import { AuthSession } from './authSession.model'
import { OtpChallenge, OtpPurpose } from './otpChallenge.model'
import { randomUUID } from 'crypto'

const OTP_TTL_MS = 5 * 60 * 1000
const OTP_WINDOW_MS = 15 * 60 * 1000
const OTP_COOLDOWN_MS = 60 * 1000
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type OtpState = { expiresAt: Date; consumedAt?: Date | null; attempts: number; maxAttempts: number }
export const validateOtpChallengeState = (challenge: OtpState, now = new Date()): void => {
  if (challenge.consumedAt) throw new ApiError(httpStatus.UNAUTHORIZED, 'Verification code has already been used')
  if (challenge.expiresAt.getTime() <= now.getTime()) throw new ApiError(httpStatus.UNAUTHORIZED, 'Verification code has expired')
  if (challenge.attempts >= challenge.maxAttempts) throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'Maximum verification attempts exceeded')
}

const publicUser = (user: any) => ({ _id: user._id, name: user.name, email: user.email,
  phoneNumber: user.phoneNumber, userRole: user.userRole, organizationId: user.organizationId })

const accessTokenFor = (user: any): string => jwtHelpers.createToken({ _id: user._id.toString(), phoneNumber: user.phoneNumber,
  email: user.email, userRole: user.userRole, organizationId: user.organizationId }, config.jwt.secret as Secret, config.jwt.expires_in)

const createSession = async (user: any, meta: RequestMeta, familyId = randomToken(18)): Promise<AuthResult> => {
  const sessionId = new Types.ObjectId()
  const jti = randomToken(18)
  const refreshToken = jwtHelpers.createToken({ _id: user._id.toString(), sessionId: sessionId.toString(), familyId,
    jti, organizationId: user.organizationId }, config.jwt.refresh_secret as Secret, config.jwt.refresh_expires_in)
  await AuthSession.create({ _id: sessionId, userId: user._id, organizationId: user.organizationId, familyId,
    tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TTL_MS), createdIp: meta.ip || '', userAgent: meta.userAgent || '' })
  return { accessToken: accessTokenFor(user), refreshToken, userRole: user.userRole, organizationId: user.organizationId,
    user: publicUser(user), isVerified: user.isVerified }
}

const reserveSubdomain = async (agencyName: string, email: string): Promise<string> => {
  let base = normalizeSubdomain(agencyName) || 'agency'
  if (RESERVED_SUBDOMAINS.has(base)) base = `${base}-agency`
  if (!(await Organization.exists({ sub_domain: base }))) return base
  const suffix = sha256(email).slice(0, 6)
  const suggestion = `${base.slice(0, 41)}-${suffix}`
  if (!(await Organization.exists({ sub_domain: suggestion }))) return suggestion
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${suggestion.slice(0, 45)}-${n}`
    if (!(await Organization.exists({ sub_domain: candidate }))) return candidate
  }
  throw new ApiError(httpStatus.CONFLICT, `Subdomain unavailable. Suggested prefix: ${suggestion}`)
}

const enforceOtpThrottle = async (phoneNumber: string, purpose: OtpPurpose): Promise<void> => {
  const since = new Date(Date.now() - OTP_WINDOW_MS)
  const [count, latest] = await Promise.all([
    OtpChallenge.countDocuments({ phoneNumber, purpose, createdAt: { $gte: since } }),
    OtpChallenge.findOne({ phoneNumber, purpose }).sort({ createdAt: -1 }).select('createdAt').lean(),
  ])
  if (count >= 3) throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'Too many verification requests. Try again later.')
  if (latest?.createdAt && Date.now() - new Date(latest.createdAt).getTime() < OTP_COOLDOWN_MS) {
    throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'Please wait before requesting another code')
  }
}

const createOtpChallenge = async (phoneNumber: string, purpose: OtpPurpose, meta: RequestMeta, userId?: Types.ObjectId, session?: mongoose.ClientSession) => {
  await enforceOtpThrottle(phoneNumber, purpose)
  const otp = generateOtp()
  const challengeId = new Types.ObjectId()
  const challenge = { _id: challengeId, phoneNumber, userId, purpose, codeHash: hashOtp(challengeId.toString(), otp),
    expiresAt: new Date(Date.now() + OTP_TTL_MS), requestIp: meta.ip || '' }
  await sendOtp(phoneNumber, otp)
  await OtpChallenge.create([challenge], session ? { session } : undefined)
}

const defaultWebsiteDocument = { schemaVersion: 1, pages: [{ id: 'home', slug: '/', title: 'Home', nodes: [] }],
  theme: { primaryColor: '#0f172a', secondaryColor: '#2563eb', accentColor: '#7c3aed', fontFamily: 'Inter' } }

const registerAgency = async (payload: IRegisterAgency, meta: RequestMeta): Promise<{ phoneNumber: string; subdomain: string }> => {
  const email = normalizeEmail(payload.email)
  let phoneNumber: string
  try { phoneNumber = normalizeBangladeshPhone(payload.phoneNumber) } catch (error) { throw new ApiError(400, (error as Error).message) }
  if (await User.exists({ $or: [{ email }, { phoneNumber }] })) throw new ApiError(409, 'Email or phone is already registered')
  const subdomain = await reserveSubdomain(payload.agencyName, email)
  const organizationId = `org_${randomUUID()}`
  const userId = new Types.ObjectId()
  const organizationObjectId = new Types.ObjectId()
  const challengeId = new Types.ObjectId()
  const otp = generateOtp()
  await enforceOtpThrottle(phoneNumber, 'account_verification')
  await sendOtp(phoneNumber, otp)
  const dbSession = await mongoose.startSession()
  try {
    await dbSession.withTransaction(async () => {
      const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      await Organization.create([{ _id: organizationObjectId, organizationId, agencyName: payload.agencyName, agencyType: payload.agencyType || 'residential',
        licenseNumber: payload.licenseNumber || '', ownerId: userId, email, phone: phoneNumber, country: 'Bangladesh', sub_domain: subdomain,
        subscription: { plan: 'trial', status: 'trialing', currentPeriodEnd: trialEnd, trialEndsAt: trialEnd, lastPaymentDate: null, maxProperties: 10, maxAgents: 2 } }], { session: dbSession })
      await User.create([{ _id: userId, name: payload.name, email, phoneNumber, password: await hashPassword(payload.password), organizationId,
        userRole: 'agency_owner', status: 'pending', isVerified: false, isAddProfile: false, licenseNumber: payload.licenseNumber || '' }], { session: dbSession })
      await WebsitePage.create([{ organizationId, slug: '/', title: 'Home', draftDocument: defaultWebsiteDocument, status: 'draft', updatedBy: userId }], { session: dbSession })
      await OtpChallenge.create([{ _id: challengeId, phoneNumber, userId, purpose: 'account_verification', codeHash: hashOtp(challengeId.toString(), otp),
        expiresAt: new Date(Date.now() + OTP_TTL_MS), requestIp: meta.ip || '' }], { session: dbSession })
      await writeAudit({ organizationId, actorId: userId.toString(), actorRole: 'agency_owner', action: 'tenant.provisioned', entityType: 'organization',
        entityId: organizationObjectId.toString(), requestId: meta.requestId, ip: meta.ip, metadata: { subdomain, plan: 'trial' } }, dbSession)
    })
  } finally { await dbSession.endSession() }
  return { phoneNumber, subdomain }
}

const loginUser = async (payload: ILoginUser, meta: RequestMeta): Promise<AuthResult> => {
  let query: Record<string, string>
  try { query = payload.phoneNumber ? { phoneNumber: normalizeBangladeshPhone(payload.phoneNumber) } : { email: normalizeEmail(payload.email || '') } }
  catch (error) { throw new ApiError(400, (error as Error).message) }
  const user = await User.findOne(query)
  if (!user || !(await bcrypt.compare(payload.password, user.password as string))) throw new ApiError(401, 'Invalid credentials')
  if (user.status === 'blocked') throw new ApiError(403, 'Account is blocked')
  if (!user.isVerified || user.status !== 'active') throw new ApiError(403, 'Verify your phone before signing in')
  return createSession(user, meta)
}

const consumeOtp = async (phoneNumber: string, code: string, purpose: OtpPurpose) => {
  const challenge = await OtpChallenge.findOne({ phoneNumber, purpose, consumedAt: null }).sort({ createdAt: -1 })
  if (!challenge) throw new ApiError(401, 'Invalid or expired verification code')
  validateOtpChallengeState(challenge)
  if (!safeEqual(challenge.codeHash, hashOtp(challenge._id.toString(), code))) {
    await OtpChallenge.updateOne({ _id: challenge._id, consumedAt: null }, { $inc: { attempts: 1 } })
    throw new ApiError(401, 'Invalid or expired verification code')
  }
  const consumed = await OtpChallenge.findOneAndUpdate({ _id: challenge._id, consumedAt: null, attempts: { $lt: challenge.maxAttempts }, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date() } }, { new: true })
  if (!consumed) throw new ApiError(401, 'Invalid or expired verification code')
  return consumed
}

const verifyOtp = async (rawPhone: string, code: string, meta: RequestMeta): Promise<AuthResult> => {
  const phoneNumber = normalizeBangladeshPhone(rawPhone)
  const challenge = await consumeOtp(phoneNumber, code, 'account_verification')
  const user = await User.findOneAndUpdate({ _id: challenge.userId, phoneNumber, isVerified: false }, { isVerified: true, status: 'active' }, { new: true })
  if (!user) throw new ApiError(409, 'Account is already verified or unavailable')
  await writeAudit({ organizationId: user.organizationId, actorId: user._id.toString(), actorRole: user.userRole,
    action: 'identity.phone_verified', entityType: 'user', entityId: user._id.toString(), requestId: meta.requestId, ip: meta.ip })
  return createSession(user, meta)
}

const resendOtp = async (rawPhone: string, meta: RequestMeta): Promise<void> => {
  const phoneNumber = normalizeBangladeshPhone(rawPhone)
  const user = await User.findOne({ phoneNumber, isVerified: false, status: 'pending' })
  if (!user) throw new ApiError(404, 'Pending account not found')
  await createOtpChallenge(phoneNumber, 'account_verification', meta, user._id)
}

const requestPasswordReset = async (rawPhone: string, meta: RequestMeta): Promise<void> => {
  const phoneNumber = normalizeBangladeshPhone(rawPhone)
  const user = await User.findOne({ phoneNumber, isVerified: true, status: 'active' })
  if (user) await createOtpChallenge(phoneNumber, 'password_reset', meta, user._id)
}

const verifyPasswordReset = async (rawPhone: string, code: string): Promise<{ resetToken: string }> => {
  const phoneNumber = normalizeBangladeshPhone(rawPhone)
  const challenge = await consumeOtp(phoneNumber, code, 'password_reset')
  const resetToken = randomToken(32)
  await OtpChallenge.updateOne({ _id: challenge._id, resetTokenUsedAt: null }, { resetTokenHash: sha256(resetToken), resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) })
  return { resetToken }
}

const completePasswordReset = async (resetToken: string, newPassword: string, meta: RequestMeta): Promise<void> => {
  const session = await mongoose.startSession()
  let completed = false
  try {
    await session.withTransaction(async () => {
      const challenge = await OtpChallenge.findOneAndUpdate({ resetTokenHash: sha256(resetToken), resetTokenUsedAt: null,
        resetTokenExpiresAt: { $gt: new Date() } }, { resetTokenUsedAt: new Date() }, { new: true, session })
      if (!challenge?.userId) throw new ApiError(401, 'Invalid or expired reset token')
      const user = await User.findByIdAndUpdate(challenge.userId, { password: await hashPassword(newPassword) }, { new: true, session })
      if (!user) throw new ApiError(401, 'Invalid reset request')
      await AuthSession.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date(), revokeReason: 'password_reset' }, { session })
      await writeAudit({ organizationId: user.organizationId, actorId: user._id.toString(), actorRole: user.userRole,
        action: 'identity.password_reset', entityType: 'user', entityId: user._id.toString(), requestId: meta.requestId, ip: meta.ip }, session)
      completed = true
    })
  } finally { await session.endSession() }
  if (!completed) throw new ApiError(401, 'Invalid reset request')
}

const refreshToken = async (token: string): Promise<AuthResult> => {
  let verified: any
  try { verified = jwtHelpers.verifyToken(token, config.jwt.refresh_secret as Secret) } catch { throw new ApiError(401, 'Invalid refresh token') }
  const authSession = await AuthSession.findById(verified.sessionId)
  if (!authSession || authSession.revokedAt || authSession.expiresAt <= new Date()) throw new ApiError(401, 'Session has expired')
  if (!safeEqual(authSession.tokenHash, sha256(token))) {
    await AuthSession.updateMany({ familyId: verified.familyId, revokedAt: null }, { revokedAt: new Date(), revokeReason: 'refresh_token_reuse' })
    throw new ApiError(401, 'Refresh token reuse detected; session family revoked')
  }
  const user = await User.findById(verified._id)
  if (!user || !user.isVerified || user.status !== 'active') throw new ApiError(401, 'Account is unavailable')
  const jti = randomToken(18)
  const nextRefresh = jwtHelpers.createToken({ _id: user._id.toString(), sessionId: authSession._id.toString(), familyId: authSession.familyId,
    jti, organizationId: user.organizationId }, config.jwt.refresh_secret as Secret, config.jwt.refresh_expires_in)
  authSession.tokenHash = sha256(nextRefresh); authSession.lastUsedAt = new Date(); authSession.expiresAt = new Date(Date.now() + REFRESH_TTL_MS)
  await authSession.save()
  return { accessToken: accessTokenFor(user), refreshToken: nextRefresh, userRole: user.userRole,
    organizationId: user.organizationId, user: publicUser(user), isVerified: user.isVerified }
}

const logout = async (token?: string): Promise<void> => {
  if (!token) return
  try { const payload: any = jwtHelpers.verifyToken(token, config.jwt.refresh_secret as Secret)
    await AuthSession.updateOne({ _id: payload.sessionId }, { revokedAt: new Date(), revokeReason: 'logout' }) } catch { return }
}

const changePassword = async (userId: string, payload: IChangePassword, meta: RequestMeta): Promise<void> => {
  const user = await User.findById(userId)
  if (!user || !(await bcrypt.compare(payload.oldPassword, user.password as string))) throw new ApiError(401, 'Old password is incorrect')
  user.password = await hashPassword(payload.newPassword); await user.save()
  await AuthSession.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date(), revokeReason: 'password_change' })
  await writeAudit({ organizationId: user.organizationId, actorId: user._id.toString(), actorRole: user.userRole,
    action: 'identity.password_changed', entityType: 'user', entityId: user._id.toString(), requestId: meta.requestId, ip: meta.ip })
}

export const AuthServices = { registerAgency, loginUser, verifyOtp, resendOtp, requestPasswordReset,
  verifyPasswordReset, completePasswordReset, refreshToken, logout, changePassword }
