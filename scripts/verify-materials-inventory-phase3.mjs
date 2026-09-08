import fs from 'node:fs'

const required = [
  'src/app/module/materialInventory/material.model.ts',
  'src/app/module/materialInventory/materialRequirement.model.ts',
  'src/app/module/materialInventory/stockMovement.model.ts',
  'src/app/module/materialInventory/materialInventory.service.ts',
  'src/app/module/materialInventory/materialInventory.route.ts',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 3 file: ${file}`)
}
const route = fs.readFileSync('src/app/module/materialInventory/materialInventory.route.ts', 'utf8')
if (!route.includes("requireEntitlement('MATERIALS_INVENTORY')")) throw new Error('Materials entitlement enforcement is missing')
if (!route.includes("requirePermission('materials.read')") || !route.includes("requirePermission('materials.write')")) throw new Error('Materials permissions are missing')
const movement = fs.readFileSync('src/app/module/materialInventory/stockMovement.model.ts', 'utf8')
for (const type of ['PURCHASE', 'USAGE', 'ADJUSTMENT', 'RETURN']) if (!movement.includes('STOCK_MOVEMENT_TYPES')) throw new Error(`Stock movement contract is incomplete: ${type}`)
const service = fs.readFileSync('src/app/module/materialInventory/materialInventory.service.ts', 'utf8')
if (!service.includes('stockFilter.stockQuantity = { $gte: Math.abs(delta) }')) throw new Error('Negative-stock concurrency guard is missing')
if (!service.includes('totalCostMinor = Math.round(absolute * unitPriceMinor)')) throw new Error('Purchase cost derivation is missing')
console.log('Phase 3 materials inventory source verification passed')
