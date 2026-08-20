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
import { ONBOARDING_VERSION, normalizeOnboardingState } from '../organization/onboarding.constants'
import { User } from '../user/user.model'
import { AccountCredential } from '../accountCredential/accountCredential.model'
import { UserProfile } from '../userProfile/userProfile.model'
import { AgencyOwnerProfile } from '../agencyOwnerProfile/agencyOwnerProfile.model'
import { AgentProfile } from '../agentProfile/agentProfile.model'
import { SuperAdminProfile } from '../superAdminProfile/superAdminProfile.model'
import { ensureUserProfile, syncRoleProfile, toAuthUserDto } from '../user/userProfile.service'
import { findUserWithProfiles } from '../user/userReadModel.service'
import { buildDefaultWebsiteDocument } from '../websiteBuilder/defaultWebsiteDocument'
import { WebsitePage } from '../websiteBuilder/websitePage.model'
import { AuthResult, IChangePassword, ILoginUser, IRegisterAgency, RequestMeta } from './auth.interface'
import { AuthSession } from './authSession.model'
import { toAuthSessionSummary, type AuthSessionSummary } from '../../../contracts/workspaceContracts'
import { OtpChallenge, OtpPurpose } from './otpChallenge.model'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { captureOtpForTest } from '../../../testSupport/otpCapture'
import { sendAccountVerificationEmail, sendPasswordResetEmail } from './authEmail.service'
import { getTrialPolicy, trialEndFromPolicy } from '../platformSettings/trialPolicy.service'
import { RealtimeService } from '../realtime/realtime.service'

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

const publicUser = (user: any) => toAuthUserDto(user)

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
    refreshTokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    createdIp: meta.ip || '',
    lastUsedIp: meta.ip || '',
    userAgent: meta.userAgent || '',
  })
  const [projectedUser, organization, verifiedDomain] = await Promise.all([
    findUserWithProfiles({ _id: user._id }),
    Organization.findOne({ organizationId: user.organizationId }).select('sub_domain websiteStatus onboarding').lean(),
    DomainRecord.findOne({ organizationId: user.organizationId, status: 'verified', tlsStatus: 'active' }).select('domain').lean(),
  ])
  const onboarding = normalizeOnboardingState(organization?.onboarding)
  return {
    accessToken: accessTokenFor(user),
    refreshToken,
    userRole: user.userRole,
    organizationId: user.organizationId,
    user: publicUser(projectedUser || user),
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
  const now = new Date()
  // Only the newest challenge may be used. Consuming older unconsumed codes
  // prevents replay across resend requests without relying on TTL timing.
  await OtpChallenge.updateMany(
    { userId: user._id, purpose, channel: 'email', consumedAt: null, expiresAt: { $gt: now } },
    { $set: { consumedAt: now } },
  )
  await OtpChallenge.create({
    _id: challengeId,
    email,
    channel: 'email',
    userId: user._id,
    organizationId: user.organizationId || '',
    purpose,
    codeHash: hashOtp(challengeId.toString(), otp),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    requestIp: meta.ip || '',
    requestUserAgent: meta.userAgent || '',
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
    AccountCredential.deleteOne({ userId: input.userId }),
    UserProfile.deleteOne({ userId: input.userId }),
    AgencyOwnerProfile.deleteOne({ userId: input.userId }),
    AgentProfile.deleteOne({ userId: input.userId }),
    SuperAdminProfile.deleteOne({ userId: input.userId }),
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

  const trialPolicy = await getTrialPolicy()
  const trialEnd = trialEndFromPolicy(trialPolicy)
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
      onboarding: { status: 'not_started', currentStep: 1, version: ONBOARDING_VERSION },
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
        status: trialPolicy.enabled && trialPolicy.defaultTrialDays > 0 ? 'trialing' : 'expired',
        currentPeriodEnd: trialEnd,
        trialEndsAt: trialEnd,
        lastPaymentDate: null,
        maxProperties: trialPolicy.maxProperties,
        maxAgents: trialPolicy.maxAgents,
        source: 'trial',
      },
    }], sessionOptions)
    await User.create([{
      _id: userId,
      name: payload.name,
      email,
      phoneNumber,
      organizationId,
      userRole: 'agency_owner',
      status: 'pending',
      isVerified: false,
    }], sessionOptions)
    await AccountCredential.create([{
      userId,
      passwordHash,
      passwordChangedAt: new Date(),
    }], sessionOptions)
    await ensureUserProfile(userId, {
      isAddProfile: false,
      accessControl: { useRoleDefaults: true, permissions: [] },
    }, session)
    await syncRoleProfile(userId, organizationId, 'agency_owner', {
      licenseNumber: payload.licenseNumber || '',
    }, session)
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
      organizationId,
      purpose: 'account_verification',
      codeHash: hashOtp(challengeId.toString(), otp),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      requestIp: meta.ip || '',
      requestUserAgent: meta.userAgent || '',
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
  if (!user) throw new ApiError(401, 'Invalid credentials')
  const credential: any = await AccountCredential.findOne({ userId: user._id }).select('+passwordHash')
  if (!credential) throw new ApiError(401, 'Invalid credentials')
  if (credential.lockedUntil && credential.lockedUntil > new Date()) {
    throw new ApiError(429, 'Too many failed sign-in attempts. Try again later.', '', 'ACCOUNT_TEMPORARILY_LOCKED')
  }
  const passwordMatches = await bcrypt.compare(payload.password, credential.passwordHash as string)
  if (!passwordMatches) {
    const nextFailures = Number(credential.failedLoginCount || 0) + 1
    const lockUntil = nextFailures >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null
    await AccountCredential.updateOne(
      { _id: credential._id },
      { $set: { failedLoginCount: lockUntil ? 0 : nextFailures, lockedUntil: lockUntil } },
    )
    throw new ApiError(401, 'Invalid credentials')
  }
  if (user.status === 'blocked') throw new ApiError(403, 'Account is blocked')
  if (!user.isVerified || user.status !== 'active') throw new ApiError(403, 'Verify your email before signing in', '', 'EMAIL_VERIFICATION_REQUIRED')
  await AccountCredential.updateOne(
    { _id: credential._id },
    { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: meta.ip || '' } },
  )
  return createSession(user, meta)
}

const consumeOtp = async (email: string, code: string, purpose: OtpPurpose) => {
  const challenge = await OtpChallenge.findOne({ email, channel: 'email', purpose, consumedAt: null }).sort({ createdAt: -1 }).select('+codeHash')
  if (!challenge) throw new ApiError(401, 'Invalid or expired verification code')
  validateOtpChallengeState(challenge)
  if (!safeEqual(challenge.codeHash, hashOtp(challenge._id.toString(), code))) {
    await OtpChallenge.updateOne({ _id: challenge._id, consumedAt: null }, { $inc: { attempts: 1 }, $set: { lastAttemptAt: new Date() } })
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
  await AccountCredential.updateOne(
    { userId: user._id },
    { $set: { emailVerifiedAt: new Date() } },
  )
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
    { resetTokenHash: sha256(resetToken), resetTokenIssuedAt: new Date(), resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
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
        }, { resetTokenUsedAt: new Date() }, { new: true, session }).select('+resetTokenHash')
        if (!challenge?.userId) throw new ApiError(401, 'Invalid or expired reset token')
        const user = await User.findById(challenge.userId).session(session)
        if (!user) throw new ApiError(401, 'Invalid reset request')
        const updatedCredential = await AccountCredential.findOneAndUpdate(
          { userId: user._id },
          { $set: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } },
          { new: true, session },
        )
        if (!updatedCredential) throw new ApiError(401, 'Invalid reset request')
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
  }, { resetTokenUsedAt: new Date() }, { new: true }).select('+resetTokenHash')
  if (!challenge?.userId) throw new ApiError(401, 'Invalid or expired reset token')
  const user = await User.findById(challenge.userId)
  if (!user) throw new ApiError(401, 'Invalid reset request')
  const passwordHash = await hashPassword(newPassword)
  const updatedCredential = await AccountCredential.findOneAndUpdate(
    { userId: user._id },
    { $set: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } },
    { new: true },
  )
  if (!updatedCredential) throw new ApiError(401, 'Invalid reset request')
  await AuthSession.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date(), revokeReason: 'password_reset' })
  RealtimeService.emitSessionChanged({ userId: user._id.toString(), organizationId: user.organizationId, forceLogout: true, reason: 'password_reset' })
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

const createRealtimeTicket = async (userId: string) => {
  const user = await User.findById(userId).select('_id organizationId userRole status isVerified').lean()
  if (!user || user.status !== 'active' || !user.isVerified) throw new ApiError(401, 'Account is unavailable')
  const ticket = jwtHelpers.createToken({
    typ: 'realtime_ticket',
    aud: 'dashboard_socket',
    _id: user._id.toString(),
    organizationId: user.organizationId,
    userRole: user.userRole,
  }, config.jwt.secret as Secret, config.realtime.ticket_ttl)
  return { ticket, expiresIn: config.realtime.ticket_ttl }
}


type CurrentSessionIdentity = { sessionId: string; familyId: string }

const currentSessionIdentity = (
  token: string | undefined,
  userId: string,
  organizationId: string,
): CurrentSessionIdentity | null => {
  if (!token) return null
  let payload: any
  try {
    payload = jwtHelpers.verifyToken(token, config.jwt.refresh_secret as Secret)
  } catch {
    return null
  }
  if (!payload?.sessionId || String(payload._id || '') !== userId) return null
  // Phase-1 sessions always carry organizationId. Pre-migration refresh tokens may not;
  // an explicit tenant mismatch is still rejected, while an absent legacy claim is
  // validated against the owned AuthSession record below.
  if (payload.organizationId && String(payload.organizationId) !== organizationId) return null
  return { sessionId: String(payload.sessionId), familyId: String(payload.familyId || '') }
}

const ownedActiveSessionFilter = (userId: string, organizationId: string) => ({
  userId,
  revokedAt: null,
  expiresAt: { $gt: new Date() },
  $or: [
    { organizationId },
    { organizationId: { $exists: false } },
    { organizationId: '' },
    { organizationId: null },
  ],
})

const requireCurrentSessionIdentity = async (token: string | undefined, userId: string, organizationId: string): Promise<CurrentSessionIdentity> => {
  const identity = currentSessionIdentity(token, userId, organizationId)
  if (!identity || !token) {
    throw new ApiError(401, 'Current browser session could not be verified', '', 'CURRENT_SESSION_UNAVAILABLE')
  }
  const session: any = await AuthSession.findOne({
    _id: identity.sessionId,
    ...ownedActiveSessionFilter(userId, organizationId),
  }).select('+refreshTokenHash +tokenHash')
  const storedHash = session?.refreshTokenHash || session?.tokenHash
  if (!storedHash || !safeEqual(storedHash, sha256(token))) {
    throw new ApiError(401, 'Current browser session could not be verified', '', 'CURRENT_SESSION_UNAVAILABLE')
  }
  return identity
}

const getCurrentSessionSummary = async (
  token: string | undefined,
  userId: string,
  organizationId: string,
): Promise<AuthSessionSummary | null> => {
  const identity = currentSessionIdentity(token, userId, organizationId)
  if (!identity) return null
  const session = await AuthSession.findOne({
    _id: identity.sessionId,
    ...ownedActiveSessionFilter(userId, organizationId),
  }).select('_id userAgent createdIp lastUsedIp lastUsedAt expiresAt createdAt').lean()
  return session ? toAuthSessionSummary(session, true) : null
}

const listSessions = async (token: string | undefined, userId: string, organizationId: string): Promise<AuthSessionSummary[]> => {
  const identity = currentSessionIdentity(token, userId, organizationId)
  const sessions = await AuthSession.find(ownedActiveSessionFilter(userId, organizationId))
    .select('_id userAgent createdIp lastUsedIp lastUsedAt expiresAt createdAt')
    .sort({ lastUsedAt: -1, createdAt: -1 })
    .lean()

  return sessions.map((session: any) => toAuthSessionSummary(session, String(session._id) === identity?.sessionId))
}

const revokeSession = async (
  token: string | undefined,
  userId: string,
  organizationId: string,
  sessionId: string,
  meta: RequestMeta,
): Promise<void> => {
  const identity = await requireCurrentSessionIdentity(token, userId, organizationId)
  if (!Types.ObjectId.isValid(sessionId)) throw new ApiError(400, 'Invalid session id', '', 'INVALID_SESSION_ID')
  if (identity.sessionId === sessionId) {
    throw new ApiError(400, 'Current session cannot be revoked', '', 'CURRENT_SESSION_CANNOT_BE_REVOKED')
  }

  const revoked = await AuthSession.findOneAndUpdate(
    {
      _id: sessionId,
      ...ownedActiveSessionFilter(userId, organizationId),
    },
    { $set: { revokedAt: new Date(), revokeReason: 'user_revoked' } },
    { new: true },
  ).select('_id')
  if (!revoked) throw new ApiError(404, 'Session not found', '', 'SESSION_NOT_FOUND')

  await writeAudit({
    organizationId,
    actorId: userId,
    action: 'identity.session_revoked',
    entityType: 'auth_session',
    entityId: sessionId,
    requestId: meta.requestId,
    ip: meta.ip,
  })
}

const revokeOtherSessions = async (
  token: string | undefined,
  userId: string,
  organizationId: string,
  meta: RequestMeta,
): Promise<{ revokedCount: number }> => {
  const identity = await requireCurrentSessionIdentity(token, userId, organizationId)
  if (!Types.ObjectId.isValid(identity.sessionId)) {
    throw new ApiError(401, 'Current browser session could not be verified', '', 'CURRENT_SESSION_UNAVAILABLE')
  }

  const result = await AuthSession.updateMany(
    {
      ...ownedActiveSessionFilter(userId, organizationId),
      _id: { $ne: new Types.ObjectId(identity.sessionId) },
    },
    { $set: { revokedAt: new Date(), revokeReason: 'user_revoked_other_sessions' } },
  )

  await writeAudit({
    organizationId,
    actorId: userId,
    action: 'identity.other_sessions_revoked',
    entityType: 'auth_session',
    entityId: identity.sessionId,
    requestId: meta.requestId,
    ip: meta.ip,
    metadata: { revokedCount: result.modifiedCount },
  })
  return { revokedCount: result.modifiedCount }
}

const refreshToken = async (token: string, meta: RequestMeta = {}): Promise<AuthResult> => {
  let verified: any
  try {
    verified = jwtHelpers.verifyToken(token, config.jwt.refresh_secret as Secret)
  } catch {
    throw new ApiError(401, 'Invalid refresh token')
  }
  const authSession: any = await AuthSession.findById(verified.sessionId).select('+refreshTokenHash +tokenHash')
  if (!authSession || authSession.revokedAt || authSession.expiresAt <= new Date()) throw new ApiError(401, 'Session has expired')
  const storedRefreshHash = authSession.refreshTokenHash || authSession.tokenHash
  if (!storedRefreshHash || !safeEqual(storedRefreshHash, sha256(token))) {
    await AuthSession.updateMany({ familyId: verified.familyId, revokedAt: null }, { revokedAt: new Date(), revokeReason: 'refresh_token_reuse' })
    RealtimeService.emitSessionChanged({ userId: String(verified._id || ''), organizationId: String(verified.organizationId || ''), forceLogout: true, reason: 'refresh_token_reuse' })
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
  await AuthSession.updateOne(
    { _id: authSession._id, revokedAt: null },
    {
      $set: {
        refreshTokenHash: sha256(nextRefresh),
        lastUsedAt: new Date(),
        lastUsedIp: meta.ip || authSession.lastUsedIp || '',
        rotatedAt: new Date(),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
      $unset: { tokenHash: '' },
      $inc: { sessionVersion: 1 },
    },
  )
  const projectedUser = await findUserWithProfiles({ _id: user._id })
  return {
    accessToken: accessTokenFor(user),
    refreshToken: nextRefresh,
    userRole: user.userRole,
    organizationId: user.organizationId,
    user: publicUser(projectedUser || user),
    isVerified: user.isVerified,
  }
}

const logout = async (token?: string): Promise<void> => {
  if (!token) return
  try {
    const payload: any = jwtHelpers.verifyToken(token, config.jwt.refresh_secret as Secret)
    await AuthSession.updateOne({ _id: payload.sessionId }, { revokedAt: new Date(), revokeReason: 'logout' })
    RealtimeService.emitSessionChanged({ userId: String(payload._id || ''), organizationId: String(payload.organizationId || ''), forceLogout: true, reason: 'logout' })
  } catch {
    return
  }
}

const changePassword = async (userId: string, payload: IChangePassword, meta: RequestMeta): Promise<void> => {
  const user = await User.findById(userId)
  if (!user) throw new ApiError(401, 'Current password is incorrect')
  const credential: any = await AccountCredential.findOne({ userId: user._id }).select('+passwordHash')
  if (!credential || !(await bcrypt.compare(payload.oldPassword, credential.passwordHash as string))) throw new ApiError(401, 'Current password is incorrect')
  if (await bcrypt.compare(payload.newPassword, credential.passwordHash as string)) throw new ApiError(400, 'New password must be different from your current password')
  credential.passwordHash = await hashPassword(payload.newPassword)
  credential.passwordChangedAt = new Date()
  credential.failedLoginCount = 0
  credential.lockedUntil = null
  await credential.save()
  await AuthSession.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date(), revokeReason: 'password_change' })
  RealtimeService.emitSessionChanged({ userId: user._id.toString(), organizationId: user.organizationId, forceLogout: true, reason: 'password_change' })
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
  createRealtimeTicket,
  refreshToken,
  getCurrentSessionSummary,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  logout,
  changePassword,
  getWebsiteUrlForUser,
}
