export const normalizeEmail = (value: string): string => value.trim().toLowerCase()

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯'

export const normalizeDigits = (value: string): string =>
  value.normalize('NFKC').replace(/[০-৯]/g, digit => String(BANGLA_DIGITS.indexOf(digit)))

// ITU country calling codes. This keeps the CRM validator strict enough to reject
// structurally invalid international numbers without coupling authentication/OTP
// to any new country policy. Bangladesh local mobile numbers remain a convenience
// input and are normalized to E.164.
const COUNTRY_CALLING_CODES = new Set([
  '1','7','20','27','30','31','32','33','34','36','39','40','41','43','44','45','46','47','48','49',
  '51','52','53','54','55','56','57','58','60','61','62','63','64','65','66','81','82','84','86','90','91','92','93','94','95','98',
  '211','212','213','216','218','220','221','222','223','224','225','226','227','228','229','230','231','232','233','234','235','236','237','238','239','240','241','242','243','244','245','246','248','249','250','251','252','253','254','255','256','257','258','260','261','262','263','264','265','266','267','268','269',
  '290','291','297','298','299','350','351','352','353','354','355','356','357','358','359','370','371','372','373','374','375','376','377','378','379','380','381','382','383','385','386','387','389',
  '420','421','423','500','501','502','503','504','505','506','507','508','509','590','591','592','593','594','595','596','597','598','599',
  '670','672','673','674','675','676','677','678','679','680','681','682','683','685','686','687','688','689','690','691','692',
  '850','852','853','855','856','880','886','960','961','962','963','964','965','966','967','968','970','971','972','973','974','975','976','977','992','993','994','995','996','998',
])

const hasKnownCallingCode = (digits: string): boolean =>
  [1, 2, 3].some(length => digits.length > length && COUNTRY_CALLING_CODES.has(digits.slice(0, length)))

export const normalizeInternationalPhone = (value: string): string => {
  const normalized = normalizeDigits(String(value || '')).trim()
  if (!normalized) throw new Error('Phone number is required')

  const compact = normalized.replace(/[\s().-]/g, '')

  // Backward-compatible convenience for the product's Bangladesh home market.
  if (/^01[3-9]\d{8}$/.test(compact)) return `+880${compact.slice(1)}`
  if (/^8801[3-9]\d{8}$/.test(compact)) return `+${compact}`

  const withPlus = compact.startsWith('00') ? `+${compact.slice(2)}` : compact
  if (!withPlus.startsWith('+')) {
    throw new Error('Enter an international phone number with country code, for example +14155552671')
  }

  const digits = withPlus.slice(1)
  if (!/^[1-9]\d{7,14}$/.test(digits) || !hasKnownCallingCode(digits)) {
    throw new Error('Enter a valid international phone number with country code')
  }

  // Preserve the stricter Bangladesh mobile rule when +880 is used.
  if (digits.startsWith('880') && !/^8801[3-9]\d{8}$/.test(digits)) {
    throw new Error('Enter a valid Bangladesh mobile number or another valid international number')
  }

  return `+${digits}`
}

export const normalizeBangladeshPhone = (value: string): string => {
  const normalized = normalizeInternationalPhone(value)
  if (!/^\+8801[3-9]\d{8}$/.test(normalized)) throw new Error('Phone number must be a valid Bangladesh mobile number')
  return normalized
}

export const normalizeSubdomain = (value: string): string => value.normalize('NFKD').toLowerCase()
  .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

export const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'app', 'admin', 'super-admin', 'support', 'help', 'billing', 'mail',
  'cdn', 'static', 'assets', 'status', 'demo', 'staging', 'dev', 'test', 'login', 'signup',
])
