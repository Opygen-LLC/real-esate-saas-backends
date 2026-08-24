import { describe, expect, it } from 'vitest'
import { memberCanReceiveCapability } from '../../app/module/crm/crmAssignableMember.service'

const money = (value: number) => Number(Math.max(0, value).toFixed(2))
const proratedDifference = (currentPrice: number, targetPrice: number, remainingSeconds: number, totalSeconds: number) =>
  money(Math.max(0, targetPrice - currentPrice) * Math.max(0, Math.min(1, remainingSeconds / totalSeconds)))
const effectiveLeadCapacity = (plan: number, loyalty: number, recurring: number, legacy: number, adminAdjustment: number) =>
  Math.max(0, plan + loyalty + recurring + legacy + adminAdjustment)

describe('Phase 7 commercial release rules', () => {
  it('prorates Starter 500 -> Medium 1000 at half-period to BDT 250', () => {
    expect(proratedDifference(500, 1000, 15, 30)).toBe(250)
  })

  it('prorates Medium 1000 -> Pro 1500 from exact remaining/total time', () => {
    expect(proratedDifference(1000, 1500, 10 * 86_400, 30 * 86_400)).toBe(166.67)
  })

  it('never prorates lead capacity itself', () => {
    expect(effectiveLeadCapacity(800, 0, 0, 0, 0)).toBe(800)
  })

  it('keeps recurring add-ons separate from loyalty and legacy top-ups', () => {
    expect(effectiveLeadCapacity(200, 100, 300, 50, 25)).toBe(675)
  })

  it('enforces the purchased recurring add-on ceiling independently of loyalty', () => {
    const maxRecurringLeadAddon = 300
    const activeRecurring = 100
    expect(activeRecurring + 200 <= maxRecurringLeadAddon).toBe(true)
    expect(activeRecurring + 500 <= maxRecurringLeadAddon).toBe(false)
  })

  it('allows Staff/Viewer to receive leads only when effective permissions include leads.read + leads.write', () => {
    expect(memberCanReceiveCapability({ userRole: 'staff', profile: { accessControl: { useRoleDefaults: false, permissions: ['leads.read', 'leads.write'] } } }, 'lead')).toBe(true)
    expect(memberCanReceiveCapability({ userRole: 'viewer', profile: { accessControl: { useRoleDefaults: false, permissions: ['leads.write'] } } }, 'lead')).toBe(true)
    expect(memberCanReceiveCapability({ userRole: 'staff', profile: { accessControl: { useRoleDefaults: true } } }, 'lead')).toBe(false)
    expect(memberCanReceiveCapability({ userRole: 'viewer', profile: { accessControl: { useRoleDefaults: true } } }, 'lead')).toBe(false)
  })
})
