import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const service = read('src/app/module/property/property.service.ts')
const model = read('src/app/module/property/property.model.ts')
const validation = read('src/app/module/property/property.validation.ts')
const constants = read('src/app/module/property/property.constants.ts')
const migration = read('src/app/db/migratePhase2PropertyCorrectness.ts')

assert.match(constants, /ComingSoon/)
assert.match(validation, /PROPERTY_STATUSES/)
assert.match(validation, /Listing price must be greater than zero/)
assert.match(validation, /canonicalizePostalCode/)
assert.match(service, /bangladeshAddress\.postalCode/)
assert.ok((service.match(/runValidators: true/g) || []).length >= 3, 'property mutations must enable mongoose validators')
assert.doesNotMatch(model, /yearBuilt:[\s\S]{0,80}new Date\(\)\.getFullYear/)
assert.match(model, /Legacy compatibility only/)
assert.match(migration, /\$unset: \{ zipCode: '' \}/)

console.log('Phase 2 property correctness architecture verification passed.')
