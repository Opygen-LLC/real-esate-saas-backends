import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('invoice PDF branding contract', () => {
  it('keeps invoice branding owner-only on the backend', () => {
    const route = read('src/app/module/organization/organization.route.ts')
    expect(route).toMatch(/'\/invoice-branding',[\s\S]*authMiddlewares\.auth\('agency_owner'\)/)
  })

  it('accepts only agency-owned stored invoice logo references', () => {
    const service = read('src/app/module/organization/organization.service.ts')
    expect(service).toMatch(/ObjectStorageService\.keyFromReference\(safeInvoiceLogo\)/)
    expect(service).toMatch(/key\.startsWith\(`tenants\/\$\{organizationId\}\//)
    expect(service).toMatch(/ObjectStorageService\.head\(key\)/)
  })

  it('embeds the logo as data in the invoice PDF and keeps the agency name fallback', () => {
    const pdf = read('src/app/module/finance/invoicePdf.service.ts')
    expect(pdf).toMatch(/organization\?\.invoiceLogo \|\| organization\?\.logo/)
    expect(pdf).toMatch(/data:image\/png;base64/)
    expect(pdf).toMatch(/img-src data:/)
    expect(pdf).toMatch(/Agency logo/)
  })
})
