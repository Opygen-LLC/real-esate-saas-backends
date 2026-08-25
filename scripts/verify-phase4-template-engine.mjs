import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const constants = read('src/app/module/websiteBuilder/websiteTemplate.constants.ts')
const registry = read('src/app/module/websiteBuilder/templateRegistry.ts')
const organization = read('src/app/module/organization/organization.service.ts')
const reconciliation = read('src/app/module/entitlement/resourceEntitlementReconciliation.service.ts')
const builder = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')

for (let index = 1; index <= 10; index += 1) assert.match(constants, new RegExp(`'template-${index}'`))
for (const name of ['Editorial Estate', 'Gallery Residence', 'Swiss Realty']) assert.match(registry, new RegExp(name))
assert.match(registry, /FULL_SITE_PAGES = \['home', 'about', 'contact', 'properties', 'propertyDetail', 'agents', 'agentDetail'\]/)
assert.match(registry, /isPremium:/)
assert.match(organization, /TemplateRegistry\.isPremium/)
assert.match(reconciliation, /TemplateRegistry\.isPremium/)
assert.match(builder, /TemplateRegistry\.isPremium/)
assert.doesNotMatch(organization, /PREMIUM_TEMPLATE_IDS/)
assert.doesNotMatch(reconciliation, /PREMIUM_TEMPLATE_IDS/)
assert.doesNotMatch(builder, /PREMIUM_TEMPLATE_IDS/)
console.log('Phase 4 full-site template engine verification passed.')
