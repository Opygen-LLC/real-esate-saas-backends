export interface ILoginUser {
  phoneNumber?: string
  email?: string
  password?: string
}

export interface IRegisterAgency {
  name: string
  email: string
  phoneNumber: string
  password?: string
  agencyName: string
  agencyType?: string
  licenseNumber?: string
}

export interface ILoginUserResponse {
  accessToken: string
  refreshToken: string
  userRole: string
  organizationId: string
  user: Record<string, unknown>
  isVerified: boolean
}

export interface IRefreshTokenResponse {
  accessToken: string
}

export interface IChangePassword {
  oldPassword?: string
  newPassword?: string
}
