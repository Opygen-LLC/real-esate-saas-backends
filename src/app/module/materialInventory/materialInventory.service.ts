import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import paginationHelper from '../../helpers/paginationHelper'
import type { IPaginationOptions } from '../../../interfaces/common'
import { requiredTransaction } from '../../db/requiredTransaction'
import { moneyToMinorUnits } from '../finance/finance.money'
import { Property } from '../property/property.model'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { Material } from './material.model'
import { MaterialRequirement } from './materialRequirement.model'
import { StockMovement } from './stockMovement.model'
import type { StockMovementType } from './materialInventory.interface'

const actorObjectId = (actorId: string) => {
  if (!mongoose.isValidObjectId(actorId)) throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid authenticated user')
  return new mongoose.Types.ObjectId(actorId)
}

const materialObjectId = (value: string) => {
  if (!mongoose.isValidObjectId(value)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid material id')
  return new mongoose.Types.ObjectId(value)
}

const normalizeNameKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
const roundQuantity = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const ensureProperty = async (organizationId: string, propertyId?: string, session?: ClientSession) => {
  if (!propertyId) return undefined
  if (!mongoose.isValidObjectId(propertyId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid property id')
  const property = await Property.findOne({ _id: propertyId, organizationId }).select('_id title buildingName floorNumber').session(session || null).lean()
  if (!property) throw new ApiError(httpStatus.BAD_REQUEST, 'Property does not belong to this organization')
  return property
}

const movementDelta = (type: StockMovementType, input: number): number => {
  const absolute = Math.abs(input)
  if (type === 'PURCHASE' || type === 'RETURN') return absolute
  if (type === 'USAGE') return -absolute
  return input
}

const movementRollups = async (organizationId: string, materialIds: mongoose.Types.ObjectId[]) => {
  if (!materialIds.length) return new Map<string, any>()
  const rows = await StockMovement.aggregate([
    { $match: { organizationId, materialId: { $in: materialIds } } },
    { $group: {
      _id: '$materialId',
      purchasedQuantity: { $sum: { $cond: [{ $eq: ['$type', 'PURCHASE'] }, '$quantityAbsolute', 0] } },
      usedQuantity: { $sum: { $cond: [{ $eq: ['$type', 'USAGE'] }, '$quantityAbsolute', 0] } },
      returnedQuantity: { $sum: { $cond: [{ $eq: ['$type', 'RETURN'] }, '$quantityAbsolute', 0] } },
      adjustmentNet: { $sum: { $cond: [{ $eq: ['$type', 'ADJUSTMENT'] }, '$quantityDelta', 0] } },
      totalPurchaseCostMinor: { $sum: { $cond: [{ $eq: ['$type', 'PURCHASE'] }, { $ifNull: ['$totalCostMinor', 0] }, 0] } },
    } },
  ])
  return new Map(rows.map((row) => [String(row._id), row]))
}

const requirementRollups = async (organizationId: string, materialIds: mongoose.Types.ObjectId[]) => {
  if (!materialIds.length) return new Map<string, number>()
  const rows = await MaterialRequirement.aggregate([
    { $match: { organizationId, materialId: { $in: materialIds }, status: { $nin: ['Completed', 'Cancelled'] } } },
    { $group: { _id: '$materialId', plannedRequirement: { $sum: '$requiredQuantity' } } },
  ])
  return new Map(rows.map((row) => [String(row._id), Number(row.plannedRequirement || 0)]))
}

const withSummary = (material: any, movement: any, plannedRequirement: number) => {
  const currentStock = roundQuantity(Number(material.stockQuantity || 0))
  const planned = roundQuantity(plannedRequirement || 0)
  const shortage = roundQuantity(Math.max(0, planned - currentStock))
  const minimumStock = material.minimumStock == null ? null : Number(material.minimumStock)
  return {
    ...material,
    currentStock,
    purchasedQuantity: roundQuantity(Number(movement?.purchasedQuantity || 0)),
    usedQuantity: roundQuantity(Number(movement?.usedQuantity || 0)),
    returnedQuantity: roundQuantity(Number(movement?.returnedQuantity || 0)),
    adjustmentNet: roundQuantity(Number(movement?.adjustmentNet || 0)),
    plannedRequirement: planned,
    shortage,
    totalPurchaseCostMinor: Number(movement?.totalPurchaseCostMinor || 0),
    lowStock: Boolean((minimumStock != null && currentStock < minimumStock) || shortage > 0),
  }
}

const summarizeMaterials = async (organizationId: string, materials: any[]) => {
  const ids = materials.map((row) => new mongoose.Types.ObjectId(String(row._id)))
  const [movements, requirements] = await Promise.all([
    movementRollups(organizationId, ids),
    requirementRollups(organizationId, ids),
  ])
  return materials.map((material) => withSummary(material, movements.get(String(material._id)), requirements.get(String(material._id)) || 0))
}

const listMaterials = async (organizationId: string, query: any, options: IPaginationOptions) => {
  const { page, limit, skip } = paginationHelper.calculatePagination(options, { sortBy: 'name', sortOrder: 'asc' })
  const filter: any = { organizationId }
  if (query.active !== undefined) filter.active = query.active === true || query.active === 'true'
  if (query.category) filter.category = query.category
  if (query.searchTerm) {
    const pattern = new RegExp(escapeRegex(String(query.searchTerm).trim()), 'i')
    filter.$or = [{ name: pattern }, { category: pattern }, { notes: pattern }]
  }
  const [rows, total] = await Promise.all([
    Material.find(filter).sort({ name: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    Material.countDocuments(filter),
  ])
  const data = await summarizeMaterials(organizationId, rows)
  return { meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }, data }
}

const createMaterial = async (organizationId: string, actorId: string, payload: any) => {
  const actor = actorObjectId(actorId)
  const name = String(payload.name).trim().replace(/\s+/g, ' ')
  try {
    const material = await Material.create({
      organizationId,
      name,
      nameKey: normalizeNameKey(name),
      category: String(payload.category).trim().replace(/\s+/g, ' '),
      unit: payload.unit,
      ...(payload.minimumStock !== undefined ? { minimumStock: Number(payload.minimumStock) } : {}),
      ...(payload.notes ? { notes: String(payload.notes).trim() } : {}),
      active: true,
      stockQuantity: 0,
      createdBy: actor,
      updatedBy: actor,
    })
    return withSummary(material.toObject(), undefined, 0)
  } catch (error: any) {
    if (error?.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'A material with this name already exists')
    throw error
  }
}

const updateMaterial = async (organizationId: string, materialId: string, actorId: string, payload: any) => {
  const material = await Material.findOne({ _id: materialObjectId(materialId), organizationId })
  if (!material) throw new ApiError(httpStatus.NOT_FOUND, 'Material not found')
  if (payload.unit && payload.unit !== material.unit) {
    const hasMovements = await StockMovement.exists({ organizationId, materialId: material._id })
    if (hasMovements) throw new ApiError(httpStatus.CONFLICT, 'Material unit cannot be changed after stock movements exist')
  }
  if (payload.name !== undefined) {
    const name = String(payload.name).trim().replace(/\s+/g, ' ')
    material.name = name
    material.nameKey = normalizeNameKey(name)
  }
  if (payload.category !== undefined) material.category = String(payload.category).trim().replace(/\s+/g, ' ')
  if (payload.unit !== undefined) material.unit = payload.unit
  if (payload.minimumStock !== undefined) material.minimumStock = payload.minimumStock === null ? undefined : Number(payload.minimumStock)
  if (payload.notes !== undefined) material.notes = payload.notes === null ? undefined : String(payload.notes).trim()
  if (payload.active !== undefined) material.active = Boolean(payload.active)
  material.updatedBy = actorObjectId(actorId)
  try { await material.save() } catch (error: any) {
    if (error?.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'A material with this name already exists')
    throw error
  }
  const [summary] = await summarizeMaterials(organizationId, [material.toObject()])
  return summary
}

const getMaterial = async (organizationId: string, materialId: string) => {
  const material = await Material.findOne({ _id: materialObjectId(materialId), organizationId }).lean()
  if (!material) throw new ApiError(httpStatus.NOT_FOUND, 'Material not found')
  const [summary] = await summarizeMaterials(organizationId, [material])
  const [requirements, movements] = await Promise.all([
    MaterialRequirement.find({ organizationId, materialId: material._id }).sort({ requiredBy: 1, _id: 1 }).limit(100).lean(),
    StockMovement.find({ organizationId, materialId: material._id }).sort({ occurredAt: -1, _id: -1 }).limit(50).lean(),
  ])
  const propertyIds = [...new Set([...requirements, ...movements].map((row: any) => row.propertyId && String(row.propertyId)).filter(Boolean))]
  const properties = propertyIds.length ? await Property.find({ organizationId, _id: { $in: propertyIds } }).select('_id title buildingName floorNumber').lean() : []
  const propertyMap = new Map(properties.map((row: any) => [String(row._id), row]))
  return {
    material: summary,
    requirements: requirements.map((row: any) => ({ ...row, property: row.propertyId ? propertyMap.get(String(row.propertyId)) || null : null })),
    recentMovements: movements.map((row: any) => ({ ...row, property: row.propertyId ? propertyMap.get(String(row.propertyId)) || null : null })),
  }
}


const reminderRunAt = (candidate: Date) => candidate.getTime() > Date.now() + 1_000 ? candidate : new Date(Date.now() + 30_000)

const syncRequirementReminder = async (organizationId: string, requirement: any) => {
  const entityId = String(requirement._id)
  if (['Completed', 'Cancelled'].includes(String(requirement.status))) {
    await OperationsQueueService.cancel(organizationId, 'material_requirement_reminder', entityId)
    return
  }
  const due = new Date(requirement.requiredBy)
  const runAt = reminderRunAt(new Date(due.getTime() - 7 * 24 * 60 * 60 * 1000))
  await OperationsQueueService.schedule({ organizationId, type: 'material_requirement_reminder', entityId, runAt, payload: { materialId: String(requirement.materialId) } })
}

const syncLowStockReminder = async (organizationId: string, materialId: string) => {
  const material: any = await Material.findOne({ _id: materialObjectId(materialId), organizationId, active: true }).select('_id stockQuantity minimumStock').lean()
  if (!material) {
    await OperationsQueueService.cancel(organizationId, 'low_stock_reminder', materialId)
    return
  }
  const rows: any[] = await MaterialRequirement.find({ organizationId, materialId: material._id, status: { $in: ['Planned', 'Partially Available'] } }).select('requiredQuantity').lean()
  const required = rows.reduce((sum, row) => sum + Number(row.requiredQuantity || 0), 0)
  const stock = Number(material.stockQuantity || 0)
  const low = (material.minimumStock != null && stock < Number(material.minimumStock)) || required > stock
  if (!low) {
    await OperationsQueueService.cancel(organizationId, 'low_stock_reminder', materialId)
    return
  }
  await OperationsQueueService.schedule({ organizationId, type: 'low_stock_reminder', entityId: materialId, runAt: new Date(Date.now() + 30_000) })
}

const createRequirement = async (organizationId: string, materialId: string, actorId: string, payload: any) => {
  const material = await Material.findOne({ _id: materialObjectId(materialId), organizationId, active: true }).select('_id').lean()
  if (!material) throw new ApiError(httpStatus.NOT_FOUND, 'Active material not found')
  await ensureProperty(organizationId, payload.propertyId)
  const [row] = await MaterialRequirement.create([{
    organizationId,
    materialId: material._id,
    ...(payload.propertyId ? { propertyId: payload.propertyId } : {}),
    ...(payload.flatId ? { flatId: String(payload.flatId).trim() } : {}),
    requiredQuantity: Number(payload.requiredQuantity),
    requiredBy: payload.requiredBy,
    ...(payload.notes ? { notes: String(payload.notes).trim() } : {}),
    status: payload.status || 'Planned',
    createdBy: actorObjectId(actorId),
    updatedBy: actorObjectId(actorId),
  }])
  await Promise.all([syncRequirementReminder(organizationId, row), syncLowStockReminder(organizationId, materialId)])
  return row.toObject()
}

const updateRequirement = async (organizationId: string, requirementId: string, actorId: string, payload: any) => {
  if (!mongoose.isValidObjectId(requirementId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid requirement id')
  const row = await MaterialRequirement.findOne({ _id: requirementId, organizationId })
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Material requirement not found')
  if (payload.propertyId !== undefined) {
    if (payload.propertyId) await ensureProperty(organizationId, payload.propertyId)
    row.propertyId = payload.propertyId || undefined
  }
  if (payload.flatId !== undefined) row.flatId = payload.flatId || undefined
  if (payload.requiredQuantity !== undefined) row.requiredQuantity = Number(payload.requiredQuantity)
  if (payload.requiredBy !== undefined) row.requiredBy = payload.requiredBy
  if (payload.notes !== undefined) row.notes = payload.notes || undefined
  if (payload.status !== undefined) row.status = payload.status
  row.updatedBy = actorObjectId(actorId)
  await row.save()
  await Promise.all([syncRequirementReminder(organizationId, row), syncLowStockReminder(organizationId, String(row.materialId))])
  return row.toObject()
}

const createMovement = async (organizationId: string, materialId: string, actorId: string, payload: any, headerIdempotencyKey?: string) => {
  const idempotencyKey = String(payload.idempotencyKey || headerIdempotencyKey || '').trim() || undefined
  if (idempotencyKey && idempotencyKey.length > 120) throw new ApiError(httpStatus.BAD_REQUEST, 'Idempotency key is too long')
  const result = await requiredTransaction(async (session) => {
    if (idempotencyKey) {
      const existing = await StockMovement.findOne({ organizationId, idempotencyKey }).session(session).lean()
      if (existing) {
        if (String(existing.materialId) !== String(materialId)) throw new ApiError(httpStatus.CONFLICT, 'This idempotency key is already used for another material')
        return { movement: existing, material: (await getMaterial(organizationId, materialId)).material, replayed: true }
      }
    }
    const material = await Material.findOne({ _id: materialObjectId(materialId), organizationId, active: true }).session(session)
    if (!material) throw new ApiError(httpStatus.NOT_FOUND, 'Active material not found')
    await ensureProperty(organizationId, payload.propertyId, session)

    const input = Number(payload.quantity)
    const delta = roundQuantity(movementDelta(payload.type, input))
    const absolute = roundQuantity(Math.abs(delta))
    if (!Number.isFinite(delta) || !absolute) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid movement quantity')

    let unitPriceMinor: number | undefined
    let totalCostMinor: number | undefined
    if (payload.type === 'PURCHASE') {
      unitPriceMinor = moneyToMinorUnits(Number(payload.unitPrice))
      totalCostMinor = Math.round(absolute * unitPriceMinor)
      if (!Number.isSafeInteger(totalCostMinor)) throw new ApiError(httpStatus.BAD_REQUEST, 'Purchase total is too large')
    }

    const stockFilter: any = { _id: material._id, organizationId, active: true }
    if (delta < 0) stockFilter.stockQuantity = { $gte: Math.abs(delta) }
    const updatedMaterial = await Material.findOneAndUpdate(stockFilter, { $inc: { stockQuantity: delta }, $set: { updatedBy: actorObjectId(actorId) } }, { new: true, session })
    if (!updatedMaterial) throw new ApiError(httpStatus.CONFLICT, 'This movement would make stock negative. Refresh and try again.')

    let movement: any
    try {
      ;[movement] = await StockMovement.create([{
        organizationId,
        materialId: material._id,
        ...(payload.propertyId ? { propertyId: payload.propertyId } : {}),
        ...(payload.flatId ? { flatId: String(payload.flatId).trim() } : {}),
        type: payload.type,
        quantityDelta: delta,
        quantityAbsolute: absolute,
        ...(unitPriceMinor !== undefined ? { unitPriceMinor } : {}),
        ...(totalCostMinor !== undefined ? { totalCostMinor } : {}),
        occurredAt: payload.occurredAt || new Date(),
        ...(payload.notes ? { notes: String(payload.notes).trim() } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        createdBy: actorObjectId(actorId),
      }], { session })
    } catch (error: any) {
      if (error?.code === 11000 && idempotencyKey) {
        throw new ApiError(httpStatus.CONFLICT, 'A stock movement with this idempotency key already exists. Retry the request to fetch the existing result.')
      }
      throw error
    }
    return { movement: movement.toObject(), material: updatedMaterial.toObject(), replayed: false }
  })
  await syncLowStockReminder(organizationId, materialId)
  return result
}


const recordPurchaseReceiptInSession = async (
  organizationId: string,
  materialId: string,
  actorId: string,
  payload: {
    quantity: number
    unitPriceMinor: number
    propertyId?: string
    flatId?: string
    occurredAt: Date
    notes?: string
    sourceId: string
  },
  session: ClientSession,
) => {
  if (!mongoose.isValidObjectId(payload.sourceId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid purchase receipt source')
  const material = await Material.findOne({ _id: materialObjectId(materialId), organizationId, active: true }).session(session)
  if (!material) throw new ApiError(httpStatus.NOT_FOUND, 'Active material not found')
  await ensureProperty(organizationId, payload.propertyId, session)
  const absolute = roundQuantity(Math.abs(Number(payload.quantity)))
  if (!Number.isFinite(absolute) || absolute <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid receipt quantity')
  if (!Number.isSafeInteger(payload.unitPriceMinor) || payload.unitPriceMinor < 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid purchase unit price')
  const totalCostMinor = Math.round(absolute * payload.unitPriceMinor)
  if (!Number.isSafeInteger(totalCostMinor)) throw new ApiError(httpStatus.BAD_REQUEST, 'Purchase receipt total is too large')

  const updatedMaterial = await Material.findOneAndUpdate(
    { _id: material._id, organizationId, active: true },
    { $inc: { stockQuantity: absolute }, $set: { updatedBy: actorObjectId(actorId) } },
    { new: true, session },
  )
  if (!updatedMaterial) throw new ApiError(httpStatus.CONFLICT, 'Material inventory changed. Refresh and try again.')

  const [movement] = await StockMovement.create([{
    organizationId,
    materialId: material._id,
    ...(payload.propertyId ? { propertyId: payload.propertyId } : {}),
    ...(payload.flatId ? { flatId: String(payload.flatId).trim() } : {}),
    type: 'PURCHASE',
    quantityDelta: absolute,
    quantityAbsolute: absolute,
    unitPriceMinor: payload.unitPriceMinor,
    totalCostMinor,
    occurredAt: payload.occurredAt,
    ...(payload.notes ? { notes: String(payload.notes).trim() } : {}),
    sourceType: 'MATERIAL_PURCHASE_RECEIPT',
    sourceId: new mongoose.Types.ObjectId(payload.sourceId),
    createdBy: actorObjectId(actorId),
  }], { session })
  return { movement, material: updatedMaterial }
}

const listMovements = async (organizationId: string, materialId: string, query: any, options: IPaginationOptions) => {
  const material = await Material.findOne({ _id: materialObjectId(materialId), organizationId }).select('_id').lean()
  if (!material) throw new ApiError(httpStatus.NOT_FOUND, 'Material not found')
  const { page, limit, skip } = paginationHelper.calculatePagination(options, { sortBy: 'occurredAt', sortOrder: 'desc' })
  const filter: any = { organizationId, materialId: material._id }
  if (query.type) filter.type = query.type
  const [rows, total] = await Promise.all([
    StockMovement.find(filter).sort({ occurredAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    StockMovement.countDocuments(filter),
  ])
  return { meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }, data: rows }
}

export const MaterialInventoryService = { listMaterials, createMaterial, updateMaterial, getMaterial, createRequirement, updateRequirement, createMovement, recordPurchaseReceiptInSession, syncRequirementReminder, syncLowStockReminder, listMovements }
