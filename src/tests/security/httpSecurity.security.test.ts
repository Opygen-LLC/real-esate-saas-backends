import type { Server } from 'node:http'
import cookieParser from 'cookie-parser'
import express, { NextFunction, Request, Response } from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { csrfProtection } from '../../app/middlewares/security'
import { authRateLimiter } from '../../app/middlewares/rateLimiter'

const start = async (app: express.Express) => {
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to bind security test server')
  return { server, baseUrl: `http://127.0.0.1:${address.port}` }
}

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('HTTP security middleware', () => {
  it('rejects cookie-authenticated state changes without a matching CSRF header', async () => {
    const app = express()
    app.use(cookieParser())
    app.post('/protected', csrfProtection, (_req, res) => res.status(204).end())
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const statusCode = Number((error as { statusCode?: number }).statusCode || 500)
      res.status(statusCode).json({ message: (error as Error).message })
    })
    const running = await start(app); servers.push(running.server)

    const missing = await fetch(`${running.baseUrl}/protected`, {
      method: 'POST', headers: { cookie: 'accessToken=token; csrfToken=csrf-secret' },
    })
    expect(missing.status).toBe(403)

    const valid = await fetch(`${running.baseUrl}/protected`, {
      method: 'POST', headers: { cookie: 'accessToken=token; csrfToken=csrf-secret', 'x-csrf-token': 'csrf-secret' },
    })
    expect(valid.status).toBe(204)
  })

  it('returns 429 after the configured authentication burst allowance', async () => {
    const app = express()
    app.post('/login', authRateLimiter, (_req, res) => res.status(204).end())
    const running = await start(app); servers.push(running.server)

    let lastStatus = 0
    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = await fetch(`${running.baseUrl}/login`, { method: 'POST' })
      lastStatus = response.status
    }
    expect(lastStatus).toBe(429)
  })
})
