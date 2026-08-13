export const normalizeEmail = (value: string): string => value.trim().toLowerCase()

export const normalizeBangladeshPhone = (value: string): string => {
  const compact = value.replace(/[\s()-]/g, '')
  let national = compact
  if (compact.startsWith('+880')) national = `0${compact.slice(4)}`
  else if (compact.startsWith('880')) national = `0${compact.slice(3)}`
  if (!/^01[3-9]\d{8}$/.test(national)) throw new Error('Phone number must be a valid Bangladesh mobile number')
  return `+880${national.slice(1)}`
}

export const normalizeSubdomain = (value: string): string => value.normalize('NFKD').toLowerCase()
  .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

export const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'app', 'admin', 'super-admin', 'support', 'help', 'billing', 'mail',
  'cdn', 'static', 'assets', 'status', 'demo', 'staging', 'dev', 'test', 'login', 'signup',
])
