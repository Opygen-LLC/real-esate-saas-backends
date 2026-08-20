import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('subscription requests and CRM pagination contracts', () => {
  it('serves subscription requests from a dedicated paginated super-admin endpoint', () => {
    const route = read('src/app/module/platformAdmin/platformAdmin.route.ts')
    const service = read('src/app/module/platformAdmin/platformAdmin.service.ts')

    expect(route).toContain("router.get('/subscription-requests'")
    expect(route).toContain('authMiddlewares.authSuperAdmin')
    expect(service).toContain('const getSubscriptionRequests = async')
    expect(service).toContain('.skip((page - 1) * limit)')
    expect(service).toContain('.limit(limit)')
    expect(service).toContain('totalPages: Math.ceil(total / Math.max(limit, 1))')
    expect(service).toContain('SubscriptionChangeRequest.countDocuments(filter)')
  })

  it('notifies super-admins as soon as an agency creates or cancels a package request', () => {
    const payments = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
    const platform = read('src/app/module/platformAdmin/platformAdmin.service.ts')

    expect(payments).toContain("RealtimeService.emitRole('super-admin'")
    expect(payments).toContain("eventType: 'subscription.change_requested'")
    expect(payments).toContain("eventType: 'subscription.change_cancelled'")
    expect(platform).toContain("type: 'subscription_request'")
    expect(platform).toContain('/dashboard/super-admin/subscription-requests?search=')
  })

  it('keeps task list totals correct while fetching only one page and exposes lead totalPages', () => {
    const tasks = read('src/app/module/task/task.service.ts')
    const leads = read('src/app/module/lead/lead.service.ts')

    expect(tasks).toContain('.skip(skip)')
    expect(tasks).toContain('.limit(limit)')
    expect(tasks).toContain("Task.aggregate([");
    expect(tasks).toContain('dueToday:')
    expect(tasks).toContain('overdue:')
    expect(tasks).toContain('completed:')
    expect(leads).toContain('totalPages:Math.ceil(pageResult.total/Math.max(limit,1))')
  })

  it('retains the Starter 200 base + 50 consecutive monthly renewal policy', () => {
    const migration = read('src/app/db/migrateStarterPlanVNext.ts')
    const benefits = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')

    expect(migration).toContain('baseMonthlyLeadAllowance: 200')
    expect(migration).toContain('renewalLeadBonus: 50')
    expect(migration).toContain('grandfatherExisting: true')
    expect(benefits).toContain('Math.max(0, renewalStreak - 1) * renewalLeadBonus')
    expect(benefits).toContain('totalLeadAllowance: baseLeadAllowance + bonusLeadAllowance')
  })
})
