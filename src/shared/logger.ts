/* eslint-disable no-console */
import { createLogger, format, transports } from 'winston'
import path from 'path'
const { combine, timestamp, label, printf } = format

const myFormat = printf(({ level, message, label: logLabel, timestamp: logTimestamp }) => {
  const date = new Date(logTimestamp as string)
  const hour = date.getHours()
  const minutes = date.getMinutes()
  const seconds = date.getSeconds()
  return `${date.toDateString()} ${hour}:${minutes}:${seconds} [${logLabel}] ${level}: ${message}`
})

const logger = createLogger({
  level: 'info',
  format: combine(label({ label: 'REAL-ESTATE-SAAS' }), timestamp(), myFormat),
  transports: [
    new transports.Console(),
  ],
})

const errorLogger = createLogger({
  level: 'error',
  format: combine(label({ label: 'REAL-ESTATE-SAAS' }), timestamp(), myFormat),
  transports: [
    new transports.Console(),
  ],
})

export { logger, errorLogger }
