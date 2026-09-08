import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')
const requireFile = (file) => { if (!fs.existsSync(file)) throw new Error(`Missing Phase 5 file: ${file}`) }

for (const file of [
  'src/app/module/user/accessControl.ts',
  'src/app/module/customerFinance/customerFinance.route.ts',
  'src/app/module/materialInventory/materialInventory.route.ts',
  'src/app/module/supplierManagement/supplierManagement.route.ts',
  'src/app/module/operationsQueue/premiumOperationsReminder.service.ts',
  'src/app/db/migratePremiumOperationsSecurityPhase5.ts',
]) requireFile(file)

const access = read('src/app/module/user/accessControl.ts')
for (const permission of ['customerFinance.read', 'customerFinance.manage', 'customerPayments.manage', 'materials.read', 'materials.manage', 'inventory.adjust', 'suppliers.read', 'suppliers.manage', 'supplierPayments.manage']) {
  if (!access.includes(`'${permission}'`)) throw new Error(`Missing explicit Phase 5 permission: ${permission}`)
}
if (!access.includes("selected.has('materials.write')") || !access.includes("selected.has('suppliers.write')")) throw new Error('Legacy custom-role permission compatibility is missing')

const customerRoute = read('src/app/module/customerFinance/customerFinance.route.ts')
if (!customerRoute.includes("requirePermission('customerPayments.manage')")) throw new Error('Customer payment permission enforcement is missing')
if (!customerRoute.includes("payments/:paymentId/void")) throw new Error('Customer payment reversal route is missing')
const financeRoute = read('src/app/module/finance/finance.route.ts')
if (!financeRoute.includes('requireInvoicePaymentPermission')) throw new Error('Generic Finance invoice payment bypass protection is missing')
const financeService = read('src/app/module/finance/finance.service.ts')
if (!financeService.includes("sourceType: 'invoice_payment'") || !financeService.includes('idempotencyKey')) throw new Error('Customer invoice-payment idempotency is missing')
if (!financeService.includes('const voidInvoicePayment = async')) throw new Error('Customer payment reversal lifecycle is missing')
if (!financeService.includes('includeReplayMetadata') || !financeService.includes('if (!replayed)')) throw new Error('Invoice-payment replay side effects are not suppressed')
const financeModel = read('src/app/module/finance/finance.model.ts')
if (!financeModel.includes("enum: ['posted', 'voided']") || !financeModel.includes('voidReason')) throw new Error('Invoice payment reversal state is not persisted in the Mongoose schema')

const materialsRoute = read('src/app/module/materialInventory/materialInventory.route.ts')
for (const permission of ['materials.read', 'materials.manage', 'inventory.adjust']) if (!materialsRoute.includes(`requirePermission('${permission}')`)) throw new Error(`Material permission enforcement missing: ${permission}`)
const materialService = read('src/app/module/materialInventory/materialInventory.service.ts')
if (!materialService.includes("type: 'low_stock_reminder'") || !materialService.includes("type: 'material_requirement_reminder'")) throw new Error('Material reminder scheduling is missing')
if (!materialService.includes('stockQuantity = { $gte:')) throw new Error('Atomic negative-stock protection is missing')

const supplierRoute = read('src/app/module/supplierManagement/supplierManagement.route.ts')
for (const permission of ['suppliers.read', 'suppliers.manage', 'supplierPayments.manage', 'inventory.adjust']) if (!supplierRoute.includes(`requirePermission('${permission}')`)) throw new Error(`Supplier permission enforcement missing: ${permission}`)
const supplierService = read('src/app/module/supplierManagement/supplierManagement.service.ts')
if (!supplierService.includes("type: 'supplier_payment_due'")) throw new Error('Supplier payment due scheduling is missing')
if (!supplierService.includes('recordPurchaseReceiptInSession')) throw new Error('Supplier receiving is not transactionally connected to inventory')
if (!supplierService.includes("sourceType: 'material_purchase_payment'")) throw new Error('Supplier payments are not Finance-linked')
if (!supplierService.includes('paymentMutationVersion') || !supplierService.includes('Serialize supplier-payment mutations')) throw new Error('Concurrent supplier payment serialization is missing')
if (!supplierService.includes('if (!result.replayed) await emit')) throw new Error('Supplier replay side effects are not suppressed')

const booking = read('src/app/module/customerFinance/saleBooking.model.ts')
if (!booking.includes('activePropertyKey') || !booking.includes('unique: true')) throw new Error('Double-booking database uniqueness guard is missing')
const customerService = read('src/app/module/customerFinance/customerFinance.service.ts')
if (!customerService.includes('Property.updateOne') || !customerService.includes('status: { $in: BOOKABLE_PROPERTY_STATUSES }') || !customerService.includes('activePropertyKey')) throw new Error('Transactional property reservation guard is missing')

const stockModel = read('src/app/module/materialInventory/stockMovement.model.ts')
if (!stockModel.includes('idempotencyKey') || !stockModel.includes('unique: true')) throw new Error('Stock idempotency index is missing')
const purchaseReceipt = read('src/app/module/supplierManagement/materialPurchaseReceipt.model.ts')
if (!purchaseReceipt.includes('idempotencyKey') || !purchaseReceipt.includes('unique: true')) throw new Error('Purchase receipt idempotency index is missing')

const reminders = read('src/app/module/operationsQueue/premiumOperationsReminder.service.ts')
for (const type of ['low_stock_reminder', 'material_requirement_reminder', 'supplier_payment_due']) if (!reminders.includes(type)) throw new Error(`Missing premium reminder delivery: ${type}`)
if (!reminders.includes('effectivePermissionsForUser')) throw new Error('Reminder recipient permission filtering is missing')
if (!reminders.includes('entitlements?.[feature]?.enabled')) throw new Error('Reminder entitlement re-check is missing')

const overrides = read('src/app/module/tenantEntitlementOverride/tenantEntitlementOverride.service.ts')
if (!overrides.includes('subscription.tenant_entitlement_override_applied') || !overrides.includes('effectiveBefore') || !overrides.includes('effectiveAfter') || !overrides.includes('expiresAt')) throw new Error('Super Admin entitlement audit evidence is incomplete')

for (const model of ['saleBooking.model.ts', 'installment.model.ts']) {
  if (!read(`src/app/module/customerFinance/${model}`).includes('organizationId')) throw new Error(`${model} is not tenant scoped`)
}
for (const model of ['material.model.ts', 'materialRequirement.model.ts', 'stockMovement.model.ts']) {
  if (!read(`src/app/module/materialInventory/${model}`).includes('organizationId')) throw new Error(`${model} is not tenant scoped`)
}
if (!read('src/app/module/supplierManagement/materialPurchase.model.ts').includes('organizationId')) throw new Error('MaterialPurchase is not tenant scoped')

const migration = read('src/app/db/migratePremiumOperationsSecurityPhase5.ts')
if (!migration.includes('destructiveDataChanges: false')) throw new Error('Phase 5 migration does not explicitly preserve premium data')
for (const reminderBackfill of ['syncRequirementReminder', 'syncLowStockReminder', 'syncSupplierPaymentReminder', 'reminderBackfillCandidates']) {
  if (!migration.includes(reminderBackfill)) throw new Error(`Phase 5 reminder backfill is missing: ${reminderBackfill}`)
}
if (migration.includes('deleteMany(') || migration.includes('dropCollection(')) throw new Error('Phase 5 migration contains destructive data operations')

console.log('Phase 5 premium operations production verification passed')
