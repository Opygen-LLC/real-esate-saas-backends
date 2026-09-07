const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('renderer contract defaults unknown historical tenants to legacy instead of current', () => {
  const manifest = read('src/contracts/websiteCatalog/manifest.ts')
  assert.match(manifest, /LEGACY_WEBSITE_RENDERER_VERSION[^\n]+legacy-v1/)
  assert.match(manifest, /CURRENT_WEBSITE_RENDERER_VERSION[^\n]+premium-v2/)
  assert.match(manifest, /resolveWebsiteRendererVersion[\s\S]*LEGACY_WEBSITE_RENDERER_VERSION/)
})

test('migration is dry-run by default and stamps organizations plus Studio history only on apply', () => {
  const migration = read('src/app/db/migratePhase5WebsiteRenderer.ts')
  assert.match(migration, /migrationCli\(\)/)
  assert.match(migration, /requireConfirmation\(cli, CONFIRM\)/)
  assert.match(migration, /organizations/)
  assert.match(migration, /websitestudios/)
  assert.match(migration, /websitestudiorevisions/)
  assert.match(migration, /backupDocuments/)
  assert.match(migration, /updateMany/)
  assert.match(migration, /No changes made/)
})

test('Studio publish enforces rollout transition and version is included in publication history and events', () => {
  const studio = read('src/app/module/websiteBuilder/websiteStudio.service.ts')
  assert.match(studio, /assertTransitionAllowed\(organizationId, org\.websiteSettings\?\.rendererVersion, studio\.snapshot\.websiteSettings\.rendererVersion\)/)
  assert.match(studio, /rendererVersion: studio\.snapshot\.websiteSettings\.rendererVersion/)
  assert.match(studio, /snapshot\.websiteSettings\.rendererVersion/)
})

test('new tenant renderer selection is controlled by rollout mode without changing existing records', () => {
  const rollout = read('src/app/module/websiteBuilder/websiteRendererRollout.service.ts')
  const auth = read('src/app/module/auth/auth.services.ts')
  assert.match(rollout, /disabled.*opt-in.*new-sites/)
  assert.match(rollout, /rolloutMode\(\) === 'new-sites'/)
  assert.match(rollout, /WEBSITE_RENDERER_ROLLOUT_ORGANIZATIONS/)
  assert.match(rollout, /cohort\.size === 0 \|\| Boolean\(organizationId && cohort\.has\(organizationId\)\)/)
  assert.match(auth, /rendererVersion: WebsiteRendererRolloutService\.initialRendererVersion\(\)/)
})
