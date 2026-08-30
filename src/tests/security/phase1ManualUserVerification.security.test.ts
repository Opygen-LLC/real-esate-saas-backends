import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(path, 'utf8')

describe('super-admin manual user verification security contracts', () => {
  it('uses a dedicated super-admin-only endpoint with a required audit reason', () => {
    const route = read('src/app/module/user/user.route.ts')
    const validation = read('src/app/module/user/user.validation.ts')

    expect(route).toMatch(/\/super-admin\/:id\/verify'.*authMiddlewares\.authSuperAdmin/s)
    expect(route).toMatch(/validateRequest\(UserValidation\.manualVerification\)/)
    expect(validation).toMatch(/manualVerification: z\.object/)
    expect(validation).toMatch(/reason: z\.string\(\)\.trim\(\)\.min\(10\)\.max\(500\)/)
    expect(validation).toMatch(/manualVerification:[\s\S]*\.strict\(\)/)
  })

  it('only transitions pending unverified users and is safe when OTP verification wins the race', () => {
    const service = read('src/app/module/user/user.service.ts')

    expect(service).toMatch(/status: 'pending', isVerified: false/)
    expect(service).toMatch(/\$set: \{ status: 'active', isVerified: true \}/)
    expect(service).toMatch(/raceWinner\.isVerified && raceWinner\.status === 'active'/)
    expect(service).toMatch(/alreadyVerified: !writeResult\.changed/)
  })

  it('sets email verification, consumes only account verification OTPs, and writes an audit event', () => {
    const service = read('src/app/module/user/user.service.ts')

    expect(service).toMatch(/emailVerifiedAt: verifiedAt/)
    expect(service).toMatch(/purpose: 'account_verification', consumedAt: null/)
    expect(service).not.toMatch(/purpose: 'password_reset', consumedAt: null/)
    expect(service).toMatch(/action: 'identity\.user_manually_verified'/)
    expect(service).toMatch(/verificationMethod: 'manual_admin_approval'/)
    expect(service).toMatch(/source: 'super_admin'/)
    expect(service).toMatch(/previousStatus: 'pending'/)
    expect(service).toMatch(/newStatus: 'active'/)
  })
})
