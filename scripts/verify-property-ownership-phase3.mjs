import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const ownershipModel = read('src/app/module/property/propertyOwnership.model.ts')
const ownershipService = read('src/app/module/property/propertyOwnership.service.ts')
const ownershipValidation = read('src/app/module/property/propertyOwnership.validation.ts')
const routes = read('src/app/module/property/property.route.ts')
const propertyService = read('src/app/module/property/property.service.ts')
const financeModel = read('src/app/module/finance/finance.model.ts')
const financeService = read('src/app/module/finance/finance.service.ts')
const gl = read('src/app/module/finance/financeGlIntegration.service.ts')

assert.match(ownershipModel, /PropertyOwnershipProfile/)
assert.match(ownershipModel, /PropertyOwnership/)
assert.match(ownershipModel, /PropertyInvestor/)
assert.match(ownershipModel, /PropertyInvestment/)
assert.match(ownershipModel, /PropertyInvestorDistribution/)
assert.doesNotMatch(ownershipService, /FinanceShareholder/)
assert.match(ownershipValidation, /Land owner and developer shares must total 100%/)
assert.match(ownershipService, /Property owner percentages cannot exceed 100%/)
assert.match(ownershipService, /Property investor ownership percentages cannot exceed 100%/)

assert.match(routes, /ownership\/investors\/:investorId\/contributions/)
assert.match(routes, /requirePermission\('properties\.write'\).*requirePermission\('finance\.write'\)/)
assert.match(routes, /contributions\/:investmentId\/reverse/)
assert.match(routes, /distributions\/:distributionId\/reverse/)

assert.match(financeModel, /property_investment_contribution/)
assert.match(financeModel, /property_investor_distribution/)
assert.match(ownershipService, /const affectsProfit = false/)
assert.match(gl, /RETAINED_EARNINGS/)
assert.doesNotMatch(gl, /Property Investor Profit Distribution', type: 'EXPENSE'/)
assert.match(financeService, /affectsProfit: \{ \$ne: false \}/)
assert.match(gl, /PROPERTY_INVESTOR_CONTRIBUTION/)
assert.match(gl, /PROPERTY_INVESTOR_CAPITAL_RETURN/)
assert.match(gl, /PROPERTY_INVESTOR_PROFIT_DISTRIBUTION/)

assert.match(ownershipService, /Capital return cannot exceed the investor’s outstanding contributed capital/)
assert.match(ownershipService, /status = 'REVERSED'/)
assert.match(propertyService, /PROPERTY_INVESTOR_HISTORY_PROTECTED/)
assert.match(propertyService, /cleanupNonFinancialRecords/)

console.log('Property ownership Phase 3 architecture verification passed.')
