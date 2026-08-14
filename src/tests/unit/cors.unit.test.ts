import { describe, expect, it } from 'vitest'
import config from '../../config'
import { csrfProtection } from '../../app/middlewares/security'
import { Request, Response } from 'express'

describe('CORS and Origin Configuration', () => {
  it('includes localhost and https://realestate.opygen.com in allowed origins', () => {
    expect(config.allowed_origins).toContain('http://localhost:3000')
    expect(config.allowed_origins).toContain('https://realestate.opygen.com')
  })

  it('allows request from https://realestate.opygen.com in CSRF middleware check', () => {
    let errorPassed: any = null
    const req = {
      method: 'GET',
      get: (header: string) => {
        if (header.toLowerCase() === 'origin') return 'https://realestate.opygen.com'
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

  it('rejects unallowed origin in CSRF middleware check', () => {
    let errorPassed: any = null
    const req = {
      method: 'GET',
      get: (header: string) => {
        if (header.toLowerCase() === 'origin') return 'https://malicious-domain.com'
        return undefined
      },
    } as unknown as Request

    const res = {} as Response
    const next = (err?: any) => {
      errorPassed = err
    }

    csrfProtection(req, res, next)
    expect(errorPassed).toBeDefined()
    expect(errorPassed?.message).toMatch(/Origin is not allowed/i)
  })
})
