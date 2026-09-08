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
  authMiddlewares.requirePermission('customerFinance.read'),
  validateRequest(CustomerFinanceValidation.listCustomers),
  CustomerFinanceController.listCustomers,
)

router.get(
  '/:contactId/profile',
  customerFinance,
  authMiddlewares.requirePermission('customerFinance.read'),
  validateRequest(CustomerFinanceValidation.contactId),
  CustomerFinanceController.getProfile,
)

router.get(
  '/:contactId/bookings',
  customerFinance,
  authMiddlewares.requirePermission('customerFinance.read'),
  validateRequest(CustomerFinanceValidation.listBookings),
  CustomerFinanceController.listBookings,
)

router.post(
  '/:contactId/bookings',
  customerFinance,
  authMiddlewares.requirePermission('customerFinance.manage'),
  authMiddlewares.requirePermission('properties.write'),
  validateRequest(CustomerFinanceValidation.createBooking),
  CustomerFinanceController.createBooking,
)

router.get(
  '/bookings/:bookingId',
  customerFinance,
  authMiddlewares.requirePermission('customerFinance.read'),
  validateRequest(CustomerFinanceValidation.bookingId),
  CustomerFinanceController.getBooking,
)

router.post(
  '/bookings/:bookingId/payments',
  customerFinance,
  authMiddlewares.requirePermission('customerPayments.manage'),
  validateRequest(CustomerFinanceValidation.recordPayment),
  CustomerFinanceController.recordPayment,
)


router.post(
  '/bookings/:bookingId/payments/:paymentId/void',
  customerFinance,
  authMiddlewares.requirePermission('customerPayments.manage'),
  validateRequest(CustomerFinanceValidation.voidPayment),
  CustomerFinanceController.voidPayment,
)

export const CustomerFinanceRoute = router
