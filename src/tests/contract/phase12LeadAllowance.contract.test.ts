import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 12 concurrency-safe monthly lead allowance contract', () => {
  it('serializes monthly lead reservations per organization', () => {
    const source = read('src/app/module/entitlement/entitlement.service.ts')
    expect(source).toContain('withLeadQuotaGuard')
    expect(source).toContain('leadQuotaRevision')
    expect(source).toContain('reserveLeadAllowance')
    expect(source).toContain('usedLeadAllowance')
    expect(source).toContain('LEAD_ALLOWANCE_EXHAUSTED')
    expect(source).toContain('cleanupStaleLeadAllowanceReservations')
  })

  it('makes new Lead creation consume the same reservation service', () => {
    const source = read('src/app/module/lead/lead.service.ts')
    expect(source).toContain('reserveLeadAllowance')
    expect(source).toContain('consumeLeadAllowanceReservation')
    expect(source).toContain('releaseLeadAllowanceReservation')
    expect(source).toContain('leadAllowanceReservationId')
    expect(source).not.toContain("assertLimit(organizationId,'leads')")
  })

  it('reserves bulk import capacity once and supports partial grants', () => {
    const source = read('src/app/module/lead/leadImport.service.ts')
    expect(source).toContain("allowPartial: true, source: 'bulk_import'")
    expect(source).toContain('allowance.grantedUnits')
    expect(source).toContain("type: 'quota'")
    expect(source).toContain('quotaExceeded')
  })

  it('routes public website and viewing-created Leads through LeadService', () => {
    const leadSource = read('src/app/module/lead/lead.service.ts')
    const viewingSource = read('src/app/module/viewing/viewing.service.ts')
    expect(leadSource).toContain("allowanceSource:'website'")
    expect(viewingSource).toContain("allowanceSource:'website'")
  })

  it('does not create Leads directly outside the canonical Lead service in runtime modules', () => {
    const moduleRoot = path.join(root, 'src/app/module')
    const offenders: string[] = []
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name)
        if (entry.isDirectory()) walk(absolute)
        else if (entry.name.endsWith('.ts') && !absolute.endsWith(path.join('lead', 'lead.service.ts'))) {
          const source = fs.readFileSync(absolute, 'utf8')
          if (/\bLead\.(create|insertMany)\s*\(/.test(source)) offenders.push(path.relative(root, absolute))
        }
      }
    }
    walk(moduleRoot)
    expect(offenders).toEqual([])
  })
})
