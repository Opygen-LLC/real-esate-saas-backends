import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { EntitlementService } from '../entitlement/entitlement.service'

export const CURRENT_BUILDER_SCHEMA_VERSION = 2

export type TemplateTier = 'free' | 'premium'

export interface WebsiteTemplateDefinition {
  id: string
  version: string
  name: string
  thumbnail: string
  supportedSchemaVersion: number
  tier: TemplateTier
  entitlement: 'included' | 'premiumTemplates'
  description: string
  qa: { accessibility: 'enforced'; responsive: 'enforced' }
  migrate: (document: any) => any
}

const pinTemplate = (id: string, version: string) => (document: any) => ({ ...document, template: { id, version } })

const registry: WebsiteTemplateDefinition[] = [
  { id: 'template-1', version: '2.0.0', name: 'Modern Residence', thumbnail: '/templates/template-1.svg', supportedSchemaVersion: 2, tier: 'free', entitlement: 'included', description: 'Clean, conversion-focused residential website.', qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-1', '2.0.0') },
  { id: 'template-2', version: '2.0.0', name: 'Luxury Editorial', thumbnail: '/templates/template-2.svg', supportedSchemaVersion: 2, tier: 'free', entitlement: 'included', description: 'Editorial presentation for premium property portfolios.', qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-2', '2.0.0') },
  { id: 'template-3', version: '2.0.0', name: 'Corporate Brokerage', thumbnail: '/templates/template-3.svg', supportedSchemaVersion: 2, tier: 'premium', entitlement: 'premiumTemplates', description: 'Structured multi-agent brokerage presentation.', qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-3', '2.0.0') },
  { id: 'template-4', version: '2.0.0', name: 'Urban Developer', thumbnail: '/templates/template-4.svg', supportedSchemaVersion: 2, tier: 'premium', entitlement: 'premiumTemplates', description: 'Bold project-led layout for developers and urban agencies.', qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-4', '2.0.0') },
]

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

export const assertTemplateEntitlement = async (organizationId: string, document: any): Promise<void> => {
  const template = getTemplate(document?.template?.id || 'template-1')
  if (template.tier === 'premium') await EntitlementService.assertFeature(organizationId, 'premiumTemplates')
}

export const TemplateRegistry = {
  list: () => registry.map(({ migrate: _migrate, ...item }) => ({ ...item })),
  get: getTemplate,
  migrate: migrateBuilderDocument,
  assertEntitlement: assertTemplateEntitlement,
}
