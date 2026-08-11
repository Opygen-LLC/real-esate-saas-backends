import { NextFunction, Request, Response } from 'express'
import httpStatus from 'http-status'
import { Secret } from 'jsonwebtoken'
import config from '../../config'
import ApiError from '../../errors/ApiError'
import { jwtHelpers } from '../helpers/jwtHelpers'

const auth =
  (...requiredRoles: string[]) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.headers.authorization

      if (!token) {
        throw new ApiError(httpStatus.UNAUTHORIZED, 'You are not authorized')
      }

      const verifiedUser = jwtHelpers.verifyToken(
        token.replace(/^Bearer\s+/i, ''),
        config.jwt.secret as Secret
      )

      req.user = verifiedUser

      if (requiredRoles.length) {
        const userRole = verifiedUser.userRole || verifiedUser.role
        // Map alias roles for backward compatibility
        const mappedRoles = [userRole]
        if (userRole === 'admin' || userRole === 'client') mappedRoles.push('agency_owner', 'agency_admin')
        if (userRole === 'staff') mappedRoles.push('agent')
        if (userRole === 'agency_owner') mappedRoles.push('admin', 'client')
        if (userRole === 'agency_admin') mappedRoles.push('admin')
        if (userRole === 'agent') mappedRoles.push('staff')

        const hasAccess = requiredRoles.some((role) => mappedRoles.includes(role))
        if (!hasAccess) {
          throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden access')
        }
      }

      next()
    } catch (error) {
      next(error)
    }
  }

const authSuperAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.headers.authorization
    if (!token) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'You are not authorized')
    }

    const verifiedUser = jwtHelpers.verifyToken(
      token.replace(/^Bearer\s+/i, ''),
      config.jwt.secret as Secret
    )

    req.user = verifiedUser

    const userRole = verifiedUser.userRole || verifiedUser.role
    if (userRole !== 'super-admin' && userRole !== 'super-Admin') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden, you are not a super admin')
    }

    next()
  } catch (error) {
    next(error)
  }
}

export const authMiddlewares = {
  auth,
  authSuperAdmin,
}
