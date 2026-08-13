import { z } from 'zod'
const optionalUrl = z.union([z.literal(''), z.string().url().max(2048)])
export const OrganizationValidation = {
  updateProfile: z.object({ body: z.object({ agencyName: z.string().trim().min(2).max(120).optional(),
    agencyType: z.enum(['residential', 'commercial', 'mixed', 'brokerage', 'developer', 'general']).optional(),
    licenseNumber: z.string().max(100).optional(), address: z.string().max(300).optional(), city: z.string().max(100).optional(),
    state: z.string().max(100).optional(), country: z.literal('Bangladesh').optional(), zipCode: z.string().regex(/^\d{4}$/).optional(),
    defaultLanguage: z.enum(['en', 'bn']).optional(),
    addressDetails: z.object({ divisionId: z.string().max(12).optional(), division: z.string().max(80).optional(), districtId: z.string().max(12).optional(),
      district: z.string().max(80).optional(), upazilaId: z.string().max(12).optional(), upazila: z.string().max(80).optional(), areaId: z.string().max(12).optional(),
      area: z.string().max(100).optional(), road: z.string().max(100).optional(), block: z.string().max(50).optional(), sector: z.string().max(50).optional(),
      mouza: z.string().max(100).optional(), postalCode: z.string().regex(/^\d{4}$/).optional(), landmark: z.string().max(200).optional() }).strict().optional(),
    areaConversion: z.object({ kathaSqft: z.number().positive().max(10000), bighaKatha: z.number().positive().max(100) }).strict().optional(),
    serviceAreas: z.array(z.union([z.string().max(100), z.record(z.unknown())])).max(100).optional(), socialLinks: z.record(optionalUrl).optional(),
    teamSettings: z.object({ defaultRole: z.enum(['agent', 'staff', 'agency_admin']).optional(), agentsCanViewAllLeads: z.boolean().optional(),
      leaderboardVisible: z.boolean().optional(), autoAssignLeads: z.boolean().optional() }).optional() }).strict() }),
  website: z.object({ body: z.object({ templateId: z.enum(['template-1', 'template-2', 'template-3', 'template-4']).optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    font: z.string().max(80).optional(), metaTitle: z.string().max(120).optional(), metaDescription: z.string().max(300).optional(),
    logo: optionalUrl.optional(), defaultLanguage: z.enum(['en', 'bn']).optional(), socialLinks: z.record(optionalUrl).optional(), websiteSettings: z.record(z.unknown()).optional() }).strict() }),
  platformUpdate: z.object({ body: z.object({ isBlocked: z.boolean().optional(),
    subscription: z.object({ status: z.enum(['trialing', 'active', 'past_due', 'grace', 'cancel_at_period_end', 'expired', 'suspended']).optional(),
      currentPeriodEnd: z.coerce.date().optional(), gracePeriodEnd: z.coerce.date().nullable().optional() }).optional() }).strict() }),
}
