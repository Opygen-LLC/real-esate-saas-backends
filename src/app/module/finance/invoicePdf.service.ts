import { spawn } from 'child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import sharp from 'sharp'
import ApiError from '../../../errors/ApiError'
import { ObjectStorageService } from '../websiteBuilder/objectStorage.service'

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

const multiline = (value: unknown) => escapeHtml(value).replace(/\r?\n/g, '<br />')
const amount = (value: unknown) => `BDT ${Number(value || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const date = (value: unknown) => {
  if (!value) return '—'
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('en-BD', { timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric' }).format(parsed)
}
const safeHex = (value: unknown) => /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value) : '#18181b'

const findChromium = async () => {
  const candidates = [
    process.env.INVOICE_PDF_CHROMIUM_PATH,
    '/usr/local/bin/invoice-chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].filter(Boolean) as string[]
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* try next */ }
  }
  throw new ApiError(503, 'Invoice PDF renderer is not configured')
}

const runChromium = async (executable: string, inputHtml: string, outputPdf: string) => {
  const timeoutMs = Math.max(5_000, Math.min(60_000, Number(process.env.INVOICE_PDF_TIMEOUT_MS || 20_000)))
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [
      '--headless', '--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-extensions', '--disable-background-networking',
      '--disable-sync', '--metrics-recording-only', '--no-first-run', '--safebrowsing-disable-auto-update',
      `--print-to-pdf=${outputPdf}`, '--no-pdf-header-footer', pathToFileURL(inputHtml).href,
    ], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, HOME: os.tmpdir() } })
    let stderr = ''
    child.stderr?.on('data', (chunk) => { if (stderr.length < 8_000) stderr += String(chunk) })
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Invoice PDF renderer timed out')) }, timeoutMs)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`Invoice PDF renderer exited with code ${code}: ${stderr.slice(-1000)}`))
    })
  })
}

const resolveInvoiceLogoDataUri = async (organization: any): Promise<string> => {
  const reference = String(organization?.invoiceLogo || organization?.logo || '').trim()
  if (!reference) return ''
  const key = ObjectStorageService.keyFromReference(reference)
  if (!key || !String(organization?.organizationId || '').trim() || !key.startsWith(`tenants/${organization.organizationId}/`)) return ''

  try {
    const source = await ObjectStorageService.readBuffer(key, 5 * 1024 * 1024)
    const normalized = await sharp(source, { failOn: 'error' })
      .rotate()
      .resize({ width: 320, height: 100, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer()
    return `data:image/png;base64,${normalized.toString('base64')}`
  } catch {
    // A missing/invalid logo should never prevent an otherwise valid invoice
    // from being generated. The agency name remains the deterministic fallback.
    return ''
  }
}

const renderInvoiceHtml = (invoice: any, organization: any, logoDataUri = '') => {
  const outstanding = Math.max(0, Number(invoice.total || 0) - Number(invoice.paidAmount || 0))
  const primary = safeHex(organization?.primaryColor)
  const address = [organization?.address, organization?.city, organization?.state, organization?.country].filter(Boolean).join(', ')
  const lineRows = (invoice.lineItems || []).map((item: any) => `
    <tr>
      <td>${escapeHtml(item.description)}</td>
      <td class="num">${Number(item.quantity || 0).toLocaleString('en-BD')}</td>
      <td class="num">${amount(item.unitPrice)}</td>
      <td class="num strong">${amount(item.amount)}</td>
    </tr>`).join('')
  const paymentRows = (invoice.payments || []).length
    ? invoice.payments.map((payment: any) => `
      <tr>
        <td>${date(payment.paidAt)}</td>
        <td>${escapeHtml(String(payment.paymentMethod || '').replace(/^./, (c) => c.toUpperCase()))}</td>
        <td>${escapeHtml(payment.reference || '—')}</td>
        <td class="num strong">${amount(payment.amount)}</td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="muted center">No payments recorded</td></tr>'
  const cancelled = invoice.status === 'cancelled'
  const property = invoice.propertyId && typeof invoice.propertyId === 'object' ? invoice.propertyId : null
  const propertyAddress = property
    ? [property.address, property.city, property.state].filter(Boolean).join(', ') ||
      [property.bangladeshAddress?.area, property.bangladeshAddress?.upazila, property.bangladeshAddress?.district].filter(Boolean).join(', ')
    : ''
  const propertyListing = property?.listingType === 'ForSale' ? 'For Sale' : property?.listingType === 'ForRent' ? 'For Rent' : property?.listingType === 'ForLease' ? 'For Lease' : property?.listingType || ''
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'self' data:; img-src data:" />
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #18181b; font-family: "Noto Sans Bengali", "Noto Sans", Arial, sans-serif; font-size: 11px; line-height: 1.45; }
  .sheet { position: relative; min-height: 265mm; }
  .watermark { position: fixed; top: 42%; left: 10%; width: 80%; transform: rotate(-24deg); text-align: center; font-size: 68px; font-weight: 800; letter-spacing: 8px; color: rgba(190, 24, 93, .10); z-index: -1; }
  .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid ${primary}; padding-bottom: 18px; }
  .brand-logo { display: block; max-width: 170px; max-height: 54px; object-fit: contain; margin-bottom: 8px; }
  .brand { font-size: 20px; font-weight: 800; color: ${primary}; margin-bottom: 5px; }
  .title { font-size: 26px; font-weight: 800; letter-spacing: -.5px; text-align: right; }
  .status { display: inline-block; margin-top: 5px; border: 1px solid #d4d4d8; border-radius: 999px; padding: 3px 9px; font-size: 9px; text-transform: uppercase; font-weight: 700; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin: 22px 0; }
  .label { color: #71717a; text-transform: uppercase; font-size: 8px; font-weight: 700; letter-spacing: .7px; margin-bottom: 4px; }
  .value { font-size: 11px; font-weight: 600; }
  .muted { color: #71717a; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { background: #f4f4f5; color: #52525b; font-size: 8px; text-transform: uppercase; letter-spacing: .5px; text-align: left; padding: 8px; border-bottom: 1px solid #d4d4d8; }
  td { padding: 8px; border-bottom: 1px solid #e4e4e7; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .strong { font-weight: 700; }
  .totals { width: 47%; margin: 15px 0 0 auto; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .grand { border-top: 2px solid #18181b; margin-top: 5px; padding-top: 8px; font-size: 14px; font-weight: 800; }
  .balance { color: #be123c; }
  .section { margin-top: 24px; page-break-inside: avoid; }
  .section-title { font-size: 12px; font-weight: 800; margin-bottom: 7px; }
  .note { background: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px; padding: 10px 12px; }
  .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e4e4e7; color: #71717a; font-size: 8px; display: flex; justify-content: space-between; }
  .center { text-align: center; }
</style></head><body><div class="sheet">
${cancelled ? '<div class="watermark">VOID</div>' : ''}
<header class="header">
  <div>
    ${logoDataUri ? `<img class="brand-logo" src="${logoDataUri}" alt="Agency logo" />` : ''}
    <div class="brand">${escapeHtml(organization?.agencyName || 'Real Estate Agency')}</div>
    ${address ? `<div class="muted">${escapeHtml(address)}</div>` : ''}
    ${organization?.phone ? `<div class="muted">${escapeHtml(organization.phone)}</div>` : ''}
    ${organization?.email ? `<div class="muted">${escapeHtml(organization.email)}</div>` : ''}
  </div>
  <div>
    <div class="title">INVOICE</div>
    <div class="value">${escapeHtml(invoice.invoiceNumber)}</div>
    <span class="status">${escapeHtml(invoice.status)}</span>
  </div>
</header>
<section class="grid">
  <div>
    <div class="label">Bill to</div>
    <div class="value">${escapeHtml(invoice.clientName)}</div>
    ${invoice.clientPhone ? `<div class="muted">${escapeHtml(invoice.clientPhone)}</div>` : ''}
    ${invoice.clientEmail ? `<div class="muted">${escapeHtml(invoice.clientEmail)}</div>` : ''}
  </div>
  <div>
    <div><span class="label">Issue date</span><div class="value">${date(invoice.issueDate)}</div></div>
    <div style="margin-top:8px"><span class="label">Due date</span><div class="value">${date(invoice.dueDate)}</div></div>
  </div>
</section>
${property ? `<section class="section"><div class="section-title">Property</div><div class="note"><div class="value">${escapeHtml(property.title || 'Linked property')}</div>${propertyAddress ? `<div class="muted">${escapeHtml(propertyAddress)}</div>` : ''}<div class="muted" style="margin-top:4px">Reference: ${escapeHtml(property.slug || String(property._id || '—'))}${propertyListing ? ` · ${escapeHtml(propertyListing)}` : ''}${property.status ? ` · ${escapeHtml(property.status)}` : ''}${Number.isFinite(Number(property.price)) ? ` · ${amount(property.price)}` : ''}</div></div></section>` : ''}
<table>
<thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
<tbody>${lineRows}</tbody>
</table>
<div class="totals">
  <div class="row"><span>Subtotal</span><strong>${amount(invoice.subtotal)}</strong></div>
  <div class="row"><span>Discount</span><strong>${amount(invoice.discount)}</strong></div>
  <div class="row grand"><span>Total</span><span>${amount(invoice.total)}</span></div>
  <div class="row"><span>Paid</span><strong>${amount(invoice.paidAmount)}</strong></div>
  <div class="row balance"><span>Outstanding</span><strong>${amount(outstanding)}</strong></div>
</div>
<section class="section">
  <div class="section-title">Payment history${property ? ` · ${escapeHtml(property.title || property.slug || 'Property')}` : ''}</div>
  <table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="num">Amount</th></tr></thead><tbody>${paymentRows}</tbody></table>
</section>
${invoice.cancelReason ? `<section class="section"><div class="section-title">Void reason</div><div class="note">${multiline(invoice.cancelReason)}</div></section>` : ''}
${invoice.notes ? `<section class="section"><div class="section-title">Notes</div><div class="note">${multiline(invoice.notes)}</div></section>` : ''}
<footer class="footer"><span>Generated from the agency finance ledger.</span><span>${escapeHtml(invoice.invoiceNumber)}</span></footer>
</div></body></html>`
}

export const renderInvoicePdf = async (invoice: any, organization: any): Promise<Buffer> => {
  const executable = await findChromium()
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'invoice-pdf-'))
  const input = path.join(tempDir, 'invoice.html')
  const output = path.join(tempDir, 'invoice.pdf')
  try {
    const logoDataUri = await resolveInvoiceLogoDataUri(organization)
    await writeFile(input, renderInvoiceHtml(invoice, organization, logoDataUri), { encoding: 'utf8', mode: 0o600 })
    await runChromium(executable, input, output)
    const pdf = await readFile(output)
    if (pdf.length < 500 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Invoice renderer returned an invalid PDF')
    return pdf
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(503, `Unable to render invoice PDF: ${error instanceof Error ? error.message : 'renderer failed'}`)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
