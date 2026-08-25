import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name)
  return entry.isDirectory() ? walk(full) : [full]
})

const mongooseCollectionName = (modelName: string) => {
  const value = modelName.toLowerCase()
  if (/[^aeiou]y$/.test(value)) return `${value.slice(0, -1)}ies`
  if (/(?:s|x|z|ch|sh)$/.test(value)) return `${value}es`
  return `${value}s`
}

const extractStringArray = (source: string, exportName: string) => {
  const match = source.match(new RegExp(`export const ${exportName} = \\[([\\s\\S]*?)\\] as const`))
  if (!match) throw new Error(`${exportName} was not found`)
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
}

describe('Phase 2 complete tenant database purge contracts', () => {
  it('registers every current organization-scoped Mongoose model in the central tenant deletion registry', () => {
    const registrySource = read('src/app/module/compliance/tenantDataCollections.ts')
    const registry = new Set(extractStringArray(registrySource, 'TENANT_DELETION_COLLECTIONS'))
    const modelRoot = path.join(root, 'src/app/module')
    const modelFiles = walk(modelRoot).filter((file) => file.endsWith('.model.ts'))

    const discovered = new Set<string>()
    for (const file of modelFiles) {
      const source = fs.readFileSync(file, 'utf8')
      if (!source.includes('organizationId')) continue

      const explicitCollections = [...source.matchAll(/collection\s*:\s*['"]([^'"]+)['"]/g)].map((item) => item[1])
      const models = [...source.matchAll(/model(?:<[^>]+>)?\(\s*['"]([^'"]+)['"]/g)].map((item) => item[1])
      for (const modelName of models) {
        if (modelName === 'Organization') continue // root is deliberately deleted last
        if (explicitCollections.length === 1 && models.length === 1) discovered.add(explicitCollections[0])
        else discovered.add(mongooseCollectionName(modelName))
      }
    }

    const missing = [...discovered].filter((name) => !registry.has(name)).sort()
    expect(missing).toEqual([])
    expect(registry.has('agencyownerprofiles')).toBe(true)
    expect(registry.has('agentprofiles')).toBe(true)
    expect(registry.has('auditevents')).toBe(true)
    expect(registry.has('datasubjectrequests')).toBe(true)
  })

  it('centralizes user-linked credential/profile/session cleanup and excludes Super Admin profile data', () => {
    const registrySource = read('src/app/module/compliance/tenantDataCollections.ts')
    const userLinked = new Set(extractStringArray(registrySource, 'USER_LINKED_DELETION_COLLECTIONS'))

    expect(userLinked).toEqual(new Set([
      'accountcredentials',
      'userprofiles',
      'agencyownerprofiles',
      'agentprofiles',
      'authsessions',
      'otpchallenges',
    ]))
    expect(userLinked.has('superadminprofiles')).toBe(false)
  })

  it('protects platform/global collections from every tenant deletion registry', () => {
    const registrySource = read('src/app/module/compliance/tenantDataCollections.ts')
    const tenant = new Set(extractStringArray(registrySource, 'TENANT_DELETION_COLLECTIONS'))
    const userLinked = new Set(extractStringArray(registrySource, 'USER_LINKED_DELETION_COLLECTIONS'))
    const protectedCollections = extractStringArray(registrySource, 'PROTECTED_PLATFORM_COLLECTIONS')

    expect(protectedCollections).toEqual(expect.arrayContaining([
      'superadminprofiles',
      'platformsettings',
      'subscriptionplans',
      'leadaddondefinitions',
      'leadtopuppricings',
    ]))
    for (const collection of protectedCollections) {
      expect(tenant.has(collection)).toBe(false)
      expect(userLinked.has(collection)).toBe(false)
    }
    expect(tenant.has('organizations')).toBe(false)
  })

  it('deletes user-linked records first, users after dependants, and Organization last', () => {
    const purge = read('src/app/module/compliance/tenantPurge.service.ts')
    const executeStart = purge.indexOf('const execute = async')
    const executeEnd = purge.indexOf('if (await mongoSupportsTransactions())', executeStart)
    const executeBlock = purge.slice(executeStart, executeEnd)

    const userLinked = executeBlock.indexOf('deleteUserLinkedDocuments')
    const tenantScoped = executeBlock.indexOf('deleteTenantScopedDocuments')
    const users = executeBlock.indexOf('deleteTenantUsers')
    const organization = executeBlock.indexOf('deleteOrganizationRoot')

    expect(userLinked).toBeGreaterThan(-1)
    expect(tenantScoped).toBeGreaterThan(userLinked)
    expect(users).toBeGreaterThan(tenantScoped)
    expect(organization).toBeGreaterThan(users)
    expect(purge).toContain('User.deleteMany({ organizationId }')
    expect(purge).toContain('Organization.deleteOne({ organizationId }')
    expect(purge).not.toContain('SuperAdminProfile.deleteMany')
  })

  it('requires zero tenant and user-linked records before returning hard-delete success', () => {
    const purge = read('src/app/module/compliance/tenantPurge.service.ts')
    expect(purge).toContain('getTenantCollectionCounts(organizationId)')
    expect(purge).toContain('getUserLinkedCollectionCounts(userIds, organizationId)')
    expect(purge).toContain('remainingUserLinkedCollections')
    expect(purge).toContain("'TENANT_PURGE_INCOMPLETE'")
    expect(purge).toContain('await verifyPurged(organizationId, userIds)')
  })

  it('rejects platform/system organization ids and any tenant containing a Super Admin account', () => {
    const registrySource = read('src/app/module/compliance/tenantDataCollections.ts')
    const purge = read('src/app/module/compliance/tenantPurge.service.ts')
    const protectedIds = extractStringArray(registrySource, 'PROTECTED_ORGANIZATION_IDS')

    expect(protectedIds).toEqual(expect.arrayContaining(['platform', '__platform__']))
    expect(purge).toContain('Platform/system organizations cannot be permanently deleted')
    expect(purge).toContain("user.userRole === 'super-admin'")
    expect(purge).toContain('Organizations containing a Super Admin account cannot be permanently deleted')
  })
})
