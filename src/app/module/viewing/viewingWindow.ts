import ApiError from '../../../errors/ApiError'

export const ACTIVE_VIEWING_STATUSES = ['Scheduled', 'Confirmed', 'Rescheduled'] as const
export const isActiveViewingStatus = (status: string): boolean => (ACTIVE_VIEWING_STATUSES as readonly string[]).includes(status)

/** Half-open intervals: 10:00-11:00 and 11:00-12:00 do not overlap. */
export const viewingWindowsOverlap = (start: string, end: string, otherStart: string, otherEnd: string): boolean =>
  start < otherEnd && end > otherStart

export const assertViewingWindow = (date: string, startTime: string, endTime: string, future = false, now = Date.now()): void => {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  const day = Date.parse(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date) {
    throw new ApiError(400, 'Choose a valid viewing date', '', 'VIEWING_INVALID_WINDOW', undefined, { date: ['Choose a valid calendar date'] })
  }
  if (!time.test(startTime) || !time.test(endTime) || endTime <= startTime) {
    throw new ApiError(400, 'End time must be after start time on the same day', '', 'VIEWING_INVALID_WINDOW', undefined, { endTime: ['End time must be after start time'] })
  }
  if (future && Date.parse(`${date}T${startTime}:00+06:00`) <= now) {
    throw new ApiError(400, 'Choose a future viewing time', '', 'VIEWING_TIME_PAST', undefined, { startTime: ['Viewing time must be in the future'] })
  }
}
