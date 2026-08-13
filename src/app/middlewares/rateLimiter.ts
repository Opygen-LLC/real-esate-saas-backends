import rateLimit from 'express-rate-limit'

// Rate limiter for public lead submission forms (prevent spam)
export const publicLeadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  message: {
    success: false,
    message: 'Too many lead submissions from this IP address. Please try again after 15 minutes.',
  },
})

// Rate limiter for authentication routes (login / register)
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 auth requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts from this IP address. Please try again after 15 minutes.',
  },
})

export const otpRateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true,
  legacyHeaders: false, message: { success: false, message: 'Too many verification requests. Try again later.' } })

export const refreshRateLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 30, standardHeaders: true,
  legacyHeaders: false, message: { success: false, message: 'Too many session refresh attempts.' } })

// General API rate limiter for public portal routes
export const generalApiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this IP. Please try again later.',
  },
})
