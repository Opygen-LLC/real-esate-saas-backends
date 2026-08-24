import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('phase 1 platform entry and public language backend dependencies', () => {
  it('keeps the session resolver authenticated and cookie-safe for frontend routing', () => {
    const route = read('src/app/module/auth/auth.route.ts')
    const controller = read('src/app/module/auth/auth.controller.ts')
    const middleware = read('src/app/middlewares/auth.ts')

    expect(route).toMatch(/router\.get\('\/routing-session', AuthController\.getRoutingSession\)/)
    expect(route).toMatch(/router\.get\('\/session', authMiddlewares\.auth\(\), AuthController\.getSession\)/)
    expect(controller).toMatch(/Cache-Control', 'no-store/)
    expect(controller).toMatch(/AuthServices\.resolveRoutingSession/)
    expect(controller).toMatch(/authenticated:\s*true/)
    expect(controller).toMatch(/user:\s*\{ \.\.\.req\.user/)
    expect(middleware).toMatch(/access_cookie_name/)
    expect(middleware).toMatch(/Invalid or expired access token/)
    const service = read('src/app/module/auth/auth.services.ts')
    expect(service).toMatch(/const resolveRoutingSession/)
    expect(service).toMatch(/refresh_secret/)
    expect(service).toMatch(/safeEqual\(storedRefreshHash, sha256\(token\)\)/)
    expect(service).toMatch(/USER_SUSPENDED/)
    expect(service).toMatch(/TENANT_SUSPENDED/)
  })

  it('publishes defaultLanguage and invalidates tenant cache when website settings change', () => {
    const service = read('src/app/module/organization/organization.service.ts')
    const validation = read('src/app/module/organization/organization.validation.ts')
    const route = read('src/app/module/organization/organization.route.ts')

    expect(service).toMatch(/select\('[^']*defaultLanguage[^']*'\)/)
    expect(service).toMatch(/defaultLanguage:\s*org\.defaultLanguage \|\| 'en'/)
    expect(service).toMatch(/defaultLanguage:\s*payload\.defaultLanguage/)
    expect(service).toMatch(/CacheInvalidationService\.invalidateTenant\(organizationId\)/)
    expect(validation).toMatch(/defaultLanguage:\s*z\.enum\(\['en', 'bn'\]\)/)
    expect(route).toMatch(/\/website-settings/)
    expect(route).toMatch(/requirePermission\('website\.write'\)/)
  })
})
