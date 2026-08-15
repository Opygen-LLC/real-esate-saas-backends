import { describe, expect, it } from 'vitest'
import { API_ERROR_CODES, buildFieldErrors, defaultErrorCodeForStatus } from '../../contracts/apiContract'
import handleZodError from '../../errors/handleZodError'
import { z } from 'zod'

describe('API error contract', () => {
  it('groups validation messages by stable field path', () => {
    expect(buildFieldErrors([
      { path: 'phone', message: 'Invalid phone' },
      { path: 'phone', message: 'Invalid phone' },
      { path: 'email', message: 'Invalid email' },
    ])).toEqual({ phone: ['Invalid phone'], email: ['Invalid email'] })
  })

  it('maps Zod body paths to frontend field names', () => {
    const schema = z.object({ body: z.object({ defaultLanguage: z.enum(['en', 'bn']) }) })
    const result = schema.safeParse({ body: { defaultLanguage: 'বাংলা' } })
    expect(result.success).toBe(false)
    if (result.success) return
    const error = handleZodError(result.error)
    expect(error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR)
    expect(error.fieldErrors?.defaultLanguage?.[0]).toBeTruthy()
    expect(error.message).toBe('Please correct the highlighted fields')
  })

  it('uses stable default error codes for common HTTP statuses', () => {
    expect(defaultErrorCodeForStatus(401)).toBe('UNAUTHORIZED')
    expect(defaultErrorCodeForStatus(404)).toBe('NOT_FOUND')
    expect(defaultErrorCodeForStatus(409)).toBe('CONFLICT')
    expect(defaultErrorCodeForStatus(500)).toBe('INTERNAL_ERROR')
  })
})
