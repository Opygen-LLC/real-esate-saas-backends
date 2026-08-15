import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { ContactController } from './contact.controller'
import { ContactValidation } from './contact.validation'

const router = express.Router()

router.get(
  '/',
  authMiddlewares.requirePermission('contacts.read'),
  ContactController.getAllContacts
)

router.post(
  '/',
  authMiddlewares.requirePermission('contacts.write'),
  validateRequest(ContactValidation.createContactZodSchema),
  ContactController.createContact
)

router.get(
  '/:id',
  authMiddlewares.requirePermission('contacts.read'),
  ContactController.getContactById
)

router.patch(
  '/:id',
  authMiddlewares.requirePermission('contacts.write'),
  validateRequest(ContactValidation.updateContactZodSchema),
  ContactController.updateContact
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('contacts.write'),
  ContactController.deleteContact
)

export const ContactRoute = router
