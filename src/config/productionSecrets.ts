const PLACEHOLDER_PATTERNS = [
  /development[-_ ]?only/i,
  /change[-_ ]?me/i,
  /placeholder/i,
  /example/i,
  /sample/i,
  /super[-_ ]?secure/i,
  /real[-_ ]?estate[-_ ]?saas/i,
  /secret[-_ ]?key[-_ ]?2026/i,
  /(?:^|[-_ ])default(?:$|[-_ ])/i,
  /password/i,
  /qwerty/i,
]

const assertNotPlaceholder = (name: string, value: string) => {
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error(`Missing or insecure production configuration: ${name} uses a known placeholder/default value`)
  }
  if (/\s/.test(value)) {
    throw new Error(`Missing or insecure production configuration: ${name} must not contain whitespace`)
  }
  if (new Set(value).size < 10) {
    throw new Error(`Missing or insecure production configuration: ${name} does not contain enough unique characters`)
  }
}

export const requireProductionSecret = (
  env: NodeJS.ProcessEnv,
  name: string,
  minimumLength = 32,
): string => {
  const value = env[name]?.trim() || ''
  if (!value || value.length < minimumLength) {
    throw new Error(`Missing or insecure production configuration: ${name}`)
  }
  assertNotPlaceholder(name, value)
  return value
}

export const assertDistinctProductionSecrets = (entries: Array<[string, string]>) => {
  const byValue = new Map<string, string>()
  for (const [name, value] of entries) {
    const previous = byValue.get(value)
    if (previous) {
      throw new Error(`Missing or insecure production configuration: ${name} must not reuse ${previous}`)
    }
    byValue.set(value, name)
  }
}
