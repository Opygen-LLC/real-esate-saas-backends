import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 0 regression coverage invariants', () => {
  it('keeps property, lead and task mutations behind explicit permissions', () => {
    const propertyRoutes = read('src/app/module/property/property.route.ts')
    const leadRoutes = read('src/app/module/lead/lead.route.ts')
    const taskRoutes = read('src/app/module/task/task.route.ts')

    expect(propertyRoutes).toMatch(/requirePermission\('properties\.write'\)/)
    expect(propertyRoutes).toMatch(/requirePermission\('properties\.delete'\)|requirePermission\('properties\.write'\)/)
    expect(leadRoutes).toMatch(/requirePermission\('leads\.write'\)/)
    expect(leadRoutes).toMatch(/requirePermission\('leads\.assign'\)/)
    expect(taskRoutes).toMatch(/requirePermission\('tasks\.read'\)/)
    expect(taskRoutes).toMatch(/requirePermission\('tasks\.write'\)/)
  })

  it('requires tenant context in protected controllers instead of trusting organizationId from the client', () => {
    for (const file of [
      'src/app/module/property/property.controller.ts',
      'src/app/module/lead/lead.controller.ts',
      'src/app/module/task/task.controller.ts',
    ]) {
      expect(read(file), file).toMatch(/requireTenant\(req\)/)
    }
  })

  it('keeps auth session bootstrap authenticated and secrets non-selectable by default', () => {
    const authRoutes = read('src/app/module/auth/auth.route.ts')
    const authSession = read('src/app/module/auth/authSession.model.ts')
    expect(authRoutes).toMatch(/router\.get\('\/session', authMiddlewares\.auth\(\)/)
    expect(authSession).toMatch(/refreshTokenHash: \{[^}]*select: false/)
    expect(authSession).toMatch(/tokenHash: \{[^}]*select: false/)
  })

  it('keeps public forms validated and host resolution separate from authenticated tenant routing', () => {
    const leadRoutes = read('src/app/module/lead/lead.route.ts')
    const viewingRoutes = read('src/app/module/viewing/viewing.route.ts')
    const reviewRoutes = read('src/app/module/review/review.route.ts')
    const reviewController = read('src/app/module/review/review.controller.ts')
    const domainRoutes = read('src/app/module/domain/domain.route.ts')
    expect(leadRoutes).toMatch(/public-capture/)
    expect(leadRoutes).toMatch(/validateRequest\(LeadValidation\.publicCaptureZodSchema\)/)
    expect(viewingRoutes).toMatch(/public-request/)
    expect(viewingRoutes).toMatch(/validateRequest\(ViewingValidation\.publicRequestZodSchema\)/)
    expect(reviewRoutes).toMatch(/validateRequest\(ReviewValidation\.submit\)/)
    expect(reviewController).toMatch(/WebsiteSubmissionService\.captureReview/)
    expect(domainRoutes).toMatch(/\/resolve\/:host/)
  })
})
