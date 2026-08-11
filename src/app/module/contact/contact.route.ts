import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { ContactController } from './contact.controller'
import { ContactValidation } from './contact.validation'

const router = express.Router()

router.get(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'viewer', 'super-admin', 'admin', 'client'),
  ContactController.getAllContacts
)

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  validateRequest(ContactValidation.createContactZodSchema),
  ContactController.createContact
)

router.get(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'viewer', 'super-admin', 'admin', 'client'),
  ContactController.getContactById
)

router.patch(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  validateRequest(ContactValidation.updateContactZodSchema),
  ContactController.updateContact
)

router.delete(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  ContactController.deleteContact
)

export const ContactRoute = router
