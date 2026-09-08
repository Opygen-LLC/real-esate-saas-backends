import mongoose from 'mongoose'
import config from '../../config'
import { UserProfile } from '../module/userProfile/userProfile.model'
import { TeamInvitation } from '../module/teamInvitation/teamInvitation.model'
import { FinanceInvoice } from '../module/finance/finance.model'
import { SaleBooking } from '../module/customerFinance/saleBooking.model'
import { Installment } from '../module/customerFinance/installment.model'
import { Material } from '../module/materialInventory/material.model'
import { MaterialRequirement } from '../module/materialInventory/materialRequirement.model'
import { StockMovement } from '../module/materialInventory/stockMovement.model'
import { MaterialInventoryService } from '../module/materialInventory/materialInventory.service'
import { MaterialPurchase } from '../module/supplierManagement/materialPurchase.model'
import { MaterialPurchaseReceipt } from '../module/supplierManagement/materialPurchaseReceipt.model'
import { SupplierManagementService } from '../module/supplierManagement/supplierManagement.service'
import { OperationsJob } from '../module/operationsQueue/operationsJob.model'
import { Notification } from '../module/notification/notification.model'

const apply = process.argv.includes('--apply')

const migratePermissions = (permissions: string[] = []) => {
  const next = new Set(permissions)
  if (next.has('materials.write')) {
    next.delete('materials.write')
    next.add('materials.manage')
    next.add('inventory.adjust')
    next.add('materials.read')
  }
  if (next.has('suppliers.write')) {
    next.delete('suppliers.write')
    next.add('suppliers.manage')
    next.add('suppliers.read')
  }
  if (next.has('suppliers.payments')) {
    next.delete('suppliers.payments')
    next.add('supplierPayments.manage')
    next.add('suppliers.read')
  }
  return [...next]
}

const changed = (before: string[], after: string[]) => before.length !== after.length || before.some((value, index) => value !== after[index])

async function backfillPremiumReminderSchedules() {
  let materialRequirementsScheduled = 0
  let materialLowStockEvaluated = 0
  let supplierPaymentDueEvaluated = 0

  const requirements = MaterialRequirement.find({ status: { $in: ['Planned', 'Partially Available'] } })
    .select('_id organizationId materialId requiredBy status')
    .lean()
    .cursor()
  for await (const requirement of requirements) {
    await MaterialInventoryService.syncRequirementReminder(String(requirement.organizationId), requirement)
    materialRequirementsScheduled += 1
  }

  const materials = Material.find({ active: true }).select('_id organizationId').lean().cursor()
  for await (const material of materials) {
    await MaterialInventoryService.syncLowStockReminder(String(material.organizationId), String(material._id))
    materialLowStockEvaluated += 1
  }

  const purchases = MaterialPurchase.find({ status: { $ne: 'Cancelled' }, paymentDueDate: { $ne: null } })
    .select('_id organizationId')
    .lean()
    .cursor()
  for await (const purchase of purchases) {
    await SupplierManagementService.syncSupplierPaymentReminder(String(purchase.organizationId), String(purchase._id))
    supplierPaymentDueEvaluated += 1
  }

  return { materialRequirementsScheduled, materialLowStockEvaluated, supplierPaymentDueEvaluated }
}

async function run() {
  if (!config.database_url) throw new Error('DATABASE_URL is required')
  await mongoose.connect(config.database_url)
  try {
    const profileRows: any[] = await UserProfile.find({ 'accessControl.useRoleDefaults': false }).select('_id accessControl.permissions').lean()
    const invitationRows: any[] = await TeamInvitation.find({ 'accessControl.useRoleDefaults': false }).select('_id accessControl.permissions').lean()
    const profileChanges = profileRows.map((row) => ({ row, before: row.accessControl?.permissions || [], after: migratePermissions(row.accessControl?.permissions || []) })).filter(({ before, after }) => changed(before, after))
    const invitationChanges = invitationRows.map((row) => ({ row, before: row.accessControl?.permissions || [], after: migratePermissions(row.accessControl?.permissions || []) })).filter(({ before, after }) => changed(before, after))
    const missingPaymentStatus = await FinanceInvoice.countDocuments({ payments: { $elemMatch: { status: { $exists: false } } } })
    const [openRequirementCount, activeMaterialCount, supplierPaymentDueCount] = await Promise.all([
      MaterialRequirement.countDocuments({ status: { $in: ['Planned', 'Partially Available'] } }),
      Material.countDocuments({ active: true }),
      MaterialPurchase.countDocuments({ status: { $ne: 'Cancelled' }, paymentDueDate: { $ne: null } }),
    ])

    const models = [SaleBooking, Installment, Material, MaterialRequirement, StockMovement, MaterialPurchase, MaterialPurchaseReceipt, OperationsJob, Notification]
    const collections: Array<Record<string, unknown>> = []
    for (const model of models) {
      const exists = await mongoose.connection.db?.listCollections({ name: model.collection.name }).hasNext()
      collections.push({ model: model.modelName, collection: model.collection.name, exists: Boolean(exists) })
      if (apply) {
        if (!exists) await model.createCollection()
        await model.createIndexes()
      }
    }

    let reminderBackfill = {
      materialRequirementsScheduled: 0,
      materialLowStockEvaluated: 0,
      supplierPaymentDueEvaluated: 0,
    }

    if (apply) {
      for (const item of profileChanges) await UserProfile.updateOne({ _id: item.row._id }, { $set: { 'accessControl.permissions': item.after } })
      for (const item of invitationChanges) await TeamInvitation.updateOne({ _id: item.row._id }, { $set: { 'accessControl.permissions': item.after } })
      if (missingPaymentStatus) {
        await FinanceInvoice.updateMany(
          { payments: { $elemMatch: { status: { $exists: false } } } },
          { $set: { 'payments.$[payment].status': 'posted' } },
          { arrayFilters: [{ 'payment.status': { $exists: false } }] },
        )
      }
      await MaterialPurchase.createIndexes()
      await FinanceInvoice.createIndexes()
      reminderBackfill = await backfillPremiumReminderSchedules()
    }

    console.log(JSON.stringify({
      phase: 'premium_operations_security_phase5',
      apply,
      customUserProfilesToMigrate: profileChanges.length,
      pendingInvitationsToMigrate: invitationChanges.length,
      invoicesWithLegacyPaymentStatus: missingPaymentStatus,
      reminderBackfillCandidates: {
        openMaterialRequirements: openRequirementCount,
        activeMaterials: activeMaterialCount,
        supplierPurchasesWithPaymentDueDate: supplierPaymentDueCount,
      },
      reminderBackfill,
      collections,
      destructiveDataChanges: false,
    }, null, 2))
    if (!apply) console.log('Dry run only. Re-run with --apply after reviewing this report.')
  } finally {
    await mongoose.disconnect()
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
