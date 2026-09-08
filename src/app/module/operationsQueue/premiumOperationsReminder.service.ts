import { Types } from 'mongoose'
import { NotificationService } from '../notification/notification.service'
import { User } from '../user/user.model'
import { UserProfile } from '../userProfile/userProfile.model'
import { effectivePermissionsForUser } from '../user/accessControl'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Material } from '../materialInventory/material.model'
import { MaterialRequirement } from '../materialInventory/materialRequirement.model'
import { MaterialPurchase } from '../supplierManagement/materialPurchase.model'
import { FinanceTransaction } from '../finance/finance.model'
import { moneyToMinorUnits } from '../finance/finance.money'

type PremiumReminderJob = {
  _id: { toString(): string }
  organizationId: string
  entityId: string
  type: 'low_stock_reminder' | 'material_requirement_reminder' | 'supplier_payment_due'
}

const featureEnabled = async (organizationId: string, feature: 'materialsInventory' | 'supplierManagement') => {
  try {
    // Use the normal entitlement boundary here. Suspended/blocked/inactive tenants
    // must never receive operational reminders even if their historical plan had
    // the feature enabled. A plan downgrade also resolves to feature=false.
    const resolved = await EntitlementService.resolve(organizationId)
    return Boolean(resolved.limits?.entitlements?.[feature]?.enabled)
  } catch (error: any) {
    if ([402, 403, 404].includes(Number(error?.statusCode || error?.status || 0))) return false
    throw error
  }
}

const recipientIds = async (organizationId: string, permission: 'materials.read' | 'suppliers.read') => {
  const users: any[] = await User.find({ organizationId, status: 'active', isVerified: true })
    .select('_id userRole')
    .lean()
  if (!users.length) return []
  const profiles: any[] = await UserProfile.find({ userId: { $in: users.map((user) => user._id) } })
    .select('userId accessControl')
    .lean()
  const profileMap = new Map(profiles.map((profile) => [String(profile.userId), profile]))
  return users
    .filter((user) => effectivePermissionsForUser({ userRole: user.userRole, accessControl: profileMap.get(String(user._id))?.accessControl }).includes(permission))
    .map((user) => String(user._id))
}

const notifyMany = async (job: PremiumReminderJob, permission: 'materials.read' | 'suppliers.read', title: string, body: string, notificationEntityId = job.entityId) => {
  const users = await recipientIds(job.organizationId, permission)
  await Promise.all(users.map((userId) => NotificationService.createFromJob({
    organizationId: job.organizationId,
    userId,
    jobId: job._id.toString(),
    type: job.type,
    title,
    body,
    entityId: notificationEntityId,
  })))
}

const deliverLowStockReminder = async (job: PremiumReminderJob) => {
  if (!(await featureEnabled(job.organizationId, 'materialsInventory'))) return
  const material: any = await Material.findOne({ _id: job.entityId, organizationId: job.organizationId, active: true }).lean()
  if (!material) return
  const current = Number(material.stockQuantity || 0)
  const minimum = material.minimumStock == null ? null : Number(material.minimumStock)
  const openRequirements: any[] = await MaterialRequirement.find({
    organizationId: job.organizationId,
    materialId: material._id,
    status: { $in: ['Planned', 'Partially Available'] },
  }).select('requiredQuantity').lean()
  const required = openRequirements.reduce((sum, row) => sum + Number(row.requiredQuantity || 0), 0)
  const shortage = Math.max(0, required - current)
  const belowMinimum = minimum != null && current < minimum
  if (!belowMinimum && shortage <= 0) return
  const reason = shortage > 0
    ? `${shortage.toLocaleString('en-BD')} ${material.unit} more is required for planned requirements.`
    : `Stock is below the configured minimum of ${minimum?.toLocaleString('en-BD')} ${material.unit}.`
  await notifyMany(job, 'materials.read', `Low stock: ${material.name}`, `Available ${current.toLocaleString('en-BD')} ${material.unit}. ${reason}`)
}

const deliverMaterialRequirementReminder = async (job: PremiumReminderJob) => {
  if (!(await featureEnabled(job.organizationId, 'materialsInventory'))) return
  const requirement: any = await MaterialRequirement.findOne({ _id: job.entityId, organizationId: job.organizationId }).lean()
  if (!requirement || ['Completed', 'Cancelled'].includes(requirement.status)) return
  const material: any = await Material.findOne({ _id: requirement.materialId, organizationId: job.organizationId }).select('name unit stockQuantity').lean()
  if (!material) return
  const due = new Date(requirement.requiredBy)
  const current = Number(material.stockQuantity || 0)
  const needed = Number(requirement.requiredQuantity || 0)
  const shortage = Math.max(0, needed - current)
  await notifyMany(
    job,
    'materials.read',
    `Material required soon: ${material.name}`,
    `${needed.toLocaleString('en-BD')} ${material.unit} required by ${due.toLocaleDateString('en-BD')}.${shortage > 0 ? ` Need to purchase about ${shortage.toLocaleString('en-BD')} ${material.unit}.` : ' Current stock can cover this requirement.'}`,
    String(requirement.materialId),
  )
}

const deliverSupplierPaymentDue = async (job: PremiumReminderJob) => {
  if (!(await featureEnabled(job.organizationId, 'supplierManagement'))) return
  const purchase: any = await MaterialPurchase.findOne({ _id: job.entityId, organizationId: job.organizationId, status: { $ne: 'Cancelled' } }).lean()
  if (!purchase || !purchase.paymentDueDate) return
  const [payment] = await FinanceTransaction.aggregate([
    { $match: { organizationId: job.organizationId, sourceType: 'material_purchase_payment', sourceId: new Types.ObjectId(job.entityId), status: 'paid', deletedAt: null } },
    { $group: { _id: null, paid: { $sum: '$amount' } } },
  ])
  const paidMinor = moneyToMinorUnits(Number(payment?.paid || 0))
  const outstandingMinor = Math.max(0, Number(purchase.totalMinor || 0) - paidMinor)
  if (outstandingMinor <= 0) return
  const due = new Date(purchase.paymentDueDate)
  await notifyMany(job, 'suppliers.read', 'Supplier payment due', `৳${(outstandingMinor / 100).toLocaleString('en-BD', { maximumFractionDigits: 2 })} remains due for purchase #${String(purchase._id).slice(-6).toUpperCase()} by ${due.toLocaleDateString('en-BD')}.`)
}

export const PremiumOperationsReminderService = {
  deliver: async (job: PremiumReminderJob) => {
    if (job.type === 'low_stock_reminder') return deliverLowStockReminder(job)
    if (job.type === 'material_requirement_reminder') return deliverMaterialRequirementReminder(job)
    if (job.type === 'supplier_payment_due') return deliverSupplierPaymentDue(job)
  },
}
