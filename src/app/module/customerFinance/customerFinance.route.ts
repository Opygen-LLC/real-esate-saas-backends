import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { CustomerFinanceController } from './customerFinance.controller'
import { CustomerFinanceValidation } from './customerFinance.validation'

const router = express.Router()
const customerFinance = authMiddlewares.requireEntitlement('CUSTOMER_FINANCE')

router.get(
  '/',
  customerFinance,
  authMiddlewares.requirePermission('contacts.read'),
  validateRequest(CustomerFinanceValidation.listCustomers),
  CustomerFinanceController.listCustomers,
)

router.get(
  '/:contactId/profile',
  customerFinance,
  authMiddlewares.requirePermission('contacts.read'),
  validateRequest(CustomerFinanceValidation.contactId),
  CustomerFinanceController.getProfile,
)

router.get(
  '/:contactId/bookings',
  customerFinance,
  authMiddlewares.requirePermission('contacts.read'),
  validateRequest(CustomerFinanceValidation.listBookings),
  CustomerFinanceController.listBookings,
)

router.post(
  '/:contactId/bookings',
  customerFinance,
  authMiddlewares.requirePermission('contacts.write'),
  authMiddlewares.requirePermission('properties.write'),
  authMiddlewares.requirePermission('finance.write'),
  validateRequest(CustomerFinanceValidation.createBooking),
  CustomerFinanceController.createBooking,
)

router.get(
  '/bookings/:bookingId',
  customerFinance,
  authMiddlewares.requirePermission('contacts.read'),
  validateRequest(CustomerFinanceValidation.bookingId),
  CustomerFinanceController.getBooking,
)

router.post(
  '/bookings/:bookingId/payments',
  customerFinance,
  authMiddlewares.requirePermission('contacts.read'),
  authMiddlewares.requirePermission('finance.write'),
  validateRequest(CustomerFinanceValidation.recordPayment),
  CustomerFinanceController.recordPayment,
)

export const CustomerFinanceRoute = router
