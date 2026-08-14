type CapturedOtp = { code: string; purpose: string; capturedAt: Date }
const captured = new Map<string, CapturedOtp>()

const key = (identity: string, purpose: string) => `${identity}:${purpose}`

export const captureOtpForTest = (identity: string, purpose: string, code: string): void => {
  if (process.env.NODE_ENV !== 'test') return
  captured.set(key(identity, purpose), { code, purpose, capturedAt: new Date() })
}

export const readCapturedOtpForTest = (identity: string, purpose: string): string | null => {
  if (process.env.NODE_ENV !== 'test') return null
  return captured.get(key(identity, purpose))?.code || null
}

export const clearCapturedOtpsForTest = (): void => { captured.clear() }
