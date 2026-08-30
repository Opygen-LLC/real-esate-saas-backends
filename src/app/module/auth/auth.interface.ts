import { AuthUserResponseDto } from '../user/user.dto'
import { IUserRole } from '../user/user.interface'

export interface IRegisterAgency { name: string; email: string; phoneNumber: string; password: string;
  agencyName: string; agencyType?: string; licenseNumber?: string }
export interface ILoginUser { phoneNumber?: string; email?: string; password: string }
export interface IChangePassword { oldPassword: string; newPassword: string }
export interface RequestMeta { ip?: string; userAgent?: string; requestId?: string }
export interface AuthResult { accessToken: string; refreshToken: string; userRole: IUserRole;
  organizationId: string; user: AuthUserResponseDto; isVerified: boolean; websiteUrl?: string; websiteStatus?: string;
  onboarding?: { status: 'not_started' | 'in_progress' | 'completed' | 'skipped'; currentStep: number; version?: number } }

export interface RegisterAgencyPendingVerificationResult {
  email: string
  phoneNumber: string
  subdomain: string
  websiteUrl: string
  verificationRequired: true
  verificationChannel: 'email'
  registrationContinuationToken: string
}

export type RegisterAgencyAuthenticatedResult = AuthResult & {
  email: string
  phoneNumber: string
  subdomain: string
  websiteUrl: string
  verificationRequired: false
}

export type RegisterAgencyResult = RegisterAgencyPendingVerificationResult | RegisterAgencyAuthenticatedResult
