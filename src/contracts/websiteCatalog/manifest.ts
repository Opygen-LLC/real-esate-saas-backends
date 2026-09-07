import { DEFAULT_WEBSITE_CONTENT, WEBSITE_CONTENT_FIELDS, WEBSITE_CONTENT_SCHEMA_VERSION, type WebsiteContent, type WebsiteContentPatch, fillMissingContent } from './content'

export const WEBSITE_MANIFEST_VERSION = 1 as const
export const WEBSITE_TEMPLATE_IDS = ['template-1', 'template-2', 'template-3', 'template-4', 'template-5', 'template-6', 'template-7', 'template-8', 'template-9', 'template-10'] as const
export type WebsiteTemplateId = typeof WEBSITE_TEMPLATE_IDS[number]
export const WEBSITE_RENDERER_VERSIONS = ['legacy-v1', 'premium-v2'] as const
export type WebsiteRendererVersion = typeof WEBSITE_RENDERER_VERSIONS[number]
export const LEGACY_WEBSITE_RENDERER_VERSION: WebsiteRendererVersion = 'legacy-v1'
export const CURRENT_WEBSITE_RENDERER_VERSION: WebsiteRendererVersion = 'premium-v2'
export const REDESIGNED_WEBSITE_TEMPLATE_IDS = ['template-3', 'template-4', 'template-5', 'template-6', 'template-7', 'template-8', 'template-9', 'template-10'] as const
export const isWebsiteRendererVersion = (value: unknown): value is WebsiteRendererVersion => typeof value === 'string' && (WEBSITE_RENDERER_VERSIONS as readonly string[]).includes(value)
export const resolveWebsiteRendererVersion = (value: unknown): WebsiteRendererVersion => isWebsiteRendererVersion(value) ? value : LEGACY_WEBSITE_RENDERER_VERSION
export const isRedesignedWebsiteTemplate = (value: unknown): value is typeof REDESIGNED_WEBSITE_TEMPLATE_IDS[number] => typeof value === 'string' && (REDESIGNED_WEBSITE_TEMPLATE_IDS as readonly string[]).includes(value)
export const PUBLIC_WEBSITE_PAGES = ['home', 'about', 'contact', 'properties', 'propertyDetail', 'agents', 'agentDetail'] as const
export type PublicWebsitePage = typeof PUBLIC_WEBSITE_PAGES[number]
export type WebsiteTemplateSectionCapability = { supported: boolean; label: string; required?: boolean }
export type WebsiteTemplateCapabilities = {
  hero: { backgroundImage: boolean; eyebrow: boolean; title: boolean; subtitle: boolean }
  sections: Record<'featuredProperties' | 'whyChooseUs' | 'agents' | 'consultation', WebsiteTemplateSectionCapability>
  advancedBuilder: boolean
}
export type WebsitePublicationContract = {
  status: 'provisioned' | 'published' | 'suspended'
  revision: number
  lastPublishedAt?: string | null
  rendererVersion: WebsiteRendererVersion
}
export type WebsiteRevisionInput = { expectedPublicationRevision?: number }
export const isPublicationRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export const HOME_SECTION_VISIBILITY = {
  'home.featuredProperties': 'showFeaturedProperties', 'home.whyChooseUs': 'showWhyChooseUs',
  'home.agents': 'showAgents', 'home.consultation': 'showConsultation',
} as const
export type WebsiteTemplateManifest = {
  id: WebsiteTemplateId
  version: string
  manifestVersion: typeof WEBSITE_MANIFEST_VERSION
  contentSchemaVersion: typeof WEBSITE_CONTENT_SCHEMA_VERSION
  name: string
  thumbnail: string
  supportedSchemaVersion: number
  tier: 'free' | 'premium'
  entitlement: 'included' | 'premiumTemplates'
  description: string
  supportedPages: readonly PublicWebsitePage[]
  capabilities: WebsiteTemplateCapabilities
  contentFields: readonly string[]
  imageSlots: readonly ('home.heroImage' | 'about.image')[]
  editableSections: readonly string[]
  designControls: readonly string[]
  defaultContent: WebsiteContentPatch
}
const metadata = [
  {
    "id": "template-1",
    "version": "2.0.0",
    "name": "Modern Residence",
    "thumbnail": "/templates/template-1.svg",
    "supportedSchemaVersion": 2,
    "tier": "free",
    "entitlement": "included",
    "description": "Clean, conversion-focused residential website.",
    "capabilities": {
      "advancedBuilder": true,
      "hero": {
        "backgroundImage": true,
        "eyebrow": true,
        "title": true,
        "subtitle": true
      },
      "sections": {
        "featuredProperties": {
          "supported": true,
          "label": "Featured Properties"
        },
        "whyChooseUs": {
          "supported": true,
          "label": "Why Choose Us"
        },
        "agents": {
          "supported": true,
          "label": "Meet Our Agents"
        },
        "consultation": {
          "supported": true,
          "label": "Consultation"
        }
      }
    }
  },
  {
    "id": "template-2",
    "version": "2.0.0",
    "name": "Luxury Editorial",
    "thumbnail": "/templates/template-2.svg",
    "supportedSchemaVersion": 2,
    "tier": "free",
    "entitlement": "included",
    "description": "Editorial presentation for premium property portfolios.",
    "capabilities": {
      "advancedBuilder": true,
      "hero": {
        "backgroundImage": true,
        "eyebrow": true,
        "title": true,
        "subtitle": true
      },
      "sections": {
        "featuredProperties": {
          "supported": true,
          "label": "Featured Collection"
        },
        "whyChooseUs": {
          "supported": true,
          "label": "Brand Story"
        },
        "agents": {
          "supported": true,
          "label": "Advisors"
        },
        "consultation": {
          "supported": true,
          "label": "Private Consultation"
        }
      }
    }
  },
  {
    "id": "template-3",
    "version": "2.0.0",
    "name": "Corporate Brokerage",
    "thumbnail": "/templates/template-3.svg",
    "supportedSchemaVersion": 2,
    "tier": "premium",
    "entitlement": "premiumTemplates",
    "description": "Quiet corporate premium for established brokerages: precise search, disciplined listing presentation and a strong advisory-team hierarchy.",
    "capabilities": {
      "advancedBuilder": true,
      "hero": {
        "backgroundImage": true,
        "eyebrow": true,
        "title": true,
        "subtitle": true
      },
      "sections": {
        "featuredProperties": {
          "supported": true,
          "label": "Featured Listings"
        },
        "whyChooseUs": {
          "supported": true,
          "label": "Services"
        },
        "agents": {
          "supported": true,
          "label": "Brokerage Team"
        },
        "consultation": {
          "supported": true,
          "label": "Contact CTA"
        }
      }
    }
  },
  {
    "id": "template-4",
    "version": "2.0.0",
    "name": "Urban Developer",
    "thumbnail": "/templates/template-4.svg",
    "supportedSchemaVersion": 2,
    "tier": "premium",
    "entitlement": "premiumTemplates",
    "description": "Architectural editorial for developers: warm stone surfaces, project-led storytelling and clear inventory presentation.",
    "capabilities": {
      "advancedBuilder": true,
      "hero": {
        "backgroundImage": true,
        "eyebrow": true,
        "title": true,
        "subtitle": true
      },
      "sections": {
        "featuredProperties": {
          "supported": true,
          "label": "Featured Projects"
        },
        "whyChooseUs": {
          "supported": true,
          "label": "Development Highlights"
        },
        "agents": {
          "supported": true,
          "label": "Project Team"
        },
        "consultation": {
          "supported": true,
          "label": "Inquiry CTA"
        }
      }
    }
  },
  {
    "id": "template-5",
    "version": "2.0.0",
    "name": "Nordic Minimalist",
    "thumbnail": "/templates/template-5.svg",
    "supportedSchemaVersion": 2,
    "tier": "free",
    "entitlement": "included",
    "description": "True Nordic minimalism with warm whites, generous space, fine separators and uncomplicated property presentation.",
    "capabilities": {
      "advancedBuilder": true,
      "hero": {
        "backgroundImage": true,
        "eyebrow": true,
        "title": true,
        "subtitle": true
      },
      "sections": {
        "featuredProperties": {
          "supported": true,
          "label": "Curated Portfolio"
        },
        "whyChooseUs": {
          "supported": true,
          "label": "Quality Standards"
        },
        "agents": {
          "supported": true,
          "label": "Advisors"
        },
        "consultation": {
          "supported": true,
          "label": "Consultation"
        }
      }
    }
  },
  {
    "id": "template-6",
    "version": "2.0.0",
    "name": "Apex Metropolitan",
    "thumbnail": "/templates/template-6.svg",
    "supportedSchemaVersion": 2,
    "tier": "premium",
    "entitlement": "premiumTemplates",
    "description": "Quiet dark luxury for metropolitan portfolios: charcoal and warm ivory, restrained bronze accents and private-advisory presentation.",
    "capabilities": {
      "advancedBuilder": true,
      "hero": {
        "backgroundImage": true,
        "eyebrow": true,
        "title": true,
        "subtitle": true
      },
      "sections": {
        "featuredProperties": {
          "supported": true,
          "label": "Metropolitan Assets"
        },
        "whyChooseUs": {
          "supported": true,
          "label": "Execution Pillars"
        },
        "agents": {
          "supported": true,
          "label": "Asset Advisors"
        },
        "consultation": {
          "supported": true,
          "label": "Private Acquisition Desk"
        }
      }
    }
  },
  {
    "id": "template-7",
    "version": "2.0.0",
    "name": "Serene Oasis",
    "thumbnail": "/templates/template-7.svg",
    "supportedSchemaVersion": 2,
    "tier": "free",
    "entitlement": "included",
    "description": "Warm residential lifestyle design with cream and sage surfaces, natural-light imagery and neighborhood-led storytelling.",
    "capabilities": {
      "advancedBuilder": true,
      "hero": {
        "backgroundImage": true,
        "eyebrow": true,
        "title": true,
        "subtitle": true
      },
      "sections": {
        "featuredProperties": {
          "supported": true,
          "label": "Peaceful Residences"
        },
        "whyChooseUs": {
          "supported": true,
          "label": "Neighborhood Guides"
        },
        "agents": {
          "supported": true,
          "label": "Living Concierge"
        },
        "consultation": {
          "supported": true,
          "label": "Private Tour Scheduler"
        }
      }
    }
  },
  {
    "id": "template-8",
    "version": "3.0.0",
    "name": "Editorial Estate",
    "thumbnail": "/templates/template-8.svg",
    "supportedSchemaVersion": 2,
    "tier": "premium",
    "entitlement": "premiumTemplates",
    "description": "Property-magazine presentation with expressive typography, asymmetric compositions and curated listing stories across every public page.",
    "capabilities": {
      "advancedBuilder": true,
      "hero": {
        "backgroundImage": true,
        "eyebrow": true,
        "title": true,
        "subtitle": true
      },
      "sections": {
        "featuredProperties": {
          "supported": true,
          "label": "Selected Residences"
        },
        "whyChooseUs": {
          "supported": true,
          "label": "Editorial Story"
        },
        "agents": {
          "supported": true,
          "label": "Advisory Desk"
        },
        "consultation": {
          "supported": true,
          "label": "Private Appointment"
        }
      }
    }
  },
  {
    "id": "template-9",
    "version": "3.0.0",
    "name": "Gallery Residence",
    "thumbnail": "/templates/template-9.svg",
    "supportedSchemaVersion": 2,
    "tier": "premium",
    "entitlement": "premiumTemplates",
    "description": "Photographic portfolio luxury with large galleries, low visual clutter, compact navigation and an accessible inquiry path.",
    "capabilities": {
      "advancedBuilder": true,
      "hero": {
        "backgroundImage": true,
        "eyebrow": true,
        "title": true,
        "subtitle": true
      },
      "sections": {
        "featuredProperties": {
          "supported": true,
          "label": "Gallery Collection"
        },
        "whyChooseUs": {
          "supported": true,
          "label": "Signature Service"
        },
        "agents": {
          "supported": true,
          "label": "Private Advisors"
        },
        "consultation": {
          "supported": true,
          "label": "Arrange a Viewing"
        }
      }
    }
  },
  {
    "id": "template-10",
    "version": "3.0.0",
    "name": "Swiss Realty",
    "thumbnail": "/templates/template-10.svg",
    "supportedSchemaVersion": 2,
    "tier": "premium",
    "entitlement": "premiumTemplates",
    "description": "Swiss-grid realty system with disciplined hierarchy, restrained color and clear property facts across desktop and mobile.",
    "capabilities": {
      "advancedBuilder": true,
      "hero": {
        "backgroundImage": true,
        "eyebrow": true,
        "title": true,
        "subtitle": true
      },
      "sections": {
        "featuredProperties": {
          "supported": true,
          "label": "Current Inventory"
        },
        "whyChooseUs": {
          "supported": true,
          "label": "Operating Principles"
        },
        "agents": {
          "supported": true,
          "label": "Brokerage Team"
        },
        "consultation": {
          "supported": true,
          "label": "Start an Inquiry"
        }
      }
    }
  }
] as const

const baseHomeFields = ['eyebrow', 'heroTitle', 'heroSubtitle', 'heroImage', 'featuredEyebrow', 'featuredTitle', 'featuredSubtitle',
  'whyEyebrow', 'whyTitle', 'whySubtitle', 'features', 'agentsEyebrow', 'agentsTitle', 'agentsSubtitle',
  'consultationEyebrow', 'consultationTitle', 'consultationSubtitle', 'consultationButtonText',
  'showFeaturedProperties', 'showWhyChooseUs', 'showAgents', 'showConsultation', 'featuredPropertyIds', 'useCuratedProperties']
const sharedPageFields = Object.entries(WEBSITE_CONTENT_FIELDS).flatMap(([page, fields]) => page === 'home' ? [] : Object.keys(fields).map((field) => `${page}.${field}`))
const fieldsFor = (id: WebsiteTemplateId): string[] => [
  ...sharedPageFields, ...baseHomeFields.map((field) => `home.${field}`),
  ...(id === 'template-1' ? ['home.trustItems'] : []),
  ...(['template-2', 'template-9'].includes(id) ? ['home.heroGallery'] : []),
  ...(['template-5', 'template-7'].includes(id) ? ['heroCardBadge', 'heroCardTagline', 'heroCardTitle', 'heroCardSpecs', 'heroCardButtonText', 'heroCardLink', 'showHeroCard', 'heroPropertyId'].map((field) => `home.${field}`) : []),
  ...(['template-3', 'template-4', 'template-5', 'template-6', 'template-7', 'template-8', 'template-9', 'template-10'].includes(id) ? ['heroButtonText', 'heroButtonLink', 'secondaryButtonText', 'secondaryButtonLink'].map((field) => `home.${field}`) : []),
]
export const WEBSITE_TEMPLATE_MANIFESTS: readonly WebsiteTemplateManifest[] = metadata.map((item) => ({
  ...item, manifestVersion: WEBSITE_MANIFEST_VERSION, contentSchemaVersion: WEBSITE_CONTENT_SCHEMA_VERSION,
  supportedPages: PUBLIC_WEBSITE_PAGES, contentFields: fieldsFor(item.id), imageSlots: ['home.heroImage', 'about.image'],
  editableSections: ['shared.header', 'shared.footer', 'home.hero', ...(item.id === 'template-1' ? ['home.trustPoints'] : []), 'home.reviews', ...Object.keys(HOME_SECTION_VISIBILITY), 'about.hero', 'about.story', 'about.values', 'about.stats', 'about.cta', 'properties.hero', 'properties.listing', 'agents.hero', 'agents.listing', 'contact.hero', 'contact.office', 'contact.form'],
  designControls: ['primaryColor', 'secondaryColor', 'font', 'sectionStyles', 'componentOverrides', 'componentAnimations', 'imageAlt', 'imageFocalPoint', 'imageFit', 'sectionVisibility', 'sectionOrder'],
  defaultContent: {},
}))
export const getWebsiteTemplateManifest = (id?: string | null): WebsiteTemplateManifest => WEBSITE_TEMPLATE_MANIFESTS.find((item) => item.id === id) || WEBSITE_TEMPLATE_MANIFESTS[0]
export const templateSupportsContentField = (id: string | undefined, field: string): boolean => getWebsiteTemplateManifest(id).contentFields.includes(field)
export const getTemplateContentDefaults = (id?: string | null): WebsiteContent => fillMissingContent(DEFAULT_WEBSITE_CONTENT, getWebsiteTemplateManifest(id).defaultContent)
