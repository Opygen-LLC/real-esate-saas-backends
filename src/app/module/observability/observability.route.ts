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

const operationalEventSchema = z.object({ body: z.object({
  event: z.enum(['form_validation_failed', 'website_template_render_failed']),
  route: z.string().max(1500).optional(),
  templateId: z.string().max(40).optional(),
  fields: z.array(z.string().max(120)).max(50).optional(),
  firstField: z.string().max(120).optional(),
  source: z.enum(['client', 'server']).optional(),
  digest: z.string().max(160).optional(),
  errorName: z.string().max(80).optional(),
}).strict() })

router.post('/client-error', limiter, validateRequest(schema), ObservabilityController.clientError)
router.post('/operational-event', limiter, validateRequest(operationalEventSchema), ObservabilityController.operationalEvent)

export const ObservabilityRoute = router
