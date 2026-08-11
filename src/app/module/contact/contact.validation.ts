import { z } from 'zod'

const createContactZodSchema = z.object({
  body: z.object({
    name: z.string({ required_error: 'Contact name is required' }),
    phone: z.string({ required_error: 'Phone number is required' }),
    email: z.string().email().optional().or(z.literal('')),
    type: z
      .enum(['Buyer', 'Seller', 'Tenant', 'Landlord', 'Investor', 'Partner', 'Other'])
      .optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    company: z.string().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
})

const updateContactZodSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    type: z
      .enum(['Buyer', 'Seller', 'Tenant', 'Landlord', 'Investor', 'Partner', 'Other'])
      .optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    company: z.string().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
})

export const ContactValidation = {
  createContactZodSchema,
  updateContactZodSchema,
}
