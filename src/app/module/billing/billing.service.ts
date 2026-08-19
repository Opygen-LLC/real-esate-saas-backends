import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { Organization } from '../organization/organization.model'
import { IBilling } from './billing.interface'
import { Billing } from './billing.model'
import { EntitlementService } from '../entitlement/entitlement.service'
import { decryptField } from '../../helpers/fieldEncryption'
import { SubscriptionPaymentService } from '../subscriptionPayment/subscriptionPayment.service'

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

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

const getInvoiceReceipt = async (organizationId: string, id: string) => {
  try { return await SubscriptionPaymentService.renderReceipt(organizationId, id) } catch (error) {
    if (!(error instanceof ApiError) || error.statusCode !== httpStatus.NOT_FOUND) throw error
  }
  const billing = await Billing.findOne({
    organizationId,
    status: 'paid',
    $or: [{ invoiceId: id }, ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : [])],
  }).select('+taxSnapshot.binEncrypted')

  if (!billing) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Billing invoice record not found')
  }

  const org = await Organization.findOne({ organizationId })

  const status = (billing as any).paymentStatus || billing.status || 'paid'
  const dateStr = (billing as any).billingDate ? new Date((billing as any).billingDate).toLocaleDateString() : billing.date
  const nameStr = (billing as any).planName || billing.serviceName || 'SaaS Subscription'
  const currency = billing.currency || 'BDT'
  const formattedAmount = new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
  }).format(billing.amount)
  const tax = billing.taxSnapshot
  const isTaxInvoice = Boolean(tax?.invoiceEnabled && tax.registrationStatus === 'registered')
  const formatBdt = (amount: number) => new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2 }).format(amount)
  const bin = isTaxInvoice && tax?.binEncrypted ? decryptField(tax.binEncrypted) : ''

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Receipt ${billing.invoiceId}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #0f172a; line-height: 1.5; }
          .container { max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; p: 32px; padding: 32px; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; margin-bottom: 24px; }
          .title { font-size: 20px; font-weight: 800; color: #0f172a; }
          .status { display: inline-block; padding: 4px 12px; background-color: #dcfce7; color: #15803d; border-radius: 9999px; font-weight: 700; font-size: 12px; text-transform: uppercase; }
          .details { margin-bottom: 24px; font-size: 13px; color: #475569; }
          .table { width: 100%; border-collapse: collapse; margin-top: 24px; }
          .table th, .table td { padding: 12px; border-bottom: 1px solid #f1f5f9; text-align: left; font-size: 13px; }
          .table th { background-color: #f8fafc; font-weight: 700; }
          .total { text-align: right; font-size: 18px; font-weight: 800; margin-top: 24px; color: #0f172a; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div>
              <div class="title">${isTaxInvoice ? 'VAT / TAX INVOICE' : 'PAYMENT RECEIPT'}</div>
              <div style="font-size: 13px; color: #64748b;">${escapeHtml(tax?.operatorLegalName || 'PropSe Agency OS')}</div>
              ${bin ? `<div style="font-size: 11px; color: #64748b;">BIN: ${escapeHtml(bin)}</div>` : ''}
            </div>
            <div>
              <span class="status">${escapeHtml(status)}</span>
            </div>
          </div>
          <div class="details">
            <p><strong>Invoice ID:</strong> ${escapeHtml(billing.invoiceId)}</p>
            <p><strong>Billing Date:</strong> ${escapeHtml(dateStr)}</p>
            <p><strong>Billed To:</strong> ${escapeHtml(org?.agencyName || 'Agency Customer')} (${escapeHtml(org?.email || '')})</p>
          </div>
          <table class="table">
            <thead>
              <tr><th>Description</th><th>Amount</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>${escapeHtml(nameStr)}</td>
                <td>${escapeHtml(formattedAmount)}</td>
              </tr>
            </tbody>
          </table>
          ${isTaxInvoice ? `<div class="details"><p><strong>Net amount:</strong> ${escapeHtml(formatBdt(tax?.netAmount || billing.amount))}</p><p><strong>VAT (${escapeHtml(tax?.vatRate || 0)}%):</strong> ${escapeHtml(formatBdt(tax?.vatAmount || 0))}</p></div>` : ''}
          <div class="total">Total Paid: ${escapeHtml(formattedAmount)}</div>
        </div>
        <script>window.print();</script>
      </body>
    </html>
  `
}

export const BillingService = {
  createBillingRecord,
  getBillingHistory,
  getSubscriptionUsage,
  cancelSubscription,
  getInvoiceReceipt,
}
