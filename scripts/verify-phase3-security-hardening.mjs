import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const fail = (message) => {
  console.error(`Phase 3 security verification failed: ${message}`)
  process.exitCode = 1
}
const assert = (condition, message) => { if (!condition) fail(message) }

const publicModules = [
  ['banner', 'Banner'],
  ['section', 'Section'],
  ['landingPage', 'LandingPage'],
]

for (const [folder, symbol] of publicModules) {
  const controller = read(`src/app/module/${folder}/${folder}.controller.ts`)
  const route = read(`src/app/module/${folder}/${folder}.route.ts`)
  const validator = read(`src/app/module/${folder}/${folder}.validation.ts`)
  const serializer = read(`src/app/module/${folder}/${folder}.serializer.ts`)

  assert(controller.includes(`${symbol}.find({ organizationId, status: true })`), `${folder} public query must require status=true`)
  assert(controller.includes('.select('), `${folder} public query must use an explicit field projection`)
  assert(controller.includes(`serializePublic${symbol}`), `${folder} public response must use its public serializer`)
  assert(controller.includes('TenantAccessService.assertPublicWebsiteAccess'), `${folder} public endpoint must enforce tenant public access`)
  assert(!serializer.includes('organizationId'), `${folder} public serializer must not expose organizationId`)
  assert(validator.includes('.strict()'), `${folder} write contract must reject unknown fields`)
  assert(route.includes(`validateRequest(${symbol}Validation.create)`), `${folder} create route must validate input`)
  assert(route.includes(`validateRequest(${symbol}Validation.update)`), `${folder} update route must validate input`)
  assert(route.includes(`validateRequest(${symbol}Validation.remove)`), `${folder} delete route must validate params`)
}

const bannerSerializer = read('src/app/module/banner/banner.serializer.ts')
const sectionSerializer = read('src/app/module/section/section.serializer.ts')
const landingSerializer = read('src/app/module/landingPage/landingPage.serializer.ts')
assert(bannerSerializer.includes('sanitizePublicUrl'), 'banner serializer must sanitize legacy stored URLs')
assert(sectionSerializer.includes('sanitizeStructuredPublicContent'), 'section serializer must sanitize legacy stored structured content')
assert(landingSerializer.includes('sanitizeRichText'), 'landing page serializer must sanitize legacy stored HTML')

const config = read('src/config/index.ts')
for (const name of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'OTP_PEPPER', 'CRON_SIGNING_SECRET', 'DATA_ENCRYPTION_KEY', 'NEXT_REVALIDATE_SECRET']) {
  assert(config.includes(`requireProductionSecret(process.env, '${name}'`), `${name} must be validated as a production secret`)
}
assert(config.includes('assertDistinctProductionSecrets(securitySecrets)'), 'production secrets must be unique')
assert(config.includes("!isProduction ? process.env.JWT_SECRET?.trim() || '' : ''"), 'NEXT_REVALIDATE_SECRET fallback must be development-only')

const deploymentGuide = read('DEPLOYMENT_GUIDE.md')
for (const forbidden of ['real_estate_saas_jwt_secret_key_', 'real_estate_saas_refresh_secret_key_', 'real_estate_saas_otp_pepper_', 'secret_key_2026']) {
  assert(!deploymentGuide.toLowerCase().includes(forbidden.toLowerCase()), `deployment guide still contains predictable secret example: ${forbidden}`)
}

const packageJson = JSON.parse(read('package.json'))
assert(packageJson.packageManager === 'pnpm@10.27.0', 'packageManager must pin pnpm@10.27.0')
assert(packageJson.engines?.node === '>=22.16.0 <23', 'Node engine must remain pinned to supported Node 22 range')
assert(read('.node-version').trim() === '22.16.0', '.node-version must pin Node 22.16.0')
assert(!fs.existsSync(path.join(root, 'package-lock.json')), 'backend must not contain package-lock.json')
assert(fs.existsSync(path.join(root, 'pnpm-lock.yaml')), 'backend must contain pnpm-lock.yaml')

const routeModules = ['finance', 'customerFinance', 'property', 'supplierManagement', 'materialInventory', 'crm']
const allowedUploadContracts = new Map([
  ['property', new Set(["/import/preview", "/assets/upload"])],
])

const extractRouteCalls = (source) => {
  const result = []
  const regex = /router\.(post|put|patch|delete)\s*\(/g
  let match
  while ((match = regex.exec(source))) {
    const start = match.index
    let pos = regex.lastIndex
    let depth = 1
    let quote = null
    let escaped = false
    while (pos < source.length && depth > 0) {
      const char = source[pos]
      if (quote) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === quote) quote = null
      } else if (char === "'" || char === '"' || char === '`') quote = char
      else if (char === '(') depth += 1
      else if (char === ')') depth -= 1
      pos += 1
    }
    result.push(source.slice(start, pos))
    regex.lastIndex = pos
  }
  return result
}

for (const moduleName of routeModules) {
  const routeDir = path.join(root, 'src/app/module', moduleName)
  const routes = fs.readdirSync(routeDir).filter((name) => name.endsWith('.route.ts'))
  for (const routeName of routes) {
    const source = read(`src/app/module/${moduleName}/${routeName}`)
    for (const call of extractRouteCalls(source)) {
      if (call.includes('validateRequest(')) continue
      const pathMatch = call.match(/router\.(?:post|put|patch|delete)\(\s*['"]([^'"]+)['"]/)
      const routePath = pathMatch?.[1] || '<dynamic>'
      const allowed = allowedUploadContracts.get(moduleName)?.has(routePath)
      const hasUploadContract = /propertyImportUpload|propertyImageUpload/.test(call)
      assert(Boolean(allowed && hasUploadContract), `${moduleName} write ${routePath} is missing validateRequest or an approved upload contract`)
    }
  }
}

for (const relative of [
  'src/app/module/customerFinance/customerFinance.service.ts',
  'src/app/module/property/propertyOwnership.service.ts',
  'src/app/module/finance/financeAccounting.service.ts',
  'src/app/module/finance/financeCapital.service.ts',
  'src/app/module/finance/financeCategoryMapping.service.ts',
  'src/app/module/finance/financeInitialization.service.ts',
  'src/app/module/finance/financeOperations.service.ts',
  'src/app/module/finance/financeReporting.service.ts',
]) {
  const source = read(relative)
  assert(/tenantRefPopulate|tenantRefPopulates|userRefPopulate/.test(source), `${relative} must scope populated tenant references`)
}

if (!process.exitCode) console.log('Phase 3 security hardening verification passed.')
