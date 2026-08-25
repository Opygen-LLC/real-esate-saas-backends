import fs from 'fs/promises'
import path from 'path'
import { DatabaseBackupService } from './databaseBackup.service'
import { loadDatabaseBackupConfig } from './databaseBackup.config'
import { logger } from '../../../shared/logger'

type CronField = { raw: string; values: Set<number>; wildcard: boolean }
type ParsedCron = {
  minute: CronField
  hour: CronField
  dayOfMonth: CronField
  month: CronField
  dayOfWeek: CronField
}

const expandCronField = (raw: string, min: number, max: number, sundaySeven = false): CronField => {
  const input = raw.trim()
  if (!input) throw new Error('Cron field cannot be empty')
  const values = new Set<number>()
  const add = (value: number): void => {
    const normalized = sundaySeven && value === 7 ? 0 : value
    if (normalized < min || normalized > max) throw new Error(`Cron value ${value} is outside ${min}-${max}`)
    values.add(normalized)
  }

  for (const part of input.split(',')) {
    const [base, stepRaw] = part.split('/')
    const step = stepRaw ? Number(stepRaw) : 1
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step: ${part}`)
    let start: number
    let end: number
    if (base === '*') {
      start = min
      end = sundaySeven ? 7 : max
    } else if (base.includes('-')) {
      const [startRaw, endRaw] = base.split('-')
      start = Number(startRaw)
      end = Number(endRaw)
    } else {
      const value = Number(base)
      if (!Number.isInteger(value)) throw new Error(`Invalid cron value: ${part}`)
      if (!stepRaw) {
        add(value)
        continue
      }
      start = value
      end = sundaySeven ? 7 : max
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) throw new Error(`Invalid cron range: ${part}`)
    for (let value = start; value <= end; value += step) add(value)
  }
  return { raw: input, values, wildcard: input.startsWith('*') }
}

export const parseBackupCron = (expression: string): ParsedCron => {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error('BACKUP_CRON must contain exactly 5 fields: minute hour day-of-month month day-of-week')
  return {
    minute: expandCronField(fields[0], 0, 59),
    hour: expandCronField(fields[1], 0, 23),
    dayOfMonth: expandCronField(fields[2], 1, 31),
    month: expandCronField(fields[3], 1, 12),
    dayOfWeek: expandCronField(fields[4], 0, 6, true),
  }
}

const zonedParts = (date: Date, timeZone: string): { minute: number; hour: number; day: number; month: number; year: number; dow: number } => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
  const dow = new Date(Date.UTC(map.year, map.month - 1, map.day)).getUTCDay()
  return { minute: map.minute, hour: map.hour, day: map.day, month: map.month, year: map.year, dow }
}

export const cronMatches = (cron: ParsedCron, date: Date, timeZone: string): boolean => {
  const local = zonedParts(date, timeZone)
  if (!cron.minute.values.has(local.minute) || !cron.hour.values.has(local.hour) || !cron.month.values.has(local.month)) return false
  const domMatch = cron.dayOfMonth.values.has(local.day)
  const dowMatch = cron.dayOfWeek.values.has(local.dow)
  if (!cron.dayOfMonth.wildcard && !cron.dayOfWeek.wildcard) return domMatch || dowMatch
  return domMatch && dowMatch
}

const localMinuteKey = (date: Date, timeZone: string): string => {
  const local = zonedParts(date, timeZone)
  return `${local.year}-${local.month}-${local.day}-${local.hour}-${local.minute}`
}

export const startDatabaseBackupScheduler = async (): Promise<void> => {
  const config = loadDatabaseBackupConfig()
  const cron = parseBackupCron(config.cron)
  const heartbeat = path.join(config.archiveDir, '.scheduler-heartbeat')
  await fs.mkdir(config.archiveDir, { recursive: true, mode: 0o700 })
  let stopping = false
  let running = false
  let lastRunMinute = ''

  const writeHeartbeat = async (): Promise<void> => {
    await fs.writeFile(heartbeat, `${new Date().toISOString()}\n`, { encoding: 'utf8', mode: 0o600 }).catch(() => undefined)
  }
  const heartbeatTimer = setInterval(() => { void writeHeartbeat() }, 30_000)
  heartbeatTimer.unref()
  await writeHeartbeat()

  const stop = (signal: string): void => {
    stopping = true
    clearInterval(heartbeatTimer)
    logger.info('database_backup_scheduler_stopping', { signal, running })
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))

  logger.info('database_backup_scheduler_started', {
    cron: config.cron,
    timezone: config.timezone,
    retentionDays: config.retentionDays,
  })

  while (!stopping) {
    const now = new Date()
    const minuteKey = localMinuteKey(now, config.timezone)
    if (!running && minuteKey !== lastRunMinute && cronMatches(cron, now, config.timezone)) {
      lastRunMinute = minuteKey
      running = true
      try {
        await DatabaseBackupService.runOnce()
      } catch (error) {
        logger.error('database_backup_scheduled_run_failed', { error })
      } finally {
        running = false
      }
    }
    await writeHeartbeat()
    await new Promise((resolve) => setTimeout(resolve, 15_000))
  }
}

if (require.main === module) {
  void startDatabaseBackupScheduler().catch((error) => {
    logger.error('database_backup_scheduler_failed', { error })
    process.exitCode = 1
  })
}
