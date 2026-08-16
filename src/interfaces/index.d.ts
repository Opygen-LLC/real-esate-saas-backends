import { JwtPayload } from 'jsonwebtoken'

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload & {
        _id?: string
        id?: string
        number?: string
        name?: string
        phoneNumber?: string
        email?: string
        userRole?: string
        role?: string
        organizationId?: string
        profileImgURL?: string
        licenseNumber?: string
        specialization?: string[]
        permissions?: string[]
        status?: 'pending' | 'active' | 'blocked'
        isVerified?: boolean
        authorizationUpdatedAt?: string
        storeId?: string
      }
      tenant?: { organizationId: string; userId: string; role: string; permissions: string[] }
      impersonation?: { sessionId: string; adminUserId: string; organizationId: string; readOnly: boolean; expiresAt: Date }
      requestId: string
    }
  }
}

export {}
