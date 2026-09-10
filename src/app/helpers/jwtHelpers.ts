import jwt, { JwtPayload, Secret, SignOptions } from 'jsonwebtoken'

const JWT_ALGORITHM = 'HS256' as const

const createToken = (
  payload: Record<string, unknown>,
  secret: Secret,
  expireTime: string
): string => {
  return jwt.sign(payload, secret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: expireTime,
  } as SignOptions)
}

const verifyToken = (token: string, secret: Secret): JwtPayload => {
  return jwt.verify(token, secret, {
    algorithms: [JWT_ALGORITHM],
  }) as JwtPayload
}

export const jwtHelpers = {
  createToken,
  verifyToken,
}
