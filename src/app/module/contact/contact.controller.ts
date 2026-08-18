import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { requireTenant } from '../../middlewares/auth'
import { ActivityService } from '../activity/activity.service'
import { crmAccessFromRequest, crmRecordReadAccessFromRequest } from '../crm/crmAccess'
import { ContactService } from './contact.service'

const actor = (req: Request) => req.user?._id || req.user?.id

const createContact = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await ContactService.createContact(organizationId, req.body, actor(req), crmAccessFromRequest(req))
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Contact created successfully', data: result })
})

const getAllContacts = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ['searchTerm', 'type', 'city', 'tag', 'assignedTo', 'source', 'scope', 'origin', 'statusAtConversion', 'convertedFrom', 'convertedTo', 'followUpPreset', 'followUpFrom', 'followUpTo'])
  filters.organizationId = requireTenant(req)
  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])
  const result = await ContactService.getAllContacts(filters, paginationOptions, crmAccessFromRequest(req, req.query.scope))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Contacts fetched successfully', meta: result.meta, data: result.data })
})

const getContactById = catchAsync(async (req: Request, res: Response) => {
  const result = await ContactService.getContactById(requireTenant(req), req.params.id, crmRecordReadAccessFromRequest(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Contact fetched successfully', data: result })
})


const addNote = catchAsync(async (req: Request, res: Response) => {
  const result = await ActivityService.createContactNote(
    requireTenant(req),
    req.params.id,
    req.body.content,
    actor(req),
    crmAccessFromRequest(req),
  )
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Contact note added successfully', data: result })
})

const getHistory = catchAsync(async (req: Request, res: Response) => {
  const result = await ActivityService.getContactHistory(
    requireTenant(req),
    req.params.id,
    pick(req.query, ['page', 'limit']),
    crmRecordReadAccessFromRequest(req),
  )
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Contact history fetched successfully', meta: result.meta, data: result.data })
})

const updateContact = catchAsync(async (req: Request, res: Response) => {
  const result = await ContactService.updateContact(requireTenant(req), req.params.id, req.body, actor(req), crmAccessFromRequest(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Contact updated successfully', data: result })
})


const contactExportFilters = (req: Request) => pick(req.query, [
  'searchTerm', 'type', 'city', 'tag', 'assignedTo', 'source', 'scope', 'origin',
  'statusAtConversion', 'convertedFrom', 'convertedTo', 'followUpPreset', 'followUpFrom', 'followUpTo',
])

const exportCsv = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const csv = await ContactService.exportCsv(
    organizationId,
    contactExportFilters(req),
    crmAccessFromRequest(req, req.query.scope),
  )
  res.status(httpStatus.OK).setHeader('content-type', 'text/csv; charset=utf-8')
  res.setHeader('content-disposition', `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.send(`\uFEFF${csv}`)
})

const exportXlsx = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const workbook = await ContactService.exportXlsx(
    organizationId,
    contactExportFilters(req),
    crmAccessFromRequest(req, req.query.scope),
  )
  res.status(httpStatus.OK).setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('content-disposition', `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.xlsx"`)
  res.send(workbook)
})

const deleteContact = catchAsync(async (req: Request, res: Response) => {
  const result = await ContactService.deleteContact(requireTenant(req), req.params.id, crmAccessFromRequest(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Contact deleted successfully', data: result })
})

export const ContactController = { createContact, getAllContacts, getContactById, addNote, getHistory, updateContact, deleteContact, exportCsv, exportXlsx }
