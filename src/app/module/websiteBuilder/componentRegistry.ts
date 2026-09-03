import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { EntitlementService } from '../entitlement/entitlement.service'
import {
  WEBSITE_COMPONENT_SLOTS,
  type AnimationPreset,
  type WebsiteComponentOverrides,
  type WebsiteComponentSlot,
} from './websiteArchitecture.contract'

export type WebsiteComponentCategory =
  | 'header' | 'footer' | 'hero' | 'featured-properties' | 'why-choose-us' | 'reviews' | 'agents' | 'consultation'
  | 'about-hero' | 'about-story' | 'about-values' | 'about-stats' | 'about-cta'
  | 'properties-hero' | 'properties-listing' | 'properties-filters' | 'properties-card' | 'properties-pagination'
  | 'agents-hero' | 'agents-listing' | 'agents-card' | 'agents-cta'
  | 'contact-hero' | 'contact-office' | 'contact-form' | 'contact-map'
export type WebsiteComponentStatus = 'ACTIVE' | 'INACTIVE'
export type WebsiteComponentTier = 'FREE' | 'PREMIUM'
export type WebsiteComponentEntitlement = 'included' | 'premiumTemplates'

export type WebsiteComponentDefinition = {
  id: string
  name: string
  slot: WebsiteComponentSlot
  category: WebsiteComponentCategory
  version: number
  status: WebsiteComponentStatus
  tier: WebsiteComponentTier
  entitlement: WebsiteComponentEntitlement
  description: string
  thumbnail: string | null
  supportedAnimations: readonly AnimationPreset[]
}

const COMMON_ENTRANCE_ANIMATIONS = ['none', 'fade-in', 'fade-up', 'fade-down', 'fade-left', 'fade-right', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom-in', 'zoom-out', 'blur-in', 'reveal-up'] as const satisfies readonly AnimationPreset[]
const registry = [
  { id: 'header.modern-glass.v1', name: 'Modern Glass', slot: 'shared.header', category: 'header', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Independent floating glass navigation with responsive agency actions.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'header.luxury-centered.v1', name: 'Luxury Centered', slot: 'shared.header', category: 'header', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Centered editorial navigation designed for premium real-estate brands.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'header.corporate-split.v1', name: 'Corporate Split', slot: 'shared.header', category: 'header', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Structured brokerage header with contact-first navigation.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'footer.mega.v1', name: 'Mega Footer', slot: 'shared.footer', category: 'footer', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Large multi-column agency footer with navigation, contact details and social links.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'footer.minimal.v1', name: 'Minimal Footer', slot: 'shared.footer', category: 'footer', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Compact navigation-first footer for clean contemporary websites.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'footer.luxury-centered.v1', name: 'Luxury Centered Footer', slot: 'shared.footer', category: 'footer', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Centered editorial footer for premium residential brands.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'hero.property-search.v1', name: 'Property Search', slot: 'home.hero', category: 'hero', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Search-led independent hero focused on fast property discovery.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'hero.split-luxury.v1', name: 'Luxury Split', slot: 'home.hero', category: 'hero', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Editorial split-screen hero with cinematic property media.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'hero.editorial-fullscreen.v1', name: 'Editorial Fullscreen', slot: 'home.hero', category: 'hero', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Fullscreen image-first hero with restrained editorial typography.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.modern-grid.v1', name: 'Modern Grid', slot: 'home.featuredProperties', category: 'featured-properties', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Responsive independent property-card grid using canonical public property presentation.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.editorial.v1', name: 'Editorial Properties', slot: 'home.featuredProperties', category: 'featured-properties', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Image-led editorial presentation using canonical public property presentation.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.horizontal-carousel.v1', name: 'Horizontal Collection', slot: 'home.featuredProperties', category: 'featured-properties', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Touch-friendly horizontal property collection using canonical public property presentation.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'why.icon-cards.v1', name: 'Icon Cards', slot: 'home.whyChooseUs', category: 'why-choose-us', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Four-card trust and service presentation using website content features.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'why.image-statistics.v1', name: 'Image + Statistics', slot: 'home.whyChooseUs', category: 'why-choose-us', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Image-led agency value proposition paired with website statistics.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'why.numbered-editorial.v1', name: 'Numbered Editorial', slot: 'home.whyChooseUs', category: 'why-choose-us', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Editorial numbered list for a structured premium agency story.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'reviews.three-cards.v1', name: 'Three Review Cards', slot: 'home.reviews', category: 'reviews', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Three-card review layout rendered only from published public reviews.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'reviews.testimonial-slider.v1', name: 'Large Testimonial Slider', slot: 'home.reviews', category: 'reviews', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Large editorial testimonial slider rendered only from published public reviews.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'reviews.rating-summary.v1', name: 'Rating Summary + Reviews', slot: 'home.reviews', category: 'reviews', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Average rating summary with recent published client reviews.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.portrait-cards.v1', name: 'Portrait Cards', slot: 'home.agents', category: 'agents', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Portrait agent cards with direct contact actions.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.editorial-split.v1', name: 'Editorial Split', slot: 'home.agents', category: 'agents', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Editorial team composition with a lead advisor focus.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.minimal-profiles.v1', name: 'Minimal Profiles', slot: 'home.agents', category: 'agents', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Compact advisor directory for restrained website designs.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'consultation.background-image.v1', name: 'Background Image CTA', slot: 'home.consultation', category: 'consultation', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Cinematic inquiry CTA with a canonical public lead submission form.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'consultation.minimal-brand.v1', name: 'Minimal Brand CTA', slot: 'home.consultation', category: 'consultation', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Brand-color consultation block with compact canonical lead capture.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'consultation.split-lead-form.v1', name: 'Split Lead Form', slot: 'home.consultation', category: 'consultation', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Split information and lead form layout that preserves the existing public CRM capture flow.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.hero.centered.v1', name: 'Centered Introduction', slot: 'about.hero', category: 'about-hero', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Centered about-page introduction with strong typography and agency story copy.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.hero.split.v1', name: 'Image Split Introduction', slot: 'about.hero', category: 'about-hero', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Split about hero pairing agency introduction with the configured about image.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.hero.editorial.v1', name: 'Editorial Introduction', slot: 'about.hero', category: 'about-hero', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Dark editorial introduction for high-contrast agency storytelling.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.story.image-split.v1', name: 'Image Split Story', slot: 'about.story', category: 'about-story', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Image-led agency story section using canonical About content.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.story.quote.v1', name: 'Statement Story', slot: 'about.story', category: 'about-story', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Large statement-style story presentation with editorial hierarchy.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.story.timeline.v1', name: 'Story Timeline', slot: 'about.story', category: 'about-story', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Timeline presentation for longer agency story copy.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.values.cards.v1', name: 'Value Cards', slot: 'about.values', category: 'about-values', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Independent card layout for agency values.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.values.stripes.v1', name: 'Value Stripes', slot: 'about.values', category: 'about-values', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Structured numbered rows for agency values.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.values.editorial.v1', name: 'Editorial Values', slot: 'about.values', category: 'about-values', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Dark editorial value cards using brand tokens.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.stats.cards.v1', name: 'Statistic Cards', slot: 'about.stats', category: 'about-stats', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Responsive metric cards using canonical About statistics.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.stats.band.v1', name: 'Brand Statistic Band', slot: 'about.stats', category: 'about-stats', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Full-width brand-color statistics band.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.stats.minimal.v1', name: 'Minimal Statistics', slot: 'about.stats', category: 'about-stats', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Minimal divided statistics presentation.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.cta.dark.v1', name: 'Dark About CTA', slot: 'about.cta', category: 'about-cta', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Dark closing call-to-action using the canonical contact route.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.cta.split.v1', name: 'Split About CTA', slot: 'about.cta', category: 'about-cta', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Split copy/action about-page closing block.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'about.cta.outline.v1', name: 'Outline About CTA', slot: 'about.cta', category: 'about-cta', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Minimal outlined about-page call-to-action.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.page-hero.search-band.v1', name: 'Search Band Hero', slot: 'properties.hero', category: 'properties-hero', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Property catalog hero with canonical keyword search control.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.page-hero.split.v1', name: 'Featured Split Hero', slot: 'properties.hero', category: 'properties-hero', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Split catalog hero using current canonical property data.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.page-hero.editorial.v1', name: 'Editorial Catalog Hero', slot: 'properties.hero', category: 'properties-hero', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'High-contrast editorial property catalog introduction.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.listing.sidebar.v1', name: 'Sidebar Catalog', slot: 'properties.listing', category: 'properties-listing', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Sidebar filters, canonical property cards and paginated results.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.listing.toolbar.v1', name: 'Toolbar Catalog', slot: 'properties.listing', category: 'properties-listing', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Collapsible filter toolbar with responsive property grid and pagination.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.listing.editorial.v1', name: 'Editorial Inventory', slot: 'properties.listing', category: 'properties-listing', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Editorial property rows with canonical specs, pricing and filter sidebar.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.page-hero.centered.v1', name: 'Centered Team Hero', slot: 'agents.hero', category: 'agents-hero', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Centered public team introduction.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.page-hero.count-split.v1', name: 'Team Count Split', slot: 'agents.hero', category: 'agents-hero', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Team hero paired with the live count of public advisors.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.page-hero.editorial.v1', name: 'Editorial Team Hero', slot: 'agents.hero', category: 'agents-hero', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'High-contrast editorial team introduction.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.listing.portrait-grid.v1', name: 'Portrait Agent Grid', slot: 'agents.listing', category: 'agents-listing', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Portrait cards with canonical direct-contact and profile routes.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.listing.editorial.v1', name: 'Editorial Agent Listing', slot: 'agents.listing', category: 'agents-listing', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Lead-advisor editorial composition with supporting profiles.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.listing.minimal.v1', name: 'Minimal Agent Directory', slot: 'agents.listing', category: 'agents-listing', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Compact public advisor directory and agent CTA.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'contact.hero.centered.v1', name: 'Centered Contact Hero', slot: 'contact.hero', category: 'contact-hero', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Centered contact introduction using agency content.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'contact.hero.split.v1', name: 'Direct Desk Hero', slot: 'contact.hero', category: 'contact-hero', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Split contact introduction with direct phone and email desk.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'contact.hero.editorial.v1', name: 'Editorial Contact Hero', slot: 'contact.hero', category: 'contact-hero', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Editorial high-contrast contact introduction.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'contact.office.cards.v1', name: 'Office Information Cards', slot: 'contact.office', category: 'contact-office', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Office contact details, opening hours and direct channels.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'contact.office.map-first.v1', name: 'Map First Office', slot: 'contact.office', category: 'contact-office', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Map/location-first office section with external directions.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'contact.office.dark.v1', name: 'Dark Contact Desk', slot: 'contact.office', category: 'contact-office', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Dark contact desk with phone, email, address and WhatsApp.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'contact.form.card.v1', name: 'Contact Form Card', slot: 'contact.form', category: 'contact-form', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Independent contact form using the canonical public lead capture action.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'contact.form.dark.v1', name: 'Dark Contact Form', slot: 'contact.form', category: 'contact-form', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Dark contact form using the canonical public lead capture action.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'contact.form.minimal.v1', name: 'Minimal Contact Form', slot: 'contact.form', category: 'contact-form', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Minimal contact form using the canonical public lead capture action.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.filters.sidebar.v1', name: 'Sidebar Filters', slot: 'properties.filters', category: 'properties-filters', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Full canonical public property filter panel.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.filters.compact-bar.v1', name: 'Compact Filter Bar', slot: 'properties.filters', category: 'properties-filters', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Compact search and sorting bar for the public property catalog.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.filters.minimal.v1', name: 'Minimal Filter Pills', slot: 'properties.filters', category: 'properties-filters', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Minimal listing-type filter controls using canonical filter state.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.card.modern.v1', name: 'Modern Property Card', slot: 'properties.card', category: 'properties-card', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Modern property card using canonical normalized public presentation.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.card.editorial.v1', name: 'Editorial Property Card', slot: 'properties.card', category: 'properties-card', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Editorial horizontal property card using canonical normalized public presentation.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.card.compact.v1', name: 'Compact Property Card', slot: 'properties.card', category: 'properties-card', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Compact property card for dense catalog layouts.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.pagination.numbered.v1', name: 'Numbered Pagination', slot: 'properties.pagination', category: 'properties-pagination', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Numbered pagination driven by canonical public property metadata.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.pagination.minimal.v1', name: 'Minimal Pagination', slot: 'properties.pagination', category: 'properties-pagination', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Minimal previous/next pagination controls.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.pagination.load-more.v1', name: 'Load More', slot: 'properties.pagination', category: 'properties-pagination', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Load-more presentation using the canonical pagination action.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.card.portrait.v1', name: 'Portrait Agent Card', slot: 'agents.card', category: 'agents-card', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Portrait advisor card using canonical public agent data.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.card.compact.v1', name: 'Compact Agent Card', slot: 'agents.card', category: 'agents-card', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Compact public agent card for dense directories.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.card.editorial.v1', name: 'Editorial Agent Card', slot: 'agents.card', category: 'agents-card', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Editorial public advisor row with direct contact and profile route.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.cta.dark.v1', name: 'Dark Agent CTA', slot: 'agents.cta', category: 'agents-cta', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Dark team advisory call-to-action.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.cta.brand.v1', name: 'Brand Agent CTA', slot: 'agents.cta', category: 'agents-cta', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Brand-color team advisory call-to-action.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.cta.minimal.v1', name: 'Minimal Agent CTA', slot: 'agents.cta', category: 'agents-cta', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Minimal agency-advisory call-to-action.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'contact.map.location-card.v1', name: 'Location Card', slot: 'contact.map', category: 'contact-map', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Office location card with external map navigation.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'contact.map.directions.v1', name: 'Directions Split', slot: 'contact.map', category: 'contact-map', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Split location and directions component using agency address data.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'contact.map.minimal.v1', name: 'Minimal Location', slot: 'contact.map', category: 'contact-map', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Minimal office-location row with map action.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
] as const satisfies readonly WebsiteComponentDefinition[]

const registryById = new Map<string, WebsiteComponentDefinition>(registry.map((definition) => [definition.id, definition]))

const readOverride = (overrides: WebsiteComponentOverrides | undefined, slot: WebsiteComponentSlot): string | undefined => {
  if (!overrides) return undefined
  const [group, key] = slot.split('.', 2)
  return (overrides as Record<string, Record<string, string> | undefined>)[group]?.[key]
}

const get = (id: string): WebsiteComponentDefinition => {
  const definition = registryById.get(id)
  if (!definition) throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown website component')
  return definition
}

const assertComponentForSlot = async (organizationId: string, slot: WebsiteComponentSlot, componentId: string): Promise<WebsiteComponentDefinition> => {
  const definition = get(componentId)
  if (definition.slot !== slot) {
    throw new ApiError(httpStatus.BAD_REQUEST, `${definition.name} cannot be assigned to ${slot}`)
  }
  if (definition.status !== 'ACTIVE') {
    throw new ApiError(httpStatus.BAD_REQUEST, `${definition.name} is not currently available`)
  }
  if (definition.entitlement === 'premiumTemplates') {
    await EntitlementService.assertFeature(organizationId, 'premiumTemplates')
  }
  return definition
}

const assertOverrides = async (organizationId: string, overrides?: WebsiteComponentOverrides): Promise<void> => {
  for (const slot of WEBSITE_COMPONENT_SLOTS) {
    const componentId = readOverride(overrides, slot)
    if (componentId) await assertComponentForSlot(organizationId, slot, componentId)
  }
}

export const ComponentRegistry = {
  list: (): WebsiteComponentDefinition[] => registry.map((definition) => ({ ...definition })),
  get,
  find: (id: string): WebsiteComponentDefinition | undefined => registryById.get(id),
  assertComponentForSlot,
  assertOverrides,
  isPremium: (id: string): boolean => registryById.get(id)?.tier === 'PREMIUM',
  supportsSlot: (id: string, slot: WebsiteComponentSlot): boolean => registryById.get(id)?.slot === slot,
  isEffectiveForAccess: (id: string, premiumTemplates: boolean): boolean => {
    const definition = registryById.get(id)
    if (!definition || definition.status !== 'ACTIVE') return false
    return definition.entitlement !== 'premiumTemplates' || premiumTemplates
  },
}
