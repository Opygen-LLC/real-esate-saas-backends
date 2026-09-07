import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { EntitlementService } from '../entitlement/entitlement.service'
import type { WebsiteTemplateId } from './websiteTemplate.constants'
import { WEBSITE_TEMPLATE_MANIFESTS, type WebsiteTemplateManifest } from '../../../contracts/websiteCatalog/manifest'

export const CURRENT_BUILDER_SCHEMA_VERSION = 2

export type TemplateTier = 'free' | 'premium'

export interface WebsiteTemplateDefinition extends WebsiteTemplateManifest {
  qa: { accessibility: 'enforced'; responsive: 'enforced' }
  migrate: (document: any) => any
}

const pinTemplate = (id: string, version: string) => (document: any) => ({ ...document, template: { id, version } })

const FULL_SITE_PAGES = ['home', 'about', 'contact', 'properties', 'propertyDetail', 'agents', 'agentDetail'] as const

const registry: WebsiteTemplateDefinition[] = WEBSITE_TEMPLATE_MANIFESTS.map((manifest) => ({
  ...manifest,
  qa: { accessibility: 'enforced', responsive: 'enforced' },
  migrate: pinTemplate(manifest.id, manifest.version),
}))

const normalizeSeo = (document: any) => ({
  canonicalUrl: '',
  title: '',
  description: '',
  openGraph: { title: '', description: '', image: '' },
  robots: { index: true, follow: true },
  structuredData: { enabled: true },
  ...(document?.seo || {}),
})

export const migrateBuilderDocument = (input: any): any => {
  let document = structuredClone(input || {})
  const version = Number(document.schemaVersion || 1)

  if (version < 2) {
    document = {
      ...document,
      schemaVersion: 2,
      template: document.template || { id: 'template-1', version: '2.0.0' },
      seo: normalizeSeo(document),
    }
  }

  if (Number(document.schemaVersion) !== CURRENT_BUILDER_SCHEMA_VERSION) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Unsupported website schema version ${document.schemaVersion}`)
  }
  document.seo = normalizeSeo(document)
  document.template = document.template || { id: 'template-1', version: '2.0.0' }
  const template = getTemplate(document.template.id || 'template-1')
  if (template.supportedSchemaVersion !== CURRENT_BUILDER_SCHEMA_VERSION) throw new ApiError(httpStatus.BAD_REQUEST, 'Template does not support the current builder schema')
  document = template.migrate(document)
  return document
}

export const getTemplate = (id: string): WebsiteTemplateDefinition => {
  const template = registry.find((item) => item.id === id)
  if (!template) throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown website template')
  return template
}

export const assertTemplateCapabilities = (document: any): void => {
  const template = getTemplate(document?.template?.id || 'template-1')
  if (!template.capabilities.advancedBuilder) {
    throw new ApiError(httpStatus.BAD_REQUEST, `${template.name} does not support Advanced Builder`)
  }
  if (!template.capabilities.hero.backgroundImage) {
    const pages = Array.isArray(document?.pages) ? document.pages : []
    const hasHeroBackground = pages.some((page: any) => {
      const walk = (nodes: any[]): boolean => (nodes || []).some((node: any) => {
        const semantic = `${String(node?.id || '')} ${String(node?.label || '')}`.toLowerCase()
        const isHero = semantic.includes('hero')
        const styles = [node?.styles?.desktop, node?.styles?.tablet, node?.styles?.mobile]
        return (isHero && styles.some((style) => Boolean(style?.backgroundImage))) || walk(node?.children || [])
      })
      return walk(page?.nodes || [])
    })
    if (hasHeroBackground) throw new ApiError(httpStatus.BAD_REQUEST, `${template.name} does not support hero background images`)
  }
}

export const assertTemplateEntitlement = async (organizationId: string, document: any): Promise<void> => {
  const template = getTemplate(document?.template?.id || 'template-1')
  if (template.tier === 'premium') await EntitlementService.assertFeature(organizationId, 'premiumTemplates')
}

export const TemplateRegistry = {
  list: () => registry.map(({ migrate: _migrate, ...item }) => ({ ...item, supportedPages: FULL_SITE_PAGES })),
  get: getTemplate,
  migrate: migrateBuilderDocument,
  assertEntitlement: assertTemplateEntitlement,
  assertCapabilities: assertTemplateCapabilities,
  isPremium: (id: string) => registry.some((item) => item.id === id && item.tier === 'premium'),
}
