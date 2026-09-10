import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const moduleRoot = path.join(root, 'src/app/module')
const baselinePath = path.join(root, 'ops/security/privileged-route-baseline.json')
const methods = ['get', 'post', 'put', 'patch', 'delete']

const files = []
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.route.ts')) files.push(full)
  }
}
walk(moduleRoot)

const findCallEnd = (source, openIndex) => {
  let depth = 0
  let quote = ''
  let lineComment = false
  let blockComment = false
  let escaped = false
  for (let i = openIndex; i < source.length; i += 1) {
    const c = source[i]
    const n = source[i + 1]
    if (lineComment) { if (c === '\n') lineComment = false; continue }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i += 1 }; continue }
    if (quote) {
      if (escaped) { escaped = false; continue }
      if (c === '\\') { escaped = true; continue }
      if (c === quote) quote = ''
      continue
    }
    if (c === '/' && n === '/') { lineComment = true; i += 1; continue }
    if (c === '/' && n === '*') { blockComment = true; i += 1; continue }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === '(') depth += 1
    else if (c === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

const inventory = []
for (const file of files.sort()) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(root, file).replace(/\\/g, '/')
  const globalGuard = /router\.use\([\s\S]{0,240}authMiddlewares\.(?:auth\(|requirePermission\(|requireAnyPermission\(|requireEntitlement\()/.test(source)
  const globalSuperAdmin = /router\.use\([\s\S]{0,240}authMiddlewares\.authSuperAdmin/.test(source)
  const routePattern = new RegExp(`router\\.(${methods.join('|')})\\s*\\(`, 'g')
  let match
  while ((match = routePattern.exec(source))) {
    const open = source.indexOf('(', match.index)
    const end = findCallEnd(source, open)
    if (end < 0) throw new Error(`Unclosed route declaration in ${relative}`)
    const call = source.slice(match.index, end + 1)
    const inside = source.slice(open + 1, end)
    const pathMatch = inside.match(/^\s*(['"])(.*?)\1/)
    if (!pathMatch) { routePattern.lastIndex = end + 1; continue }
    const routePath = pathMatch[2]
    const localSuperAdmin = call.includes('authMiddlewares.authSuperAdmin')
    const localPermission = call.includes('authMiddlewares.requirePermission(') || call.includes('authMiddlewares.requireAnyPermission(')
    const localRole = call.includes('authMiddlewares.auth(')
    const localEntitlement = call.includes('authMiddlewares.requireEntitlement(')
    const guarded = localSuperAdmin || localPermission || localRole || localEntitlement || globalGuard || globalSuperAdmin
    if (guarded) {
      inventory.push({
        key: `${relative}:${match[1].toUpperCase()}:${routePath}`,
        file: relative,
        method: match[1].toUpperCase(),
        path: routePath,
        guard: localSuperAdmin || globalSuperAdmin ? 'super-admin' : localPermission ? 'permission' : localEntitlement ? 'entitlement' : 'authenticated',
        requiredScenarios: ['unauthenticated', 'authenticated-unauthorized', 'wrong-tenant', 'authorized'],
      })
    }
    routePattern.lastIndex = end + 1
  }
}

if (process.argv.includes('--write-baseline')) {
  fs.writeFileSync(baselinePath, JSON.stringify({ version: 1, generatedFrom: 'central-auth-route-inventory', routes: inventory }, null, 2) + '\n')
  console.log(`Wrote ${inventory.length} privileged routes to ${path.relative(root, baselinePath)}`)
  process.exit(0)
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const currentByKey = new Map(inventory.map((item) => [item.key, item]))
const baselineByKey = new Map((baseline.routes || []).map((item) => [item.key, item]))
const missing = [...baselineByKey.keys()].filter((key) => !currentByKey.has(key))
const added = [...currentByKey.keys()].filter((key) => !baselineByKey.has(key))
const weaker = [...baselineByKey.entries()].filter(([key, old]) => currentByKey.has(key) && old.guard === 'super-admin' && currentByKey.get(key).guard !== 'super-admin').map(([key]) => key)
const invalidScenarios = (baseline.routes || []).filter((item) => !Array.isArray(item.requiredScenarios) || item.requiredScenarios.join('|') !== 'unauthenticated|authenticated-unauthorized|wrong-tenant|authorized').map((item) => item.key)
if (missing.length || added.length || weaker.length || invalidScenarios.length) {
  if (missing.length) console.error('Privileged routes removed from/unguarded versus baseline:\n' + missing.map((x) => ` - ${x}`).join('\n'))
  if (added.length) console.error('New privileged routes require explicit baseline review:\n' + added.map((x) => ` - ${x}`).join('\n'))
  if (weaker.length) console.error('Super-admin route guard weakened:\n' + weaker.map((x) => ` - ${x}`).join('\n'))
  if (invalidScenarios.length) console.error('Baseline routes missing the four required authorization scenarios:\n' + invalidScenarios.map((x) => ` - ${x}`).join('\n'))
  process.exit(1)
}
if (inventory.length < 200) throw new Error(`Privileged route inventory unexpectedly small (${inventory.length})`)
console.log(`Privileged-route audit passed for ${inventory.length} guarded route definitions.`)
