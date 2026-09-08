import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { MaterialInventoryController } from './materialInventory.controller'
import { MaterialInventoryValidation } from './materialInventory.validation'

const router = express.Router()

router.use(authMiddlewares.auth(), authMiddlewares.requireEntitlement('MATERIALS_INVENTORY'))

router.get('/', authMiddlewares.requirePermission('materials.read'), validateRequest(MaterialInventoryValidation.list), MaterialInventoryController.listMaterials)
router.post('/', authMiddlewares.requirePermission('materials.manage'), validateRequest(MaterialInventoryValidation.createMaterial), MaterialInventoryController.createMaterial)
router.patch('/requirements/:requirementId', authMiddlewares.requirePermission('materials.manage'), validateRequest(MaterialInventoryValidation.updateRequirement), MaterialInventoryController.updateRequirement)
router.get('/:materialId/movements', authMiddlewares.requirePermission('materials.read'), validateRequest(MaterialInventoryValidation.movements), MaterialInventoryController.listMovements)
router.post('/:materialId/movements', authMiddlewares.requirePermission('inventory.adjust'), validateRequest(MaterialInventoryValidation.movement), MaterialInventoryController.createMovement)
router.post('/:materialId/requirements', authMiddlewares.requirePermission('materials.manage'), validateRequest(MaterialInventoryValidation.createRequirement), MaterialInventoryController.createRequirement)
router.get('/:materialId', authMiddlewares.requirePermission('materials.read'), validateRequest(MaterialInventoryValidation.materialId), MaterialInventoryController.getMaterial)
router.patch('/:materialId', authMiddlewares.requirePermission('materials.manage'), validateRequest(MaterialInventoryValidation.updateMaterial), MaterialInventoryController.updateMaterial)

export const MaterialInventoryRoute = router
