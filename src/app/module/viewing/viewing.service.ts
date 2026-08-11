import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { Activity } from '../activity/activity.model'
import { Contact } from '../contact/contact.model'
import { Lead } from '../lead/lead.model'
import { Property } from '../property/property.model'
import { IViewing, IViewingFilter } from './viewing.interface'
import { Viewing } from './viewing.model'

// Helper to convert HH:mm to minutes for overlap checking
const timeToMinutes = (timeStr: string): number => {
  const [hours, minutes] = timeStr.split(':').map(Number)
  return hours * 60 + minutes
}

const checkConflict = async (
  organizationId: string,
  agentId: string,
  propertyId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeViewingId?: string
): Promise<{ hasConflict: boolean; reason?: string }> => {
  const startMin = timeToMinutes(startTime)
  const endMin = timeToMinutes(endTime)

  // Find active viewings on that date
  const query: Record<string, any> = {
    organizationId,
    date,
    status: { $in: ['Scheduled', 'Confirmed'] },
  }

  if (excludeViewingId) {
    query._id = { $ne: excludeViewingId }
  }

  const existingViewings = await Viewing.find(query).populate('agentId', 'name').populate('propertyId', 'title')

  for (const v of existingViewings) {
    const vStart = timeToMinutes(v.startTime)
    const vEnd = timeToMinutes(v.endTime)

    // Check time overlap: (start1 < end2) && (end1 > start2)
    const isOverlap = startMin < vEnd && endMin > vStart

    if (isOverlap) {
      const vAgentId = String((v.agentId as any)?._id || v.agentId)
      const vPropId = String((v.propertyId as any)?._id || v.propertyId)

      if (vAgentId === String(agentId)) {
        return {
          hasConflict: true,
          reason: `Agent is already booked for another viewing (${v.startTime} - ${v.endTime})`,
        }
      }
      if (vPropId === String(propertyId)) {
        return {
          hasConflict: true,
          reason: `Property already has a scheduled showing at (${v.startTime} - ${v.endTime})`,
        }
      }
    }
  }

  return { hasConflict: false }
}

const createViewing = async (
  organizationId: string,
  payload: Partial<IViewing>
): Promise<IViewing> => {
  // Check for conflicts
  const conflictCheck = await checkConflict(
    organizationId,
    String(payload.agentId),
    String(payload.propertyId),
    payload.date!,
    payload.startTime!,
    payload.endTime!
  )

  if (conflictCheck.hasConflict) {
    throw new ApiError(httpStatus.CONFLICT, conflictCheck.reason || 'Viewing time slot conflict detected')
  }

  const result = await Viewing.create({
    ...payload,
    organizationId,
  })

  // If lead is linked, update lead pipeline stage to ViewingScheduled and log activity
  if (payload.leadId) {
    await Lead.findOneAndUpdate(
      { _id: payload.leadId, organizationId },
      {
        leadStatus: 'ViewingScheduled',
        lastContact: new Date(),
      }
    )

    await Activity.create({
      organizationId,
      leadId: payload.leadId,
      propertyId: payload.propertyId,
      type: 'viewing',
      title: 'Viewing Scheduled',
      content: `Property viewing scheduled for ${payload.date} at ${payload.startTime} with ${payload.clientName}`,
      agentId: payload.agentId,
    })
  }

  return result
}

const publicRequestViewing = async (payload: {
  organizationId: string
  propertyId: string
  date: string
  startTime: string
  endTime: string
  clientName: string
  clientPhone: string
  clientEmail?: string
  notes?: string
}): Promise<IViewing> => {
  const { organizationId, propertyId, date, startTime, endTime, clientName, clientPhone, clientEmail, notes } =
    payload

  const prop = await Property.findById(propertyId)
  if (!prop) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  }

  const agentId = prop.agentId ? String(prop.agentId) : undefined
  if (!agentId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Property does not have an assigned agent')
  }

  // Conflict check
  const conflict = await checkConflict(organizationId, agentId, propertyId, date, startTime, endTime)
  if (conflict.hasConflict) {
    throw new ApiError(httpStatus.CONFLICT, conflict.reason || 'Time slot has a scheduling conflict')
  }

  // Find or create Contact & Lead
  let contact = await Contact.findOne({ organizationId, phone: clientPhone })
  if (!contact) {
    contact = await Contact.create({
      organizationId,
      name: clientName,
      email: clientEmail || '',
      phone: clientPhone,
      type: 'Buyer',
      tags: ['ViewingRequest'],
    })
  }

  let lead = await Lead.findOne({ organizationId, phone: clientPhone })
  if (!lead) {
    lead = await Lead.create({
      organizationId,
      name: clientName,
      phone: clientPhone,
      email: clientEmail,
      source: 'Website',
      leadStatus: 'ViewingScheduled',
      contactId: contact._id,
      assignedAgent: agentId,
      propertyInterest: [propertyId as any],
      lastContact: new Date(),
    })
  } else {
    lead.leadStatus = 'ViewingScheduled'
    lead.lastContact = new Date()
    if (!lead.propertyInterest.includes(propertyId as any)) {
      lead.propertyInterest.push(propertyId as any)
    }
    await lead.save()
  }

  const viewing = await Viewing.create({
    organizationId,
    propertyId,
    agentId,
    leadId: lead._id,
    date,
    startTime,
    endTime,
    clientName,
    clientPhone,
    clientEmail,
    status: 'Scheduled',
    notes,
  })

  // Auto-log activity
  await Activity.create({
    organizationId,
    leadId: lead._id,
    propertyId,
    agentId,
    type: 'viewing',
    title: 'Public Viewing Requested',
    content: `Client ${clientName} requested showing for ${prop.title} on ${date} at ${startTime} - ${endTime}`,
  })

  return viewing
}

const getAllViewings = async (
  filters: IViewingFilter,
  paginationOptions: IPaginationOptions
): Promise<IGenericResponse<IViewing[]>> => {
  const { searchTerm, organizationId, propertyId, agentId, leadId, status, date, startDate, endDate } =
    filters

  const andConditions: Array<Record<string, unknown>> = []

  if (organizationId) andConditions.push({ organizationId })
  if (propertyId) andConditions.push({ propertyId })
  if (agentId) andConditions.push({ agentId })
  if (leadId) andConditions.push({ leadId })
  if (status) andConditions.push({ status })
  if (date) andConditions.push({ date })

  if (startDate && endDate) {
    andConditions.push({
      date: { $gte: startDate, $lte: endDate },
    })
  } else if (startDate) {
    andConditions.push({ date: { $gte: startDate } })
  } else if (endDate) {
    andConditions.push({ date: { $lte: endDate } })
  }

  if (searchTerm) {
    andConditions.push({
      $or: ['clientName', 'clientPhone', 'clientEmail', 'notes'].map((field) => ({
        [field]: { $regex: searchTerm, $options: 'i' },
      })),
    })
  }

  const whereCondition = andConditions.length > 0 ? { $and: andConditions } : {}
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)

  const result = await Viewing.find(whereCondition)
    .populate('propertyId', 'title price images address city')
    .populate('agentId', 'name email phoneNumber profileImgURL')
    .populate('leadId', 'name phone email leadStatus')
    .sort({ date: 1, startTime: 1, [sortBy]: sortOrder })
    .skip(skip)
    .limit(limit)

  const total = await Viewing.countDocuments(whereCondition)

  return {
    meta: { page, limit, total },
    data: result,
  }
}

const getViewingById = async (organizationId: string, id: string): Promise<IViewing | null> => {
  const result = await Viewing.findOne({ _id: id, organizationId })
    .populate('propertyId', 'title price images address city propertyType bedrooms bathrooms')
    .populate('agentId', 'name email phoneNumber profileImgURL')
    .populate('leadId', 'name phone email leadStatus')

  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Viewing not found')
  }
  return result
}

const updateViewing = async (
  organizationId: string,
  id: string,
  payload: Partial<IViewing>
): Promise<IViewing | null> => {
  const isExist = await Viewing.findOne({ _id: id, organizationId })
  if (!isExist) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Viewing not found')
  }

  // If time or agent or property changed, check conflict
  if (
    (payload.date && payload.date !== isExist.date) ||
    (payload.startTime && payload.startTime !== isExist.startTime) ||
    (payload.agentId && String(payload.agentId) !== String(isExist.agentId)) ||
    (payload.propertyId && String(payload.propertyId) !== String(isExist.propertyId))
  ) {
    const checkDate = payload.date || isExist.date
    const checkStart = payload.startTime || isExist.startTime
    const checkEnd = payload.endTime || isExist.endTime
    const checkAgent = String(payload.agentId || isExist.agentId)
    const checkProp = String(payload.propertyId || isExist.propertyId)

    const conflict = await checkConflict(
      organizationId,
      checkAgent,
      checkProp,
      checkDate,
      checkStart,
      checkEnd,
      id
    )

    if (conflict.hasConflict) {
      throw new ApiError(httpStatus.CONFLICT, conflict.reason || 'Viewing time slot conflict detected')
    }
  }

  const result = await Viewing.findOneAndUpdate({ _id: id, organizationId }, payload, {
    new: true,
  })
    .populate('propertyId', 'title price images address city')
    .populate('agentId', 'name email phoneNumber profileImgURL')
    .populate('leadId', 'name phone email leadStatus')

  // If status is Completed, auto update lead status to ViewingCompleted
  if (payload.status === 'Completed' && isExist.leadId) {
    await Lead.findOneAndUpdate(
      { _id: isExist.leadId, organizationId },
      { leadStatus: 'ViewingCompleted', lastContact: new Date() }
    )
  }

  return result
}

const deleteViewing = async (organizationId: string, id: string): Promise<IViewing | null> => {
  const result = await Viewing.findOneAndDelete({ _id: id, organizationId })
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Viewing not found')
  }
  return result
}

export const ViewingService = {
  checkConflict,
  createViewing,
  publicRequestViewing,
  getAllViewings,
  getViewingById,
  updateViewing,
  deleteViewing,
}
