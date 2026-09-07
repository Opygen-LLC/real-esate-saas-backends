import { createHash } from 'crypto'
import { isIP } from 'net'
import type { Request, Response, NextFunction } from 'express'
import mongoose, { Schema, model, models } from 'mongoose'
import ApiError from '../../errors/ApiError'

const counterSchema = new Schema({
  _id: { type: String, required: true },
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
}, { versionKey: false })
counterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
export const PublicViewingRateCounter = models.PublicViewingRateCounter || model('PublicViewingRateCounter', counterSchema)

/** Group IPv6 privacy addresses by /64; normalize mapped IPv4 addresses. */
export const clientNetwork = (input: string): string => {
  const raw = input.trim().split('%')[0].toLowerCase()
  if (raw.startsWith('::ffff:') && isIP(raw.slice(7)) === 4) return raw.slice(7)
  if (isIP(raw) === 4) return raw
  if (isIP(raw) !== 6) return 'unknown'
  const canonical = new URL(`http://[${raw}]/`).hostname.replace(/^\[|\]$/g, '')
  const [left, right] = canonical.split('::')
  const lhs = left ? left.split(':') : []
  const rhs = right ? right.split(':') : []
  const groups = right !== undefined ? [...lhs, ...Array(8 - lhs.length - rhs.length).fill('0'), ...rhs] : lhs
  // Mapped addresses may have been normalized from a hexadecimal representation.
  if (groups.slice(0, 5).every((part) => Number.parseInt(part, 16) === 0) && Number.parseInt(groups[5], 16) === 65535) {
    const a = Number.parseInt(groups[6], 16); const b = Number.parseInt(groups[7], 16)
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
  }
  return `${groups.slice(0, 4).map((part) => Number.parseInt(part, 16).toString(16)).join(':')}::/64`
}

const WINDOW_MS = 15 * 60_000
const consume = async (scope: string, limit: number): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> => {
  if (mongoose.connection.readyState !== 1) throw new ApiError(503, 'Viewing requests are temporarily unavailable', '', 'RATE_LIMIT_UNAVAILABLE')
  const now = Date.now(); const window = Math.floor(now / WINDOW_MS)
  const id = createHash('sha256').update(`${window}:${scope}`).digest('hex')
  const expiresAt = new Date((window + 2) * WINDOW_MS)
  let row: any
  try {
    row = await PublicViewingRateCounter.findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true, new: true }).lean()
  } catch (error: any) {
    if (error?.code !== 11000) throw new ApiError(503, 'Viewing requests are temporarily unavailable', '', 'RATE_LIMIT_UNAVAILABLE')
    row = await PublicViewingRateCounter.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { new: true }).lean()
  }
  if (!row) throw new ApiError(503, 'Viewing requests are temporarily unavailable', '', 'RATE_LIMIT_UNAVAILABLE')
  return { allowed: row.count <= limit, remaining: Math.max(0, limit - row.count), retryAfter: Math.ceil(((window + 1) * WINDOW_MS - now) / 1000) }
}

export const publicViewingRateLimiter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // This Mongo-backed limit is shared across API replicas. No raw IP is stored.
    const result = await consume(`network:${clientNetwork(req.ip || req.socket.remoteAddress || '')}`, 20)
    res.setHeader('RateLimit-Limit', '20')
    res.setHeader('RateLimit-Remaining', String(result.remaining))
    res.setHeader('RateLimit-Reset', String(result.retryAfter))
    res.setHeader('Cache-Control', 'no-store')
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfter))
      throw new ApiError(429, 'Too many viewing requests. Try again later.', '', 'VIEWING_RATE_LIMITED')
    }
    next()
  } catch (error) { next(error) }
}

/** Apply only after validation, to cap distributed abuse of one agency's quota. */
export const publicViewingTenantRateLimiter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await consume(`agency:${req.body.organizationId}`, 300)
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfter))
      throw new ApiError(429, 'This agency is receiving too many requests. Try again later.', '', 'VIEWING_RATE_LIMITED')
    }
    next()
  } catch (error) { next(error) }
}
