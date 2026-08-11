import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { IBilling } from './billing.interface'
import { Billing } from './billing.model'

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

  const maxProperties = org.subscription?.maxProperties || 100
  const maxAgents = org.subscription?.maxAgents || 3

  const propertiesPercent = Math.min(Math.round((currentProperties / maxProperties) * 100), 100)
  const agentsPercent = Math.min(Math.round((currentAgents / maxAgents) * 100), 100)

  const isApproachingLimit = propertiesPercent >= 80 || agentsPercent >= 80

  return {
    plan: org.subscription?.plan || 'starter',
    status: org.subscription?.status || 'active',
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
    isApproachingLimit,
  }
}

const changeSubscriptionPlan = async (
  organizationId: string,
  plan: 'starter' | 'professional' | 'agency' | 'enterprise',
  billingCycle: 'monthly' | 'yearly' = 'monthly'
) => {
  const org = await Organization.findOne({ organizationId })
  if (!org) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  }

  let maxProperties = 25
  let maxAgents = 2
  let price = 49

  if (plan === 'starter') {
    maxProperties = 25
    maxAgents = 2
    price = billingCycle === 'yearly' ? 39 : 49
  } else if (plan === 'professional') {
    maxProperties = 150
    maxAgents = 10
    price = billingCycle === 'yearly' ? 119 : 149
  } else if (plan === 'agency' || plan === 'enterprise') {
    maxProperties = 9999
    maxAgents = 9999
    price = billingCycle === 'yearly' ? 319 : 399
  }

  const periodEnd = new Date()
  periodEnd.setMonth(periodEnd.getMonth() + (billingCycle === 'yearly' ? 12 : 1))

  // Update Organization Subscription
  org.subscription = {
    plan,
    status: 'active',
    currentPeriodEnd: periodEnd,
    lastPaymentDate: new Date(),
    maxProperties,
    maxAgents,
  }
  await org.save()

  // Generate Invoice Record
  const invoiceId = 'INV-' + Math.random().toString(36).substring(2, 8).toUpperCase()
  await Billing.create({
    organizationId,
    invoiceId,
    amount: price,
    planName: `${plan.toUpperCase()} Plan (${billingCycle})`,
    paymentStatus: 'paid',
    paymentMethod: 'Credit Card (Stripe)',
    billingDate: new Date(),
    dueDate: new Date(),
    pdfUrl: `/invoices/${invoiceId}.pdf`,
  })

  return {
    organization: org,
    plan,
    price,
    invoiceId,
  }
}

export const BillingService = {
  createBillingRecord,
  getBillingHistory,
  getSubscriptionUsage,
  changeSubscriptionPlan,
}
