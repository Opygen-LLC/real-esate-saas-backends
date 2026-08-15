import { z } from 'zod'
import { normalizeBangladeshPhone, normalizeEmail } from './identity'

const validateBangladeshPhone = (value: string): boolean => {
  try {
    normalizeBangladeshPhone(value)
    return true
  } catch {
    return false
  }
}

export const bangladeshPhoneSchema = z.string()
  .trim()
  .min(1, 'Phone number is required')
  .max(40, 'Phone number is too long')
  .refine(validateBangladeshPhone, 'Enter a valid Bangladesh mobile number')
  .transform(normalizeBangladeshPhone)

export const optionalBangladeshPhoneSchema = z.union([
  z.literal(''),
  bangladeshPhoneSchema,
]).optional()

export const emailSchema = z.string()
  .trim()
  .min(1, 'Email address is required')
  .max(254, 'Email address is too long')
  .email('Enter a valid email address')
  .transform(normalizeEmail)

export const optionalEmailSchema = z.union([
  z.literal(''),
  emailSchema,
]).optional()

export const appointmentDateSchema = z.string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid appointment date')

export const appointmentTimeSchema = z.string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a valid appointment time')

const dhakaDateTimeMs = (date: string, time: string): number => Date.parse(`${date}T${time}:00+06:00`)

export const addAppointmentWindowValidation = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) => schema.superRefine((value, ctx) => {
  const date = String((value as Record<string, unknown>).date || '')
  const startTime = String((value as Record<string, unknown>).startTime || '')
  const endTime = String((value as Record<string, unknown>).endTime || '')
  if (!date || !startTime || !endTime) return

  const start = dhakaDateTimeMs(date, startTime)
  const end = dhakaDateTimeMs(date, endTime)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return

  if (end <= start) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endTime'], message: 'End time must be after start time' })
  }

  if (start <= Date.now()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startTime'], message: 'Viewing time must be in the future' })
  }

  const maxFuture = Date.now() + 366 * 24 * 60 * 60 * 1000
  if (start > maxFuture) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['date'], message: 'Viewing date cannot be more than one year in the future' })
  }
})
