// Authoritative marketing content contract. Generated into the frontend.
import type { ContractIssue } from './query'

export type WebsiteGalleryImage = { image: string; alt: string; title: string; subtitle: string; tag: string; focalX?: number; focalY?: number; fit?: 'cover' | 'contain'; decorative?: boolean }
export type WebsiteFeature = { title: string; description: string }
export type WebsiteStat = { label: string; value: string; caption: string }

export type WebsiteContent = {
  navigation: {
    tagline: string
    homeLabel: string
    propertiesLabel: string
    agentsLabel: string
    aboutLabel: string
    contactLabel: string
    headerCtaLabel: string
    footerDescription: string
    footerTrustText: string
  }
  home: {
    eyebrow: string
    heroTitle: string
    heroSubtitle: string
    heroImage: string
    heroGallery?: WebsiteGalleryImage[]
    trustItems: string[]
    featuredEyebrow: string
    featuredTitle: string
    featuredSubtitle: string
    whyEyebrow: string
    whyTitle: string
    whySubtitle: string
    features: WebsiteFeature[]
    agentsEyebrow: string
    agentsTitle: string
    agentsSubtitle: string
    consultationEyebrow: string
    consultationTitle: string
    consultationSubtitle: string
    consultationButtonText: string
    showFeaturedProperties: boolean
    showWhyChooseUs: boolean
    showAgents: boolean
    showConsultation: boolean
    heroCardBadge?: string
    heroCardTagline?: string
    heroCardTitle?: string
    heroCardSpecs?: string
    heroCardButtonText?: string
    heroCardLink?: string
    showHeroCard?: boolean
    heroPropertyId?: string
    featuredPropertyIds?: string[]
    useCuratedProperties?: boolean
    heroButtonText?: string
    heroButtonLink?: string
    secondaryButtonText?: string
    secondaryButtonLink?: string
  }
  about: {
    eyebrow: string
    title: string
    intro: string
    image: string
    storyTitle: string
    storyBody: string
    values: WebsiteFeature[]
    stats: WebsiteStat[]
    ctaEyebrow: string
    ctaTitle: string
    ctaText: string
    ctaButtonText: string
    showStats: boolean
  }
  properties: { eyebrow: string; title: string; subtitle: string }
  agents: { eyebrow: string; title: string; subtitle: string }
  contact: {
    eyebrow: string
    title: string
    subtitle: string
    officeTitle: string
    hoursTitle: string
    weekdaysHours: string
    fridayHours: string
    whatsappHours: string
    formTitle: string
    formSubtitle: string
    submitButtonText: string
  }
}

export const DEFAULT_WEBSITE_CONTENT: WebsiteContent = {
  navigation: {
    tagline: 'Professional Property Agency',
    homeLabel: 'Home',
    propertiesLabel: 'Properties',
    agentsLabel: 'Our Brokers',
    aboutLabel: 'About Agency',
    contactLabel: 'Contact',
    headerCtaLabel: 'Book Viewing',
    footerDescription: 'Residential flats, penthouses, plots (Katha/Bigha), rentals, and commercial spaces for buyers, tenants, and investors.',
    footerTrustText: 'Property information supplied by the agency',
  },
  home: {
    eyebrow: 'Agency Property Catalog · Bangladesh',
    heroTitle: 'Find Properties with {agencyName}',
    heroSubtitle: 'Explore residential flats, penthouses, commercial spaces, rentals, and land listings published by our agency.',
    heroImage: '',
    trustItems: ['Property Details Organized', 'Direct WhatsApp Video Tours', 'Agency Contact Ready'],
    featuredEyebrow: 'Exclusive Inventory',
    featuredTitle: 'Featured Property Listings',
    featuredSubtitle: 'Browse selected available listings from our current portfolio.',
    whyEyebrow: 'Trust & Transparency',
    whyTitle: 'Why Buy & Rent with {agencyName}',
    whySubtitle: 'We organize property information, viewing coordination, and agency contact details in one place.',
    features: [
      { title: 'Property Documentation', description: 'Review agency-provided approval, mutation, khatian, and holding-tax details where available, and verify documents independently before a transaction.' },
      { title: 'Instant WhatsApp Updates', description: 'Get immediate brochures, floor plans, and video walkthroughs directly on your mobile.' },
      { title: 'Scheduled Site Viewings', description: 'Efficient viewing routes coordinated around your preferred locations and schedule.' },
      { title: 'Clear Property Information', description: 'Discuss published asking prices, payment terms, and transaction details directly with our agency.' },
    ],
    agentsEyebrow: 'Professional Advisors',
    agentsTitle: 'Meet Our Property Advisors',
    agentsSubtitle: 'Experienced real estate advisors ready to assist with site viewings and legal closing.',
    consultationEyebrow: 'Schedule Appointment',
    consultationTitle: 'Request a Guided Property Site Tour',
    consultationSubtitle: 'Leave your contact details and our designated area broker will coordinate an in-person viewing at your preferred time.',
    consultationButtonText: 'Request Instant Viewing Appointment',
    showFeaturedProperties: true,
    showWhyChooseUs: true,
    showAgents: true,
    showConsultation: true,
    heroCardBadge: 'Sanctuary Collection',
    heroCardTagline: 'Peaceful Enclave',
    heroCardTitle: 'Explore our property collection',
    heroCardSpecs: '',
    heroCardButtonText: 'View Residence',
    heroCardLink: '/properties',
    showHeroCard: true,
    heroPropertyId: '',
    featuredPropertyIds: [],
    useCuratedProperties: false,
    heroButtonText: 'Explore properties',
    heroButtonLink: '/properties',
    secondaryButtonText: 'About the agency',
    secondaryButtonLink: '/about',
  },
  about: {
    eyebrow: 'Our Heritage & Advisory',
    title: 'Professional Real Estate Service in Bangladesh',
    intro: 'Built around clear property information and customer-first advisory, {agencyName} connects homebuyers, tenants, investors, and businesses with property opportunities.',
    image: '',
    storyTitle: 'A Legacy of Trusted Property Advisory',
    storyBody: 'We combine local neighborhood knowledge with organized digital property information to make discovery, viewings, and agency communication easier.',
    values: [
      { title: 'Organized Legal Information', description: 'Where supplied, title, mutation, khatian, approval, and tax details are presented clearly so clients can perform independent due diligence.' },
      { title: 'Off-Market & Ready Flat Access', description: 'Access newly completed apartments, commercial floors, and land opportunities before wider release.' },
      { title: 'Dedicated Expatriate & NRI Support', description: 'Property acquisition support, documentation assistance, and video walkthroughs for Bangladeshis worldwide.' },
    ],
    stats: [],
    ctaEyebrow: 'Direct Agency Advisory',
    ctaTitle: 'Partner with {agencyName} for Your Next Property',
    ctaText: 'Whether you are acquiring a residential flat, investing in commercial space, or exploring land, our team is ready to assist.',
    ctaButtonText: 'Schedule Private Consultation',
    showStats: false,
  },
  properties: {
    eyebrow: 'Property Catalog',
    title: 'Browse Available Properties',
    subtitle: 'Explore homes, land, rentals, and commercial listings from our current portfolio.',
  },
  agents: {
    eyebrow: 'Professional Property Advisors',
    title: 'Meet Our Licensed Brokers',
    subtitle: 'Connect directly with experienced advisors for property discovery, site visits, and transaction support.',
  },
  contact: {
    eyebrow: 'Client Advisory Services',
    title: 'Connect with {agencyName}',
    subtitle: 'Inquire about available property listings, schedule a guided site tour, or request representation for your apartment or land.',
    officeTitle: 'Headquarters & Office',
    hoursTitle: 'Office & Viewing Hours',
    weekdaysHours: '9:00 AM – 8:00 PM',
    fridayHours: '2:30 PM – 7:30 PM',
    whatsappHours: '24/7 Active Inquiries',
    formTitle: 'Send an Inquiry',
    formSubtitle: 'Our designated area broker will review your request and contact you as soon as possible.',
    submitButtonText: 'Submit Property Inquiry',
  },
}

export const WEBSITE_CONTENT_SCHEMA_VERSION = 2 as const
export type WebsiteContentPatch = { [K in keyof WebsiteContent]?: Partial<WebsiteContent[K]> }
export type ContentFieldDefinition = {
  kind: 'text' | 'image' | 'link' | 'boolean' | 'texts' | 'features' | 'stats' | 'propertyId' | 'propertyIds' | 'images'
  maxLength?: number
  maxItems?: number
  source: 'marketing' | 'property-reference'
}
const text = (maxLength: number): ContentFieldDefinition => ({ kind: 'text', maxLength, source: 'marketing' })
const boolean: ContentFieldDefinition = { kind: 'boolean', source: 'marketing' }
const image: ContentFieldDefinition = { kind: 'image', maxLength: 2000, source: 'marketing' }
const link: ContentFieldDefinition = { kind: 'link', maxLength: 500, source: 'marketing' }
export const WEBSITE_COLLECTION_ITEM_FIELDS: Record<'features' | 'stats', Record<string, number>> = {
  features: { title: 140, description: 600 },
  stats: { label: 120, value: 60, caption: 180 },
}
export const WEBSITE_CONTENT_FIELDS: Record<keyof WebsiteContent, Record<string, ContentFieldDefinition>> = {
  navigation: {
    tagline: text(120), homeLabel: text(40), propertiesLabel: text(40), agentsLabel: text(40), aboutLabel: text(40),
    contactLabel: text(40), headerCtaLabel: text(60), footerDescription: text(600), footerTrustText: text(180),
  },
  home: {
    eyebrow: text(160), heroTitle: text(200), heroSubtitle: text(600), heroImage: image, heroGallery: { kind: 'images', maxItems: 8, source: 'marketing' },
    trustItems: { kind: 'texts', maxLength: 140, maxItems: 3, source: 'marketing' },
    featuredEyebrow: text(120), featuredTitle: text(160), featuredSubtitle: text(400),
    whyEyebrow: text(120), whyTitle: text(180), whySubtitle: text(400),
    features: { kind: 'features', maxItems: 4, source: 'marketing' },
    agentsEyebrow: text(120), agentsTitle: text(160), agentsSubtitle: text(400),
    consultationEyebrow: text(120), consultationTitle: text(180), consultationSubtitle: text(500), consultationButtonText: text(80),
    showFeaturedProperties: boolean, showWhyChooseUs: boolean, showAgents: boolean, showConsultation: boolean,
    // Legacy promotional fields are retained, never populated from a real listing during migration.
    heroCardBadge: text(120), heroCardTagline: text(120), heroCardTitle: text(200), heroCardSpecs: text(120),
    heroCardButtonText: text(80), heroCardLink: link, showHeroCard: boolean,
    heroPropertyId: { kind: 'propertyId', source: 'property-reference' },
    featuredPropertyIds: { kind: 'propertyIds', maxItems: 24, source: 'property-reference' },
    useCuratedProperties: boolean,
    heroButtonText: text(80), heroButtonLink: link, secondaryButtonText: text(80), secondaryButtonLink: link,
  },
  about: {
    eyebrow: text(120), title: text(200), intro: text(900), image, storyTitle: text(180), storyBody: text(1500),
    values: { kind: 'features', maxItems: 3, source: 'marketing' }, stats: { kind: 'stats', maxItems: 4, source: 'marketing' },
    ctaEyebrow: text(120), ctaTitle: text(200), ctaText: text(700), ctaButtonText: text(80), showStats: boolean,
  },
  properties: { eyebrow: text(120), title: text(180), subtitle: text(500) },
  agents: { eyebrow: text(120), title: text(180), subtitle: text(500) },
  contact: {
    eyebrow: text(120), title: text(180), subtitle: text(500), officeTitle: text(120), hoursTitle: text(120),
    weekdaysHours: text(80), fridayHours: text(80), whatsappHours: text(100), formTitle: text(120),
    formSubtitle: text(400), submitButtonText: text(80),
  },
}
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const dangerousKey = (key: string) => ['__proto__', 'prototype', 'constructor'].includes(key) || key.startsWith('$') || key.includes('.')

/** Relative same-origin paths or HTTPS only. No protocol-relative URLs, credentials or executable schemes. */
export const isSafeContentUrl = (value: string, kind: 'image' | 'link' = 'link'): boolean => {
  if (!value) return true
  if (/[\u0000-\u0020\u007f\\]/.test(value)) return false
  if (value.startsWith('/') && !value.startsWith('//')) return true
  if (kind === 'link' && /^#[A-Za-z][\w-]*$/.test(value)) return true
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password } catch { return false }
}
export const validateWebsiteContentPatch = (input: unknown): ContractIssue[] => {
  const issues: ContractIssue[] = []
  const issue = (path: string, message: string) => issues.push({ path, message })
  if (!record(input)) return [{ path: '', message: 'Website content must be an object' }]
  for (const [page, values] of Object.entries(input)) {
    if (!own(WEBSITE_CONTENT_FIELDS, page) || dangerousKey(page)) { issue(page, 'Unsupported content page'); continue }
    if (!record(values)) { issue(page, 'Content page must be an object'); continue }
    for (const [key, value] of Object.entries(values)) {
      const path = `${page}.${key}`
      const definition = WEBSITE_CONTENT_FIELDS[page as keyof WebsiteContent][key]
      if (!definition || dangerousKey(key)) { issue(path, 'Unsupported content field'); continue }
      if (value === undefined) continue
      switch (definition.kind) {
        case 'boolean': if (typeof value !== 'boolean') issue(path, 'Expected true or false'); break
        case 'text': case 'image': case 'link':
          if (typeof value !== 'string' || value.length > (definition.maxLength || 2000)) issue(path, `Expected text of at most ${definition.maxLength} characters`)
          else if ((definition.kind === 'image' || definition.kind === 'link') && !isSafeContentUrl(value, definition.kind)) issue(path, 'Use a safe HTTPS URL or a same-origin path')
          break
        case 'propertyId':
          if (typeof value !== 'string' || (value !== '' && !/^[a-f\d]{24}$/i.test(value))) issue(path, 'Expected a property identifier or an empty selection')
          break
        case 'propertyIds':
          if (!Array.isArray(value) || value.length > (definition.maxItems || 24) || value.some((id) => typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) || new Set(value.map((id) => typeof id === 'string' ? id.toLowerCase() : id)).size !== value.length) issue(path, 'Expected unique property identifiers (maximum 24)')
          break
        case 'texts':
          if (!Array.isArray(value) || value.length > (definition.maxItems || 3) || value.some((item) => typeof item !== 'string' || item.length > (definition.maxLength || 140))) issue(path, 'Invalid text collection')
          break
        case 'images': {
          if (!Array.isArray(value) || value.length > (definition.maxItems || 8)) { issue(path, 'Expected at most eight gallery images'); break }
          value.forEach((item, index) => {
            if (!record(item)) { issue(`${path}.${index}`, 'Expected an image item'); return }
            const limits = { image: 2000, alt: 300, title: 200, subtitle: 600, tag: 160 }
            const allowed = [...Object.keys(limits), 'focalX', 'focalY', 'fit', 'decorative']
            for (const key of Object.keys(item)) if (!allowed.includes(key)) issue(`${path}.${index}.${key}`, 'Unsupported gallery field')
            for (const [key, maximum] of Object.entries(limits)) if (typeof item[key] !== 'string' || (item[key] as string).length > maximum) issue(`${path}.${index}.${key}`, `Expected text of at most ${maximum} characters`)
            if (typeof item.image === 'string' && !isSafeContentUrl(item.image, 'image')) issue(`${path}.${index}.image`, 'Use a safe image URL')
            for (const key of ['focalX', 'focalY']) if (item[key] !== undefined && (typeof item[key] !== 'number' || !Number.isFinite(item[key]) || (item[key] as number) < 0 || (item[key] as number) > 100)) issue(`${path}.${index}.${key}`, 'Focal point must be between 0 and 100')
            if (item.fit !== undefined && item.fit !== 'cover' && item.fit !== 'contain') issue(`${path}.${index}.fit`, 'Invalid image fit')
            if (item.decorative !== undefined && typeof item.decorative !== 'boolean') issue(`${path}.${index}.decorative`, 'Expected true or false')
          })
          break
        }
        case 'features': case 'stats': {
          if (!Array.isArray(value) || value.length > (definition.maxItems || 4)) { issue(path, `Expected at most ${definition.maxItems} items`); break }
          const fields = WEBSITE_COLLECTION_ITEM_FIELDS[definition.kind]
          value.forEach((item, index) => {
            if (!record(item)) { issue(`${path}.${index}`, 'Expected an item object'); return }
            for (const key of Object.keys(item)) if (!own(fields, key)) issue(`${path}.${index}.${key}`, 'Unsupported item field')
            for (const [key, maximum] of Object.entries(fields)) if (typeof item[key] !== 'string' || (item[key] as string).length > maximum) issue(`${path}.${index}.${key}`, `Expected text of at most ${maximum} characters`)
          })
          break
        }
      }
    }
  }
  return issues
}

/** Fill missing keys only. Empty strings, false, zero and empty arrays are deliberate tenant values. */
export const fillMissingContent = <T>(defaults: T, stored: unknown): T => {
  if (stored === undefined) return structuredClone(defaults)
  if (!record(defaults) || !record(stored)) return structuredClone(stored) as T
  const output: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(defaults), ...Object.keys(stored)])) {
    if (dangerousKey(key)) continue
    output[key] = own(stored, key) && stored[key] !== undefined
      ? (record(defaults[key]) && record(stored[key]) ? fillMissingContent(defaults[key], stored[key]) : structuredClone(stored[key]))
      : structuredClone(defaults[key])
  }
  return output as T
}
/** Patch objects recursively; collections replace atomically. No destructive page replacement on PATCH. */
export const mergeWebsiteContentPatch = (current: unknown, patch: WebsiteContentPatch): WebsiteContentPatch => {
  const base = record(current) ? current : {}
  const output: Record<string, unknown> = structuredClone(base)
  for (const [page, fields] of Object.entries(patch)) {
    if (!own(WEBSITE_CONTENT_FIELDS, page) || !record(fields)) continue
    const previous = record(base[page]) ? base[page] : {}
    const next = { ...previous }
    for (const [key, value] of Object.entries(fields)) if (!dangerousKey(key) && value !== undefined) next[key] = structuredClone(value)
    output[page] = next
  }
  return output as WebsiteContentPatch
}
export const migrateWebsiteContent = (settings: { content?: unknown; contentSchemaVersion?: number; heroTitle?: string; heroSubtitle?: string; heroImage?: string }, defaults: WebsiteContent = DEFAULT_WEBSITE_CONTENT) => {
  if ((settings.contentSchemaVersion || 0) > WEBSITE_CONTENT_SCHEMA_VERSION) throw new Error('Website content was written by a newer contract version')
  const legacy: WebsiteContentPatch = { home: {} }
  for (const key of ['heroTitle', 'heroSubtitle', 'heroImage'] as const) {
    const value = settings[key]
    if (typeof value === 'string') legacy.home![key] = value
  }
  // Saved nested keys take precedence over legacy top-level settings, including explicit blanks.
  const nested = record(settings.content) ? settings.content : {}
  const inherited = fillMissingContent(legacy, nested)
  return { contentSchemaVersion: WEBSITE_CONTENT_SCHEMA_VERSION, content: fillMissingContent(defaults, inherited) }
}

/** Defensive read projection for older malformed data; this never writes over stored values. */
export const renderableWebsiteContent = (settings: { content?: unknown; contentSchemaVersion?: number; heroTitle?: string; heroSubtitle?: string; heroImage?: string }, defaults: WebsiteContent = DEFAULT_WEBSITE_CONTENT): WebsiteContent => {
  const content: WebsiteContentPatch = {}
  if (record(settings.content)) {
    for (const page of Object.keys(WEBSITE_CONTENT_FIELDS) as Array<keyof WebsiteContent>) {
      const source = settings.content[page]
      if (!record(source)) continue
      const values: Record<string, unknown> = {}
      for (const field of Object.keys(WEBSITE_CONTENT_FIELDS[page])) {
        if (source[field] !== undefined && !validateWebsiteContentPatch({ [page]: { [field]: source[field] } }).length) values[field] = source[field]
      }
      Object.assign(content, { [page]: values })
    }
  }
  const safeSettings = { ...settings, content, contentSchemaVersion: Math.min(settings.contentSchemaVersion || 0, WEBSITE_CONTENT_SCHEMA_VERSION) }
  return migrateWebsiteContent(safeSettings, defaults).content
}
