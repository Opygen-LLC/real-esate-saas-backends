import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { EntitlementService } from '../entitlement/entitlement.service'
import type { WebsiteTemplateId } from './websiteTemplate.constants'

export const CURRENT_BUILDER_SCHEMA_VERSION = 2

export type TemplateTier = 'free' | 'premium'

export interface WebsiteTemplateDefinition {
  id: WebsiteTemplateId
  version: string
  name: string
  thumbnail: string
  supportedSchemaVersion: number
  tier: TemplateTier
  entitlement: 'included' | 'premiumTemplates'
  description: string
  supportedPages?: readonly ['home', 'about', 'contact', 'properties', 'propertyDetail', 'agents', 'agentDetail']
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

const FULL_SITE_PAGES = ['home', 'about', 'contact', 'properties', 'propertyDetail', 'agents', 'agentDetail'] as const

const registry: WebsiteTemplateDefinition[] = [
  { id: 'template-1', version: '2.0.0', name: 'Modern Residence', thumbnail: '/templates/template-1.svg', supportedSchemaVersion: 2, tier: 'free', entitlement: 'included', description: 'Clean, conversion-focused residential website.', capabilities: { hero: { backgroundImage: true, eyebrow: true, title: true, subtitle: true }, sections: { featuredProperties: { supported: true, label: 'Featured Properties' }, whyChooseUs: { supported: true, label: 'Why Choose Us' }, agents: { supported: true, label: 'Meet Our Agents' }, consultation: { supported: true, label: 'Consultation' } } }, qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-1', '2.0.0') },
  { id: 'template-2', version: '2.0.0', name: 'Luxury Editorial', thumbnail: '/templates/template-2.svg', supportedSchemaVersion: 2, tier: 'free', entitlement: 'included', description: 'Editorial presentation for premium property portfolios.', capabilities: { hero: { backgroundImage: true, eyebrow: true, title: true, subtitle: true }, sections: { featuredProperties: { supported: true, label: 'Featured Collection' }, whyChooseUs: { supported: false, label: 'Brand Story' }, agents: { supported: false, label: 'Advisors' }, consultation: { supported: false, label: 'Private Consultation' } } }, qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-2', '2.0.0') },
  { id: 'template-3', version: '2.0.0', name: 'Corporate Brokerage', thumbnail: '/templates/template-3.svg', supportedSchemaVersion: 2, tier: 'premium', entitlement: 'premiumTemplates', description: 'Structured multi-agent brokerage presentation.', capabilities: { hero: { backgroundImage: false, eyebrow: true, title: true, subtitle: true }, sections: { featuredProperties: { supported: true, label: 'Featured Listings' }, whyChooseUs: { supported: false, label: 'Services' }, agents: { supported: false, label: 'Brokerage Team' }, consultation: { supported: false, label: 'Contact CTA' } } }, qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-3', '2.0.0') },
  { id: 'template-4', version: '2.0.0', name: 'Urban Developer', thumbnail: '/templates/template-4.svg', supportedSchemaVersion: 2, tier: 'premium', entitlement: 'premiumTemplates', description: 'Bold project-led layout for developers and urban agencies.', capabilities: { hero: { backgroundImage: true, eyebrow: true, title: true, subtitle: true }, sections: { featuredProperties: { supported: true, label: 'Featured Projects' }, whyChooseUs: { supported: false, label: 'Development Highlights' }, agents: { supported: false, label: 'Project Team' }, consultation: { supported: false, label: 'Inquiry CTA' } } }, qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-4', '2.0.0') },
  { id: 'template-5', version: '2.0.0', name: 'Nordic Minimalist', thumbnail: '/templates/template-5.svg', supportedSchemaVersion: 2, tier: 'free', entitlement: 'included', description: 'Clean Scandinavian architectural layout with high whitespace, mortgage estimator and verified badges.', capabilities: { hero: { backgroundImage: true, eyebrow: true, title: true, subtitle: true }, sections: { featuredProperties: { supported: true, label: 'Curated Portfolio' }, whyChooseUs: { supported: true, label: 'Quality Standards' }, agents: { supported: true, label: 'Advisors' }, consultation: { supported: true, label: 'Consultation' } } }, qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-5', '2.0.0') },
  { id: 'template-6', version: '2.0.0', name: 'Apex Metropolitan', thumbnail: '/templates/template-6.svg', supportedSchemaVersion: 2, tier: 'premium', entitlement: 'premiumTemplates', description: 'High-tech dark cyber-luxury with live market ticker, glass cards and financial grid mode.', capabilities: { hero: { backgroundImage: true, eyebrow: true, title: true, subtitle: true }, sections: { featuredProperties: { supported: true, label: 'Metropolitan Assets' }, whyChooseUs: { supported: true, label: 'Execution Pillars' }, agents: { supported: true, label: 'Asset Advisors' }, consultation: { supported: true, label: 'Private Acquisition Desk' } } }, qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-6', '2.0.0') },
  { id: 'template-7', version: '2.0.0', name: 'Serene Oasis', thumbnail: '/templates/template-7.svg', supportedSchemaVersion: 2, tier: 'free', entitlement: 'included', description: 'Warm organic modern editorial for peaceful waterfront, garden and botanical living.', capabilities: { hero: { backgroundImage: true, eyebrow: true, title: true, subtitle: true }, sections: { featuredProperties: { supported: true, label: 'Peaceful Residences' }, whyChooseUs: { supported: true, label: 'Neighborhood Guides' }, agents: { supported: true, label: 'Living Concierge' }, consultation: { supported: true, label: 'Private Tour Scheduler' } } }, qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-7', '2.0.0') },
  { id: 'template-8', version: '3.0.0', name: 'Editorial Estate', thumbnail: '/templates/template-8.svg', supportedSchemaVersion: 2, tier: 'premium', entitlement: 'premiumTemplates', description: 'Premium editorial system with expressive typography, asymmetric property grids, restrained surfaces and magazine-style storytelling across every public page.', capabilities: { hero: { backgroundImage: true, eyebrow: true, title: true, subtitle: true }, sections: { featuredProperties: { supported: true, label: 'Selected Residences' }, whyChooseUs: { supported: true, label: 'Editorial Story' }, agents: { supported: true, label: 'Advisory Desk' }, consultation: { supported: true, label: 'Private Appointment' } } }, qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-8', '3.0.0') },
  { id: 'template-9', version: '3.0.0', name: 'Gallery Residence', thumbnail: '/templates/template-9.svg', supportedSchemaVersion: 2, tier: 'premium', entitlement: 'premiumTemplates', description: 'Image-first luxury property experience with immersive galleries, floating navigation, calm neutral surfaces and premium inquiry journeys.', capabilities: { hero: { backgroundImage: true, eyebrow: true, title: true, subtitle: true }, sections: { featuredProperties: { supported: true, label: 'Gallery Collection' }, whyChooseUs: { supported: true, label: 'Signature Service' }, agents: { supported: true, label: 'Private Advisors' }, consultation: { supported: true, label: 'Arrange a Viewing' } } }, qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-9', '3.0.0') },
  { id: 'template-10', version: '3.0.0', name: 'Swiss Realty', thumbnail: '/templates/template-10.svg', supportedSchemaVersion: 2, tier: 'premium', entitlement: 'premiumTemplates', description: 'Swiss-grid brokerage system with sharp hierarchy, disciplined spacing, structured listing data and a professional commercial-real-estate tone.', capabilities: { hero: { backgroundImage: true, eyebrow: true, title: true, subtitle: true }, sections: { featuredProperties: { supported: true, label: 'Current Inventory' }, whyChooseUs: { supported: true, label: 'Operating Principles' }, agents: { supported: true, label: 'Brokerage Team' }, consultation: { supported: true, label: 'Start an Inquiry' } } }, qa: { accessibility: 'enforced', responsive: 'enforced' }, migrate: pinTemplate('template-10', '3.0.0') },
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
  list: () => registry.map(({ migrate: _migrate, ...item }) => ({ ...item, supportedPages: FULL_SITE_PAGES })),
  get: getTemplate,
  migrate: migrateBuilderDocument,
  assertEntitlement: assertTemplateEntitlement,
  isPremium: (id: string) => registry.some((item) => item.id === id && item.tier === 'premium'),
}
