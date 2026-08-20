import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

const service = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
const model = read('src/app/module/subscriptionChangeRequest/subscriptionChangeRequest.model.ts')
const contract = read('src/app/module/subscriptionChangeRequest/subscriptionChangeRequest.interface.ts')
const controller = read('src/app/module/billing/billing.controller.ts')

describe('Phase 4 subscription request WhatsApp contract', () => {
  it('snapshots authoritative plan name, version, price, cycle and BDT currency on request creation', () => {
    expect(model).toContain('requestedPlanName')
    expect(contract).toContain('requestedPlanName?: string')
    expect(service).toContain('requestedPlanName: plan.name')
    expect(service).toContain('amount: priceFor(plan, input.billingCycle)')
    expect(service).toContain("currency: 'BDT'")
    expect(service).toContain('billingCycle: input.billingCycle')
    expect(service).toContain('return toChangeRequestContract(request, plan.name)')
  })

  it('keeps the create request API response server-authoritative', () => {
    expect(controller).toContain('SubscriptionPaymentService.createChangeRequest')
    expect(controller).toContain('data: result')
    expect(service).toContain('requestNumber: serial(\'REQ\')')
  })

  it('enriches legacy pending requests that predate requestedPlanName', () => {
    expect(service).toContain('request.requestedPlanName')
    expect(service).toContain("SubscriptionPlan.findOne({ planId: request.requestedPlan, version: request.requestedPlanVersion })")
    expect(service).toContain('toChangeRequestContract(request, plan?.name)')
  })

  it('translates concurrent duplicate open-request creation into a conflict instead of leaking a duplicate-key error', () => {
    expect(service).toContain('Number(error?.code) !== 11000')
    expect(service).toContain('A subscription request is already open')
    expect(service).toContain('httpStatus.CONFLICT')
  })
})
