import { Lead } from '../lead/lead.model'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { Viewing } from '../viewing/viewing.model'

const getOverviewStats = async (organizationId: string) => {
  const organization = await Organization.findOne({ organizationId })
  const totalAgents = await User.countDocuments({
    organizationId,
    userRole: { $in: ['agent', 'agency_admin', 'agency_owner', 'admin', 'staff'] },
  })

  const totalProperties = await Property.countDocuments({ organizationId })
  const activeListings = await Property.countDocuments({
    organizationId,
    status: 'Available',
  })

  const totalLeads = await Lead.countDocuments({ organizationId })
  const dealsWon = await Lead.countDocuments({ organizationId, leadStatus: 'Won' })
  const scheduledViewings = await Viewing.countDocuments({
    organizationId,
    status: { $in: ['Scheduled', 'Confirmed'] },
  })

  return {
    totalProperties,
    activeListings,
    totalLeads,
    scheduledViewings,
    dealsWon,
    totalAgents,
    plan: organization?.subscription?.plan || 'trial',
    planStatus: organization?.subscription?.status || 'active',
    currentPeriodEnd: organization?.subscription?.currentPeriodEnd,
    totalVisitors: organization?.totalVisitor || 0,
    recentActivities: [
      {
        id: 'act_1',
        title: 'CRM Hub Active',
        desc: `Managing ${totalLeads} active client leads and ${scheduledViewings} scheduled property viewings for ${organization?.agencyName || 'Agency'}`,
        date: new Date(),
        type: 'system',
      },
    ],
  }
}

const getAnalytics = async (organizationId: string, range: string = '30d') => {
  const now = new Date()
  let startDate = new Date()

  if (range === '7d') {
    startDate.setDate(now.getDate() - 7)
  } else if (range === '30d') {
    startDate.setDate(now.getDate() - 30)
  } else if (range === '90d') {
    startDate.setDate(now.getDate() - 90)
  } else if (range === '1y') {
    startDate.setFullYear(now.getFullYear() - 1)
  } else if (range === 'all') {
    startDate = new Date(0)
  }

  // Summary Metrics
  const totalProperties = await Property.countDocuments({ organizationId })
  const activeListings = await Property.countDocuments({ organizationId, status: 'Available' })
  const totalLeads = await Lead.countDocuments({ organizationId })
  const newLeadsInPeriod = await Lead.countDocuments({
    organizationId,
    createdAt: { $gte: startDate },
  })

  const scheduledViewings = await Viewing.countDocuments({
    organizationId,
    status: { $in: ['Scheduled', 'Confirmed'] },
    date: { $gte: startDate.toISOString().split('T')[0] },
  })

  const dealsWonLeads = await Lead.find({
    organizationId,
    leadStatus: 'Won',
  })
  const dealsWon = dealsWonLeads.length
  const dealsWonInPeriod = dealsWonLeads.filter(
    (l: any) => new Date(l.updatedAt || l.createdAt) >= startDate
  ).length

  // Calculate closed volume ($ sum of won deals)
  const totalClosedVolume = dealsWonLeads.reduce((acc, lead: any) => {
    const val = lead.budgetMax || lead.budgetMin || 500000
    return acc + val
  }, 0)

  const conversionRate = totalLeads > 0 ? Math.round((dealsWon / totalLeads) * 100) : 0

  // Lead Source Attribution Breakdown
  const sources = ['Website', 'Referral', 'Zillow', 'Portal', 'Social', 'WalkIn', 'ColdCall', 'Other']
  const leadsBySource = await Promise.all(
    sources.map(async (source) => {
      const count = await Lead.countDocuments({ organizationId, source })
      return { source, count }
    })
  )

  // 8-Stage CRM Pipeline Funnel
  const stages = [
    'New',
    'Contacted',
    'Qualified',
    'ViewingScheduled',
    'ViewingCompleted',
    'OfferMade',
    'Negotiation',
    'Won',
    'Lost',
  ]
  const leadsByStage = await Promise.all(
    stages.map(async (stage) => {
      const count = await Lead.countDocuments({ organizationId, leadStatus: stage })
      return { stage, count }
    })
  )

  // Property Type Distribution
  const propertyTypes = ['Apartment', 'Villa', 'House', 'Condo', 'Commercial', 'Land']
  const propertiesByType = await Promise.all(
    propertyTypes.map(async (type) => {
      const count = await Property.countDocuments({ organizationId, propertyType: type })
      return { type, count }
    })
  )

  // Top 5 Viewed & Inquired Properties
  const topProperties = await Property.find({ organizationId })
    .sort({ views: -1 })
    .limit(5)
    .select('title price city propertyType listingType views images')

  // Broker Performance Leaderboard
  const agents = await User.find({
    organizationId,
    userRole: { $in: ['agent', 'agency_admin', 'agency_owner', 'admin', 'staff'] },
  }).select('name email phoneNumber profileImgURL licenseNumber')

  const brokerPerformance = await Promise.all(
    agents.map(async (agent) => {
      const agentLeads = await Lead.countDocuments({ organizationId, assignedAgent: agent._id })
      const agentWon = await Lead.countDocuments({ organizationId, assignedAgent: agent._id, leadStatus: 'Won' })
      const agentViewings = await Viewing.countDocuments({ organizationId, agentId: agent._id })
      const rate = agentLeads > 0 ? Math.round((agentWon / agentLeads) * 100) : 0

      return {
        _id: agent._id,
        name: agent.name,
        email: agent.email,
        profileImgURL: agent.profileImgURL,
        licenseNumber: agent.licenseNumber,
        leadsHandled: agentLeads,
        viewingsConducted: agentViewings,
        dealsWon: agentWon,
        conversionRate: rate,
      }
    })
  )

  // 6-Month Rolling Velocity Trend Data
  const monthlyTrend = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const monthName = d.toLocaleString('en-US', { month: 'short' })
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1)
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0)

    const leadsCount = await Lead.countDocuments({
      organizationId,
      createdAt: { $gte: monthStart, $lte: monthEnd },
    })

    const wonCount = await Lead.countDocuments({
      organizationId,
      leadStatus: 'Won',
      updatedAt: { $gte: monthStart, $lte: monthEnd },
    })

    monthlyTrend.push({
      month: monthName,
      leads: leadsCount,
      dealsWon: wonCount,
    })
  }

  return {
    range,
    kpis: {
      totalProperties,
      activeListings,
      totalLeads,
      newLeadsInPeriod,
      scheduledViewings,
      dealsWon,
      dealsWonInPeriod,
      totalClosedVolume,
      conversionRate,
    },
    leadsBySource,
    leadsByStage,
    propertiesByType,
    topProperties,
    brokerPerformance,
    monthlyTrend,
  }
}

export const DashboardService = {
  getOverviewStats,
  getAnalytics,
}
