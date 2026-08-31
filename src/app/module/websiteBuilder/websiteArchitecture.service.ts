import { WEBSITE_TEMPLATE_IDS, type WebsiteTemplateId } from './websiteTemplate.constants'
import {
  WEBSITE_SECTION_KEYS,
  type CanonicalWebsiteContract,
  type WebsiteRenderMode,
  type WebsiteSectionKey,
  type WebsiteSectionStyle,
  type WebsiteSectionStyles,
} from './websiteArchitecture.contract'

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const sectionKeySet = new Set<string>(WEBSITE_SECTION_KEYS)
const templateIdSet = new Set<string>(WEBSITE_TEMPLATE_IDS)

const canonicalSectionStyle = (value: unknown): WebsiteSectionStyle | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  const style: WebsiteSectionStyle = {}
  if (typeof input.backgroundColor === 'string' && HEX_COLOR.test(input.backgroundColor)) style.backgroundColor = input.backgroundColor
  if (typeof input.textColor === 'string' && HEX_COLOR.test(input.textColor)) style.textColor = input.textColor
  return Object.keys(style).length ? style : undefined
}

const canonicalizeSectionStyles = (value: unknown): WebsiteSectionStyles => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: WebsiteSectionStyles = {}
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (sectionKeySet.has(rawKey)) {
      const style = canonicalSectionStyle(rawValue)
      if (style) result[rawKey as WebsiteSectionKey] = style
      continue
    }
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue
    for (const [sectionName, sectionValue] of Object.entries(rawValue as Record<string, unknown>)) {
      const key = `${rawKey}.${sectionName}`
      if (!sectionKeySet.has(key)) continue
      const style = canonicalSectionStyle(sectionValue)
      if (style) result[key as WebsiteSectionKey] = style
    }
  }
  return result
}

const serializeSectionStylesForStorage = (styles?: WebsiteSectionStyles): Record<string, Record<string, WebsiteSectionStyle>> => {
  const stored: Record<string, Record<string, WebsiteSectionStyle>> = {}
  for (const key of WEBSITE_SECTION_KEYS) {
    const style = canonicalSectionStyle(styles?.[key])
    if (!style) continue
    const [group, section] = key.split('.', 2)
    stored[group] ||= {}
    stored[group][section] = style
  }
  return stored
}

type CanonicalWebsiteSource = {
  organizationId?: unknown
  websiteStatus?: unknown
  templateId?: unknown
  logo?: unknown
  favicon?: unknown
  primaryColor?: unknown
  secondaryColor?: unknown
  font?: unknown
  metaTitle?: unknown
  metaDescription?: unknown
  sub_domain?: unknown
  domain?: unknown
  domain_Verify?: unknown
  websiteSettings?: {
    renderMode?: unknown
    publicationRevision?: unknown
    lastPublishedAt?: unknown
    sectionStyles?: unknown
  } | null
}

type CanonicalWebsiteOptions = {
  renderMode?: WebsiteRenderMode
  templateId?: WebsiteTemplateId
  customDomain?: string
  customDomainVerified?: boolean
  public?: boolean
}

const optionalString = (value: unknown) => typeof value === 'string' && value.trim() ? value : undefined

const toCanonicalWebsiteContract = (source: CanonicalWebsiteSource, options: CanonicalWebsiteOptions = {}): CanonicalWebsiteContract => {
  const settings = source.websiteSettings || {}
  const rawTemplateId = options.templateId || String(source.templateId || 'template-1')
  const templateId = (templateIdSet.has(rawTemplateId) ? rawTemplateId : 'template-1') as WebsiteTemplateId
  const renderMode: WebsiteRenderMode = options.renderMode || (settings.renderMode === 'builder' ? 'builder' : 'template')
  const rawStatus = String(source.websiteStatus || 'provisioned')
  const status = rawStatus === 'published' || rawStatus === 'suspended' ? rawStatus : 'provisioned'
  const lastPublishedAt = settings.lastPublishedAt instanceof Date
    ? settings.lastPublishedAt.toISOString()
    : optionalString(settings.lastPublishedAt)
  const customDomain = options.customDomain !== undefined ? optionalString(options.customDomain) : optionalString(source.domain)
  const customDomainVerified = options.customDomainVerified ?? Boolean(source.domain_Verify)

  return {
    schemaVersion: 1,
    organizationId: String(source.organizationId || ''),
    renderMode,
    templateId,
    branding: {
      ...(optionalString(source.logo) ? { logo: String(source.logo) } : {}),
      ...(optionalString(source.favicon) ? { favicon: String(source.favicon) } : {}),
      ...(optionalString(source.primaryColor) ? { primaryColor: String(source.primaryColor) } : {}),
      ...(optionalString(source.secondaryColor) ? { secondaryColor: String(source.secondaryColor) } : {}),
      ...(optionalString(source.font) ? { font: String(source.font) } : {}),
    },
    seo: {
      ...(optionalString(source.metaTitle) ? { title: String(source.metaTitle) } : {}),
      ...(optionalString(source.metaDescription) ? { description: String(source.metaDescription) } : {}),
    },
    domain: {
      ...(optionalString(source.sub_domain) ? { subdomain: String(source.sub_domain) } : {}),
      ...(customDomain ? { customDomain } : {}),
      ...(customDomain ? { customDomainVerified } : {}),
    },
    publishing: {
      status,
      revision: Math.max(0, Number(settings.publicationRevision || 0)),
      lastPublishedAt: lastPublishedAt || null,
    },
    sectionStyles: canonicalizeSectionStyles(settings.sectionStyles),
    visibility: { public: options.public ?? status === 'published' },
  }
}

export const WebsiteArchitectureService = {
  canonicalizeSectionStyles,
  serializeSectionStylesForStorage,
  toCanonicalWebsiteContract,
}
