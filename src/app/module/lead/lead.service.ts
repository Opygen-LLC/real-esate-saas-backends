import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { Activity } from '../activity/activity.model'
import { Contact } from '../contact/contact.model'
import { Property } from '../property/property.model'
import { ILead, ILeadFilter } from './lead.interface'
import { Lead } from './lead.model'
import { EntitlementService } from '../entitlement/entitlement.service'
import { normalizeBangladeshPhone } from '../../helpers/identity'

const createLead = async (
  organizationId: string,
  payload: Partial<ILead>,
  creatorAgentId?: string
): Promise<ILead> => {
  if (payload.phone) payload.phone = normalizeBangladeshPhone(payload.phone)
  // If contactId is missing, check if a contact exists with phone or create one
  if (!payload.contactId && payload.phone) {
    let contact = await Contact.findOne({ organizationId, phone: payload.phone })
    if (!contact && payload.name) {
      contact = await Contact.create({
        organizationId,
        name: payload.name,
        email: payload.email || '',
        phone: payload.phone,
        type: 'Buyer',
      })
    }
    if (contact) {
      payload.contactId = contact._id
    }
  }

  const result = await Lead.create({
    ...payload,
    organizationId,
    lastContact: new Date(),
  })

  // Auto-log creation activity
  await Activity.create({
    organizationId,
    leadId: result._id,
    type: 'status_change',
    title: 'Lead Captured',
    content: `New lead created from ${result.source} source`,
    agentId: creatorAgentId || result.assignedAgent,
  })

  return result
}

const publicCaptureLead = async (
  payload: {
    organizationId: string
    name: string
    phone: string
    email?: string
    propertyInterest?: string
    message?: string
    budgetMin?: number
    budgetMax?: number
    propertyType?: string
    locationPreference?: string
  }
): Promise<ILead> => {
  const { organizationId, name, phone, email, propertyInterest, message, ...rest } = payload

  if (!organizationId || !name || !phone) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Organization, client name, and phone are required')
  }
  await EntitlementService.assertLimit(organizationId, 'leads')
  const normalizedPhone = normalizeBangladeshPhone(phone)

  let assignedAgent: any = undefined
  let propertyTitle = ''

  if (propertyInterest) {
    const prop = await Property.findOne({ _id: propertyInterest, organizationId })
    if (prop) {
      assignedAgent = prop.agentId
      propertyTitle = prop.title
    }
  }

  // Create or link contact
  let contact = await Contact.findOne({ organizationId, phone: normalizedPhone })
  if (!contact) {
    contact = await Contact.create({
      organizationId,
      name,
      email: email || '',
      phone: normalizedPhone,
      type: 'Buyer',
      tags: ['WebsiteInquiry'],
    })
  }

  const lead = await Lead.create({
    ...rest,
    organizationId,
    name,
    phone: normalizedPhone,
    email,
    source: 'Website',
    leadStatus: 'New',
    contactId: contact._id,
    assignedAgent,
    propertyInterest: propertyInterest ? [propertyInterest as any] : [],
    notes: message || '',
    lastContact: new Date(),
  })

  // Auto-log activity
  await Activity.create({
    organizationId,
    leadId: lead._id,
    propertyId: propertyInterest,
    type: 'email',
    title: 'Website Portal Inquiry',
    content: message
      ? `Inquiry received for ${propertyTitle || 'properties'}:\n"${message}"`
      : `Client requested contact details for ${propertyTitle || 'properties'}.`,
    agentId: assignedAgent,
  })

  return lead
}

const getAllLeads = async (
  filters: ILeadFilter,
  paginationOptions: IPaginationOptions
): Promise<IGenericResponse<ILead[]>> => {
  const { searchTerm, organizationId, leadStatus, source, assignedAgent, propertyType, minBudget, maxBudget } =
    filters

  const andConditions: Array<Record<string, unknown>> = []

  if (organizationId) andConditions.push({ organizationId })

  if (searchTerm) {
    andConditions.push({
      $or: ['name', 'email', 'phone', 'locationPreference'].map((field) => ({
        [field]: { $regex: searchTerm, $options: 'i' },
      })),
    })
  }

  if (leadStatus) andConditions.push({ leadStatus })
  if (source) andConditions.push({ source })
  if (assignedAgent) andConditions.push({ assignedAgent })
  if (propertyType) andConditions.push({ propertyType })

  if (minBudget !== undefined && minBudget !== '') {
    andConditions.push({ budgetMax: { $gte: Number(minBudget) } })
  }
  if (maxBudget !== undefined && maxBudget !== '') {
    andConditions.push({ budgetMin: { $lte: Number(maxBudget) } })
  }

  const whereCondition = andConditions.length > 0 ? { $and: andConditions } : {}
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)

  const result = await Lead.find(whereCondition)
    .populate('assignedAgent', 'name email phoneNumber profileImgURL')
    .populate('propertyInterest', 'title price images city')
    .populate('contactId', 'name email phone company')
    .sort({ [sortBy]: sortOrder })
    .skip(skip)
    .limit(limit)

  const total = await Lead.countDocuments(whereCondition)

  return {
    meta: { page, limit, total },
    data: result,
  }
}

const getLeadById = async (organizationId: string, id: string): Promise<ILead | null> => {
  const result = await Lead.findOne({ _id: id, organizationId })
    .populate('assignedAgent', 'name email phoneNumber profileImgURL licenseNumber')
    .populate('propertyInterest', 'title price images city propertyType bedrooms bathrooms')
    .populate('contactId', 'name email phone address company notes tags')

  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Lead not found')
  }
  return result
}

const updateLead = async (
  organizationId: string,
  id: string,
  payload: Partial<ILead>
): Promise<ILead | null> => {
  const result = await Lead.findOneAndUpdate({ _id: id, organizationId }, payload, {
    new: true,
  })
    .populate('assignedAgent', 'name email phoneNumber profileImgURL')
    .populate('propertyInterest', 'title price images city')

  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Lead not found')
  }
  return result
}

const updateLeadStatus = async (
  organizationId: string,
  id: string,
  leadStatus: string,
  lostReason?: string,
  agentId?: string
): Promise<ILead | null> => {
  const isExist = await Lead.findOne({ _id: id, organizationId })
  if (!isExist) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Lead not found')
  }

  const prevStatus = isExist.leadStatus
  const updateData: Record<string, any> = { leadStatus, lastContact: new Date() }
  if (lostReason) updateData.lostReason = lostReason

  const result = await Lead.findOneAndUpdate({ _id: id, organizationId }, updateData, {
    new: true,
  })
    .populate('assignedAgent', 'name email phoneNumber profileImgURL')
    .populate('propertyInterest', 'title price images city')

  // Auto-log status transition activity
  await Activity.create({
    organizationId,
    leadId: id,
    type: 'status_change',
    title: `Pipeline Stage Updated`,
    content: `Stage transitioned from ${prevStatus} to ${leadStatus}${
      lostReason ? ` (Reason: ${lostReason})` : ''
    }`,
    agentId: agentId || isExist.assignedAgent,
  })

  return result
}

const assignAgent = async (
  organizationId: string,
  id: string,
  assignedAgent: string,
  agentName?: string
): Promise<ILead | null> => {
  const result = await Lead.findOneAndUpdate(
    { _id: id, organizationId },
    { assignedAgent, lastContact: new Date() },
    { new: true }
  ).populate('assignedAgent', 'name email phoneNumber profileImgURL')

  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Lead not found')
  }

  await Activity.create({
    organizationId,
    leadId: id,
    type: 'note',
    title: 'Broker Reassigned',
    content: `Lead assigned to ${agentName || 'new broker'}`,
    agentId: assignedAgent,
  })

  return result
}

const deleteLead = async (organizationId: string, id: string): Promise<ILead | null> => {
  const result = await Lead.findOneAndDelete({ _id: id, organizationId })
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Lead not found')
  }
  await Activity.deleteMany({ organizationId, leadId: id })
  return result
}

export const LeadService = {
  createLead,
  publicCaptureLead,
  getAllLeads,
  getLeadById,
  updateLead,
  updateLeadStatus,
  assignAgent,
  deleteLead,
}
