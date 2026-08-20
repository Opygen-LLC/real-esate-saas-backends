import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { Organization } from '../organization/organization.model'
import { IBilling } from './billing.interface'
import { Billing } from './billing.model'
import { EntitlementService } from '../entitlement/entitlement.service'
import { decryptField } from '../../helpers/fieldEncryption'
import { SubscriptionPaymentService } from '../subscriptionPayment/subscriptionPayment.service'
import { SubscriptionReceiptPdfService, type GeneratedReceiptPdf } from './subscriptionReceiptPdf.service'

const createBillingRecord = async (payload: Partial<IBilling>): Promise<IBilling> => {
  if (!payload.invoiceId) {
    payload.invoiceId = 'INV-' + Date.now().toString(36).toUpperCase()
  }
  const result = await Billing.create(payload)
  return result
}

const getBillingHistory = async (organizationId: string) => SubscriptionPaymentService.getTenantPaymentHistory(organizationId)

const usagePercentage = (used: number, limit: number): number => {
  if (limit <= 0) return used > 0 ? 100 : 0
  return Math.min(Math.round((used / limit) * 100), 100)
}

const getSubscriptionUsage = async (organizationId: string) => {
  const [resolved, pendingChangeRequest] = await Promise.all([
    EntitlementService.getUsageSnapshot(organizationId),
    SubscriptionPaymentService.getTenantPendingState(organizationId),
  ])

  const { organization: org, limits, usage, teamMemberQuota } = resolved
  const currentProperties = usage.properties
  const currentLeads = usage.leads
  const maxProperties = Number(limits.maxProperties || 0)
  const maxTeamMembers = Number(teamMemberQuota.maxTeamMembers || 0)
  const maxLeads = Number(limits.maxLeads || 0)
  const propertiesPercent = usagePercentage(currentProperties, maxProperties)
  const teamMembersPercent = usagePercentage(teamMemberQuota.teamMembersCommitted, maxTeamMembers)
  const leadsPercent = usagePercentage(currentLeads, maxLeads)

  return {
    plan: org.subscription?.plan || 'starter',
    planVersion: org.subscription?.planVersion || 1,
    status: org.subscription?.status || 'trialing',
    currentPeriodEnd: org.subscription?.currentPeriodEnd,
    pendingChangeRequest,
    properties: { used: currentProperties, limit: maxProperties, percentage: propertiesPercent },
    maxTeamMembers,
    teamMembersUsed: teamMemberQuota.teamMembersUsed,
    teamMembersReserved: teamMemberQuota.teamMembersReserved,
    teamMembersCommitted: teamMemberQuota.teamMembersCommitted,
    teamMembersAvailable: teamMemberQuota.teamMembersAvailable,
    teamMembersOverCapacityBy: teamMemberQuota.teamMembersOverCapacityBy,
    teamMembers: {
      used: teamMemberQuota.teamMembersUsed,
      reserved: teamMemberQuota.teamMembersReserved,
      committed: teamMemberQuota.teamMembersCommitted,
      available: teamMemberQuota.teamMembersAvailable,
      overCapacityBy: teamMemberQuota.teamMembersOverCapacityBy,
      limit: maxTeamMembers,
      percentage: teamMembersPercent,
    },
    leads: { used: currentLeads, limit: maxLeads, percentage: leadsPercent },
    storage: { usedBytes: org.storageUsedBytes || 0, limitBytes: limits.maxStorageMb * 1024 * 1024 },
    visitors: { used: org.monthlyVisitorCount || 0, limit: limits.maxMonthlyVisitors, month: org.visitorUsageMonth },
    features: {
      customDomain: limits.hasCustomDomain,
      advancedAnalytics: limits.hasAdvancedAnalytics,
      whatsAppAutomation: limits.hasWhatsAppIntegration,
      smsAutomation: limits.hasSmsAutomation,
      premiumTemplates: limits.hasPremiumTemplates,
    },
    isApproachingLimit: propertiesPercent >= 80 || teamMembersPercent >= 80 || leadsPercent >= 80,
  }
}

const cancelSubscription = async (organizationId: string) => {
  const org = await Organization.findOne({ organizationId })
  if (!org) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  }

  if (org.subscription) {
    org.subscription.status = 'cancel_at_period_end'
    org.subscription.cancelAtPeriodEnd = true
    await org.save()
  }

  return org.subscription
}

const getInvoiceReceipt = async (organizationId: string, id: string): Promise<GeneratedReceiptPdf> => {
  try {
    const receiptData = await SubscriptionPaymentService.getReceiptData(organizationId, id)
    return SubscriptionReceiptPdfService.generateSubscriptionReceiptPdf(receiptData)
  } catch (error) {
    if (!(error instanceof ApiError) || error.statusCode !== httpStatus.NOT_FOUND) throw error
  }

  // Legacy Billing rows remain downloadable, but are normalized into the same PDF contract.
  const billing = await Billing.findOne({
    organizationId,
    status: 'paid',
    $or: [{ invoiceId: id }, ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : [])],
  }).select('+taxSnapshot.binEncrypted')

  if (!billing) throw new ApiError(httpStatus.NOT_FOUND, 'Billing invoice record not found')

  const org = await Organization.findOne({ organizationId }).select('agencyName email').lean() as any
  const tax = billing.taxSnapshot
  const taxEnabled = Boolean(tax?.invoiceEnabled && tax.registrationStatus === 'registered')
  const vatAmount = taxEnabled ? Math.max(0, Number(tax?.vatAmount || 0)) : 0
  const netAmount = taxEnabled && Number(tax?.netAmount || 0) > 0
    ? Number(tax?.netAmount || 0)
    : Math.max(0, Number(billing.amount || 0) - vatAmount)
  const bin = taxEnabled && tax?.binEncrypted ? decryptField(tax.binEncrypted) : ''
  const paidAt = (billing as any).billingDate || billing.createdAt || billing.date

  return SubscriptionReceiptPdfService.generateSubscriptionReceiptPdf({
    receiptNumber: billing.invoiceId,
    paymentNumber: billing.paymentId || billing.transactionId || billing.invoiceId,
    status: 'PAID',
    agencyName: org?.agencyName || 'Agency Customer',
    customerEmail: org?.email || '',
    planName: (billing as any).planName || billing.serviceName || 'SaaS Subscription',
    planVersion: billing.planVersion || null,
    billingCycle: billing.billingCycle,
    periodStart: paidAt || null,
    periodEnd: null,
    paymentMethod: billing.paymentMethod || 'manual',
    paymentReference: billing.transactionId || billing.paymentId || '',
    paidAt: paidAt || null,
    confirmedAt: paidAt || null,
    subtotal: netAmount,
    vatRate: taxEnabled ? Number(tax?.vatRate || 0) : 0,
    vatAmount,
    total: Number(billing.amount || 0),
    currency: billing.currency || 'BDT',
    taxOperatorLegalName: taxEnabled ? (tax?.operatorLegalName || null) : null,
    taxBin: bin || null,
  })
}


export const BillingService = {
  createBillingRecord,
  getBillingHistory,
  getSubscriptionUsage,
  cancelSubscription,
  getInvoiceReceipt,
}
