import { z } from 'zod'
const sourceSchema = z.enum(['Website','WhatsApp','Facebook','Instagram','Google','Referral','WalkIn','Portal','Phone','Email','Ad','Other'])
const contactTypeSchema = z.enum(['Buyer', 'Seller', 'Tenant', 'Landlord', 'Investor', 'Partner', 'Other'])

const editableContactFields = {
  name: z.string().trim().min(1, 'Contact name is required').max(120),
  phone: z.string().trim().min(1, 'Phone number is required').max(40),
  email: z.string().email().optional().or(z.literal('')),
  type: contactTypeSchema.optional(),
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  company: z.string().trim().max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
  assignedTo: z.string().optional(),
  source: sourceSchema.optional(),
  propertyInterest: z.array(z.string()).max(100).optional(),
  followUpDate: z.string().datetime().optional(),
}

const createContactZodSchema = z.object({
  body: z.object(editableContactFields).strict(),
})

const updateContactZodSchema = z.object({
  body: z.object({ ...editableContactFields, name: editableContactFields.name.optional(), phone: editableContactFields.phone.optional() }).partial().strict(),
})

export const ContactValidation = {
  createContactZodSchema,
  updateContactZodSchema,
}
