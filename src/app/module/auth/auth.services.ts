import { randomBytes, randomUUID } from 'crypto'
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
import { buildTenantWebsiteUrl } from '../../helpers/publicWebsiteUrl'
import { writeAudit } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit.model'
import { DomainRecord } from '../domain/domain.model'
import { SubdomainAlias } from '../domain/subdomainAlias.model'
import { Organization } from '../organization/organization.model'
import { User } from '../user/user.model'
import { buildDefaultWebsiteDocument } from '../websiteBuilder/defaultWebsiteDocument'
import { WebsitePage } from '../websiteBuilder/websitePage.model'
import { AuthResult, IChangePassword, ILoginUser, IRegisterAgency, RequestMeta } from './auth.interface'
import { AuthSession } from './authSession.model'
import { OtpChallenge, OtpPurpose } from './otpChallenge.model'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { captureOtpForTest } from '../../../testSupport/otpCapture'
import { sendAccountVerificationEmail, sendPasswordResetEmail } from './authEmail.service'

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

const publicUser = (user: any) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  phoneNumber: user.phoneNumber,
  userRole: user.userRole,
  organizationId: user.organizationId,
})

const accessTokenFor = (user: any): string => jwtHelpers.createToken({
  _id: user._id.toString(),
  phoneNumber: user.phoneNumber,
  email: user.email,
  userRole: user.userRole,
  organizationId: user.organizationId,
}, config.jwt.secret as Secret, config.jwt.expires_in)

const createSession = async (user: any, meta: RequestMeta, familyId = randomToken(18)): Promise<AuthResult> => {
  const sessionId = new Types.ObjectId()
  const jti = randomToken(18)
  const refreshToken = jwtHelpers.createToken({
    _id: user._id.toString(),
    sessionId: sessionId.toString(),
    familyId,
    jti,
    organizationId: user.organizationId,
  }, config.jwt.refresh_secret as Secret, config.jwt.refresh_expires_in)
  await AuthSession.create({
    _id: sessionId,
    userId: user._id,
    organizationId: user.organizationId,
    familyId,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    createdIp: meta.ip || '',
    userAgent: meta.userAgent || '',
  })
  const [organization, verifiedDomain] = await Promise.all([
    Organization.findOne({ organizationId: user.organizationId }).select('sub_domain websiteStatus onboarding').lean(),
    DomainRecord.findOne({ organizationId: user.organizationId, status: 'verified', tlsStatus: 'active' }).select('domain').lean(),
  ])
  const onboarding = organization?.onboarding || { status: 'completed' as const, currentStep: 5, version: 1 }
  return {
    accessToken: accessTokenFor(user),
    refreshToken,
    userRole: user.userRole,
    organizationId: user.organizationId,
    user: publicUser(user),
    isVerified: user.isVerified,
    websiteStatus: organization?.websiteStatus || 'published',
    onboarding,
    websiteUrl: organization ? buildTenantWebsiteUrl(organization.sub_domain || user.organizationId, verifiedDomain?.domain) : undefined,
  }
}

const reserveSubdomain = async (agencyName: string): Promise<string> => {
  let base = normalizeSubdomain(agencyName) || 'agency'
  if (RESERVED_SUBDOMAINS.has(base)) base = `${base}-agency`

  const available = async (candidate: string) => {
    const [org, alias] = await Promise.all([
      Organization.exists({ sub_domain: candidate }),
      SubdomainAlias.exists({ alias: candidate }),
    ])
    return !org && !alias
  }

  if (await available(base)) return base
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const suffix = randomBytes(3).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4).padEnd(4, 'x')
    const candidate = `${base.slice(0, 43)}-${suffix}`
    if (await available(candidate)) return candidate
  }
  throw new ApiError(httpStatus.CONFLICT, 'Unable to reserve a unique agency website address. Please try again.')
}

const enforceOtpThrottle = async (email: string, purpose: OtpPurpose): Promise<void> => {
  if (!config.isProduction) return

  const since = new Date(Date.now() - OTP_WINDOW_MS)
  const [count, latest] = await Promise.all([
    OtpChallenge.countDocuments({ email, purpose, channel: 'email', createdAt: { $gte: since } }),
    OtpChallenge.findOne({ email, purpose, channel: 'email' }).sort({ createdAt: -1 }).select('createdAt').lean(),
  ])
  if (count >= 3) throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'Too many verification requests. Try again later.')
  if (latest?.createdAt && Date.now() - new Date(latest.createdAt).getTime() < OTP_COOLDOWN_MS) {
    throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'Please wait before requesting another code')
  }
}


const createOtpChallenge = async (
  email: string,
  purpose: OtpPurpose,
  meta: RequestMeta,
  user: { _id: Types.ObjectId; name?: string; organizationId?: string },
  agencyName?: string,
): Promise<void> => {
  await enforceOtpThrottle(email, purpose)
  const otp = generateOtp()
  const challengeId = new Types.ObjectId()
  await OtpChallenge.create({
    _id: challengeId,
    email,
    channel: 'email',
    userId: user._id,
    purpose,
    codeHash: hashOtp(challengeId.toString(), otp),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    requestIp: meta.ip || '',
  })

  try {
    if (purpose === 'account_verification') {
      await sendAccountVerificationEmail({ email, code: otp, name: user.name, agencyName })
    } else {
      await sendPasswordResetEmail({ email, code: otp, name: user.name })
    }
    captureOtpForTest(email, purpose, otp)
  } catch (error) {
    await OtpChallenge.deleteOne({ _id: challengeId, consumedAt: null })
    throw error
  }
}

const cleanupProvisionedAgency = async (input: { organizationObjectId: Types.ObjectId; organizationId: string; userId: Types.ObjectId; challengeId: Types.ObjectId }) => {
  await Promise.allSettled([
    OtpChallenge.deleteOne({ _id: input.challengeId, userId: input.userId }),
    WebsitePage.deleteOne({ organizationId: input.organizationId, slug: '/' }),
    User.deleteOne({ _id: input.userId, organizationId: input.organizationId }),
    Organization.deleteOne({ _id: input.organizationObjectId, organizationId: input.organizationId }),
    AuditEvent.collection.deleteMany({ organizationId: input.organizationId, action: 'tenant.provisioned', entityId: input.organizationObjectId.toString() }),
  ])
}

const registerAgency = async (payload: IRegisterAgency, meta: RequestMeta): Promise<{
  email: string
  phoneNumber: string
  subdomain: string
  websiteUrl: string
  verificationRequired: true
  verificationChannel: 'email'
}> => {
  const email = normalizeEmail(payload.email)
  let phoneNumber: string
  try {
    phoneNumber = normalizeBangladeshPhone(payload.phoneNumber)
  } catch (error) {
    throw new ApiError(400, (error as Error).message)
  }

  if (await User.exists({ $or: [{ email }, { phoneNumber }] })) throw new ApiError(409, 'Email or phone is already registered')

  const subdomain = await reserveSubdomain(payload.agencyName)
  const organizationId = `org_${randomUUID()}`
  const userId = new Types.ObjectId()
  const organizationObjectId = new Types.ObjectId()
  const challengeId = new Types.ObjectId()
  const otp = generateOtp()
  await enforceOtpThrottle(email, 'account_verification')

  const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  const passwordHash = await hashPassword(payload.password)
  const websiteUrl = buildTenantWebsiteUrl(subdomain)
  const websiteDocument = buildDefaultWebsiteDocument(payload.agencyName, payload.agencyType || 'residential')
  const agencyTypeText = (payload.agencyType || 'residential').replace(/[_-]+/g, ' ')

  const provisionAgency = async (session?: mongoose.ClientSession): Promise<void> => {
    const sessionOptions = session ? { session } : undefined
    await Organization.create([{
      _id: organizationObjectId,
      organizationId,
      agencyName: payload.agencyName,
      agencyType: payload.agencyType || 'residential',
      licenseNumber: payload.licenseNumber || '',
      ownerId: userId,
      email,
      phone: phoneNumber,
      country: 'Bangladesh',
      sub_domain: subdomain,
      templateId: 'template-1',
      primaryColor: '#1877F2',
      secondaryColor: '#0f172a',
      font: 'Inter',
      websiteStatus: 'provisioned',
      onboarding: { status: 'not_started', currentStep: 1, version: 1 },
      metaTitle: `${payload.agencyName} | Real Estate in Bangladesh`,
      metaDescription: `Browse homes, land and commercial property with ${payload.agencyName}.`,
      websiteSettings: {
        heroTitle: `Find Your Next Property with ${payload.agencyName}`,
        heroSubtitle: `${agencyTypeText.charAt(0).toUpperCase()}${agencyTypeText.slice(1)} property specialists serving buyers, sellers and investors across Bangladesh.`,
        heroImage: '',
        featuredPropertiesCount: 6,
        enableTestimonials: true,
        enableLeadForm: true,
        enableWhatsAppChat: true,
        renderMode: 'template',
      },
      subscription: {
        plan: 'trial',
        status: 'trialing',
        currentPeriodEnd: trialEnd,
        trialEndsAt: trialEnd,
        lastPaymentDate: null,
        maxProperties: 10,
        maxAgents: 2,
      },
    }], sessionOptions)
    await User.create([{
      _id: userId,
      name: payload.name,
      email,
      phoneNumber,
      password: passwordHash,
      organizationId,
      userRole: 'agency_owner',
      status: 'pending',
      isVerified: false,
      isAddProfile: false,
      licenseNumber: payload.licenseNumber || '',
    }], sessionOptions)
    await WebsitePage.create([{
      organizationId,
      slug: '/',
      title: 'Home',
      draftDocument: websiteDocument,
      status: 'draft',
      seo: websiteDocument.seo,
      updatedBy: userId,
    }], sessionOptions)
    await OtpChallenge.create([{
      _id: challengeId,
      email,
      channel: 'email',
      userId,
      purpose: 'account_verification',
      codeHash: hashOtp(challengeId.toString(), otp),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      requestIp: meta.ip || '',
    }], sessionOptions)
    await writeAudit({
      organizationId,
      actorId: userId.toString(),
      actorRole: 'agency_owner',
      action: 'tenant.provisioned',
      entityType: 'organization',
      entityId: organizationObjectId.toString(),
      requestId: meta.requestId,
      ip: meta.ip,
      metadata: { subdomain, plan: 'trial', websiteUrl, verificationChannel: 'email' },
    }, session)
  }

  try {
    if (await mongoSupportsTransactions()) {
      const dbSession = await mongoose.startSession()
      try {
        await dbSession.withTransaction(() => provisionAgency(dbSession))
      } finally {
        await dbSession.endSession()
      }
    } else {
      await provisionAgency()
    }

    await sendAccountVerificationEmail({ email, code: otp, name: payload.name, agencyName: payload.agencyName })
    captureOtpForTest(email, 'account_verification', otp)
  } catch (error) {
    await cleanupProvisionedAgency({ organizationObjectId, organizationId, userId, challengeId })
    if ((error as { code?: number })?.code === 11000) {
      throw new ApiError(409, 'An account or agency website with these details already exists', '', 'ACCOUNT_ALREADY_EXISTS')
    }
    throw error
  }

  return { email, phoneNumber, subdomain, websiteUrl, verificationRequired: true, verificationChannel: 'email' }
}

const loginUser = async (payload: ILoginUser, meta: RequestMeta): Promise<AuthResult> => {
  let query: Record<string, string>
  try {
    query = payload.phoneNumber
      ? { phoneNumber: normalizeBangladeshPhone(payload.phoneNumber) }
      : { email: normalizeEmail(payload.email || '') }
  } catch (error) {
    throw new ApiError(400, (error as Error).message)
  }
  const user = await User.findOne(query)
  if (!user || !(await bcrypt.compare(payload.password, user.password as string))) throw new ApiError(401, 'Invalid credentials')
  if (user.status === 'blocked') throw new ApiError(403, 'Account is blocked')
  if (!user.isVerified || user.status !== 'active') throw new ApiError(403, 'Verify your email before signing in', '', 'EMAIL_VERIFICATION_REQUIRED')
  return createSession(user, meta)
}

const consumeOtp = async (email: string, code: string, purpose: OtpPurpose) => {
  const challenge = await OtpChallenge.findOne({ email, channel: 'email', purpose, consumedAt: null }).sort({ createdAt: -1 })
  if (!challenge) throw new ApiError(401, 'Invalid or expired verification code')
  validateOtpChallengeState(challenge)
  if (!safeEqual(challenge.codeHash, hashOtp(challenge._id.toString(), code))) {
    await OtpChallenge.updateOne({ _id: challenge._id, consumedAt: null }, { $inc: { attempts: 1 } })
    throw new ApiError(401, 'Invalid or expired verification code')
  }
  const consumed = await OtpChallenge.findOneAndUpdate(
    { _id: challenge._id, consumedAt: null, attempts: { $lt: challenge.maxAttempts }, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date() } },
    { new: true },
  )
  if (!consumed) throw new ApiError(401, 'Invalid or expired verification code')
  return consumed
}

const verifyOtp = async (rawEmail: string, code: string, meta: RequestMeta): Promise<AuthResult> => {
  const email = normalizeEmail(rawEmail)
  const challenge = await consumeOtp(email, code, 'account_verification')
  const user = await User.findOneAndUpdate(
    { _id: challenge.userId, email, isVerified: false },
    { isVerified: true, status: 'active' },
    { new: true },
  )
  if (!user) throw new ApiError(409, 'Account is already verified or unavailable')
  await writeAudit({
    organizationId: user.organizationId,
    actorId: user._id.toString(),
    actorRole: user.userRole,
    action: 'identity.email_verified',
    entityType: 'user',
    entityId: user._id.toString(),
    requestId: meta.requestId,
    ip: meta.ip,
  })
  return createSession(user, meta)
}

const resendOtp = async (rawEmail: string, meta: RequestMeta): Promise<void> => {
  const email = normalizeEmail(rawEmail)
  const user = await User.findOne({ email, isVerified: false, status: 'pending' })
  if (!user) return
  const org = await Organization.findOne({ organizationId: user.organizationId }).select('agencyName').lean()
  await createOtpChallenge(email, 'account_verification', meta, user as any, org?.agencyName)
}

const requestPasswordReset = async (rawEmail: string, meta: RequestMeta): Promise<void> => {
  const email = normalizeEmail(rawEmail)
  const user = await User.findOne({ email, isVerified: true, status: 'active' })
  if (user) await createOtpChallenge(email, 'password_reset', meta, user as any)
}

const verifyPasswordReset = async (rawEmail: string, code: string): Promise<{ resetToken: string }> => {
  const email = normalizeEmail(rawEmail)
  const challenge = await consumeOtp(email, code, 'password_reset')
  const resetToken = randomToken(32)
  await OtpChallenge.updateOne(
    { _id: challenge._id, resetTokenUsedAt: null },
    { resetTokenHash: sha256(resetToken), resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  )
  return { resetToken }
}

const completePasswordReset = async (resetToken: string, newPassword: string, meta: RequestMeta): Promise<void> => {
  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    let completed = false
    try {
      await session.withTransaction(async () => {
        const challenge = await OtpChallenge.findOneAndUpdate({
          resetTokenHash: sha256(resetToken),
          resetTokenUsedAt: null,
          resetTokenExpiresAt: { $gt: new Date() },
        }, { resetTokenUsedAt: new Date() }, { new: true, session })
        if (!challenge?.userId) throw new ApiError(401, 'Invalid or expired reset token')
        const user = await User.findByIdAndUpdate(challenge.userId, { password: await hashPassword(newPassword) }, { new: true, session })
        if (!user) throw new ApiError(401, 'Invalid reset request')
        await AuthSession.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date(), revokeReason: 'password_reset' }, { session })
        await writeAudit({
          organizationId: user.organizationId,
          actorId: user._id.toString(),
          actorRole: user.userRole,
          action: 'identity.password_reset',
          entityType: 'user',
          entityId: user._id.toString(),
          requestId: meta.requestId,
          ip: meta.ip,
        }, session)
        completed = true
      })
    } finally {
      await session.endSession()
    }
    if (!completed) throw new ApiError(401, 'Invalid reset request')
    return
  }

  const challenge = await OtpChallenge.findOneAndUpdate({
    resetTokenHash: sha256(resetToken),
    resetTokenUsedAt: null,
    resetTokenExpiresAt: { $gt: new Date() },
  }, { resetTokenUsedAt: new Date() }, { new: true })
  if (!challenge?.userId) throw new ApiError(401, 'Invalid or expired reset token')
  const user = await User.findById(challenge.userId)
  if (!user) throw new ApiError(401, 'Invalid reset request')
  const passwordHash = await hashPassword(newPassword)
  await AuthSession.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date(), revokeReason: 'password_reset' })
  user.password = passwordHash
  await user.save()
  await writeAudit({
    organizationId: user.organizationId,
    actorId: user._id.toString(),
    actorRole: user.userRole,
    action: 'identity.password_reset',
    entityType: 'user',
    entityId: user._id.toString(),
    requestId: meta.requestId,
    ip: meta.ip,
  })
}

const refreshToken = async (token: string): Promise<AuthResult> => {
  let verified: any
  try {
    verified = jwtHelpers.verifyToken(token, config.jwt.refresh_secret as Secret)
  } catch {
    throw new ApiError(401, 'Invalid refresh token')
  }
  const authSession = await AuthSession.findById(verified.sessionId)
  if (!authSession || authSession.revokedAt || authSession.expiresAt <= new Date()) throw new ApiError(401, 'Session has expired')
  if (!safeEqual(authSession.tokenHash, sha256(token))) {
    await AuthSession.updateMany({ familyId: verified.familyId, revokedAt: null }, { revokedAt: new Date(), revokeReason: 'refresh_token_reuse' })
    throw new ApiError(401, 'Refresh token reuse detected; session family revoked')
  }
  const user = await User.findById(verified._id)
  if (!user || !user.isVerified || user.status !== 'active') throw new ApiError(401, 'Account is unavailable')
  const jti = randomToken(18)
  const nextRefresh = jwtHelpers.createToken({
    _id: user._id.toString(),
    sessionId: authSession._id.toString(),
    familyId: authSession.familyId,
    jti,
    organizationId: user.organizationId,
  }, config.jwt.refresh_secret as Secret, config.jwt.refresh_expires_in)
  authSession.tokenHash = sha256(nextRefresh)
  authSession.lastUsedAt = new Date()
  authSession.expiresAt = new Date(Date.now() + REFRESH_TTL_MS)
  await authSession.save()
  return {
    accessToken: accessTokenFor(user),
    refreshToken: nextRefresh,
    userRole: user.userRole,
    organizationId: user.organizationId,
    user: publicUser(user),
    isVerified: user.isVerified,
  }
}

const logout = async (token?: string): Promise<void> => {
  if (!token) return
  try {
    const payload: any = jwtHelpers.verifyToken(token, config.jwt.refresh_secret as Secret)
    await AuthSession.updateOne({ _id: payload.sessionId }, { revokedAt: new Date(), revokeReason: 'logout' })
  } catch {
    return
  }
}

const changePassword = async (userId: string, payload: IChangePassword, meta: RequestMeta): Promise<void> => {
  const user = await User.findById(userId)
  if (!user || !(await bcrypt.compare(payload.oldPassword, user.password as string))) throw new ApiError(401, 'Current password is incorrect')
  if (await bcrypt.compare(payload.newPassword, user.password as string)) throw new ApiError(400, 'New password must be different from your current password')
  user.password = await hashPassword(payload.newPassword)
  await user.save()
  await AuthSession.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date(), revokeReason: 'password_change' })
  await writeAudit({
    organizationId: user.organizationId,
    actorId: user._id.toString(),
    actorRole: user.userRole,
    action: 'identity.password_changed',
    entityType: 'user',
    entityId: user._id.toString(),
    requestId: meta.requestId,
    ip: meta.ip,
  })
}

const getWebsiteUrlForUser = async (organizationId: string): Promise<string | undefined> => {
  const org = await Organization.findOne({ organizationId }).select('sub_domain').lean()
  if (!org?.sub_domain) return undefined
  const verified = await DomainRecord.findOne({ organizationId, status: 'verified', tlsStatus: 'active' }).select('domain').lean()
  return buildTenantWebsiteUrl(org.sub_domain, verified?.domain)
}

export const AuthServices = {
  registerAgency,
  loginUser,
  verifyOtp,
  resendOtp,
  requestPasswordReset,
  verifyPasswordReset,
  completePasswordReset,
  refreshToken,
  logout,
  changePassword,
  getWebsiteUrlForUser,
}
