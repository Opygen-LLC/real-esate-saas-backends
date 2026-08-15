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
  capabilities: {
    hero: { backgroundImage: boolean; eyebrow: boolean; title: boolean; subtitle: boolean }
    sections: {
      featuredProperties: { supported: boolean; label: string; required?: boolean }
      whyChooseUs: { supported: boolean; label: string; required?: boolean }
      agents: { supported: boolean; label: string; required?: boolean }
      consultation: { supported: boolean; label: string; required?: boolean }
    }
  }
  qa: { accessibility: 'enforced'; responsive: 'enforced' }
  migrate: (document: any) => any
}

const pinTemplate = (id: string, version: string) => (document: any) => ({ ...document, template: { id, version } })

const registry: WebsiteTemplateDefinition[] = [
  { id: 'template-1', version: '2.0.0', name: 'Modern Residence', thumbnail: '/templates/template-1.svg', supportedSchemaVersion: 2, tier: 'free', entitlement: 'included', description: 'Clean, conversion-focused residential website.', capabilities: { hero: { backgroundImage: true, eyebrow: true, title: true, subtitle: true }, sections: { featuredProperties: { supported: true, label: 'Featured Properties' }, whyChooseUs: { supported: true, label: 'Why Choose Us' }, agents: { supported: true, label: 'Meet Our Agents' }, consultation: { supported: true, label: 'Consultation' } } }, qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-1', '2.0.0') },
  { id: 'template-2', version: '2.0.0', name: 'Luxury Editorial', thumbnail: '/templates/template-2.svg', supportedSchemaVersion: 2, tier: 'free', entitlement: 'included', description: 'Editorial presentation for premium property portfolios.', capabilities: { hero: { backgroundImage: true, eyebrow: true, title: true, subtitle: true }, sections: { featuredProperties: { supported: true, label: 'Featured Collection' }, whyChooseUs: { supported: false, label: 'Brand Story' }, agents: { supported: false, label: 'Advisors' }, consultation: { supported: false, label: 'Private Consultation' } } }, qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-2', '2.0.0') },
  { id: 'template-3', version: '2.0.0', name: 'Corporate Brokerage', thumbnail: '/templates/template-3.svg', supportedSchemaVersion: 2, tier: 'premium', entitlement: 'premiumTemplates', description: 'Structured multi-agent brokerage presentation.', capabilities: { hero: { backgroundImage: false, eyebrow: true, title: true, subtitle: true }, sections: { featuredProperties: { supported: true, label: 'Featured Listings' }, whyChooseUs: { supported: false, label: 'Services' }, agents: { supported: false, label: 'Brokerage Team' }, consultation: { supported: false, label: 'Contact CTA' } } }, qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-3', '2.0.0') },
  { id: 'template-4', version: '2.0.0', name: 'Urban Developer', thumbnail: '/templates/template-4.svg', supportedSchemaVersion: 2, tier: 'premium', entitlement: 'premiumTemplates', description: 'Bold project-led layout for developers and urban agencies.', capabilities: { hero: { backgroundImage: true, eyebrow: true, title: true, subtitle: true }, sections: { featuredProperties: { supported: true, label: 'Featured Projects' }, whyChooseUs: { supported: false, label: 'Development Highlights' }, agents: { supported: false, label: 'Project Team' }, consultation: { supported: false, label: 'Inquiry CTA' } } }, qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-4', '2.0.0') },
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
