import { z } from 'zod'

const optionalUrl = z.union([z.literal(''), z.string().url().max(2048)])
const agencyType = z.enum(['residential', 'commercial', 'mixed', 'brokerage', 'developer', 'general'])
const addressDetails = z.object({
  divisionId: z.string().max(12).optional(), division: z.string().max(80).optional(), districtId: z.string().max(12).optional(),
  district: z.string().max(80).optional(), upazilaId: z.string().max(12).optional(), upazila: z.string().max(80).optional(), areaId: z.string().max(12).optional(),
  area: z.string().max(100).optional(), road: z.string().max(100).optional(), block: z.string().max(50).optional(), sector: z.string().max(50).optional(),
  mouza: z.string().max(100).optional(), postalCode: z.union([z.literal(''), z.string().regex(/^\d{4}$/)]).optional(), landmark: z.string().max(200).optional(),
}).strict()
const socialLinks = z.object({
  facebook: optionalUrl.optional(), instagram: optionalUrl.optional(), twitter: optionalUrl.optional(), linkedin: optionalUrl.optional(),
  youtube: optionalUrl.optional(), whatsapp: z.union([z.literal(''), z.string().max(40)]).optional(),
}).strict()
const shortText = (max = 200) => z.string().trim().max(max)
const websiteFeature = z.object({ title: shortText(120), description: shortText(500) }).strict()
const websiteStat = z.object({ label: shortText(80), value: shortText(40), caption: shortText(160) }).strict()
const websiteContent = z.object({
  navigation: z.object({
    tagline: shortText(120), homeLabel: shortText(40), propertiesLabel: shortText(40), agentsLabel: shortText(40),
    aboutLabel: shortText(40), contactLabel: shortText(40), headerCtaLabel: shortText(60),
    footerDescription: shortText(600), footerTrustText: shortText(180),
  }).strict().optional(),
  home: z.object({
    eyebrow: shortText(160), heroTitle: shortText(200), heroSubtitle: shortText(600), heroImage: optionalUrl,
    trustItems: z.array(shortText(140)).max(3), featuredEyebrow: shortText(120), featuredTitle: shortText(160), featuredSubtitle: shortText(400),
    whyEyebrow: shortText(120), whyTitle: shortText(180), whySubtitle: shortText(400), features: z.array(websiteFeature).max(4),
    agentsEyebrow: shortText(120), agentsTitle: shortText(160), agentsSubtitle: shortText(400), consultationEyebrow: shortText(120),
    consultationTitle: shortText(180), consultationSubtitle: shortText(500), consultationButtonText: shortText(80),
    showFeaturedProperties: z.boolean(), showWhyChooseUs: z.boolean(), showAgents: z.boolean(), showConsultation: z.boolean(),
  }).strict().optional(),
  about: z.object({
    eyebrow: shortText(120), title: shortText(200), intro: shortText(900), image: optionalUrl, storyTitle: shortText(180), storyBody: shortText(1500),
    values: z.array(websiteFeature).max(3), stats: z.array(websiteStat).max(4), ctaEyebrow: shortText(120), ctaTitle: shortText(200),
    ctaText: shortText(700), ctaButtonText: shortText(80), showStats: z.boolean(),
  }).strict().optional(),
  properties: z.object({ eyebrow: shortText(120), title: shortText(180), subtitle: shortText(500) }).strict().optional(),
  agents: z.object({ eyebrow: shortText(120), title: shortText(180), subtitle: shortText(500) }).strict().optional(),
  contact: z.object({
    eyebrow: shortText(120), title: shortText(180), subtitle: shortText(500), officeTitle: shortText(120), hoursTitle: shortText(120),
    weekdaysHours: shortText(80), fridayHours: shortText(80), whatsappHours: shortText(100), formTitle: shortText(120),
    formSubtitle: shortText(400), submitButtonText: shortText(80),
  }).strict().optional(),
}).strict()
const websiteSettings = z.object({
  heroTitle: z.string().max(160).optional(),
  heroSubtitle: z.string().max(400).optional(),
  heroImage: optionalUrl.optional(),
  featuredPropertiesCount: z.number().int().min(1).max(24).optional(),
  enableTestimonials: z.boolean().optional(),
  enableLeadForm: z.boolean().optional(),
  enableWhatsAppChat: z.boolean().optional(),
  renderMode: z.enum(['template', 'builder']).optional(),
  content: websiteContent.optional(),
}).strict()


export const OrganizationValidation = {
  updateProfile: z.object({ body: z.object({
    agencyName: z.string().trim().min(2).max(120).optional(), agencyType: agencyType.optional(),
    licenseNumber: z.string().max(100).optional(), address: z.string().max(300).optional(), city: z.string().max(100).optional(),
    state: z.string().max(100).optional(), country: z.literal('Bangladesh').optional(), zipCode: z.union([z.literal(''), z.string().regex(/^\d{4}$/)]).optional(),
    defaultLanguage: z.enum(['en', 'bn']).optional(), addressDetails: addressDetails.optional(),
    areaConversion: z.object({ kathaSqft: z.number().positive().max(10000), bighaKatha: z.number().positive().max(100) }).strict().optional(),
    serviceAreas: z.array(z.union([z.string().max(100), z.record(z.unknown())])).max(100).optional(), socialLinks: socialLinks.optional(),
    teamSettings: z.object({ defaultRole: z.enum(['agent', 'staff', 'agency_admin']).optional(), agentsCanViewAllLeads: z.boolean().optional(),
      leaderboardVisible: z.boolean().optional(), autoAssignLeads: z.boolean().optional() }).strict().optional(),
  }).strict() }),

  website: z.object({ body: z.object({
    templateId: z.enum(['template-1', 'template-2', 'template-3', 'template-4']).optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    font: z.enum(['Inter', 'Geist', 'Poppins', 'Manrope', 'Roboto', 'Playfair Display']).optional(), metaTitle: z.string().max(120).optional(),
    metaDescription: z.string().max(300).optional(), logo: optionalUrl.optional(), defaultLanguage: z.enum(['en', 'bn']).optional(),
    socialLinks: socialLinks.optional(), websiteSettings: websiteSettings.optional(),
  }).strict() }),

  onboarding: z.object({ body: z.object({
    currentStep: z.number().int().min(1).max(5).optional(),
    agencyName: z.string().trim().min(2).max(120).optional(), agencyType: agencyType.optional(), licenseNumber: z.string().max(100).optional(),
    address: z.string().max(300).optional(), city: z.string().max(100).optional(), state: z.string().max(100).optional(), country: z.literal('Bangladesh').optional(),
    defaultLanguage: z.enum(['en', 'bn']).optional(), addressDetails: addressDetails.optional(), serviceAreas: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    logo: optionalUrl.optional(), primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    font: z.enum(['Inter', 'Geist', 'Poppins', 'Manrope', 'Roboto', 'Playfair Display']).optional(), templateId: z.enum(['template-1', 'template-2', 'template-3', 'template-4']).optional(),
    websiteSettings: websiteSettings.optional(), socialLinks: socialLinks.optional(),
  }).strict() }),

  platformUpdate: z.object({ body: z.object({ reason: z.string().trim().min(10).max(500),
    subscription: z.object({ status: z.enum(['trialing', 'active', 'past_due', 'grace', 'cancel_at_period_end', 'expired']).optional(),
      currentPeriodEnd: z.coerce.date().optional(), gracePeriodEnd: z.coerce.date().nullable().optional() }).strict().optional() }).strict()
      .refine((value) => value.subscription && Object.keys(value.subscription).length > 0, 'Subscription change is required') }),
}
