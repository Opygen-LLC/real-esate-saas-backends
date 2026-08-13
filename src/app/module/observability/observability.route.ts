import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import validateRequest from '../../middlewares/validateRequest'
import { ObservabilityController } from './observability.controller'

const router = express.Router()
const limiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false })
const schema = z.object({ body: z.object({
  name: z.string().max(80).optional(),
  message: z.string().min(1).max(1000),
  stack: z.string().max(8000).optional(),
  url: z.string().max(1500).optional(),
  digest: z.string().max(160).optional(),
  userAgent: z.string().max(500).optional(),
  buildId: z.string().max(160).optional(),
}).strict() })

router.post('/client-error', limiter, validateRequest(schema), ObservabilityController.clientError)

export const ObservabilityRoute = router
