import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

const controller = read('src/app/module/billing/billing.controller.ts')
const billingService = read('src/app/module/billing/billing.service.ts')
const paymentService = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
const pdfService = read('src/app/module/billing/subscriptionReceiptPdf.service.ts')
const packageJson = read('package.json')

const combinedReceiptSources = `${controller}\n${billingService}\n${paymentService}\n${pdfService}`

describe('Phase 6 subscription receipt PDF contract', () => {
  it('returns a real PDF attachment and never the legacy printable HTML response', () => {
    expect(controller).toContain("res.setHeader('Content-Type', 'application/pdf')")
    expect(controller).toContain("res.setHeader('Content-Disposition', `attachment; filename=\"${receipt.fileName}\"`)")
    expect(controller).toContain("res.setHeader('X-Content-Type-Options', 'nosniff')")
    expect(combinedReceiptSources).not.toContain('text/html')
    expect(combinedReceiptSources).not.toContain('window.print()')
  })

  it('uses one canonical Opygen Estate PDF generator for current and legacy receipts', () => {
    expect(billingService).toContain('SubscriptionReceiptPdfService.generateSubscriptionReceiptPdf')
    expect(pdfService).toContain("from 'pdf-lib'")
    expect(pdfService).toContain("name: 'OPYGEN ESTATE'")
    expect(pdfService).toContain("productLine: 'A Product of Opygen'")
    expect(pdfService).toContain("return `opygen-estate-${safeReceipt}.pdf`")
    expect(combinedReceiptSources).not.toContain('PropSe Agency OS')
  })

  it('keeps subscription payment receipt lookup tenant scoped and confirmed only', () => {
    expect(paymentService).toMatch(/SubscriptionPayment\.findOne\(\{ organizationId, status: 'confirmed', \$or: clauses \}\)/)
    expect(paymentService).toContain("Organization.findOne({ organizationId }).select('agencyName email')")
  })

  it('packages the PDF dependency and canonical brand asset for production builds', () => {
    expect(packageJson).toContain('"pdf-lib": "^1.17.1"')
    expect(packageJson).toContain('tsc && node scripts/copy-brand-assets.mjs')
    expect(fs.existsSync(path.join(root, 'src/assets/branding/opygen-estate-logo.svg'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'scripts/copy-brand-assets.mjs'))).toBe(true)
  })
})
