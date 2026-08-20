import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')
const mustContain = (source, token, label) => {
  if (!source.includes(token)) throw new Error(`${label}: missing ${token}`)
}
const mustMatch = (source, pattern, label) => {
  if (!pattern.test(source)) throw new Error(`${label}: contract mismatch ${pattern}`)
}

const requiredFiles = [
  'src/tests/contract/phase10FinalAcceptance.contract.test.ts',
  'src/tests/integration/phase10FinalAcceptance.integration.test.ts',
  'src/tests/integration/crmPhase14.integration.test.ts',
  'src/app/module/crm/crmListReadModel.service.ts',
  'src/app/module/notification/notification.service.ts',
  'src/app/module/subscriptionPayment/subscriptionPayment.service.ts',
  'src/app/module/billing/billing.controller.ts',
  'src/app/module/billing/subscriptionReceiptPdf.service.ts',
  'src/app/module/user/user.service.ts',
  'src/app/module/viewing/viewing.service.ts',
  'src/app/module/viewing/viewing.controller.ts',
  'src/app/module/realtime/realtime.service.ts',
  'src/app/module/domainEvent/domainEvent.service.ts',
]
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Final acceptance matrix is missing required file: ${file}`)
}

const crm = read('src/app/module/crm/crmListReadModel.service.ts')
const contact = read('src/app/module/contact/contact.service.ts')
const notification = read('src/app/module/notification/notification.service.ts')
const subscription = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
const billingController = read('src/app/module/billing/billing.controller.ts')
const receipt = read('src/app/module/billing/subscriptionReceiptPdf.service.ts')
const user = read('src/app/module/user/user.service.ts')
const viewing = read('src/app/module/viewing/viewing.service.ts')
const viewingController = read('src/app/module/viewing/viewing.controller.ts')
const realtime = read('src/app/module/realtime/realtime.service.ts')
const domain = read('src/app/module/domainEvent/domainEvent.service.ts')
const integration = read('src/tests/integration/phase10FinalAcceptance.integration.test.ts')

mustContain(crm, 'readContactListPageFallback', 'Contacts fallback')
mustContain(crm, "logger.warn('crm_contact_read_model_failed'", 'Contacts structured logging')
mustContain(crm, "sortSpec(options.sortBy, options.sortOrder, CONTACT_SORT_FIELDS, 'updatedAt')", 'Contacts newest-first ordering')
mustContain(contact, "Tenant context is required to list contacts", 'Contacts tenant isolation')

mustMatch(notification, /\{ _id: id, organizationId, userId, dismissedAt: null \}/, 'Notification owner scoping')
mustContain(notification, "emitNotification(organizationId, userId, row._id.toString(), 'deleted')", 'Notification realtime deletion')
mustContain(integration, 'prevents User A from dismissing User B notification', 'Notification cross-user integration test')

mustContain(subscription, "type: 'subscription.changed'", 'Subscription realtime')
mustContain(subscription, 'confirmationNoticeEligible: true', 'Subscription login fallback eligibility')
mustContain(subscription, 'customerAcknowledgedBy: { $ne: userId }', 'Subscription exactly-once lookup')
mustContain(subscription, '$addToSet: { customerAcknowledgedBy: userId }', 'Subscription persistent acknowledgement')
mustContain(subscription, "SubscriptionPayment.find({ organizationId }).sort({ createdAt: -1, _id: -1 })", 'Billing history ordering')
mustContain(integration, 'surfaces a later renewal as a new confirmation', 'Renewal integration test')

mustContain(billingController, "res.setHeader('Content-Type', 'application/pdf')", 'Receipt content type')
mustContain(receipt, "name: 'OPYGEN ESTATE'", 'Receipt branding')
mustContain(receipt, "productLine: 'A Product of Opygen'", 'Receipt product branding')
for (const field of ["'Receipt Number'", "'Payment Number'", "'Agency Name'", "'Customer Email'", "'TOTAL PAID'"]) {
  mustContain(receipt, field, 'Receipt detail layout')
}

mustContain(user, "'agencyOwnerProfile.showAsLicensedBroker': true", 'Owner broker visibility')
mustContain(user, "'agentProfile.showAsLicensedBroker': true", 'Member broker visibility')
mustContain(user, 'const LICENSE_PRESENT = /\\S/', 'Licensed broker license requirement')
mustContain(user, "Broker profile not found", 'Disabled broker direct-detail protection')
mustContain(integration, 'lets an active admin publish a licensed tenant member', 'Broker integration test')

mustContain(viewing, "{ sortBy: 'createdAt', sortOrder: 'desc' }", 'Viewing table newest-first ordering')
mustContain(viewing, 'paginationHelper.buildCalendarSort()', 'Viewing calendar chronological ordering')
mustContain(viewingController, 'MAX_CALENDAR_RANGE_DAYS = 62', 'Viewing bounded calendar range')
mustContain(viewing, "eventType:'viewing.deleted'", 'Viewing delete realtime publication')
mustContain(domain, "'viewing.deleted': { type: 'viewing', title: 'Viewing cancelled' }", 'Viewing delete activity projection')
mustContain(realtime, "viewing: 'viewing.changed'", 'Viewing realtime envelope')
mustContain(integration, 'orders the paginated viewing table newest-first and the calendar chronologically', 'Viewing ordering integration test')

const pkg = JSON.parse(read('package.json'))
if (!pkg.scripts?.['test:phase10']?.includes('phase10FinalAcceptance.contract.test.ts')) {
  throw new Error('test:phase10 must execute phase10FinalAcceptance.contract.test.ts')
}
if (!pkg.scripts?.['test:integration']?.includes('src/tests/integration')) {
  throw new Error('test:integration must execute the backend integration suite')
}
if (!pkg.scripts?.['verify:release']?.includes('pnpm test:phase10') || !pkg.scripts?.['verify:release']?.includes('pnpm test:integration')) {
  throw new Error('verify:release must enforce both Phase 10 contracts and integration tests')
}

console.log('Phase 10 backend final acceptance matrix contracts are present and wired into the release gate.')
