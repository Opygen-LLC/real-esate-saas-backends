import { describe, expect, it } from 'vitest'
import config from '../../config'
import { csrfProtection } from '../../app/middlewares/security'
import { Request, Response } from 'express'

describe('CORS and Origin Configuration', () => {
  it('includes wildcard * in allowed origins', () => {
    expect(config.allowed_origins).toContain('*')
  })

  it('allows request from any origin in CSRF middleware check when wildcard is enabled', () => {
    let errorPassed: any = null
    const req = {
      method: 'GET',
      get: (header: string) => {
        if (header.toLowerCase() === 'origin') return 'https://any-frontend-site.com'
        return undefined
      },
    } as unknown as Request

    const res = {} as Response
    const next = (err?: any) => {
      errorPassed = err
    }

    csrfProtection(req, res, next)
    expect(errorPassed).toBeUndefined()
  })
})
