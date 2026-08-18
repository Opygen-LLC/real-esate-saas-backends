export const CRM_FOLLOW_UP_TIME_ZONE = 'Asia/Dhaka'

type CalendarDate = { year: number; month: number; day: number }
type LocalDateTime = CalendarDate & { hour: number; minute: number; second: number; millisecond?: number }

const formatterCache = new Map<string, Intl.DateTimeFormat>()

const formatterFor = (timeZone: string) => {
  const cached = formatterCache.get(timeZone)
  if (cached) return cached
  // Constructing the formatter validates the IANA timezone identifier.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  formatterCache.set(timeZone, formatter)
  return formatter
}

const partsInZone = (date: Date, timeZone: string): LocalDateTime => {
  const parts = formatterFor(timeZone).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}

const offsetMsAt = (date: Date, timeZone: string): number => {
  const local = partsInZone(date, timeZone)
  const displayedAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second)
  const instantWithoutMs = Math.floor(date.getTime() / 1000) * 1000
  return displayedAsUtc - instantWithoutMs
}

/** Convert an IANA-zone wall-clock timestamp to the exact UTC instant without adding a timezone dependency. */
const localDateTimeToUtc = (local: LocalDateTime, timeZone: string): Date => {
  const wallClockUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    local.millisecond || 0,
  )
  let candidate = new Date(wallClockUtc)
  // Two passes handle offset changes around daylight-saving boundaries for future non-Bangladesh tenants.
  for (let pass = 0; pass < 2; pass += 1) {
    candidate = new Date(wallClockUtc - offsetMsAt(candidate, timeZone))
  }
  return candidate
}

const addCalendarDays = (date: CalendarDate, days: number): CalendarDate => {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }
}

export const getLocalCalendarDate = (reference: Date = new Date(), timeZone = CRM_FOLLOW_UP_TIME_ZONE): CalendarDate => {
  const local = partsInZone(reference, timeZone)
  return { year: local.year, month: local.month, day: local.day }
}

export const getDayBoundsInTimeZone = (reference: Date = new Date(), timeZone = CRM_FOLLOW_UP_TIME_ZONE) => {
  const localDate = getLocalCalendarDate(reference, timeZone)
  const nextDate = addCalendarDays(localDate, 1)
  const start = localDateTimeToUtc({ ...localDate, hour: 0, minute: 0, second: 0, millisecond: 0 }, timeZone)
  const endExclusive = localDateTimeToUtc({ ...nextDate, hour: 0, minute: 0, second: 0, millisecond: 0 }, timeZone)
  const localDateKey = `${String(localDate.year).padStart(4, '0')}-${String(localDate.month).padStart(2, '0')}-${String(localDate.day).padStart(2, '0')}`
  return {
    timeZone,
    localDate: localDateKey,
    start,
    endExclusive,
    endInclusive: new Date(endExclusive.getTime() - 1),
  }
}

export const getWeekBoundsInTimeZone = (reference: Date = new Date(), timeZone = CRM_FOLLOW_UP_TIME_ZONE) => {
  const localDate = getLocalCalendarDate(reference, timeZone)
  // Use the local calendar date as a UTC-only calendar value so weekday math is not
  // affected by the server timezone. Monday is the CRM week start.
  const localWeekday = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day)).getUTCDay()
  const daysSinceMonday = (localWeekday + 6) % 7
  const weekStartDate = addCalendarDays(localDate, -daysSinceMonday)
  const nextWeekDate = addCalendarDays(weekStartDate, 7)
  const start = localDateTimeToUtc({ ...weekStartDate, hour: 0, minute: 0, second: 0, millisecond: 0 }, timeZone)
  const endExclusive = localDateTimeToUtc({ ...nextWeekDate, hour: 0, minute: 0, second: 0, millisecond: 0 }, timeZone)
  return {
    timeZone,
    start,
    endExclusive,
    endInclusive: new Date(endExclusive.getTime() - 1),
  }
}
