import express from 'express'
import validateRequest from '../../middlewares/validateRequest'
import { LocalizationController } from './localization.controller'
import { LocalizationValidation } from './localization.validation'

const router = express.Router()
router.get('/locations', validateRequest(LocalizationValidation.locations), LocalizationController.locations)
router.get('/area-convert', validateRequest(LocalizationValidation.convert), LocalizationController.convertArea)
export const LocalizationRoute = router
