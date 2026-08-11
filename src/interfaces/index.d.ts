import { JwtPayload } from 'jsonwebtoken'

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload & {
        _id?: string
        id?: string
        number?: string
        phoneNumber?: string
        email?: string
        userRole?: string
        role?: string
        organizationId?: string
        storeId?: string
      }
    }
  }
}

export {}
