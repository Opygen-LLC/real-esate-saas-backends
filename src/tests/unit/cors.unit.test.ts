import { describe, expect, it } from 'vitest'
import config from '../../config'
import { isPublicCorsRequest, isTrustedApplicationOrigin } from '../../app/middlewares/corsPolicy'
import { Request } from 'express'

describe('CORS and Origin Configuration', () => {
  it('trusts the configured application origin', () => {
    expect(isTrustedApplicationOrigin(config.domains.public_site_origin)).toBe(true)
  })

  it('never permits a wildcard allowlist in production configuration', () => {
    if (config.isProduction) {
      expect(config.allowed_origins).not.toContain('*')
    }
  })

  it('classifies public lead capture as a credential-less public CORS request', () => {
    const req = {
      originalUrl: '/api/v1/lead/public-capture',
    } as Pick<Request, 'originalUrl'>

    expect(isPublicCorsRequest(req)).toBe(true)
  })

  it('does not classify authenticated dashboard API routes as public CORS requests', () => {
    const req = {
      originalUrl: '/api/v1/auth/session',
    } as Pick<Request, 'originalUrl'>

    expect(isPublicCorsRequest(req)).toBe(false)
  })
})
