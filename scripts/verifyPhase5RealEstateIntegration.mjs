import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
const containsAll = (source, tokens, label) => {
  for (const token of tokens) assert.ok(source.includes(token), `${label} is missing ${token}`)
}

const constants = read('src/app/module/property/property.constants.ts')
const controller = read('src/app/module/property/property.controller.ts')
const service = read('src/app/module/property/property.service.ts')
const importer = read('src/app/module/property/propertyImport.service.ts')
const serializer = read('src/app/module/property/publicProperty.serializer.ts')
const websiteBuilder = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
const propertyRoute = read('src/app/module/property/property.route.ts')
const ownershipModel = read('src/app/module/property/propertyOwnership.model.ts')
const ownershipService = read('src/app/module/property/propertyOwnership.service.ts')
const financeRoute = read('src/app/module/finance/finance.route.ts')
const financeService = read('src/app/module/finance/finance.service.ts')
const capitalModel = read('src/app/module/finance/financeCapital.model.ts')
const inquiryContract = read('src/app/shared/inquiryPurpose.contract.ts')
const submissionService = read('src/app/module/websiteSubmission/websiteSubmission.service.ts')
const leadModel = read('src/app/module/lead/lead.model.ts')
const audit = read('src/app/db/auditPhase5RealEstateIntegration.ts')

containsAll(constants, ['HotelResort', 'LandPlot', "'floor'", 'PER_KATHA', 'PER_SQFT', 'MONTHLY'], 'property constants')
containsAll(controller, ['pricingMode', 'minUnitRate', 'minRoadWidthFeet', 'minRooms', 'starRating', 'hotelOperatingStatus', 'availableBy'], 'property controller filters')
containsAll(service, ['pricing.unitRate', 'roadWidthFeet', 'totalRooms', 'starRating', 'hotelOperatingStatus', 'rentalTerms.availableFrom'], 'property query builder')
containsAll(importer, ['pricingMode', 'unitRate', 'roadWidthFeet', 'totalRooms', 'starRating', 'hotelOperatingStatus', 'securityDeposit', 'availableFrom'], 'property import')
containsAll(serializer, ["['floor', 'floorNumber']", 'hotelInvestment', "hidden.has('area')", 'publicFields'], 'public property serializer')
assert.ok(!serializer.includes('documents:'), 'private documents must not be serialized into the public property DTO')
containsAll(websiteBuilder, ['RealEstateListing', 'additionalProperty', 'LandPlot', 'HotelResort', 'numberOfBedrooms', 'numberOfBathroomsTotal'], 'structured data')

// Ownership/accounting separation and permission boundaries.
containsAll(ownershipModel, ['PropertyOwnership', 'PropertyInvestor', 'PropertyInvestment', 'PropertyInvestorDistribution'], 'property ownership models')
assert.ok(!ownershipModel.includes('FinanceShareholder'), 'property ownership models must not reuse FinanceShareholder')
containsAll(capitalModel, ['FinanceShareholder'], 'company shareholder model')
containsAll(propertyRoute, [
  "requirePermission('properties.write'), authMiddlewares.requirePermission('finance.write')",
  '/ownership/investors/:investorId/contributions',
  '/ownership/investors/:investorId/distributions',
], 'property investor finance permissions')
containsAll(ownershipService, ['postPropertyInvestorMovement', 'reverseMovement'], 'property investor finance posting')
containsAll(financeRoute, ["advancedWrite('finance.shareholders.manage')", "router.delete('/billing-profile', ...remove"], 'finance permissions')

// Finance reliability and immutable billing history.
containsAll(financeService, ['freezeLegacyInvoiceIssuerSnapshots', 'issuerSnapshot', "sourceType !== 'manual'", 'Linked transactions must be managed from their source record', 'Linked transactions cannot be deleted directly'], 'finance reliability')

// Inquiry purposes must survive public capture -> submission -> CRM Lead.
containsAll(inquiryContract, ['BUILDING_DESIGN', 'CONSTRUCTION'], 'inquiry purpose contract')
containsAll(submissionService, ['inquiryPurpose: payload.inquiryPurpose', 'projectDetails: payload.projectDetails', 'inquiryPurpose: claim.inquiryPurpose', 'projectDetails: claim.projectDetails'], 'website submission/CRM conversion')
containsAll(leadModel, ['inquiryPurpose', 'projectDetails'], 'lead persistence')

// Rollout audit is intentionally read-only and exposes every requested finding class.
containsAll(audit, [
  "mode: 'READ_ONLY'",
  'unsupportedTypeSpecificFields',
  'landAreaInconsistent',
  'landAreaImpossibleConversion',
  'oldPricingShape',
  'priceMirrorMismatch',
  'moneyTransactionsMissingFromListContract',
  'billingProfilesLinkedIncorrectly',
  'unsupportedInquiryPurpose',
  'crmLeadsWithLostInquiryPurpose',
  'companyShareholdersWithLegacyPropertyLink',
  '--fail-on-findings',
], 'Phase 5 reconciliation audit')
assert.doesNotMatch(audit, /\.(?:create|insertMany|updateOne|updateMany|deleteOne|deleteMany|findOneAndUpdate|findOneAndDelete|bulkWrite)\s*\(/, 'Phase 5 audit must not write to the database')

console.log('Phase 5 real-estate integration verification passed')
