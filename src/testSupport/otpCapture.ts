type CapturedOtp = { code: string; purpose: string; capturedAt: Date }
const captured = new Map<string, CapturedOtp>()

const key = (phoneNumber: string, purpose: string) => `${phoneNumber}:${purpose}`

export const captureOtpForTest = (phoneNumber: string, purpose: string, code: string): void => {
  if (process.env.NODE_ENV !== 'test') return
  captured.set(key(phoneNumber, purpose), { code, purpose, capturedAt: new Date() })
}

export const readCapturedOtpForTest = (phoneNumber: string, purpose: string): string | null => {
  if (process.env.NODE_ENV !== 'test') return null
  return captured.get(key(phoneNumber, purpose))?.code || null
}

export const clearCapturedOtpsForTest = (): void => { captured.clear() }
