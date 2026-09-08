import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const assert = (condition, message) => { if (!condition) throw new Error(message) }

const route = read('src/app/module/customerFinance/customerFinance.route.ts')
const service = read('src/app/module/customerFinance/customerFinance.service.ts')
const projection = read('src/app/module/customerFinance/customerFinanceProjection.service.ts')
const bookingModel = read('src/app/module/customerFinance/saleBooking.model.ts')
const installmentModel = read('src/app/module/customerFinance/installment.model.ts')
const financeService = read('src/app/module/finance/finance.service.ts')
const financeModel = read('src/app/module/finance/finance.model.ts')
const reminder = read('src/app/module/customerFinance/installmentReminder.service.ts')
const routes = read('src/app/routes/index.ts')

assert(route.includes("requireEntitlement('CUSTOMER_FINANCE')"), 'Customer Finance routes must enforce CUSTOMER_FINANCE')
assert(route.includes("/:contactId/profile"), 'Customer profile endpoint is missing')
assert(route.includes("/:contactId/bookings"), 'Customer booking endpoint is missing')
assert(route.includes("/bookings/:bookingId/payments"), 'Customer payment endpoint is missing')
assert(service.includes('paymentPlanSnapshot: snapshot'), 'Booking must freeze a payment-plan snapshot')
assert(service.includes('FinanceService.createCustomerFinanceBookingInvoice'), 'Booking must create a Finance-backed receivable through Finance')
assert(financeService.includes('createCustomerFinanceBookingInvoice') && financeService.includes('postInvoiceRevenue'), 'Customer Finance invoice creation must preserve Advanced Accounting posting semantics')
assert(service.includes("type: 'installment_reminder'") && service.includes('scheduleMany'), 'Installment reminders must be scheduled in a batched durable queue write')
assert(service.includes("kind: 'due_7_days'") && service.includes("kind: 'due_tomorrow'") && service.includes("kind: 'overdue'"), 'All three reminder timings must exist')
assert(bookingModel.includes('sale_booking_one_open_property_unique'), 'Concurrent open booking protection is missing')
assert(installmentModel.includes('installment_tenant_booking_sequence_unique'), 'Installment sequence uniqueness is missing')
assert(financeModel.includes('finance_invoice_tenant_booking_unique'), 'Booking/invoice one-to-one index is missing')
assert(financeService.includes('syncBookingPaymentProjection'), 'Finance payments must synchronize Customer Finance')
assert(financeService.includes("feature: 'customer_finance'") && financeService.includes("'FEATURE_NOT_INCLUDED'"), 'Generic Finance payment entry points must enforce Customer Finance for booking invoices')
assert(projection.includes("status: 'Completed'") && projection.includes("status: 'Sold'"), 'Fully paid bookings must complete and mark the property sold')
assert(reminder.includes('FinanceInvoice.findOne') && reminder.includes('projectInstallments'), 'Reminder delivery must recheck Finance payment truth')
assert(routes.includes("path: '/customers'"), 'Customer Finance router is not mounted')

console.log('Customer Finance Phase 2 backend source contract: OK')
