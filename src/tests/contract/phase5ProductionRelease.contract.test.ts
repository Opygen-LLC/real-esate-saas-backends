import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 5 production release contracts', () => {
  it('keeps reconciliation additive, dry-run first, and explicitly refuses blind request replay', () => {
    const source = read('src/app/db/reconcilePhase5FalseFailures.ts')
    expect(source).toContain('PHASE5-FALSE-FAILURE-REPAIR')
    expect(source).toContain('No records changed')
    expect(source).toContain('replaysRequests: false')
    expect(source).toContain('mutatesExistingViewing: false')
    expect(source).toContain('mutatesExistingLead: false')
    expect(source).toContain('mutatesSubscription: false')
    expect(source).toContain('publishesExternalSideEffects: false')
    expect(source).toContain('additiveRepairsOnly: true')
    expect(source).toContain('Audit row exists, so the old false-500 request may already have committed')
  })

  it('monitors every Phase 5 release blocker with dedicated low-cardinality counters', () => {
    expect(read('src/app/module/crm/crmListReadModel.service.ts')).toContain('crm_read_model_fallback_total')
    expect(read('src/app/module/viewing/viewing.service.ts')).toContain('viewing_update_internal_failures_total')
    expect(read('src/app/module/domainEvent/domainEvent.service.ts')).toContain('domain_event_failures_total')
    expect(read('src/app/module/realtime/nextRevalidation.service.ts')).toContain('next_revalidation_failures_total')
    expect(read('src/app/module/entitlement/entitlement.service.ts')).toContain('team_quota_transaction_failures_total')
  })

  it('uses separate count and bounded hydration queries instead of lookup-inside-facet', () => {
    const source = read('src/app/module/crm/crmListReadModel.service.ts')
    const leadStart = source.indexOf('export const readLeadListPage')
    const leadEnd = source.indexOf('export const readContactListPage', leadStart)
    const leadSection = source.slice(leadStart, leadEnd)
    expect(leadSection).not.toContain('$facet')
    expect(leadSection).toContain('Promise.all')
    expect(leadSection).toContain('Lead.countDocuments')
    expect(leadSection).toContain('Lead.aggregate(rowPipeline)')
  })

  it('ships staging smoke and post-deploy watch gates for zero-new-failure rollout', () => {
    const smoke = read('scripts/phase5-staging-smoke.mjs')
    const watch = read('scripts/phase5-production-watch.mjs')
    for (const metric of [
      'http_requests_total',
      'crm_read_model_fallback_total',
      'viewing_update_internal_failures_total',
      'domain_event_failures_total',
      'next_revalidation_failures_total',
      'team_quota_transaction_failures_total',
    ]) {
      expect(smoke).toContain(metric)
      expect(watch).toContain(metric)
    }
    expect(smoke).toContain('/api/v1/lead?page=1&limit=5&scope=team')
    expect(smoke).toContain('/api/v1/website-submissions?page=1&limit=5')
    expect(smoke).toContain('/api/v1/viewing?page=1&limit=5')
    expect(smoke).toContain('/api/revalidate')
    expect(smoke).toContain('/favicon.ico')
  })
})
