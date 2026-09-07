import { DEFAULT_WEBSITE_CONTENT, WEBSITE_CONTENT_FIELDS, WEBSITE_CONTENT_SCHEMA_VERSION, type WebsiteContent, type WebsiteContentPatch, fillMissingContent } from './content'

export const WEBSITE_MANIFEST_VERSION = 1 as const
export const WEBSITE_TEMPLATE_IDS = ['template-1', 'template-2', 'template-3', 'template-4', 'template-5', 'template-6', 'template-7', 'template-8', 'template-9', 'template-10'] as const
export type WebsiteTemplateId = typeof WEBSITE_TEMPLATE_IDS[number]
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
    "description": "Structured multi-agent brokerage presentation.",
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
    "description": "Bold project-led layout for developers and urban agencies.",
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
    "description": "Clean Scandinavian architectural layout with high whitespace, mortgage estimator and verified badges.",
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
    "description": "High-tech dark cyber-luxury with live market ticker, glass cards and financial grid mode.",
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
    "description": "Warm organic modern editorial for peaceful waterfront, garden and botanical living.",
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
    "description": "Premium editorial system with expressive typography, asymmetric property grids, restrained surfaces and magazine-style storytelling across every public page.",
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
    "description": "Image-first luxury property experience with immersive galleries, floating navigation, calm neutral surfaces and premium inquiry journeys.",
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
    "description": "Swiss-grid brokerage system with sharp hierarchy, disciplined spacing, structured listing data and a professional commercial-real-estate tone.",
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
  ...(['template-5', 'template-7'].includes(id) ? ['heroCardBadge', 'heroCardTagline', 'heroCardTitle', 'heroCardSpecs', 'heroCardButtonText', 'heroCardLink', 'showHeroCard', 'heroPropertyId'].map((field) => `home.${field}`) : []),
  ...(['template-8', 'template-9', 'template-10'].includes(id) ? ['heroButtonText', 'heroButtonLink', 'secondaryButtonText', 'secondaryButtonLink'].map((field) => `home.${field}`) : []),
]
export const WEBSITE_TEMPLATE_MANIFESTS: readonly WebsiteTemplateManifest[] = metadata.map((item) => ({
  ...item, manifestVersion: WEBSITE_MANIFEST_VERSION, contentSchemaVersion: WEBSITE_CONTENT_SCHEMA_VERSION,
  supportedPages: PUBLIC_WEBSITE_PAGES, contentFields: fieldsFor(item.id), imageSlots: ['home.heroImage', 'about.image'],
  editableSections: ['shared.header', 'shared.footer', 'home.hero', ...(item.id === 'template-1' ? ['home.trustPoints'] : []), 'home.reviews', ...Object.keys(HOME_SECTION_VISIBILITY), 'about.hero', 'about.story', 'about.values', 'about.stats', 'about.cta', 'properties.hero', 'properties.listing', 'agents.hero', 'agents.listing', 'contact.hero', 'contact.office', 'contact.form'],
  designControls: ['primaryColor', 'secondaryColor', 'font', 'sectionStyles', 'componentOverrides', 'componentAnimations'],
  defaultContent: {},
}))
export const getWebsiteTemplateManifest = (id?: string | null): WebsiteTemplateManifest => WEBSITE_TEMPLATE_MANIFESTS.find((item) => item.id === id) || WEBSITE_TEMPLATE_MANIFESTS[0]
export const templateSupportsContentField = (id: string | undefined, field: string): boolean => getWebsiteTemplateManifest(id).contentFields.includes(field)
export const getTemplateContentDefaults = (id?: string | null): WebsiteContent => fillMissingContent(DEFAULT_WEBSITE_CONTENT, getWebsiteTemplateManifest(id).defaultContent)
