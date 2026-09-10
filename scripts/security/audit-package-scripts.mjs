import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.optionalDependencies || {}) }
const lifecycleNames = new Set(['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepack', 'postpack'])
const allowedRootLifecycle = new Map([['preinstall', 'node scripts/require-pnpm.mjs']])

for (const [name, command] of Object.entries(pkg.scripts || {})) {
  if (!lifecycleNames.has(name)) continue
  if (allowedRootLifecycle.get(name) !== command) {
    throw new Error(`Unexpected root lifecycle script ${name}: ${command}`)
  }
}

for (const [name, spec] of Object.entries(dependencies)) {
  const value = String(spec)
  if (/^(?:git(?:\+[^:]+)?:|https?:|file:|link:|github:|gitlab:|bitbucket:)/i.test(value)) {
    throw new Error(`Dependency ${name} uses a non-registry source (${value})`)
  }
}

if (pkg.packageManager !== 'pnpm@10.27.0') throw new Error('packageManager must remain pinned to pnpm@10.27.0')
if (!pkg.engines || pkg.engines.node !== '>=22.16.0 <23' || pkg.engines.pnpm !== '10.27.0') {
  throw new Error('Node and pnpm engines must remain production-pinned')
}

const allowedBuilds = new Set(pkg.pnpm?.onlyBuiltDependencies || [])
for (const name of allowedBuilds) {
  if (!dependencies[name]) throw new Error(`pnpm.onlyBuiltDependencies contains undeclared package ${name}`)
}
if (!allowedBuilds.has('sharp')) throw new Error('Only trusted native install scripts should be explicitly allowed; sharp is required')

console.log(`Package lifecycle audit passed (${Object.keys(dependencies).length} declared dependencies; ${allowedBuilds.size} allowed dependency build script).`)
