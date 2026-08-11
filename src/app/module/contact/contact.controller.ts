import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { ContactService } from './contact.service'

const createContact = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId || req.body.organizationId) as string
  const result = await ContactService.createContact(organizationId, req.body)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Contact created successfully',
    data: result,
  })
})

const getAllContacts = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ['searchTerm', 'organizationId', 'type', 'city', 'tag'])

  if (req.user && req.user.userRole !== 'super-admin' && (req.user.organizationId || req.user.storeId)) {
    filters.organizationId = req.user.organizationId || req.user.storeId
  } else if (req.query.organizationId) {
    filters.organizationId = req.query.organizationId as string
  }

  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])
  const result = await ContactService.getAllContacts(filters, paginationOptions)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Contacts fetched successfully',
    meta: result.meta,
    data: result.data,
  })
})

const getContactById = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { id } = req.params
  const result = await ContactService.getContactById(organizationId, id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Contact fetched successfully',
    data: result,
  })
})

const updateContact = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { id } = req.params
  const result = await ContactService.updateContact(organizationId, id, req.body)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Contact updated successfully',
    data: result,
  })
})

const deleteContact = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { id } = req.params
  const result = await ContactService.deleteContact(organizationId, id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Contact deleted successfully',
    data: result,
  })
})

export const ContactController = {
  createContact,
  getAllContacts,
  getContactById,
  updateContact,
  deleteContact,
}
