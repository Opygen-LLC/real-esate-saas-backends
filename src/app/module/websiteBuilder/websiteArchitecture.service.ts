import { WEBSITE_TEMPLATE_IDS, type WebsiteTemplateId } from './websiteTemplate.constants'
import {
  WEBSITE_ANIMATION_DELAYS,
  WEBSITE_ANIMATION_DURATIONS,
  WEBSITE_ANIMATION_PRESETS,
  WEBSITE_ANIMATION_TRIGGERS,
  WEBSITE_COMPONENT_SLOTS,
  WEBSITE_DESIGN_SCHEMA_VERSION,
  WEBSITE_SECTION_KEYS,
  type AnimationDelay,
  type AnimationDuration,
  type AnimationPreset,
  type AnimationTrigger,
  type CanonicalWebsiteContract,
  type ComponentAnimationSettings,
  type WebsiteComponentAnimations,
  type WebsiteComponentOverrides,
  type WebsiteComponentSlot,
  type WebsiteDesignContract,
  type WebsiteRenderMode,
  type WebsiteSectionKey,
  type WebsiteSectionStyle,
  type WebsiteSectionStyles,
} from './websiteArchitecture.contract'

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const COMPONENT_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\.v[1-9]\d*$/
const sectionKeySet = new Set<string>(WEBSITE_SECTION_KEYS)
const componentSlotSet = new Set<string>(WEBSITE_COMPONENT_SLOTS)
const templateIdSet = new Set<string>(WEBSITE_TEMPLATE_IDS)
const animationPresetSet = new Set<string>(WEBSITE_ANIMATION_PRESETS)
const animationDurationSet = new Set<string>(WEBSITE_ANIMATION_DURATIONS)
const animationDelaySet = new Set<number>(WEBSITE_ANIMATION_DELAYS)
const animationTriggerSet = new Set<string>(WEBSITE_ANIMATION_TRIGGERS)

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

const readSlotValue = (value: unknown, slot: WebsiteComponentSlot): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  // Be tolerant when reading: support both the canonical nested Mongo shape and
  // a flattened dotted-key shape so old caches/manual data cannot break reads.
  if (Object.prototype.hasOwnProperty.call(input, slot)) return input[slot]
  const [group, section] = slot.split('.', 2)
  const groupValue = input[group]
  if (!groupValue || typeof groupValue !== 'object' || Array.isArray(groupValue)) return undefined
  return (groupValue as Record<string, unknown>)[section]
}

const assignSlotValue = <T>(target: Record<string, Record<string, T>>, slot: WebsiteComponentSlot, value: T) => {
  const [group, section] = slot.split('.', 2)
  target[group] ||= {}
  target[group][section] = value
}

const canonicalComponentId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length <= 120 && COMPONENT_ID.test(trimmed) ? trimmed : undefined
}

const canonicalizeComponentOverrides = (value: unknown): WebsiteComponentOverrides => {
  const stored: Record<string, Record<string, string>> = {}
  for (const slot of WEBSITE_COMPONENT_SLOTS) {
    const componentId = canonicalComponentId(readSlotValue(value, slot))
    if (componentId) assignSlotValue(stored, slot, componentId)
  }
  return stored as WebsiteComponentOverrides
}

const canonicalAnimationSettings = (value: unknown): ComponentAnimationSettings | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  const preset = typeof input.preset === 'string' && animationPresetSet.has(input.preset) ? input.preset as AnimationPreset : 'none'
  const duration = typeof input.duration === 'string' && animationDurationSet.has(input.duration) ? input.duration as AnimationDuration : 'normal'
  const numericDelay = typeof input.delay === 'number' ? input.delay : Number.NaN
  const delay = animationDelaySet.has(numericDelay) ? numericDelay as AnimationDelay : 0
  const trigger = typeof input.trigger === 'string' && animationTriggerSet.has(input.trigger) ? input.trigger as AnimationTrigger : 'viewport'
  return {
    enabled: input.enabled !== false,
    preset,
    duration,
    delay,
    trigger,
    replay: input.replay === true,
  }
}

const canonicalizeComponentAnimations = (value: unknown): WebsiteComponentAnimations => {
  const stored: Record<string, Record<string, ComponentAnimationSettings>> = {}
  for (const slot of WEBSITE_COMPONENT_SLOTS) {
    const animation = canonicalAnimationSettings(readSlotValue(value, slot))
    if (animation) assignSlotValue(stored, slot, animation)
  }
  return stored as WebsiteComponentAnimations
}

const canonicalizeWebsiteDesign = (value: unknown): WebsiteDesignContract => {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    schemaVersion: WEBSITE_DESIGN_SCHEMA_VERSION,
    componentOverrides: canonicalizeComponentOverrides(input.componentOverrides),
    componentAnimations: canonicalizeComponentAnimations(input.componentAnimations),
    // Missing design data belongs to legacy sites and must preserve the Phase 1
    // default: animations are globally enabled but no section animation exists.
    animationsEnabled: input.animationsEnabled !== false,
  }
}

const serializeWebsiteDesignForStorage = (value: unknown): WebsiteDesignContract => canonicalizeWebsiteDesign(value)

const isWebsiteComponentSlot = (value: string): value is WebsiteComponentSlot => componentSlotSet.has(value)

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
    websiteDesign?: unknown
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
    design: canonicalizeWebsiteDesign(settings.websiteDesign),
    visibility: { public: options.public ?? status === 'published' },
  }
}

export const WebsiteArchitectureService = {
  canonicalizeSectionStyles,
  serializeSectionStylesForStorage,
  canonicalizeComponentOverrides,
  canonicalizeComponentAnimations,
  canonicalizeWebsiteDesign,
  serializeWebsiteDesignForStorage,
  isWebsiteComponentSlot,
  toCanonicalWebsiteContract,
}
