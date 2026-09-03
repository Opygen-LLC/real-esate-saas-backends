import mongoose, { type ClientSession } from 'mongoose'
import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { writeAudit, type AuditInput } from '../audit/audit.service'
import { EntitlementService, featureEnabled } from '../entitlement/entitlement.service'
import { Organization } from '../organization/organization.model'
import { AnimationRegistry } from './animationRegistry'
import { ComponentRegistry, type WebsiteComponentCategory } from './componentRegistry'
import { TemplateRegistry } from './templateRegistry'
import {
  WEBSITE_COMPONENT_SLOTS,
  WEBSITE_DESIGN_ACTIONS,
  WEBSITE_DESIGN_SCHEMA_VERSION,
  type ComponentAnimationSettings,
  type WebsiteComponentOverrides,
  type WebsiteComponentSlot,
  type WebsiteDesignAction,
  type WebsiteDesignContract,
} from './websiteArchitecture.contract'
import { WebsiteArchitectureService } from './websiteArchitecture.service'
import { WebsitePublicationService } from './websitePublication.service'

export type WebsiteDesignActor = {
  actorId?: string
  actorRole?: string
  requestId?: string
  ip?: string
}

type WebsiteDesignAccess = { premiumTemplates: boolean }
type WebsiteDesignAudit = Pick<AuditInput, 'action' | 'metadata'>

const SLOT_METADATA: Record<
  WebsiteComponentSlot,
  {
    label: string
    group: 'GLOBAL' | 'HOME' | 'ABOUT' | 'PROPERTIES' | 'AGENTS' | 'CONTACT'
    category: WebsiteComponentCategory
  }
> = {
  'shared.header': { label: 'Header', group: 'GLOBAL', category: 'header' },
  'shared.footer': { label: 'Footer', group: 'GLOBAL', category: 'footer' },
  'home.hero': { label: 'Hero', group: 'HOME', category: 'hero' },
  'home.featuredProperties': { label: 'Featured Properties', group: 'HOME', category: 'featured-properties' },
  'home.whyChooseUs': { label: 'Why Choose Us', group: 'HOME', category: 'why-choose-us' },
  'home.reviews': { label: 'Reviews', group: 'HOME', category: 'reviews' },
  'home.agents': { label: 'Agents', group: 'HOME', category: 'agents' },
  'home.consultation': { label: 'Consultation / CTA', group: 'HOME', category: 'consultation' },
  'about.hero': { label: 'About Hero', group: 'ABOUT', category: 'about-hero' },
  'about.story': { label: 'Story', group: 'ABOUT', category: 'about-story' },
  'about.values': { label: 'Values', group: 'ABOUT', category: 'about-values' },
  'about.stats': { label: 'Statistics', group: 'ABOUT', category: 'about-stats' },
  'about.cta': { label: 'About CTA', group: 'ABOUT', category: 'about-cta' },
  'properties.hero': { label: 'Properties Hero', group: 'PROPERTIES', category: 'properties-hero' },
  'properties.listing': { label: 'Property Catalog', group: 'PROPERTIES', category: 'properties-listing' },
  'properties.filters': { label: 'Search / Filters', group: 'PROPERTIES', category: 'properties-filters' },
  'properties.card': { label: 'Property Card', group: 'PROPERTIES', category: 'properties-card' },
  'properties.pagination': { label: 'Pagination / Load More', group: 'PROPERTIES', category: 'properties-pagination' },
  'agents.hero': { label: 'Agents Hero', group: 'AGENTS', category: 'agents-hero' },
  'agents.listing': { label: 'Agent Directory', group: 'AGENTS', category: 'agents-listing' },
  'agents.card': { label: 'Agent Card', group: 'AGENTS', category: 'agents-card' },
  'agents.cta': { label: 'Agent CTA', group: 'AGENTS', category: 'agents-cta' },
  'contact.hero': { label: 'Contact Hero', group: 'CONTACT', category: 'contact-hero' },
  'contact.office': { label: 'Office & Location', group: 'CONTACT', category: 'contact-office' },
  'contact.form': { label: 'Contact Form', group: 'CONTACT', category: 'contact-form' },
  'contact.map': { label: 'Map / Location', group: 'CONTACT', category: 'contact-map' },
}


const readSlot = <T>(container: unknown, slot: WebsiteComponentSlot): T | undefined => {
  if (!container || typeof container !== 'object' || Array.isArray(container)) return undefined
  const [group, key] = slot.split('.', 2)
  const groupValue = (container as Record<string, unknown>)[group]
  if (!groupValue || typeof groupValue !== 'object' || Array.isArray(groupValue)) return undefined
  return (groupValue as Record<string, T>)[key]
}

const writeSlot = <T>(container: Record<string, Record<string, T>>, slot: WebsiteComponentSlot, value: T | undefined) => {
  const [group, key] = slot.split('.', 2)
  if (value === undefined) {
    if (!container[group]) return
    delete container[group][key]
    if (!Object.keys(container[group]).length) delete container[group]
    return
  }
  container[group] ||= {}
  container[group][key] = value
}

const cloneDesign = (value: unknown): WebsiteDesignContract => {
  const normalized = WebsiteArchitectureService.canonicalizeWebsiteDesign(value)
  return structuredClone(normalized)
}

const resolveAccess = async (organizationId: string): Promise<WebsiteDesignAccess> => {
  const { limits } = await EntitlementService.resolve(organizationId, undefined, { allowInactive: true })
  return { premiumTemplates: featureEnabled(limits, 'premiumTemplates') }
}

const effectiveOverridesForAccess = (
  configured: WebsiteComponentOverrides,
  access: WebsiteDesignAccess,
): { overrides: WebsiteComponentOverrides; fallbacks: Array<{ slot: WebsiteComponentSlot; componentId: string; reason: 'UNKNOWN' | 'INACTIVE' | 'ENTITLEMENT' }> } => {
  const effective: Record<string, Record<string, string>> = {}
  const fallbacks: Array<{ slot: WebsiteComponentSlot; componentId: string; reason: 'UNKNOWN' | 'INACTIVE' | 'ENTITLEMENT' }> = []
  for (const slot of WEBSITE_COMPONENT_SLOTS) {
    const componentId = readSlot<string>(configured, slot)
    if (!componentId) continue
    const definition = ComponentRegistry.find(componentId)
    if (!definition) {
      fallbacks.push({ slot, componentId, reason: 'UNKNOWN' })
      continue
    }
    if (definition.status !== 'ACTIVE') {
      fallbacks.push({ slot, componentId, reason: 'INACTIVE' })
      continue
    }
    if (definition.entitlement === 'premiumTemplates' && !access.premiumTemplates) {
      fallbacks.push({ slot, componentId, reason: 'ENTITLEMENT' })
      continue
    }
    writeSlot(effective, slot, componentId)
  }
  return { overrides: effective as WebsiteComponentOverrides, fallbacks }
}

const effectiveDesignForAccess = (configured: WebsiteDesignContract, access: WebsiteDesignAccess) => {
  const componentResolution = effectiveOverridesForAccess(configured.componentOverrides, access)
  return {
    design: {
      ...configured,
      componentOverrides: componentResolution.overrides,
    } satisfies WebsiteDesignContract,
    componentFallbacks: componentResolution.fallbacks,
  }
}

const assertAnimationForSlot = (design: WebsiteDesignContract, slot: WebsiteComponentSlot, animation: ComponentAnimationSettings) => {
  const definition = AnimationRegistry.get(animation.preset)
  if (!definition || definition.status !== 'ACTIVE') throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown or inactive website animation')
  if (!definition.supportedDurations.includes(animation.duration)) throw new ApiError(httpStatus.BAD_REQUEST, 'Animation duration is not supported')
  if (!definition.supportedDelays.includes(animation.delay)) throw new ApiError(httpStatus.BAD_REQUEST, 'Animation delay is not supported')
  if (!definition.supportedTriggers.includes(animation.trigger)) throw new ApiError(httpStatus.BAD_REQUEST, 'Animation trigger is not supported')
  if (animation.replay && !definition.replaySupported) throw new ApiError(httpStatus.BAD_REQUEST, 'Replay is not supported by this animation')
  const componentId = readSlot<string>(design.componentOverrides, slot)
  if (!componentId || animation.preset === 'none') return
  const component = ComponentRegistry.get(componentId)
  if (!component.supportedAnimations.includes(animation.preset)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `${component.name} does not support ${definition.name}`)
  }
}

const assertDesignDelta = async (organizationId: string, before: WebsiteDesignContract, after: WebsiteDesignContract) => {
  for (const slot of WEBSITE_COMPONENT_SLOTS) {
    const beforeComponent = readSlot<string>(before.componentOverrides, slot)
    const afterComponent = readSlot<string>(after.componentOverrides, slot)
    if (beforeComponent !== afterComponent && afterComponent) {
      await ComponentRegistry.assertComponentForSlot(organizationId, slot, afterComponent)
    }

    const beforeAnimation = readSlot<ComponentAnimationSettings>(before.componentAnimations, slot)
    const afterAnimation = readSlot<ComponentAnimationSettings>(after.componentAnimations, slot)
    if (JSON.stringify(beforeAnimation || null) !== JSON.stringify(afterAnimation || null) && afterAnimation) {
      assertAnimationForSlot(after, slot, afterAnimation)
    }
  }
}

const componentAuditDiff = (before: WebsiteDesignContract, after: WebsiteDesignContract, baseTemplateId: string): WebsiteDesignAudit[] => {
  const audits: WebsiteDesignAudit[] = []
  for (const slot of WEBSITE_COMPONENT_SLOTS) {
    const from = readSlot<string>(before.componentOverrides, slot)
    const to = readSlot<string>(after.componentOverrides, slot)
    if (from === to) continue
    audits.push({
      action: to ? 'website.component_changed' : 'website.component_reset',
      metadata: { slot, from: from || null, to: to || null, baseTemplateId },
    })
  }
  return audits
}

const animationAuditDiff = (before: WebsiteDesignContract, after: WebsiteDesignContract, baseTemplateId: string): WebsiteDesignAudit[] => {
  const audits: WebsiteDesignAudit[] = []
  for (const slot of WEBSITE_COMPONENT_SLOTS) {
    const from = readSlot<ComponentAnimationSettings>(before.componentAnimations, slot)
    const to = readSlot<ComponentAnimationSettings>(after.componentAnimations, slot)
    if (JSON.stringify(from || null) === JSON.stringify(to || null)) continue
    audits.push({
      action: to ? 'website.animation_changed' : 'website.animation_reset',
      metadata: { slot, from: from || null, to: to || null, baseTemplateId },
    })
  }
  if (before.animationsEnabled !== after.animationsEnabled) {
    audits.push({
      action: after.animationsEnabled ? 'website.animations_enabled' : 'website.animations_disabled',
      metadata: { from: before.animationsEnabled, to: after.animationsEnabled, baseTemplateId },
    })
  }
  return audits
}

const auditForAction = (
  action: WebsiteDesignAction,
  beforeTemplateId: string,
  afterTemplateId: string,
  before: WebsiteDesignContract,
  after: WebsiteDesignContract,
): WebsiteDesignAudit[] => {
  if (action.action === 'RESET_ALL_COMPONENTS') {
    const resetCount = WEBSITE_COMPONENT_SLOTS.filter((slot) => readSlot(before.componentOverrides, slot)).length
    return resetCount ? [{ action: 'website.components_reset', metadata: { baseTemplateId: afterTemplateId, resetCount } }] : []
  }
  if (action.action === 'RESET_ALL_ANIMATIONS') {
    const resetCount = WEBSITE_COMPONENT_SLOTS.filter((slot) => readSlot(before.componentAnimations, slot)).length
    return resetCount ? [{ action: 'website.animations_reset', metadata: { baseTemplateId: afterTemplateId, resetCount } }] : []
  }
  const audits = [
    ...componentAuditDiff(before, after, afterTemplateId),
    ...animationAuditDiff(before, after, afterTemplateId),
  ]
  if (beforeTemplateId !== afterTemplateId) {
    audits.push({ action: 'website.base_template_changed', metadata: { from: beforeTemplateId, to: afterTemplateId, baseTemplateId: afterTemplateId } })
  }
  return audits
}

const getDesignState = async (organizationId: string) => {
  const organization: any = await Organization.findOne({ organizationId })
    .select('organizationId templateId websiteSettings.renderMode websiteSettings.websiteDesign websiteSettings.publicationRevision websiteSettings.lastPublishedAt')
    .lean()
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  const configuredTemplateId = String(organization.templateId || 'template-1')
  const configured = cloneDesign(organization.websiteSettings?.websiteDesign)
  const access = await resolveAccess(organizationId)
  const effectiveTemplateId = TemplateRegistry.isPremium(configuredTemplateId) && !access.premiumTemplates ? 'template-1' : configuredTemplateId
  const effective = effectiveDesignForAccess(configured, access)
  return {
    schemaVersion: WEBSITE_DESIGN_SCHEMA_VERSION,
    baseTemplateId: effectiveTemplateId,
    configuredBaseTemplateId: configuredTemplateId,
    effectiveBaseTemplateId: effectiveTemplateId,
    renderMode: organization.websiteSettings?.renderMode === 'builder' ? 'builder' : 'template',
    configured: {
      components: configured.componentOverrides,
      animations: configured.componentAnimations,
      animationsEnabled: configured.animationsEnabled,
    },
    effective: {
      components: effective.design.componentOverrides,
      animations: effective.design.componentAnimations,
      animationsEnabled: effective.design.animationsEnabled,
    },
    resolution: {
      premiumTemplatesEnabled: access.premiumTemplates,
      templateFallbackApplied: configuredTemplateId !== effectiveTemplateId,
      componentFallbacks: effective.componentFallbacks,
    },
    publishing: {
      revision: Math.max(0, Number(organization.websiteSettings?.publicationRevision || 0)),
      lastPublishedAt: organization.websiteSettings?.lastPublishedAt || null,
    },
  }
}

const getDesignRegistry = async (organizationId: string) => {
  const access = await resolveAccess(organizationId)
  const templates = TemplateRegistry.list().map((template) => ({
    ...template,
    status: 'ACTIVE' as const,
    available: template.entitlement !== 'premiumTemplates' || access.premiumTemplates,
  }))
  const components = ComponentRegistry.list().map((component) => ({
    ...component,
    available: component.status === 'ACTIVE' && (component.entitlement !== 'premiumTemplates' || access.premiumTemplates),
  }))
  const componentGroups = Array.from(new Set(components.map((component) => component.category))).map((category) => ({
    id: category,
    label: Object.values(SLOT_METADATA).find((item) => item.category === category)?.label || category,
    slots: WEBSITE_COMPONENT_SLOTS.filter((slot) => SLOT_METADATA[slot].category === category),
    variants: components.filter((component) => component.category === category).map((component) => component.id),
  }))
  return {
    schemaVersion: WEBSITE_DESIGN_SCHEMA_VERSION,
    templates,
    componentGroups,
    components,
    animations: AnimationRegistry.list(),
    slots: WEBSITE_COMPONENT_SLOTS.map((slot) => ({ id: slot, ...SLOT_METADATA[slot] })),
    tiers: [
      { id: 'FREE', label: 'Free', entitlement: 'included' },
      { id: 'PREMIUM', label: 'Premium', entitlement: 'premiumTemplates' },
    ],
    entitlements: { premiumTemplates: { enabled: access.premiumTemplates, feature: 'premiumTemplates' } },
    actions: [...WEBSITE_DESIGN_ACTIONS],
    metadata: { generatedAt: new Date().toISOString(), designSchemaVersion: WEBSITE_DESIGN_SCHEMA_VERSION },
  }
}

const applyActionToDesign = async (
  organizationId: string,
  action: WebsiteDesignAction,
  currentTemplateId: string,
  currentDesign: WebsiteDesignContract,
) => {
  let templateId = currentTemplateId
  const design = cloneDesign(currentDesign)

  switch (action.action) {
    case 'SET_COMPONENT':
      writeSlot(design.componentOverrides as Record<string, Record<string, string>>, action.slot, action.componentId)
      break
    case 'RESET_COMPONENT':
      writeSlot(design.componentOverrides as Record<string, Record<string, string>>, action.slot, undefined)
      break
    case 'RESET_ALL_COMPONENTS':
      design.componentOverrides = {}
      break
    case 'SET_ANIMATION':
      writeSlot(design.componentAnimations as Record<string, Record<string, ComponentAnimationSettings>>, action.slot, action.animation)
      break
    case 'RESET_ANIMATION':
      writeSlot(design.componentAnimations as Record<string, Record<string, ComponentAnimationSettings>>, action.slot, undefined)
      break
    case 'RESET_ALL_ANIMATIONS':
      design.componentAnimations = {}
      break
    case 'SET_ANIMATIONS_ENABLED':
      design.animationsEnabled = action.enabled
      break
    case 'APPLY_TEMPLATE':
      await TemplateRegistry.assertEntitlement(organizationId, { template: { id: action.templateId } })
      templateId = action.templateId
      if (action.resetComponents !== false) design.componentOverrides = {}
      if (action.keepAnimations === false) design.componentAnimations = {}
      break
    case 'APPLY_DESIGN':
      if (action.templateId) {
        await TemplateRegistry.assertEntitlement(organizationId, { template: { id: action.templateId } })
        templateId = action.templateId
      }
      Object.assign(design, cloneDesign(action.design))
      break
  }

  await assertDesignDelta(organizationId, currentDesign, design)
  return { templateId, design: WebsiteArchitectureService.serializeWebsiteDesignForStorage(design) }
}

const applyDesignAction = async (organizationId: string, action: WebsiteDesignAction, actor: WebsiteDesignActor = {}) => {
  const current: any = await Organization.findOne({ organizationId })
    .select('_id organizationId templateId websiteSettings.renderMode websiteSettings.websiteDesign websiteSettings.publicationRevision')
    .lean()
  if (!current) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  const renderMode = current.websiteSettings?.renderMode === 'builder' ? 'builder' : 'template'
  if (renderMode === 'builder') throw new ApiError(httpStatus.CONFLICT, 'Component design actions are available only in template mode')

  const currentPublicationRevision = Math.max(0, Number(current.websiteSettings?.publicationRevision || 0))
  if (action.expectedPublicationRevision !== undefined && action.expectedPublicationRevision !== currentPublicationRevision) {
    throw new ApiError(httpStatus.CONFLICT, 'Website design changed in another session. Refresh and try again.')
  }

  const beforeTemplateId = String(current.templateId || 'template-1')
  const beforeDesign = cloneDesign(current.websiteSettings?.websiteDesign)
  const next = await applyActionToDesign(organizationId, action, beforeTemplateId, beforeDesign)
  const audits = auditForAction(action, beforeTemplateId, next.templateId, beforeDesign, next.design)
  if (!audits.length && beforeTemplateId === next.templateId) return getDesignState(organizationId)

  const expectedPublicationRevision = currentPublicationRevision
  let publication: any = null

  const persist = async (session?: ClientSession) => {
    publication = await WebsitePublicationService.commitPublicationState({
      organizationId,
      renderMode: 'template',
      set: {
        templateId: next.templateId,
        'websiteSettings.websiteDesign': next.design,
      },
      session,
      expectedPublicationRevision,
    })
    for (const audit of audits) {
      await writeAudit({
        organizationId,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: audit.action,
        entityType: 'website_design',
        entityId: String(publication.organization._id),
        requestId: actor.requestId,
        ip: actor.ip,
        metadata: { ...audit.metadata, publicationRevision: publication.publicationRevision },
      }, session)
    }
  }

  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => persist(session))
    } finally {
      await session.endSession()
    }
  } else {
    await persist()
  }

  if (!publication) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Website design publication failed')
  const primaryAudit = audits[0]
  await WebsitePublicationService.afterPublication({
    organizationId,
    renderMode: 'template',
    aggregateId: String(publication.organization._id),
    actorId: actor.actorId,
    publicationRevision: publication.publicationRevision,
    eventType: audits.length === 1 ? primaryAudit.action : 'website.design_changed',
    payload: {
      action: action.action,
      auditActions: audits.map((audit) => audit.action),
      baseTemplateId: next.templateId,
      changes: audits.map((audit) => audit.metadata || {}),
      publicVisible: true,
    },
  })

  return getDesignState(organizationId)
}

export const WebsiteDesignService = {
  getDesignRegistry,
  getDesignState,
  applyDesignAction,
  resolveEffectiveDesignForAccess: (value: unknown, access: WebsiteDesignAccess): WebsiteDesignContract => effectiveDesignForAccess(cloneDesign(value), access).design,
}
