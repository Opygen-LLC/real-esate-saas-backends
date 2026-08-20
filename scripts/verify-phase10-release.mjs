import fs from 'node:fs'

const requiredFiles = [
  'src/tests/contract/phase10ProductionRelease.contract.test.ts',
  'src/tests/contract/phase10FinalAcceptance.contract.test.ts',
  'src/tests/integration/teamQuota.integration.test.ts',
  'src/tests/integration/crmPhase14.integration.test.ts',
  'src/tests/integration/websiteSubmissions.integration.test.ts',
  'src/tests/integration/tenantIsolation.integration.test.ts',
  'src/tests/integration/phase10FinalAcceptance.integration.test.ts',
  'src/tests/integration/propertyImportExport.integration.test.ts',
  'src/tests/integration/propertyDraftAssetLifecycle.integration.test.ts',
  'src/tests/integration/phase8AuthSessionManagement.integration.test.ts',
  'src/tests/integration/domainLifecycle.integration.test.ts',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
]

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Phase 10 release gate is missing ${file}`)
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
for (const script of ['typecheck', 'typecheck:test', 'test:phase10', 'test:integration', 'build', 'verify:phase10', 'verify:release']) {
  if (!pkg.scripts?.[script]) throw new Error(`package.json is missing required release script: ${script}`)
}

const releaseScript = pkg.scripts['verify:release']
for (const command of ['pnpm typecheck', 'pnpm typecheck:test', 'pnpm build', 'pnpm test:phase10', 'pnpm test:integration', 'pnpm test:migrations']) {
  if (!releaseScript.includes(command)) throw new Error(`verify:release must execute ${command}`)
}

const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
for (const command of ['pnpm typecheck', 'pnpm build', 'pnpm test:phase10', 'pnpm test:integration']) {
  if (!ci.includes(command)) throw new Error(`Backend CI must execute ${command}`)
}
if (!ci.includes('docker-compose.ci.yml')) throw new Error('Backend CI must boot the disposable replica-set integration stack')

const release = fs.readFileSync('.github/workflows/release.yml', 'utf8')
if (!release.includes('Verify this commit passed Backend CI')) throw new Error('Production promotion must require a successful Backend CI run')
if (!release.includes('environment: production')) throw new Error('Production promotion must use the protected production environment')

console.log('Phase 10 backend production release gate is configured.')
