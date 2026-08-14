export interface IRegisterAgency { name: string; email: string; phoneNumber: string; password: string;
  agencyName: string; agencyType?: string; licenseNumber?: string }
export interface ILoginUser { phoneNumber?: string; email?: string; password: string }
export interface IChangePassword { oldPassword: string; newPassword: string }
export interface RequestMeta { ip?: string; userAgent?: string; requestId?: string }
export interface AuthResult { accessToken: string; refreshToken: string; userRole: string;
  organizationId: string; user: Record<string, unknown>; isVerified: boolean; websiteUrl?: string }
