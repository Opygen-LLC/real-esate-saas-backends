import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DomainService } from '../../app/module/domain/domain.service'

const walk = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const absolute = path.join(directory, entry.name)
  return entry.isDirectory() ? walk(absolute) : [absolute]
})

describe('release source-security invariants', () => {
  it('normalizes domains without accepting protocols, paths, ports, or wildcard hosts', () => {
    expect(DomainService.normalizeDomain('WWW.Example.COM.')).toBe('example.com')
    expect(() => DomainService.normalizeDomain('https://example.com/path')).toThrow()
    expect(() => DomainService.normalizeDomain('example.com:443')).toThrow()
    expect(() => DomainService.normalizeDomain('*.example.com')).toThrow()
  })

  it('does not bypass the resilient outbound HTTP wrapper from application source', () => {
    const appRoot = path.resolve(process.cwd(), 'src/app')
    const offenders = walk(appRoot)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('resilience.ts'))
      .filter((file) => /(?<!\.)\bfetch\s*\(/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(process.cwd(), file))
    expect(offenders).toEqual([])
  })

  it('keeps measured billing indexes aligned with the real ledger status field', () => {
    const migration = fs.readFileSync(path.resolve(process.cwd(), 'src/app/db/migratePhase6.ts'), 'utf8')
    expect(migration).toMatch(/billings[^\n]+status/)
    expect(migration).not.toMatch(/paymentStatus/)
    expect(migration).toMatch(/dropIndex\(conflictingName\.name\)/)
  })

  it('does not relabel historical non-BDT payment amounts during catalog migration', () => {
    const migration = fs.readFileSync(path.resolve(process.cwd(), 'src/app/db/migratePlansToBdt.ts'), 'utf8')
    expect(migration).not.toMatch(/billings\.updateMany\(\{ currency:/)
    expect(migration).not.toMatch(/payments\.updateMany\(\{ currency:/)
    expect(migration).not.toMatch(/plan: current, currency: 'BDT'/)
    expect(migration).not.toMatch(/planId: current, currency: 'BDT'/)
  })

  it('keeps database bootstrap non-destructive and free of legacy commercial/demo content', () => {
    const seed = fs.readFileSync(path.resolve(process.cwd(), 'src/app/db/seed.ts'), 'utf8')
    expect(seed).not.toMatch(/deleteMany|dropDatabase|growth|unsplash\.com|\+1 \(/i)
    expect(seed).toMatch(/SubscriptionPlanService\.getAllPlans/)
    expect(seed).toMatch(/ALLOW_PRODUCTION_SEED/)
  })

  it('does not reintroduce mutable request-body tenant fallbacks', () => {
    const appRoot = path.resolve(process.cwd(), 'src/app/module')
    const offenders = walk(appRoot)
      .filter((file) => (file.endsWith('.controller.ts') || file.endsWith('.service.ts')) && !file.includes(`${path.sep}platformAdmin${path.sep}`))
      .filter((file) => /req\.body\.organizationId|body\.organizationId\s*\|\|/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(process.cwd(), file))
    expect(offenders).toEqual([])
  })
})
