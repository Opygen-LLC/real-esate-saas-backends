import { describe, expect, it } from 'vitest'
import { httpErrorEvent, httpLogLevelForStatus } from '../../shared/httpObservability'

describe('Phase 4 operational HTTP logging', () => {
  it('keeps expected client outcomes below error severity', () => {
    expect(httpLogLevelForStatus(400, 'VALIDATION_ERROR')).toBe('info')
    expect(httpLogLevelForStatus(401, 'UNAUTHORIZED')).toBe('info')
    expect(httpLogLevelForStatus(402, 'SUBSCRIPTION_INACTIVE')).toBe('info')
    expect(httpLogLevelForStatus(403, 'FORBIDDEN')).toBe('warn')
    expect(httpLogLevelForStatus(429, 'RATE_LIMITED')).toBe('warn')
  })

  it('keeps genuine server faults visible', () => {
    expect(httpLogLevelForStatus(500, 'INTERNAL_ERROR')).toBe('error')
    expect(httpLogLevelForStatus(503, 'OBJECT_STORAGE_UNAVAILABLE')).toBe('error')
    expect(httpErrorEvent(500)).toBe('request_failed')
    expect(httpErrorEvent(401)).toBe('request_rejected')
  })
})
