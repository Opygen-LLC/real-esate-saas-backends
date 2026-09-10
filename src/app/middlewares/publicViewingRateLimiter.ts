import { createHash } from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import mongoose, { Schema, model, models } from 'mongoose'
import ApiError from '../../errors/ApiError'
import { clientNetwork } from '../helpers/clientNetwork'

const counterSchema = new Schema({
  _id: { type: String, required: true },
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
}, { versionKey: false })
counterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
export const PublicViewingRateCounter = models.PublicViewingRateCounter || model('PublicViewingRateCounter', counterSchema)

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
