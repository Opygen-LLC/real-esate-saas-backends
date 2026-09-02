import mongoose from 'mongoose'
import config from '../../config'
import { Organization } from '../module/organization/organization.model'
import { Property } from '../module/property/property.model'
import { PROPERTY_SPEC_FIELDS, PROPERTY_TYPE_CONFIG, type PropertyType } from '../module/property/property.constants'
import { convertAreaValue } from '../module/localization/areaConversion'
import { FinanceTransaction } from '../module/finance/finance.model'
import { FinanceBillingProfile } from '../module/finance/financeBillingProfile.model'
import { FinanceShareholder } from '../module/finance/financeCapital.model'
import { WebsiteSubmission } from '../module/websiteSubmission/websiteSubmission.model'
import { Lead } from '../module/lead/lead.model'
import { INQUIRY_PURPOSES } from '../shared/inquiryPurpose.contract'

type AuditCounts = Record<string, number>
const scopedOrganization = process.argv.find((arg: string) => arg.startsWith('--organization='))?.split('=', 2)[1]?.trim()
const failOnFindings = process.argv.includes('--fail-on-findings')

const material = (value: unknown) => {
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return true
}

const auditOrganization = async (org: any) => {
  const organizationId = String(org.organizationId)
  const counts: AuditCounts = {
    propertiesScanned: 0,
    unsupportedTypeSpecificFields: 0,
    landAreaInconsistent: 0,
    landAreaImpossibleConversion: 0,
    oldPricingShape: 0,
    priceMirrorMismatch: 0,
    moneyTransactionsMissingFromListContract: 0,
    billingProfilesLinkedIncorrectly: 0,
    unsupportedInquiryPurpose: 0,
    crmLeadsWithLostInquiryPurpose: 0,
    companyShareholdersWithLegacyPropertyLink: 0,
  }

  const cursor = Property.find({ organizationId })
    .select(['propertyType', 'price', 'pricing', 'area', 'areaUnit', ...PROPERTY_SPEC_FIELDS].join(' '))
    .lean()
    .cursor()
  for await (const property of cursor as any) {
    counts.propertiesScanned += 1
    const propertyType = property.propertyType as PropertyType
    const typeConfig = PROPERTY_TYPE_CONFIG[propertyType]
    if (!typeConfig) {
      counts.unsupportedTypeSpecificFields += 1
      continue
    }
    const allowed = new Set<string>(typeConfig.fields)
    if (PROPERTY_SPEC_FIELDS.some((field) => !allowed.has(field) && material(property[field]))) {
      counts.unsupportedTypeSpecificFields += 1
    }

    if (propertyType === 'LandPlot') {
      if (!Number.isFinite(Number(property.area)) || Number(property.area) <= 0 || !typeConfig.areaUnits.includes(property.areaUnit)) {
        counts.landAreaInconsistent += 1
      } else {
        try {
          const sqft = convertAreaValue(Number(property.area), property.areaUnit, 'sqft', org.areaConversion || {})
          if (!Number.isFinite(sqft) || sqft <= 0) counts.landAreaImpossibleConversion += 1
        } catch {
          counts.landAreaImpossibleConversion += 1
        }
      }
    }

    if (!property.pricing?.mode || !Number.isFinite(Number(property.pricing?.askingPrice))) counts.oldPricingShape += 1
    else if (Math.abs(Number(property.price) - Number(property.pricing.askingPrice)) > 0.01) counts.priceMirrorMismatch += 1
  }

  const [activeMoney, listEligibleMoney, billingCount, invalidPurposes, lostPurposeRows] = await Promise.all([
    FinanceTransaction.countDocuments({ organizationId, deletedAt: null }),
    FinanceTransaction.countDocuments({
      organizationId,
      deletedAt: null,
      type: { $in: ['income', 'expense'] },
      status: { $in: ['pending', 'paid', 'cancelled', 'voided'] },
      transactionDate: { $type: 'date' },
    }),
    FinanceBillingProfile.countDocuments({ organizationId }),
    WebsiteSubmission.countDocuments({ organizationId, inquiryPurpose: { $exists: true, $nin: [...INQUIRY_PURPOSES] } }),
    WebsiteSubmission.aggregate([
      { $match: { organizationId, linkedEntityType: 'Lead', linkedEntityId: { $ne: null }, inquiryPurpose: { $in: [...INQUIRY_PURPOSES] } } },
      { $lookup: { from: Lead.collection.name, localField: 'linkedEntityId', foreignField: '_id', as: 'lead' } },
      { $project: { inquiryPurpose: 1, leadPurpose: { $arrayElemAt: ['$lead.inquiryPurpose', 0] }, leadExists: { $gt: [{ $size: '$lead' }, 0] } } },
      { $match: { $or: [{ leadExists: false }, { $expr: { $ne: ['$inquiryPurpose', '$leadPurpose'] } }] } },
      { $count: 'count' },
    ]),
  ])
  counts.moneyTransactionsMissingFromListContract = Math.max(0, activeMoney - listEligibleMoney)
  counts.billingProfilesLinkedIncorrectly = billingCount > 1 ? billingCount - 1 : 0
  counts.unsupportedInquiryPurpose = invalidPurposes
  counts.crmLeadsWithLostInquiryPurpose = Number(lostPurposeRows?.[0]?.count || 0)

  // Company shareholders must never carry a property relationship. Query the raw collection
  // so legacy fields are detected even though the current Mongoose schema is strict.
  counts.companyShareholdersWithLegacyPropertyLink = await FinanceShareholder.collection.countDocuments({
    organizationId,
    $or: [{ propertyId: { $exists: true } }, { propertyIds: { $exists: true } }, { propertyInvestorId: { $exists: true } }],
  })

  return { organizationId, agencyName: org.agencyName, counts }
}

const run = async () => {
  await mongoose.connect(config.database_string as string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })
  try {
    const organizations = await Organization.find(scopedOrganization ? { organizationId: scopedOrganization } : {})
      .select('organizationId agencyName areaConversion')
      .sort({ organizationId: 1 })
      .lean()
    const reports = []
    for (const org of organizations) reports.push(await auditOrganization(org))

    const allOrganizationIds = (await Organization.find({}).select('organizationId').lean()).map((org: any) => String(org.organizationId))
    const orphanBillingProfiles = await FinanceBillingProfile.countDocuments({
      organizationId: { $nin: allOrganizationIds },
    })
    const summary = reports.reduce((acc: AuditCounts, report: any) => {
      for (const [key, value] of Object.entries(report.counts)) acc[key] = (acc[key] || 0) + Number(value || 0)
      return acc
    }, {})
    summary.billingProfilesLinkedIncorrectly = (summary.billingProfilesLinkedIncorrectly || 0) + orphanBillingProfiles

    const findingKeys = Object.keys(summary).filter((key) => !['propertiesScanned'].includes(key))
    const findingCount = findingKeys.reduce((sum, key) => sum + Number(summary[key] || 0), 0)
    console.log(JSON.stringify({ mode: 'READ_ONLY', organizations: reports.length, summary, reports }, null, 2))
    if (failOnFindings && findingCount > 0) process.exitCode = 2
  } finally {
    await mongoose.disconnect()
  }
}

run().catch((error) => {
  console.error('[phase5-real-estate-audit] failed', error)
  process.exitCode = 1
})
