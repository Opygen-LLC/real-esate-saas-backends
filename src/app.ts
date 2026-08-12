import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { Application, Request, Response } from 'express'
import httpStatus from 'http-status'
import { CronRoute } from './app/module/cron/cron.route'
import globalErrorHandler from './app/middlewares/globalErrorHandler'
import routes from './app/routes/index'
import { sendResponse } from './shared/customResponse'

const app: Application = express()

// 1. Fully open CORS middleware (origin: '*')
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Headers',
      'Access-Control-Allow-Methods',
    ],
  })
)

// Explicit preflight OPTIONS handler for all endpoints
app.options('*', cors() as any)

// 2. Global Headers & Preflight Handler
app.use((req: Request, res: Response, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept, Origin'
  )
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }
  next()
})

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(cookieParser())

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

// Main API routes
app.use('/api/v1', routes)
app.use('/api/cron', CronRoute)

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
