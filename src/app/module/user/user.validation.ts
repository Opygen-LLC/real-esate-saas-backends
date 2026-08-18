import { z } from 'zod'
import { normalizeBangladeshPhone } from '../../helpers/identity'
import { permissionValues } from './accessControl'

const permissionEnum = z.enum([...permissionValues] as [typeof permissionValues[number], ...typeof permissionValues[number][]])
const bdPhone = z.string().refine(value => { try { normalizeBangladeshPhone(value); return true } catch { return false } }, 'Enter a valid Bangladesh mobile number')
export const UserValidation = {
  create: z.object({ body: z.object({ name: z.string().trim().min(2).max(100), email: z.string().email(), phoneNumber: bdPhone,
    userRole: z.enum(['agency_admin', 'agent', 'staff', 'viewer']).default('agent'), specialization: z.array(z.string().max(80)).max(20).optional(),
    accessControl: z.object({ useRoleDefaults: z.boolean().default(true), permissions: z.array(permissionEnum).max(permissionValues.length).default([]) }).optional() }) }),
  update: z.object({ body: z.object({ name: z.string().trim().min(2).max(100).optional(), profileImgURL: z.union([z.literal(''), z.string().url()]).optional(),
    bio: z.string().max(1000).optional(), licenseNumber: z.string().max(100).optional(), specialization: z.array(z.string().max(80)).max(20).optional(),
    serviceAreas: z.array(z.string().max(100)).max(100).optional(), address: z.string().max(300).optional(), gender: z.string().max(30).optional() }).strict() }),
  selfProfile: z.object({ body: z.object({ name: z.string().trim().min(2).max(100).optional(), profileImgURL: z.union([z.literal(''), z.string().url()]).optional(),
    bio: z.string().max(1000).optional(), licenseNumber: z.string().max(100).optional(), specialization: z.array(z.string().max(80)).max(20).optional(),
    serviceAreas: z.array(z.string().max(100)).max(100).optional(), address: z.string().max(300).optional(), gender: z.string().max(30).optional() }).strict().refine(value => Object.keys(value).length > 0, 'At least one profile field is required') }),
  memberAccess: z.object({ body: z.object({ userRole: z.enum(['agency_admin', 'agent', 'staff', 'viewer']).optional(), useRoleDefaults: z.boolean(), permissions: z.array(permissionEnum).max(permissionValues.length).default([]) }) }),
  platformRole: z.object({ body: z.object({ userRole: z.enum(['super-admin', 'agency_owner', 'agency_admin', 'agent', 'staff', 'viewer', 'user']).optional(),
    status: z.enum(['pending', 'active', 'blocked']).optional(), reason: z.string().trim().min(10).max(500) }).refine(value => value.userRole || value.status, 'Role or status is required') }),
}
