import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const fail = (message) => { console.error(`Phase 6 verification failed: ${message}`); process.exit(1) }
const expect = (condition, message) => { if (!condition) fail(message) }

const readModel = read('src/app/module/user/userReadModel.service.ts')
expect(readModel.includes('$lookup'), 'user read model must use controlled profile aggregation lookups')
expect(readModel.includes('$facet'), 'paginated user read model must return rows/count in one aggregation')
expect(readModel.includes('For normal directory browsing only the requested page pays the profile join cost'), 'profile lookups must occur after pagination when profile search is not needed')

const users = read('src/app/module/user/user.service.ts')
expect(users.includes('User.aggregate'), 'public agents must use aggregation')
expect(!users.includes('USER_PROFILE_POPULATES'), 'read-heavy user service must not use four virtual profile populates')
expect(!users.includes('populateUserProfiles'), 'read-heavy user service must use the projection layer')

const authMiddleware = read('src/app/middlewares/auth.ts')
expect(authMiddleware.includes('findUserWithProfiles'), 'auth middleware must use the single profile projection')
expect(!authMiddleware.includes('populateUserProfiles'), 'auth middleware must not perform sequential profile populates')

const billing = read('src/app/module/billing/billing.service.ts')
expect(billing.includes('EntitlementService.getUsageSnapshot'), 'billing usage must consume the entitlement usage snapshot')
expect(!billing.includes('subscription?.maxProperties'), 'billing must not use subscription snapshot limits directly')
expect(!billing.includes('subscription?.maxAgents'), 'billing must not use subscription snapshot limits directly')

const entitlement = read('src/app/module/entitlement/entitlement.service.ts')
expect(entitlement.includes('getUsageSnapshot'), 'entitlement service must own usage counting rules')
expect(entitlement.includes('Promise.all'), 'resource usage snapshot must count independent resources concurrently')

const propertyModel = read('src/app/module/property/property.model.ts')
expect(!/\bzipCode\s*:/.test(propertyModel), 'Property model must not persist legacy zipCode')
expect(propertyModel.includes('PROPERTY_STATUSES'), 'Property model must use shared status constants')
expect(propertyModel.includes('PROPERTY_TYPES'), 'Property model must use shared type constants')


const leadModel = read('src/app/module/lead/lead.model.ts')
expect(leadModel.includes('organizationId:1,assignedAgent:1,leadStatus:1'), 'public-agent deal aggregation must have a matching tenant/agent/status index')

const migration = read('src/app/db/migratePhase6.ts')
expect(migration.includes('legacy zipCode'), 'Phase 6 migration must reject databases that skipped canonical postal migration')

console.log('Phase 6 backend performance/consistency architecture verified.')
