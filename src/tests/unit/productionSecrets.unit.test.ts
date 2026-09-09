import { describe, expect, it } from 'vitest'
import { assertDistinctProductionSecrets, requireProductionSecret } from '../../config/productionSecrets'

describe('production secret policy', () => {
  it('rejects documentation/default-style secrets even when they are long enough', () => {
    expect(() => requireProductionSecret({ JWT_SECRET: 'real_estate_saas_jwt_secret_key_2026_super_secure_production_key_32bytes' } as NodeJS.ProcessEnv, 'JWT_SECRET'))
      .toThrow(/placeholder\/default/i)
    expect(() => requireProductionSecret({ JWT_SECRET: 'development-only-access-secret-change-me-1234567890' } as NodeJS.ProcessEnv, 'JWT_SECRET'))
      .toThrow(/placeholder\/default/i)
  })

  it('accepts a sufficiently long non-placeholder secret', () => {
    const value = '3H7v1dLq8R0pX5eN2zC9mK4sT6uW1yB7fJ0aQ8nV'
    expect(requireProductionSecret({ JWT_SECRET: value } as NodeJS.ProcessEnv, 'JWT_SECRET')).toBe(value)
  })

  it('rejects reusing one secret for different trust boundaries', () => {
    expect(() => assertDistinctProductionSecrets([
      ['JWT_SECRET', 'A-unique-secret-value-1234567890-abcdef'],
      ['OTP_PEPPER', 'A-unique-secret-value-1234567890-abcdef'],
    ])).toThrow(/must not reuse/i)
  })
})
