import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const checks = []
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) })

const service = read('src/app/module/organization/organization.service.ts')
const validation = read('src/app/module/organization/organization.validation.ts')
const migration = read('src/app/db/migrateWebsiteFooterPhase2.ts')
const model = read('src/app/module/organization/organization.model.ts')

check('social writes remain dotted/merge-safe', service.includes('target[`socialLinks.${key}`]'))
check('migration preserves legacy twitter during first deployment', migration.includes('legacyTwitterDeleted: 0') && !migration.includes("$unset: { 'socialLinks.twitter'"))
check('explicit X writes retire the legacy twitter field after migration compatibility', service.includes("unset['socialLinks.twitter']") && service.includes('value.x !== undefined || value.twitter !== undefined'))
check('footer defaults are canonicalized on reads', service.includes('canonicalWebsiteSettings') && service.includes('showSocialLinks: settings?.footer?.showSocialLinks ?? true'))
check('public cache is invalidated after website settings save', service.includes('await CacheInvalidationService.invalidateTenant(organizationId)'))
check('Facebook validation is HTTPS + host restricted', validation.includes("platformUrl('Facebook', ['facebook.com'])"))
check('Instagram validation is HTTPS + host restricted', validation.includes("platformUrl('Instagram', ['instagram.com'])"))
check('YouTube validation supports youtube.com and youtu.be', validation.includes("platformUrl('YouTube', ['youtube.com', 'youtu.be'])"))
check('X validation supports x.com and legacy twitter.com', validation.includes("platformUrl('X', ['x.com', 'twitter.com'])"))
check('footer schema has master visibility default', model.includes('showSocialLinks: { type: Boolean, default: true }'))
check('footer schema has four per-network visibility fields', ['facebook', 'instagram', 'youtube', 'x'].every((field) => model.includes(`${field}: { type: Boolean, default: true }`)))
check('migration copies twitter only when x is absent', migration.includes("'socialLinks.x': { $exists: false }") && migration.includes("'socialLinks.x': '$socialLinks.twitter'"))
check('migration backs up affected organizations before applying', migration.includes('backupDocuments({'))
check('migration is dry-run by default and confirmation-gated', migration.includes('requireConfirmation(cli, CONFIRMATION)') && migration.includes("cli.apply ? 'APPLY' : 'DRY-RUN'"))

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`)
const failed = checks.filter((item) => !item.ok)
if (failed.length) {
  console.error(`\n${failed.length} Phase 2 verification check(s) failed.`)
  process.exit(1)
}
console.log(`\n${checks.length}/${checks.length} Phase 2 backend checks passed.`)
