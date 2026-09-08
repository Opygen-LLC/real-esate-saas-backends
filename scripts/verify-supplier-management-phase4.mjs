import fs from 'node:fs'

const required = [
  'src/app/module/supplierManagement/materialPurchase.model.ts',
  'src/app/module/supplierManagement/materialPurchaseReceipt.model.ts',
  'src/app/module/supplierManagement/supplierInvoiceAsset.model.ts',
  'src/app/module/supplierManagement/supplierManagement.service.ts',
  'src/app/module/supplierManagement/supplierManagement.route.ts',
  'src/app/module/supplierManagement/supplierInvoiceAttachment.service.ts',
]
for (const file of required) if (!fs.existsSync(file)) throw new Error(`Missing Phase 4 file: ${file}`)

const route = fs.readFileSync('src/app/module/supplierManagement/supplierManagement.route.ts', 'utf8')
if (!route.includes("requireEntitlement('SUPPLIER_MANAGEMENT')")) throw new Error('Supplier entitlement enforcement is missing')
for (const permission of ['suppliers.read', 'suppliers.write', 'suppliers.payments']) if (!route.includes(`requirePermission('${permission}')`)) throw new Error(`Supplier permission missing: ${permission}`)

const service = fs.readFileSync('src/app/module/supplierManagement/supplierManagement.service.ts', 'utf8')
if (!service.includes('recordPurchaseReceiptInSession')) throw new Error('Receiving is not connected to the stock ledger')
if (!service.includes("sourceType: 'material_purchase_payment'")) throw new Error('Supplier payments are not Finance-linked')
if (!service.includes('Payment cannot exceed the outstanding purchase amount')) throw new Error('Supplier overpayment guard is missing')
if (!service.includes("purchase.status = 'Cancelled'")) throw new Error('Purchase cancellation lifecycle is missing')

const finance = fs.readFileSync('src/app/module/finance/finance.model.ts', 'utf8')
if (!finance.includes('material_purchase_payment')) throw new Error('Finance source contract is missing material purchase payments')
if (!finance.includes('isSupplier')) throw new Error('FinanceVendor supplier extension is missing')

const stock = fs.readFileSync('src/app/module/materialInventory/materialInventory.service.ts', 'utf8')
if (!stock.includes("sourceType: 'MATERIAL_PURCHASE_RECEIPT'")) throw new Error('Stock movements do not identify supplier receipts')

const attachment = fs.readFileSync('src/app/module/supplierManagement/supplierInvoiceAttachment.service.ts', 'utf8')
if (!attachment.includes('scanStoredObject')) throw new Error('Invoice attachment malware scanning is missing')
if (!attachment.includes("status: 'pending'") || !attachment.includes('findOneAndUpdate')) throw new Error('Invoice completion concurrency/idempotency guard is missing')
if (!attachment.includes("purchase.status === 'Cancelled'")) throw new Error('Cancelled purchases can still accept invoice uploads')

console.log('Phase 4 supplier management source verification passed')
