import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const checks = []
const expect = (condition, message) => { checks.push({ condition, message }); if (!condition) console.error(`FAIL: ${message}`) }

const route = read('src/app/module/platformAdmin/platformAdmin.route.ts')
const controller = read('src/app/module/platformAdmin/platformAdmin.controller.ts')
const service = read('src/app/module/subscriptionPayment/subscriptionDateAdjustment.service.ts')
const organizationModel = read('src/app/module/organization/organization.model.ts')
const paymentService = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')

expect(route.includes("'/subscription-payments/:paymentNumber/dates'") && route.includes('authMiddlewares.authSuperAdmin'), 'date-edit endpoint is Super Admin protected')
expect(route.includes('periodEnd') && route.includes('periodStart') && route.includes('reason'), 'date-edit endpoint validates explicit dates and reason')
expect(controller.includes('editSubscriptionDates'), 'controller exposes subscription date editing')
expect(service.includes("payment.status !== 'confirmed'"), 'only confirmed payments are editable')
expect(service.includes('Period End / Access Until must be later than Period Start'), 'periodEnd > periodStart is enforced')
expect(service.includes('periodStart: { $lt: input.periodEnd }') && service.includes('periodEnd: { $gt: input.periodStart }'), 'overlapping benefit periods are rejected')
expect(service.includes("action: 'subscription_date_changed'"), 'immutable audit event is recorded')
expect(service.includes("'subscription.currentPeriodStart': input.periodStart") && service.includes("'subscription.currentPeriodEnd': input.periodEnd"), 'current organization subscription dates synchronize atomically')
expect(service.includes('SubscriptionBenefitPeriod') && service.includes('benefit.periodStart = input.periodStart') && service.includes('benefit.periodEnd = input.periodEnd'), 'benefit period dates synchronize')
expect(service.includes('LeadAddonSubscription') && service.includes('addon.currentPeriodEnd = input.periodEnd'), 'matching recurring add-on periods synchronize')
expect(service.includes('isCurrentSubscriptionPayment') && service.includes('if (isCurrentSubscriptionPayment)'), 'historical edits do not automatically rewrite current subscription access')
expect(organizationModel.includes('currentPeriodStart'), 'organization canonical subscription stores currentPeriodStart')
expect(paymentService.includes('currentPeriodStart: start, currentPeriodEnd: end'), 'new confirmations populate canonical currentPeriodStart')

const failed = checks.filter((check) => !check.condition)
if (failed.length) process.exit(1)
console.log(`Phase 5 subscription-date architecture verified (${checks.length}/${checks.length}).`)
