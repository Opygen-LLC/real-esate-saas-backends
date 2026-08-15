import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8')

describe('phase 3 legacy-operation removal invariants', () => {
  it('does not mount moderation, compliance or support-ticket routes', () => {
    const routes = read('src/app/routes/index.ts')
    expect(routes).not.toMatch(/ModerationRoute|ComplianceRoute|SupportRoute/)
    expect(routes).not.toMatch(/path:\s*['"]\/(?:moderation|compliance|support)['"]/)
  })

  it('backs up every property affected by moderation removal before mutating visibility', () => {
    const migration = read('src/app/db/migratePhase3AgencyPublishing.ts')
    const backupIndex = migration.indexOf('backupDocuments({ collection: properties, filter: affectedPropertyFilter')
    const draftIndex = migration.indexOf('properties.updateMany(nonApprovedLiveFilter')
    const unsetIndex = migration.indexOf('properties.updateMany(moderationFilter')
    expect(backupIndex).toBeGreaterThan(-1)
    expect(draftIndex).toBeGreaterThan(backupIndex)
    expect(unsetIndex).toBeGreaterThan(backupIndex)
    expect(migration).toMatch(/status:\s*'Available'[\s\S]*status:\s*'Draft'/)
    expect(migration).toMatch(/PHASE3_REMOVE_LEGACY_OPERATIONS/)
  })

  it('publishes public listings by agency status only and no longer reads moderation state', () => {
    const property = read('src/app/module/property/property.service.ts')
    expect(property).toMatch(/status:\s*'Available'/)
    expect(property).not.toMatch(/moderationStatus|moderatedAt|moderatedBy/)
    expect(property).toMatch(/Missing permission: properties\.publish/)
  })
})
