import httpStatus from 'http-status'
import mongoose, { type ClientSession, type Model } from 'mongoose'
import ApiError from '../../errors/ApiError'
import { Contact } from '../module/contact/contact.model'
import { FinanceCommission, FinanceInvoice, FinanceVendor } from '../module/finance/finance.model'
import { Lead } from '../module/lead/lead.model'
import { Property } from '../module/property/property.model'
import { User } from '../module/user/user.model'
import { Viewing } from '../module/viewing/viewing.model'
import { WebsitePage } from '../module/websiteBuilder/websitePage.model'

const normalizeId = (value: unknown, label: string): string => {
  const id = String(value || '').trim()
  if (!id || !mongoose.isValidObjectId(id)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${label}`)
  }
  return id
}

const assertTenantDocument = async (
  model: Model<any>,
  organizationId: string,
  value: unknown,
  label: string,
  session?: ClientSession,
  extraFilter: Record<string, unknown> = {},
): Promise<string> => {
  const id = normalizeId(value, label)
  let query = model.exists({ _id: id, organizationId, ...extraFilter })
  if (session) query = query.session(session)
  if (!await query) throw new ApiError(httpStatus.BAD_REQUEST, `${label} does not belong to this agency`)
  return id
}

const assertTenantDocuments = async (
  model: Model<any>,
  organizationId: string,
  values: unknown[] | undefined,
  label: string,
  session?: ClientSession,
  extraFilter: Record<string, unknown> = {},
): Promise<string[]> => {
  const ids = [...new Set((values || []).filter(Boolean).map((value) => normalizeId(value, label)))]
  if (!ids.length) return []
  let query = model.find({ _id: { $in: ids }, organizationId, ...extraFilter }).select('_id').lean()
  if (session) query = query.session(session)
  const rows = await query
  const found = new Set(rows.map((row: any) => String(row._id)))
  const missing = ids.filter((id) => !found.has(id))
  if (missing.length) throw new ApiError(httpStatus.BAD_REQUEST, `${label} does not belong to this agency`)
  return ids
}

export const TenantReferenceService = {
  assertPropertyBelongsToOrganization: (organizationId: string, id: unknown, session?: ClientSession) =>
    assertTenantDocument(Property, organizationId, id, 'Property', session),

  assertPropertiesBelongToOrganization: (organizationId: string, ids: unknown[] | undefined, session?: ClientSession) =>
    assertTenantDocuments(Property, organizationId, ids, 'Property', session),

  assertLeadBelongsToOrganization: (organizationId: string, id: unknown, session?: ClientSession) =>
    assertTenantDocument(Lead, organizationId, id, 'Lead', session),

  assertContactBelongsToOrganization: (organizationId: string, id: unknown, session?: ClientSession) =>
    assertTenantDocument(Contact, organizationId, id, 'Contact', session),

  assertUserBelongsToOrganization: (organizationId: string, id: unknown, session?: ClientSession) =>
    assertTenantDocument(User, organizationId, id, 'User', session),

  assertActiveUserBelongsToOrganization: (organizationId: string, id: unknown, session?: ClientSession) =>
    assertTenantDocument(User, organizationId, id, 'User', session, { status: 'active' }),

  assertAgentBelongsToOrganization: (organizationId: string, id: unknown, session?: ClientSession) =>
    assertTenantDocument(User, organizationId, id, 'Agent', session),

  assertViewingBelongsToOrganization: (organizationId: string, id: unknown, session?: ClientSession) =>
    assertTenantDocument(Viewing, organizationId, id, 'Viewing', session),

  assertFinanceInvoiceBelongsToOrganization: (organizationId: string, id: unknown, session?: ClientSession) =>
    assertTenantDocument(FinanceInvoice, organizationId, id, 'Invoice', session),

  assertFinanceCommissionBelongsToOrganization: (organizationId: string, id: unknown, session?: ClientSession) =>
    assertTenantDocument(FinanceCommission, organizationId, id, 'Commission', session),

  assertFinanceVendorBelongsToOrganization: (organizationId: string, id: unknown, session?: ClientSession) =>
    assertTenantDocument(FinanceVendor, organizationId, id, 'Vendor', session),

  assertWebsitePageBelongsToOrganization: (organizationId: string, id: unknown, session?: ClientSession) =>
    assertTenantDocument(WebsitePage, organizationId, id, 'Website page', session),
}
