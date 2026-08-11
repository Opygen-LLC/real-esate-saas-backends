import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { Application, Request, Response } from 'express'
import httpStatus from 'http-status'
import { CronRoute } from './app/module/cron/cron.route'
import globalErrorHandler from './app/middlewares/globalErrorHandler'
import routes from './app/routes/index'
import { sendResponse } from './shared/customResponse'

const app: Application = express()

// Security & Global Middlewares
app.use((req: Request, res: Response, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

app.use(
  cors({
    origin: true,
    credentials: true,
  })
)
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
