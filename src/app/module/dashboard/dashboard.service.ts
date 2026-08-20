import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { DomainEvent } from '../domainEvent/domainEvent.model'
import { Contact } from '../contact/contact.model'
import { visibleContactRelationshipFilter } from '../contact/contactRelationship.contract'
import { Lead } from '../lead/lead.model'
import { LEAD_STATUS, convertedStatusExpression } from '../lead/leadStatus.contract'
import { Organization } from '../organization/organization.model'
import { PlatformAdminService } from '../platformAdmin/platformAdmin.service'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { listUsersWithProfiles } from '../user/userReadModel.service'
import { Viewing } from '../viewing/viewing.model'
import { crmReadOwnerFilter, type CrmAccessContext } from '../crm/crmAccess'


const escapeSearch = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const globalSearch = async (organizationId: string, query: string, access: CrmAccessContext) => {
  const q = String(query || '').trim().slice(0, 80)
  if (q.length < 2) return []
  const regex = new RegExp(escapeSearch(q), 'i')
  const can = (permission: string) => access.permissions.includes(permission)
  const jobs: Array<Promise<any[]>> = []

  if (can('properties.read')) jobs.push(Property.find({ organizationId, $or: [{ title: regex }, { city: regex }, { address: regex }, { 'bangladeshAddress.area': regex }, { 'bangladeshAddress.district': regex }] }).select('_id title city address status price').sort({ updatedAt: -1 }).limit(5).lean().then(rows => rows.map((row:any) => ({ kind: 'property', id: String(row._id), title: row.title, subtitle: [row.city || row.address, row.status].filter(Boolean).join(' · '), href: `/dashboard/admin/properties/${row._id}` }))))
  if (can('leads.read')) jobs.push(Lead.find({ organizationId, isConverted: { $ne: true }, ...crmReadOwnerFilter('assignedAgent', access), $or: [{ name: regex }, { email: regex }, { phone: regex }, { locationPreference: regex }] }).select('_id name email phone leadStatus').sort({ updatedAt: -1 }).limit(5).lean().then(rows => rows.map((row:any) => ({ kind: 'lead', id: String(row._id), title: row.name, subtitle: [row.phone || row.email, row.leadStatus].filter(Boolean).join(' · '), href: `/dashboard/admin/leads?lead=${row._id}` }))))
  if (can('contacts.read')) jobs.push(Contact.find({ organizationId, ...crmReadOwnerFilter('assignedTo', access), ...visibleContactRelationshipFilter, $or: [{ name: regex }, { email: regex }, { phone: regex }, { company: regex }] }).select('_id name email phone type').sort({ updatedAt: -1 }).limit(5).lean().then(rows => rows.map((row:any) => ({ kind: 'contact', id: String(row._id), title: row.name, subtitle: [row.phone || row.email, row.type].filter(Boolean).join(' · '), href: `/dashboard/admin/contacts?contact=${row._id}` }))))
  if (can('users.read')) jobs.push(User.find({ organizationId, status: { $ne: 'blocked' }, $or: [{ name: regex }, { email: regex }, { phoneNumber: regex }] }).select('_id name email phoneNumber userRole').sort({ updatedAt: -1 }).limit(5).lean().then(rows => rows.map((row:any) => ({ kind: 'team', id: String(row._id), title: row.name, subtitle: [row.email || row.phoneNumber, String(row.userRole || '').replace(/_/g, ' ')].filter(Boolean).join(' · '), href: `/dashboard/admin/team?user=${row._id}` }))))

  const groups = await Promise.all(jobs)
  return groups.flat().slice(0, 16)
}

const agentRoles = ['agent', 'agency_admin', 'agency_owner']

const resolveOrganizationScope = async (organizationId: string) => {
  if (!organizationId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Organization ID is required')
  }

  const escaped = organizationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const organization: any = await Organization.findOne({
    $or: [
      { organizationId },
      { sub_domain: { $regex: `^${escaped}$`, $options: 'i' } },
      { domain: { $regex: `^${escaped}$`, $options: 'i' } },
      { customDomain: { $regex: `^${escaped}$`, $options: 'i' } },
    ],
  })
    .select('organizationId sub_domain agencyName subscription totalVisitor')
    .lean()

  const organizationIds = organization
    ? Array.from(
        new Set(
          [organization.organizationId, organization.sub_domain, organization._id?.toString()].filter(Boolean)
        )
      )
    : [organizationId]

  return { organization, organizationIds }
}

const getOverviewStats = async (organizationId: string) => {
  const { organization, organizationIds } = await resolveOrganizationScope(organizationId)
  const orgMatch = { organizationId: { $in: organizationIds } }

  const [agentCount, propertyStats, leadStats, viewingStats, recentEvents] = await Promise.all([
    User.countDocuments({ ...orgMatch, userRole: { $in: agentRoles }, status: { $ne: 'blocked' } }),
    Property.aggregate([
      { $match: orgMatch },
      {
        $group: {
          _id: null,
          totalProperties: { $sum: 1 },
          activeListings: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'Available'] }, { $ne: ['$quotaLocked', true] }] }, 1, 0] } },
        },
      },
    ]),
    Lead.aggregate([
      { $match: orgMatch },
      {
        $group: {
          _id: null,
          totalLeads: { $sum: 1 },
          dealsWon: { $sum: { $cond: [convertedStatusExpression(), 1, 0] } },
        },
      },
    ]),
    Viewing.aggregate([
      { $match: orgMatch },
      {
        $group: {
          _id: null,
          scheduledViewings: {
            $sum: { $cond: [{ $in: ['$status', ['Scheduled', 'Confirmed']] }, 1, 0] },
          },
        },
      },
    ]),
    DomainEvent.find(orgMatch)
      .sort({ occurredAt: -1 })
      .limit(8)
      .select('eventType aggregateType aggregateId payload occurredAt')
      .lean(),
  ])

  const properties = propertyStats[0] || { totalProperties: 0, activeListings: 0 }
  const leads = leadStats[0] || { totalLeads: 0, dealsWon: 0 }
  const viewings = viewingStats[0] || { scheduledViewings: 0 }

  return {
    totalProperties: properties.totalProperties,
    activeListings: properties.activeListings,
    totalLeads: leads.totalLeads,
    scheduledViewings: viewings.scheduledViewings,
    dealsWon: leads.dealsWon,
    totalAgents: agentCount,
    plan: organization?.subscription?.plan || 'trial',
    planStatus: organization?.subscription?.status || 'trialing',
    currentPeriodEnd: organization?.subscription?.currentPeriodEnd,
    totalVisitors: organization?.totalVisitor || 0,
    recentActivities: recentEvents.map((event: any) => ({
      id: event._id.toString(),
      title: event.payload?.summary || event.eventType,
      desc: event.payload?.description || event.payload?.summary || event.eventType,
      date: event.occurredAt,
      type: event.aggregateType,
      eventType: event.eventType,
      aggregateId: event.aggregateId,
    })),
  }
}

const rangeStart = (range: string, now: Date) => {
  const start = new Date(now)
  if (range === '7d') start.setDate(start.getDate() - 7)
  else if (range === '90d') start.setDate(start.getDate() - 90)
  else if (range === '1y') start.setFullYear(start.getFullYear() - 1)
  else if (range === 'all') return new Date(0)
  else start.setDate(start.getDate() - 30)
  return start
}

const getAnalytics = async (organizationId: string, range: string = '30d') => {
  const { organizationIds } = await resolveOrganizationScope(organizationId)
  const orgMatch = { organizationId: { $in: organizationIds } }
  const now = new Date()
  const startDate = rangeStart(range, now)
  const viewingStartDate = startDate.toISOString().slice(0, 10)
  const sixMonthStart = new Date(now.getFullYear(), now.getMonth() - 5, 1)

  const [leadFacetRaw, propertyFacetRaw, viewingFacetRaw, agents] = await Promise.all([
    Lead.aggregate([
      { $match: orgMatch },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalLeads: { $sum: 1 },
                newLeadsInPeriod: {
                  $sum: { $cond: [{ $gte: ['$createdAt', startDate] }, 1, 0] },
                },
                dealsWon: { $sum: { $cond: [convertedStatusExpression(), 1, 0] } },
                dealsWonInPeriod: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          convertedStatusExpression(),
                          { $gte: [{ $ifNull: ['$updatedAt', '$createdAt'] }, startDate] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                totalClosedVolume: {
                  $sum: {
                    $cond: [
                      convertedStatusExpression(),
                      {
                        $cond: [
                          { $gt: ['$budgetMax', 0] },
                          '$budgetMax',
                          { $cond: [{ $gt: ['$budgetMin', 0] }, '$budgetMin', 0] },
                        ],
                      },
                      0,
                    ],
                  },
                },
                dealsWithoutBudgetCount: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          convertedStatusExpression(),
                          { $lte: [{ $ifNull: ['$budgetMax', 0] }, 0] },
                          { $lte: [{ $ifNull: ['$budgetMin', 0] }, 0] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
          bySource: [
            { $group: { _id: { $ifNull: ['$source', 'Other'] }, count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
          ],
          byStage: [
            { $group: { _id: { $ifNull: ['$leadStatus', LEAD_STATUS.NEW] }, count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
          ],
          byAgent: [
            { $match: { assignedAgent: { $ne: null } } },
            {
              $group: {
                _id: '$assignedAgent',
                leadsHandled: { $sum: 1 },
                dealsWon: { $sum: { $cond: [convertedStatusExpression(), 1, 0] } },
              },
            },
          ],
          monthlyLeads: [
            { $match: { createdAt: { $gte: sixMonthStart } } },
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Dhaka' } },
                count: { $sum: 1 },
              },
            },
          ],
          monthlyWon: [
            { $match: { $expr: convertedStatusExpression(), updatedAt: { $gte: sixMonthStart } } },
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m', date: '$updatedAt', timezone: 'Asia/Dhaka' } },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]),
    Property.aggregate([
      { $match: orgMatch },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalProperties: { $sum: 1 },
                activeListings: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'Available'] }, { $ne: ['$quotaLocked', true] }] }, 1, 0] } },
              },
            },
          ],
          byType: [
            { $group: { _id: { $ifNull: ['$propertyType', 'Other'] }, count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
          ],
          top: [
            { $sort: { views: -1, updatedAt: -1 } },
            { $limit: 5 },
            {
              $project: {
                title: 1,
                price: 1,
                city: 1,
                propertyType: 1,
                listingType: 1,
                views: 1,
                images: { $slice: ['$images', 1] },
              },
            },
          ],
        },
      },
    ]),
    Viewing.aggregate([
      { $match: orgMatch },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                scheduledViewings: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $in: ['$status', ['Scheduled', 'Confirmed']] },
                          { $gte: ['$date', viewingStartDate] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
          byAgent: [
            { $match: { agentId: { $ne: null } } },
            { $group: { _id: '$agentId', viewingsConducted: { $sum: 1 } } },
          ],
        },
      },
    ]),
    listUsersWithProfiles({ ...orgMatch, userRole: { $in: agentRoles }, status: { $ne: 'blocked' } }, { sort: { name: 1 } }),
  ])

  const leadFacet = leadFacetRaw[0] || {}
  const propertyFacet = propertyFacetRaw[0] || {}
  const viewingFacet = viewingFacetRaw[0] || {}
  const leadSummary = leadFacet.summary?.[0] || {
    totalLeads: 0,
    newLeadsInPeriod: 0,
    dealsWon: 0,
    dealsWonInPeriod: 0,
    totalClosedVolume: 0,
    dealsWithoutBudgetCount: 0,
  }
  const propertySummary = propertyFacet.summary?.[0] || { totalProperties: 0, activeListings: 0 }
  const viewingSummary = viewingFacet.summary?.[0] || { scheduledViewings: 0 }

  const leadByAgent = new Map((leadFacet.byAgent || []).map((row: any) => [String(row._id), row]))
  const viewingByAgent = new Map((viewingFacet.byAgent || []).map((row: any) => [String(row._id), row]))
  const brokerPerformance = agents.map((agent: any) => {
    const leadRow: any = leadByAgent.get(String(agent._id)) || { leadsHandled: 0, dealsWon: 0 }
    const viewingRow: any = viewingByAgent.get(String(agent._id)) || { viewingsConducted: 0 }
    const rate = leadRow.leadsHandled > 0 ? Math.round((leadRow.dealsWon / leadRow.leadsHandled) * 100) : 0
    return {
      _id: agent._id,
      name: agent.name,
      email: agent.email,
      profileImgURL: agent.profileImgURL,
      licenseNumber: agent.licenseNumber,
      leadsHandled: leadRow.leadsHandled,
      viewingsConducted: viewingRow.viewingsConducted,
      dealsWon: leadRow.dealsWon,
      conversionRate: rate,
    }
  })

  const monthlyLeadMap = new Map((leadFacet.monthlyLeads || []).map((row: any) => [row._id, row.count]))
  const monthlyWonMap = new Map((leadFacet.monthlyWon || []).map((row: any) => [row._id, row.count]))
  const monthlyTrend = Array.from({ length: 6 }, (_, offset) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - offset), 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return {
      month: d.toLocaleString('en-US', { month: 'short' }),
      leads: Number(monthlyLeadMap.get(key) || 0),
      dealsWon: Number(monthlyWonMap.get(key) || 0),
    }
  })

  return {
    range,
    kpis: {
      totalProperties: propertySummary.totalProperties,
      activeListings: propertySummary.activeListings,
      totalLeads: leadSummary.totalLeads,
      newLeadsInPeriod: leadSummary.newLeadsInPeriod,
      scheduledViewings: viewingSummary.scheduledViewings,
      dealsWon: leadSummary.dealsWon,
      dealsWonInPeriod: leadSummary.dealsWonInPeriod,
      totalClosedVolume: leadSummary.totalClosedVolume,
      dealsWithoutBudgetCount: leadSummary.dealsWithoutBudgetCount,
      conversionRate:
        leadSummary.totalLeads > 0 ? Math.round((leadSummary.dealsWon / leadSummary.totalLeads) * 100) : 0,
    },
    leadsBySource: (leadFacet.bySource || []).map((row: any) => ({ source: row._id, count: row.count })),
    leadsByStage: (leadFacet.byStage || []).map((row: any) => ({ stage: row._id, count: row.count })),
    propertiesByType: (propertyFacet.byType || []).map((row: any) => ({ type: row._id, count: row.count })),
    topProperties: propertyFacet.top || [],
    brokerPerformance,
    monthlyTrend,
  }
}


const getBrokerPerformance = async (organizationId: string, range: string = '30d', query: any = {}) => {
  const analytics = await getAnalytics(organizationId, range)
  const page = Math.max(1, Number(query.page || 1))
  const limit = Math.min(100, Math.max(1, Number(query.limit || 20)))
  const rows = [...(analytics.brokerPerformance || [])]
  const total = rows.length
  return { data: rows.slice((page - 1) * limit, page * limit), meta: { page, limit, total, totalPages: Math.ceil(total / limit) } }
}

const exportBrokerPerformanceCsv = async (organizationId: string, range: string = '30d') => {
  const analytics = await getAnalytics(organizationId, range)
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const header = ['Broker Name','Email','License #','Leads Handled','Viewings Conducted','Deals Won','Win Rate %'].join(',')
  const body = (analytics.brokerPerformance || []).map((broker: any) => [broker.name, broker.email, broker.licenseNumber || '', broker.leadsHandled, broker.viewingsConducted, broker.dealsWon, broker.conversionRate].map(escape).join(',')).join('\n')
  return `${header}\n${body}`
}

const getSuperAdminOverviewStats = async () => {
  const [organizationStats, entityStats, revenue, health] = await Promise.all([
    Organization.aggregate([
      {
        $group: {
          _id: null,
          totalOrganizations: { $sum: 1 },
          activeAgencies: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$isBlocked', true] },
                    { $in: ['$subscription.status', ['trialing', 'active', 'grace', 'cancel_at_period_end']] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    Promise.all([
      User.estimatedDocumentCount(),
      Property.estimatedDocumentCount(),
      Lead.estimatedDocumentCount(),
      Viewing.estimatedDocumentCount(),
    ]),
    PlatformAdminService.getRevenueDashboard(),
    PlatformAdminService.getTenantHealth({ page: 1, limit: 10 }),
  ])

  const organizations = organizationStats[0] || { totalOrganizations: 0, activeAgencies: 0 }
  return {
    totalOrganizations: organizations.totalOrganizations,
    activeAgencies: organizations.activeAgencies,
    totalUsers: entityStats[0],
    totalProperties: entityStats[1],
    totalLeads: entityStats[2],
    totalViewings: entityStats[3],
    totalMRR: revenue.mrr,
    totalRevenue: revenue.totalRevenue,
    monthRevenue: revenue.monthRevenue,
    paidInvoices: revenue.paidInvoices,
    activeSubscriptions: revenue.activeSubscriptions,
    churnRate: null,
    recentAgencies: health.data,
  }
}

export const DashboardService = { globalSearch, getOverviewStats, getAnalytics, getBrokerPerformance, exportBrokerPerformanceCsv, getSuperAdminOverviewStats }
