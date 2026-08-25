import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('Phase 5 final production hardening contract', () => {
  it('emits the requested structured events without logging CAPI secrets or payment values', () => {
    const events = read('src/shared/productionEvents.ts')
    const finance = read('src/app/module/finance/finance.service.ts')
    const meta = read('src/app/module/metaIntegration/metaIntegration.service.ts')
    const requested = [
      'invoice_created', 'invoice_property_linked', 'invoice_calculation_rejected', 'invoice_payment_recorded',
      'form_validation_failed', 'website_submission_received', 'website_submission_moved_to_crm',
      'website_submission_crm_merged', 'website_submission_crm_failed', 'meta_pixel_configured',
      'meta_capi_configured', 'meta_capi_failed', 'website_template_changed', 'website_template_render_failed',
    ]
    for (const event of requested) expect(events).toContain(`'${event}'`)
    expect(finance).toContain("emitProductionEvent('invoice_payment_recorded', { organizationId, invoiceId: id })")
    expect(meta).not.toMatch(/emitProductionEvent\([^\n]+(?:rawToken|accessTokenEncrypted|decryptField)/i)
  })

  it('keeps Website Submission conversion idempotent and routed through LeadService', () => {
    const source = read('src/app/module/websiteSubmission/websiteSubmission.service.ts')
    expect(source).toContain('LeadService.createLeadWithOutcome')
    expect(source).toContain("crmTransferStatus: 'PROCESSING'")
    expect(source).toContain('CRM_TRANSFER_STALE_AFTER_MS')
    expect(source).toContain("currentTransferStatus === 'COMPLETED'")
  })

  it('keeps Meta browser/CAPI independence and canonical public URL resolution', () => {
    const source = read('src/app/module/metaIntegration/metaIntegration.service.ts')
    expect(source).toContain('pixelEnabled')
    expect(source).toContain('capiEnabled')
    expect(source).toContain('resolveCanonicalMetaPublicUrl')
    expect(source).toContain('eventId')
  })

  it('ships an idempotent dry-run-first final migration and property-reporting index', () => {
    const migration = read('src/app/db/migratePhase5FinalHardening.ts')
    const model = read('src/app/module/finance/finance.model.ts')
    expect(migration).toContain('DRY-RUN')
    expect(migration).toContain('--apply')
    expect(migration).toContain('invalidTemplateRows')
    expect(model).toContain('organizationId: 1, propertyId: 1, createdAt: -1')
  })
})
