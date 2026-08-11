import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { IContact, IContactFilter } from './contact.interface'
import { Contact } from './contact.model'

const createContact = async (
  organizationId: string,
  payload: Partial<IContact>
): Promise<IContact> => {
  const contactData = {
    ...payload,
    organizationId,
  }
  const result = await Contact.create(contactData)
  return result
}

const getAllContacts = async (
  filters: IContactFilter,
  paginationOptions: IPaginationOptions
): Promise<IGenericResponse<IContact[]>> => {
  const { searchTerm, organizationId, type, city, tag } = filters
  const andConditions: Array<Record<string, unknown>> = []

  if (organizationId) {
    andConditions.push({ organizationId })
  }

  if (searchTerm) {
    andConditions.push({
      $or: ['name', 'email', 'phone', 'company', 'city'].map((field) => ({
        [field]: { $regex: searchTerm, $options: 'i' },
      })),
    })
  }

  if (type) andConditions.push({ type })
  if (city) andConditions.push({ city: { $regex: city, $options: 'i' } })
  if (tag) andConditions.push({ tags: tag })

  const whereCondition = andConditions.length > 0 ? { $and: andConditions } : {}
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)

  const result = await Contact.find(whereCondition)
    .sort({ [sortBy]: sortOrder })
    .skip(skip)
    .limit(limit)

  const total = await Contact.countDocuments(whereCondition)

  return {
    meta: { page, limit, total },
    data: result,
  }
}

const getContactById = async (organizationId: string, id: string): Promise<IContact | null> => {
  const result = await Contact.findOne({ _id: id, organizationId })
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Contact not found')
  }
  return result
}

const updateContact = async (
  organizationId: string,
  id: string,
  payload: Partial<IContact>
): Promise<IContact | null> => {
  const result = await Contact.findOneAndUpdate({ _id: id, organizationId }, payload, {
    new: true,
  })
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Contact not found')
  }
  return result
}

const deleteContact = async (organizationId: string, id: string): Promise<IContact | null> => {
  const result = await Contact.findOneAndDelete({ _id: id, organizationId })
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Contact not found')
  }
  return result
}

export const ContactService = {
  createContact,
  getAllContacts,
  getContactById,
  updateContact,
  deleteContact,
}
