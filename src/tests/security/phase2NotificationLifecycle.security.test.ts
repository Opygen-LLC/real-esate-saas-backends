import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 2 notification lifecycle security contract', () => {
  it('uses authenticated user access instead of coupling notifications to leads.read', () => {
    const routes = read('src/app/module/notification/notification.route.ts')
    expect(routes).toMatch(/router\.use\(authMiddlewares\.auth\(\)\)/)
    expect(routes).toMatch(/router\.get\('\/', NotificationController\.list\)/)
    expect(routes).toMatch(/router\.patch\('\/read-all', NotificationController\.markAllRead\)/)
    expect(routes).toMatch(/router\.patch\('\/:id\/read', NotificationController\.markRead\)/)
    expect(routes).toMatch(/router\.delete\('\/:id', NotificationController\.dismiss\)/)
    expect(routes).not.toMatch(/leads\.read/)
  })

  it('tenant- and user-scopes list, read and dismiss operations', () => {
    const service = read('src/app/module/notification/notification.service.ts')
    expect(service).toMatch(/organizationId,[\s\S]*userId,[\s\S]*dismissedAt: null/)
    expect(service).toMatch(/\{ _id: id, organizationId, userId, dismissedAt: null \}/)
    expect(service).toMatch(/Notification\.updateMany\([\s\S]*organizationId, userId, dismissedAt: null/)
  })

  it('soft-dismisses notifications and emits a deleted realtime event', () => {
    const model = read('src/app/module/notification/notification.model.ts')
    const service = read('src/app/module/notification/notification.service.ts')
    expect(model).toMatch(/dismissedAt: Date/)
    expect(service).toMatch(/\$set: \{ dismissedAt, readAt: dismissedAt \}/)
    expect(service).toMatch(/emitNotification\(organizationId, userId, row\._id\.toString\(\), 'deleted'\)/)
  })

  it('keeps active notification reads newest-first with a stable id tie-breaker', () => {
    const service = read('src/app/module/notification/notification.service.ts')
    expect(service).toMatch(/\.sort\(\{ createdAt: -1, _id: -1 \}\)/)
  })

  it('rejects malformed notification ids before they can become Mongo cast failures', () => {
    const service = read('src/app/module/notification/notification.service.ts')
    expect(service).toMatch(/isValidObjectId/)
    expect(service).toMatch(/throw new ApiError\(404, 'Notification not found'\)/)
  })

  it('ships the active-notification production index explicitly because autoIndex is disabled in production', () => {
    const model = read('src/app/module/notification/notification.model.ts')
    const migration = read('src/app/db/migratePhase2NotificationLifecycle.ts')
    const pkg = read('package.json')
    expect(model).toMatch(/tenant_user_dismissed_created/)
    expect(migration).toMatch(/organizationId: 1, userId: 1, dismissedAt: 1, createdAt: -1, _id: -1/)
    expect(migration).toMatch(/tenant_user_dismissed_created/)
    expect(pkg).toMatch(/migrate:phase2-notifications/)
  })
})
