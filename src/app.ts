import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { Application, Request, Response } from 'express'
import helmet from 'helmet'
import httpStatus from 'http-status'
import { CronRoute } from './app/module/cron/cron.route'
import globalErrorHandler from './app/middlewares/globalErrorHandler'
import routes from './app/routes/index'
import { sendResponse } from './shared/customResponse'
import config from './config'
import { csrfProtection, requestContext, verifyCronSignature } from './app/middlewares/security'
import mongoose from 'mongoose'

const app: Application = express()

// Trust Proxy for Rate Limiter & Reverse Proxies
app.set('trust proxy', 1)

// 1. Credentialed CORS middleware. Never reflect arbitrary origins when cookies are enabled.
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    const normalizedOrigin = origin.replace(/\/$/, '')
    return callback(null, config.allowed_origins.includes(normalizedOrigin))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'X-CSRF-Token',
    'X-Request-ID',
    'Idempotency-Key',
  ],
  maxAge: 86400,
}
app.use(cors(corsOptions))

// Explicit preflight OPTIONS handler for all endpoints
app.options('*', cors(corsOptions) as any)

// 2. Global Headers & Preflight Handler
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false }))
app.use(requestContext)
app.use(cookieParser())
app.use('/api/v1/organization/website', express.json({ limit: '5mb' }))
app.use('/api/v1/lead/import', express.json({ limit: '6mb' }))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '256kb' }))
app.use(csrfProtection)

// Root testing route
app.get('/', (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Welcome to the Real Estate SaaS API Service',
    data: {
      status: 'operational',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    },
  })
})

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }))
app.get('/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' })
})

// Main API routes
app.use('/api/v1', routes)
app.use('/api/cron', verifyCronSignature, CronRoute)

// Global Error Handler
app.use(globalErrorHandler)

// 404 Route Handler
app.all('*', (req: Request, res: Response) => {
  res.status(httpStatus.NOT_FOUND).json({
    success: false,
    message: `No API endpoint found for ${req.method} ${req.originalUrl}`,
    errorMessages: [
      {
        path: req.originalUrl,
        message: `No API endpoint found for ${req.method} ${req.originalUrl}`,
      },
    ],
  })
})

export default app
