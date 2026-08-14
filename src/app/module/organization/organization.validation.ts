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
const websiteSettings = z.object({
  heroTitle: z.string().max(160).optional(),
  heroSubtitle: z.string().max(400).optional(),
  heroImage: optionalUrl.optional(),
  featuredPropertiesCount: z.number().int().min(1).max(24).optional(),
  enableTestimonials: z.boolean().optional(),
  enableLeadForm: z.boolean().optional(),
  enableWhatsAppChat: z.boolean().optional(),
  renderMode: z.enum(['template', 'builder']).optional(),
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
