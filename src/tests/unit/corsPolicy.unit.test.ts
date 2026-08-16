import { describe, expect, it } from 'vitest'
import { isPublicCorsRequest } from '../../app/middlewares/corsPolicy'

describe('CORS public endpoint policy', () => {
  it('recognizes credential-less public website API routes', () => {
    expect(isPublicCorsRequest({ originalUrl: '/api/v1/platform-settings/public' } as any)).toBe(true)
    expect(isPublicCorsRequest({ originalUrl: '/api/v1/property/public-detail/abc?organizationId=org_1' } as any)).toBe(true)
    expect(isPublicCorsRequest({ originalUrl: '/api/v1/lead/public-capture' } as any)).toBe(true)
  })

  it('does not classify authenticated dashboard APIs as public', () => {
    expect(isPublicCorsRequest({ originalUrl: '/api/v1/users' } as any)).toBe(false)
    expect(isPublicCorsRequest({ originalUrl: '/api/v1/auth/session' } as any)).toBe(false)
  })
})
