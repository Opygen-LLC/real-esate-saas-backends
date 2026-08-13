import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { IBilling } from './billing.interface'
import { Billing } from './billing.model'
import { Lead } from '../lead/lead.model'
import { EntitlementService } from '../entitlement/entitlement.service'

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

const getBillingHistory = async (organizationId: string): Promise<IBilling[]> => {
  const result = await Billing.find({ organizationId }).sort({ createdAt: -1 })
  return result
}

const getSubscriptionUsage = async (organizationId: string) => {
  const org = await Organization.findOne({ organizationId })
  if (!org) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  }

  const currentProperties = await Property.countDocuments({ organizationId })
  const currentAgents = await User.countDocuments({
    organizationId,
    userRole: { $in: ['agent', 'agency_admin', 'agency_owner', 'admin', 'staff'] },
  })
  const currentLeads = await Lead.countDocuments({ organizationId, leadStatus: { $nin: ['Won', 'Lost'] } })
  const { limits } = await EntitlementService.resolve(organizationId)

  const maxProperties = org.subscription?.maxProperties || 100
  const maxAgents = org.subscription?.maxAgents || 3

  const propertiesPercent = Math.min(Math.round((currentProperties / maxProperties) * 100), 100)
  const agentsPercent = Math.min(Math.round((currentAgents / maxAgents) * 100), 100)

  const isApproachingLimit = propertiesPercent >= 80 || agentsPercent >= 80

  return {
    plan: org.subscription?.plan || 'starter',
    status: org.subscription?.status || 'trialing',
    currentPeriodEnd: org.subscription?.currentPeriodEnd,
    properties: {
      used: currentProperties,
      limit: maxProperties,
      percentage: propertiesPercent,
    },
    agents: {
      used: currentAgents,
      limit: maxAgents,
      percentage: agentsPercent,
    },
    leads: { used: currentLeads, limit: limits.maxLeads, percentage: Math.min(Math.round((currentLeads / limits.maxLeads) * 100), 100) },
    storage: { usedBytes: org.storageUsedBytes || 0, limitBytes: limits.maxStorageMb * 1024 * 1024 },
    visitors: { used: org.monthlyVisitorCount || 0, limit: limits.maxMonthlyVisitors, month: org.visitorUsageMonth },
    features: { customDomain: limits.hasCustomDomain, advancedAnalytics: limits.hasAdvancedAnalytics,
      whatsAppAutomation: limits.hasWhatsAppIntegration, smsAutomation: limits.hasSmsAutomation, premiumTemplates: limits.hasPremiumTemplates },
    isApproachingLimit,
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
  const billing = await Billing.findOne({
    organizationId,
    $or: [{ invoiceId: id }, ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : [])],
  })

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
              <div class="title">INVOICE RECEIPT</div>
              <div style="font-size: 13px; color: #64748b;">${escapeHtml(org?.agencyName || 'PropSe Agency OS')}</div>
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
