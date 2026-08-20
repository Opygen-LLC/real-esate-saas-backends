import { describe, expect, it } from 'vitest'
import { API_ERROR_CODES, buildFieldErrors, defaultErrorCodeForStatus } from '../../contracts/apiContract'
import handleZodError from '../../errors/handleZodError'
import { z } from 'zod'
import { DASHBOARD_LIST_ORDER, PHASE0_REGRESSION_CONTRACTS } from '../../contracts/dashboardRegressionContracts'
import { paginationHelper, buildStableSort } from '../../app/helpers/paginationHelper'

describe('API error contract', () => {
  it('groups validation messages by stable field path', () => {
    expect(buildFieldErrors([
      { path: 'phone', message: 'Invalid phone' },
      { path: 'phone', message: 'Invalid phone' },
      { path: 'email', message: 'Invalid email' },
    ])).toEqual({ phone: ['Invalid phone'], email: ['Invalid email'] })
  })

  it('maps Zod body paths to frontend field names', () => {
    const schema = z.object({ body: z.object({ defaultLanguage: z.enum(['en', 'bn']) }) })
    const result = schema.safeParse({ body: { defaultLanguage: 'বাংলা' } })
    expect(result.success).toBe(false)
    if (result.success) return
    const error = handleZodError(result.error)
    expect(error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR)
    expect(error.fieldErrors?.defaultLanguage?.[0]).toBeTruthy()
    expect(error.message).toBe('Please correct the highlighted fields')
  })

  it('uses stable default error codes for common HTTP statuses', () => {
    expect(defaultErrorCodeForStatus(401)).toBe('UNAUTHORIZED')
    expect(defaultErrorCodeForStatus(404)).toBe('NOT_FOUND')
    expect(defaultErrorCodeForStatus(409)).toBe('CONFLICT')
    expect(defaultErrorCodeForStatus(500)).toBe('INTERNAL_ERROR')
  })
})


describe('Phase 0 dashboard regression contracts', () => {
  it('standardizes newest-first historical lists and contact recency ordering', () => {
    expect(DASHBOARD_LIST_ORDER.historical).toEqual({ primary: 'createdAt', direction: 'desc', tieBreaker: '_id', tieBreakerDirection: 'desc' })
    expect(DASHBOARD_LIST_ORDER.contacts).toEqual({ primary: 'updatedAt', direction: 'desc', tieBreaker: '_id', tieBreakerDirection: 'desc' })
    expect(paginationHelper.calculatePagination({} as any)).toMatchObject({ sortBy: 'createdAt', sortOrder: -1 })
    expect(paginationHelper.calculatePagination({} as any, { sortBy: 'updatedAt', sortOrder: 'desc' })).toMatchObject({ sortBy: 'updatedAt', sortOrder: -1 })
    expect(buildStableSort('createdAt', -1)).toEqual({ createdAt: -1, _id: -1 })
  })

  it('keeps calendars chronological and freezes the eight remediation contracts', () => {
    expect(DASHBOARD_LIST_ORDER.calendar).toMatchObject({ primary: 'date', direction: 'asc', secondary: 'startTime', tieBreaker: '_id' })
    expect(PHASE0_REGRESSION_CONTRACTS.contacts.tenantScoped).toBe(true)
    expect(PHASE0_REGRESSION_CONTRACTS.notifications.clickBehavior).toEqual(['dismiss', 'navigate'])
    expect(PHASE0_REGRESSION_CONTRACTS.teamRolePercentages.independentPerRole).toBe(true)
    expect(PHASE0_REGRESSION_CONTRACTS.teamRolePercentages.activeRolePercentage).toBe(100)
    expect(PHASE0_REGRESSION_CONTRACTS.subscriptionConfirmation.oncePerPayment).toBe(true)
    expect(PHASE0_REGRESSION_CONTRACTS.receiptDownload.contentType).toBe('application/pdf')
    expect(PHASE0_REGRESSION_CONTRACTS.publicBrokers.adminControlled).toBe(true)
    expect(PHASE0_REGRESSION_CONTRACTS.viewings.tabs).toEqual(['table', 'calendar'])
  })
})
