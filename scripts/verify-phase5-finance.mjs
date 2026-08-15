import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFile(path.join(root, file), 'utf8')
const [service, route, controller, model, dockerfile, pdf] = await Promise.all([
  read('src/app/module/finance/finance.service.ts'),
  read('src/app/module/finance/finance.route.ts'),
  read('src/app/module/finance/finance.controller.ts'),
  read('src/app/module/finance/finance.model.ts'),
  read('Dockerfile'),
  read('src/app/module/finance/invoicePdf.service.ts'),
])

const checks = [
  ['paid invoice immutability guard', service.includes('Paid financial records are immutable')],
  ['transactional invoice payment', service.includes('financeCommercialTransaction(async (session)') && service.includes("sourceType: 'invoice_payment'")],
  ['payment audit in transaction', service.includes("'finance.invoice.payment_recorded'") && service.includes('invoiceAudit(')],
  ['void endpoint', route.includes("'/invoices/:id/void'") && controller.includes('voidInvoice')],
  ['draft archive endpoint', route.includes("router.delete('/invoices/:id'") && service.includes('Only unpaid draft invoices can be archived')],
  ['pdf endpoint', route.includes("'/invoices/:id/pdf'") && controller.includes("'application/pdf'")],
  ['pdf contains payment history', pdf.includes('Payment history') && pdf.includes('invoice.payments')],
  ['headless chromium installed', dockerfile.includes('chromium') && dockerfile.includes('font-noto-bengali')],
  ['soft archive fields', model.includes('archivedAt') && model.includes('archiveReason')],
]

const failed = checks.filter(([, ok]) => !ok)
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
if (failed.length) process.exit(1)
