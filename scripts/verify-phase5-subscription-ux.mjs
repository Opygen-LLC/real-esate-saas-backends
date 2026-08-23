import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const failures = []
const expectText = (file, fragment, message = `${file} must contain ${fragment}`) => {
  if (!read(file).includes(fragment)) failures.push(message)
}
const rejectText = (file, fragment, message = `${file} must not contain ${fragment}`) => {
  if (read(file).includes(fragment)) failures.push(message)
}

const migration = 'src/app/db/migrateSubscriptionEntitlementStructureV1.ts'
expectText(migration, "organizationSubscriptionMutation: false")
expectText(migration, "legacyLimitMutation: false")
expectText(migration, "planVersionReassignment: false")
expectText(migration, "'trial.entitlements'")
expectText(migration, 'displayOrder')
expectText(migration, 'upgradeRank')
expectText(migration, 'backupDocuments')
rejectText(migration, 'organizations.update', 'Phase 5 structural migration must never update organizations')
rejectText(migration, 'Organization.update', 'Phase 5 structural migration must never update tenant subscription documents')
expectText('package.json', 'migrate:subscription-entitlement-structure')

const entitlement = read('src/app/module/entitlement/entitlement.service.ts')
for (const fragment of ['TRIAL_LIMIT_REACHED', 'PLAN_UPGRADE_REQUIRED', 'SUBSCRIPTION_INACTIVE']) {
  if (!entitlement.includes(fragment)) failures.push(`Entitlement service must retain ${fragment}`)
}

if (failures.length) {
  console.error(`Phase 5 subscription UX verification failed (${failures.length})`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}
console.log('Phase 5 subscription UX verification passed')
