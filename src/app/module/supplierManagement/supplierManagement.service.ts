import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import type { IPaginationOptions } from '../../../interfaces/common'
import { requiredTransaction } from '../../db/requiredTransaction'
import { normalizeInternationalPhone } from '../../helpers/identity'
import paginationHelper from '../../helpers/paginationHelper'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { FinanceService } from '../finance/finance.service'
import { moneyToMinorUnits } from '../finance/finance.money'
import { FinanceTransaction, FinanceVendor } from '../finance/finance.model'
import { MaterialInventoryService } from '../materialInventory/materialInventory.service'
import { Material } from '../materialInventory/material.model'
import { Property } from '../property/property.model'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { MaterialPurchase } from './materialPurchase.model'
import { MaterialPurchaseReceipt } from './materialPurchaseReceipt.model'
import { SupplierInvoiceAttachmentService } from './supplierInvoiceAttachment.service'

const actorObjectId = (actorId: string) => {
  if (!mongoose.isValidObjectId(actorId)) throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid authenticated user')
  return new mongoose.Types.ObjectId(actorId)
}
const objectId = (value: unknown, label: string) => {
  const id = String(value || '').trim()
  if (!mongoose.isValidObjectId(id)) throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${label}`)
  return new mongoose.Types.ObjectId(id)
}
const roundQuantity = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const normalizeOptionalPhone = (value: unknown) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try { return normalizeInternationalPhone(raw) } catch (error: any) { throw new ApiError(httpStatus.BAD_REQUEST, error?.message || 'Invalid supplier phone number') }
}
const emit = async (organizationId: string, actorId: string, aggregateType: string, aggregateId: string, eventType: string, summary: string) => {
  await DomainEventService.emit({ organizationId, aggregateType, aggregateId, eventType, actorId, payload: { summary } }).catch(() => undefined)
}

const ensureMaterialIds = async (organizationId: string, values: unknown[] | undefined, session?: ClientSession) => {
  const ids = [...new Set((values || []).filter(Boolean).map((value) => String(objectId(value, 'material id'))))]
  if (!ids.length) return [] as mongoose.Types.ObjectId[]
  let query = Material.find({ _id: { $in: ids }, organizationId }).select('_id')
  if (session) query = query.session(session)
  const rows = await query.lean()
  if (rows.length !== ids.length) throw new ApiError(httpStatus.BAD_REQUEST, 'One or more supplied materials do not belong to this organization')
  return ids.map((id) => new mongoose.Types.ObjectId(id))
}

const ensureSupplier = async (organizationId: string, supplierId: string, session?: ClientSession, activeOnly = true) => {
  let query = FinanceVendor.findOne({ _id: objectId(supplierId, 'supplier id'), organizationId, isSupplier: true, ...(activeOnly ? { status: 'active' } : {}) })
  if (session) query = query.session(session)
  const supplier = await query
  if (!supplier) throw new ApiError(httpStatus.NOT_FOUND, activeOnly ? 'Active supplier not found' : 'Supplier not found')
  return supplier
}

const ensureMaterial = async (organizationId: string, materialId: string, session?: ClientSession) => {
  let query = Material.findOne({ _id: objectId(materialId, 'material id'), organizationId, active: true })
  if (session) query = query.session(session)
  const material = await query
  if (!material) throw new ApiError(httpStatus.NOT_FOUND, 'Active material not found')
  return material
}

const ensureProperty = async (organizationId: string, propertyId?: string, session?: ClientSession) => {
  if (!propertyId) return null
  let query = Property.findOne({ _id: objectId(propertyId, 'property id'), organizationId }).select('_id title buildingName floorNumber')
  if (session) query = query.session(session)
  const property = await query.lean()
  if (!property) throw new ApiError(httpStatus.BAD_REQUEST, 'Property does not belong to this organization')
  return property
}

const purchasePaymentMap = async (organizationId: string, purchaseIds: mongoose.Types.ObjectId[], session?: ClientSession) => {
  if (!purchaseIds.length) return new Map<string, number>()
  const pipeline: any[] = [
    { $match: { organizationId, sourceType: 'material_purchase_payment', sourceId: { $in: purchaseIds }, status: 'paid', deletedAt: null } },
    { $group: { _id: '$sourceId', paid: { $sum: '$amount' } } },
  ]
  let aggregate = FinanceTransaction.aggregate(pipeline)
  if (session) aggregate = aggregate.session(session)
  const rows = await aggregate
  return new Map(rows.map((row: any) => [String(row._id), moneyToMinorUnits(Number(row.paid || 0))]))
}

const enrichPurchases = async (organizationId: string, rows: any[]) => {
  if (!rows.length) return []
  const ids = rows.map((row) => new mongoose.Types.ObjectId(String(row._id)))
  const supplierIds = [...new Set(rows.map((row) => String(row.supplierId)).filter(Boolean))]
  const materialIds = [...new Set(rows.map((row) => String(row.materialId)).filter(Boolean))]
  const propertyIds = [...new Set(rows.map((row) => String(row.propertyId || '')).filter(Boolean))]
  const [paymentMap, attachmentMap, suppliers, materials, properties] = await Promise.all([
    purchasePaymentMap(organizationId, ids),
    SupplierInvoiceAttachmentService.attachmentsForPurchases(organizationId, ids),
    FinanceVendor.find({ organizationId, _id: { $in: supplierIds } }).select('_id name phone email contactPerson status').lean(),
    Material.find({ organizationId, _id: { $in: materialIds } }).select('_id name category unit active').lean(),
    propertyIds.length ? Property.find({ organizationId, _id: { $in: propertyIds } }).select('_id title buildingName floorNumber').lean() : [],
  ])
  const supplierMap = new Map(suppliers.map((row: any) => [String(row._id), row]))
  const materialMap = new Map(materials.map((row: any) => [String(row._id), row]))
  const propertyMap = new Map(properties.map((row: any) => [String(row._id), row]))
  return rows.map((row: any) => {
    const id = String(row._id)
    const totalMinor = Number(row.totalMinor || 0)
    const paidMinor = paymentMap.get(id) || 0
    const outstandingMinor = Math.max(0, totalMinor - paidMinor)
    const paymentStatus = totalMinor <= 0 || outstandingMinor <= 0 ? 'Paid' : paidMinor > 0 ? 'Partial' : 'Unpaid'
    return {
      ...row,
      supplier: supplierMap.get(String(row.supplierId)) || null,
      material: materialMap.get(String(row.materialId)) || null,
      property: row.propertyId ? propertyMap.get(String(row.propertyId)) || null : null,
      amountPaidMinor: paidMinor,
      outstandingMinor,
      paymentStatus,
      invoiceAttachment: attachmentMap.get(id) || null,
      remainingToReceive: roundQuantity(Math.max(0, Number(row.quantity || 0) - Number(row.receivedQuantity || 0))),
    }
  })
}

const listSuppliers = async (organizationId: string, query: any, options: IPaginationOptions) => {
  const { page, limit, skip } = paginationHelper.calculatePagination(options, { sortBy: 'name', sortOrder: 'asc' })
  const filter: any = { organizationId, isSupplier: true }
  if (query.status) filter.status = query.status
  if (query.materialId) filter.materialsSupplied = objectId(query.materialId, 'material id')
  if (query.searchTerm) {
    const pattern = new RegExp(escapeRegex(String(query.searchTerm).trim()), 'i')
    filter.$or = [{ name: pattern }, { contactPerson: pattern }, { phone: pattern }, { email: pattern }, { address: pattern }]
  }
  const [vendors, total] = await Promise.all([
    FinanceVendor.find(filter).sort({ name: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    FinanceVendor.countDocuments(filter),
  ])
  const vendorIds = vendors.map((row: any) => row._id)
  const [purchaseTotals, paymentTotals, materials] = await Promise.all([
    vendorIds.length ? MaterialPurchase.aggregate([
      { $match: { organizationId, supplierId: { $in: vendorIds }, status: { $ne: 'Cancelled' } } },
      { $group: { _id: '$supplierId', totalPurchasesMinor: { $sum: '$totalMinor' }, purchaseCount: { $sum: 1 } } },
    ]) : [],
    vendorIds.length ? FinanceTransaction.aggregate([
      { $match: { organizationId, vendorId: { $in: vendorIds }, sourceType: 'material_purchase_payment', status: 'paid', deletedAt: null } },
      { $group: { _id: '$vendorId', totalPaid: { $sum: '$amount' } } },
    ]) : [],
    Material.find({ organizationId, _id: { $in: vendors.flatMap((row: any) => row.materialsSupplied || []) } }).select('_id name unit').lean(),
  ])
  const purchaseMap = new Map(purchaseTotals.map((row: any) => [String(row._id), row]))
  const paymentMap = new Map(paymentTotals.map((row: any) => [String(row._id), moneyToMinorUnits(Number(row.totalPaid || 0))]))
  const materialMap = new Map(materials.map((row: any) => [String(row._id), row]))
  const data = vendors.map((vendor: any) => {
    const purchases = purchaseMap.get(String(vendor._id)) || { totalPurchasesMinor: 0, purchaseCount: 0 }
    const totalPaidMinor = paymentMap.get(String(vendor._id)) || 0
    return {
      ...vendor,
      materials: (vendor.materialsSupplied || []).map((id: any) => materialMap.get(String(id))).filter(Boolean),
      totalPurchasesMinor: Number(purchases.totalPurchasesMinor || 0),
      totalPaidMinor,
      outstandingMinor: Math.max(0, Number(purchases.totalPurchasesMinor || 0) - totalPaidMinor),
      purchaseCount: Number(purchases.purchaseCount || 0),
    }
  })
  return { meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }, data }
}

const listAvailableVendors = async (organizationId: string, query: any) => {
  const filter: any = { organizationId, status: 'active', isSupplier: { $ne: true } }
  if (query.searchTerm) {
    const pattern = new RegExp(escapeRegex(String(query.searchTerm).trim()), 'i')
    filter.$or = [{ name: pattern }, { phone: pattern }, { email: pattern }, { category: pattern }]
  }
  return FinanceVendor.find(filter).select('_id name category phone email address notes').sort({ name: 1 }).limit(100).lean()
}

const listMaterialOptions = async (organizationId: string) => Material.find({ organizationId, active: true }).select('_id name category unit').sort({ name: 1 }).limit(1000).lean()

const createSupplier = async (organizationId: string, actorId: string, payload: any) => {
  const result = await requiredTransaction(async (session) => {
    const materialIds = await ensureMaterialIds(organizationId, payload.materialsSupplied, session)
    const phone = payload.phone !== undefined ? normalizeOptionalPhone(payload.phone) : undefined
    if (payload.vendorId) {
      const vendor = await FinanceVendor.findOne({ _id: objectId(payload.vendorId, 'vendor id'), organizationId }).session(session)
      if (!vendor) throw new ApiError(httpStatus.NOT_FOUND, 'Finance vendor not found')
      if (vendor.isSupplier) throw new ApiError(httpStatus.CONFLICT, 'This vendor is already a supplier')
      if (payload.name !== undefined) vendor.name = String(payload.name).trim()
      if (payload.contactPerson !== undefined) vendor.contactPerson = String(payload.contactPerson || '').trim()
      if (phone !== undefined) vendor.phone = phone
      if (payload.email !== undefined) vendor.email = String(payload.email || '').trim().toLowerCase()
      if (payload.address !== undefined) vendor.address = String(payload.address || '').trim()
      if (payload.notes !== undefined) vendor.notes = String(payload.notes || '').trim()
      vendor.materialsSupplied = materialIds
      vendor.isSupplier = true
      vendor.updatedBy = actorObjectId(actorId)
      await vendor.save({ session })
      return vendor
    }
    if (!payload.name) throw new ApiError(httpStatus.BAD_REQUEST, 'Supplier name is required')
    const [vendor] = await FinanceVendor.create([{
      organizationId,
      name: String(payload.name).trim(),
      category: 'Material Supplier',
      contactPerson: String(payload.contactPerson || '').trim(),
      phone: phone || '',
      email: String(payload.email || '').trim().toLowerCase(),
      address: String(payload.address || '').trim(),
      notes: String(payload.notes || '').trim(),
      isSupplier: true,
      materialsSupplied: materialIds,
      status: 'active',
      createdBy: actorObjectId(actorId),
      updatedBy: actorObjectId(actorId),
    }], { session })
    return vendor
  })
  await emit(organizationId, actorId, 'finance_vendor', String(result._id), 'supplier.created', `Supplier ${result.name} created`)
  return getSupplierProfile(organizationId, String(result._id))
}

const updateSupplier = async (organizationId: string, supplierId: string, actorId: string, payload: any) => {
  const result = await requiredTransaction(async (session) => {
    const vendor = await ensureSupplier(organizationId, supplierId, session, false)
    if (payload.materialsSupplied !== undefined) vendor.materialsSupplied = await ensureMaterialIds(organizationId, payload.materialsSupplied, session)
    if (payload.name !== undefined) vendor.name = String(payload.name).trim()
    if (payload.contactPerson !== undefined) vendor.contactPerson = String(payload.contactPerson || '').trim()
    if (payload.phone !== undefined) vendor.phone = normalizeOptionalPhone(payload.phone)
    if (payload.email !== undefined) vendor.email = String(payload.email || '').trim().toLowerCase()
    if (payload.address !== undefined) vendor.address = String(payload.address || '').trim()
    if (payload.notes !== undefined) vendor.notes = String(payload.notes || '').trim()
    if (payload.status !== undefined) vendor.status = payload.status
    vendor.updatedBy = actorObjectId(actorId)
    await vendor.save({ session })
    return vendor
  })
  await emit(organizationId, actorId, 'finance_vendor', supplierId, 'supplier.updated', `Supplier ${result.name} updated`)
  return getSupplierProfile(organizationId, supplierId)
}

const getSupplierProfile = async (organizationId: string, supplierId: string) => {
  const supplier: any = await FinanceVendor.findOne({ _id: objectId(supplierId, 'supplier id'), organizationId, isSupplier: true }).lean()
  if (!supplier) throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found')
  const materialIds = (supplier.materialsSupplied || []).map((id: any) => new mongoose.Types.ObjectId(String(id)))
  const [materials, purchasesRaw, payments, totals, paymentTotals, latestPriceRows] = await Promise.all([
    materialIds.length ? Material.find({ organizationId, _id: { $in: materialIds } }).select('_id name category unit active').lean() : [],
    MaterialPurchase.find({ organizationId, supplierId: supplier._id }).sort({ purchaseDate: -1, createdAt: -1 }).limit(50).lean(),
    FinanceTransaction.find({ organizationId, vendorId: supplier._id, sourceType: 'material_purchase_payment', deletedAt: null }).select('sourceId amount transactionDate paymentMethod reference status voidedAt voidReason createdAt').sort({ transactionDate: -1, createdAt: -1 }).limit(50).lean(),
    MaterialPurchase.aggregate([{ $match: { organizationId, supplierId: supplier._id, status: { $ne: 'Cancelled' } } }, { $group: { _id: null, totalPurchasesMinor: { $sum: '$totalMinor' }, purchaseCount: { $sum: 1 } } }]),
    FinanceTransaction.aggregate([{ $match: { organizationId, vendorId: supplier._id, sourceType: 'material_purchase_payment', status: 'paid', deletedAt: null } }, { $group: { _id: null, totalPaid: { $sum: '$amount' } } }]),
    MaterialPurchase.aggregate([
      { $match: { organizationId, supplierId: supplier._id, status: { $ne: 'Cancelled' } } },
      { $sort: { purchaseDate: -1, createdAt: -1, _id: -1 } },
      { $group: { _id: '$materialId', unitPriceMinor: { $first: '$unitPriceMinor' }, purchaseDate: { $first: '$purchaseDate' }, purchaseId: { $first: '$_id' } } },
      { $sort: { purchaseDate: -1 } },
    ]),
  ])
  const purchases = await enrichPurchases(organizationId, purchasesRaw)
  const totalPurchasesMinor = Number(totals[0]?.totalPurchasesMinor || 0)
  const totalPaidMinor = moneyToMinorUnits(Number(paymentTotals[0]?.totalPaid || 0))
  const latestMaterials: any[] = latestPriceRows.length ? await Material.find({ organizationId, _id: { $in: latestPriceRows.map((row: any) => row._id) } }).select('_id name category unit active').lean() : []
  const latestMaterialMap = new Map(latestMaterials.map((row: any) => [String(row._id), row]))
  const latestPrices = latestPriceRows.map((row: any) => ({
    material: latestMaterialMap.get(String(row._id)) || null,
    unitPriceMinor: Number(row.unitPriceMinor || 0),
    purchaseDate: row.purchaseDate,
    purchaseId: row.purchaseId,
  }))
  return {
    supplier: { ...supplier, materials },
    financialSummary: {
      totalPurchasesMinor,
      totalPaidMinor,
      outstandingMinor: Math.max(0, totalPurchasesMinor - totalPaidMinor),
      purchaseCount: Number(totals[0]?.purchaseCount || 0),
    },
    latestPrices,
    recentPurchases: purchases,
    payments,
  }
}

const listPurchases = async (organizationId: string, query: any, options: IPaginationOptions) => {
  const { page, limit, skip } = paginationHelper.calculatePagination(options, { sortBy: 'purchaseDate', sortOrder: 'desc' })
  const filter: any = { organizationId }
  if (query.supplierId) filter.supplierId = objectId(query.supplierId, 'supplier id')
  if (query.materialId) filter.materialId = objectId(query.materialId, 'material id')
  if (query.propertyId) filter.propertyId = objectId(query.propertyId, 'property id')
  if (query.status) filter.status = query.status
  if (query.startDate || query.endDate) filter.purchaseDate = { ...(query.startDate ? { $gte: new Date(query.startDate) } : {}), ...(query.endDate ? { $lte: new Date(query.endDate) } : {}) }
  if (query.searchTerm) filter.invoiceNumber = { $regex: escapeRegex(String(query.searchTerm).trim()), $options: 'i' }
  const [rows, total] = await Promise.all([
    MaterialPurchase.find(filter).sort({ purchaseDate: -1, createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    MaterialPurchase.countDocuments(filter),
  ])
  return { meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }, data: await enrichPurchases(organizationId, rows) }
}


const syncSupplierPaymentReminder = async (organizationId: string, purchaseId: string) => {
  const purchase: any = await MaterialPurchase.findOne({ _id: objectId(purchaseId, 'purchase id'), organizationId }).lean()
  if (!purchase || purchase.status === 'Cancelled' || !purchase.paymentDueDate) {
    await OperationsQueueService.cancel(organizationId, 'supplier_payment_due', purchaseId)
    return
  }
  const paidMap = await purchasePaymentMap(organizationId, [purchase._id])
  const outstanding = Math.max(0, Number(purchase.totalMinor || 0) - (paidMap.get(String(purchase._id)) || 0))
  if (outstanding <= 0) {
    await OperationsQueueService.cancel(organizationId, 'supplier_payment_due', purchaseId)
    return
  }
  const candidate = new Date(new Date(purchase.paymentDueDate).getTime() - 24 * 60 * 60 * 1000)
  const runAt = candidate.getTime() > Date.now() + 1_000 ? candidate : new Date(Date.now() + 30_000)
  await OperationsQueueService.schedule({ organizationId, type: 'supplier_payment_due', entityId: purchaseId, runAt })
}

const createPurchase = async (organizationId: string, actorId: string, payload: any, headerIdempotencyKey?: string) => {
  const idempotencyKey = String(payload.idempotencyKey || headerIdempotencyKey || '').trim() || undefined
  if (idempotencyKey && idempotencyKey.length > 120) throw new ApiError(httpStatus.BAD_REQUEST, 'Idempotency key is too long')
  try {
    const txResult = await requiredTransaction(async (session) => {
      if (idempotencyKey) {
        const existing = await MaterialPurchase.findOne({ organizationId, idempotencyKey }).session(session).lean()
        if (existing) return { purchaseId: String(existing._id), replayed: true }
      }
      const [supplier, material] = await Promise.all([
        ensureSupplier(organizationId, payload.supplierId, session),
        ensureMaterial(organizationId, payload.materialId, session),
      ])
      await ensureProperty(organizationId, payload.propertyId, session)
      const quantity = roundQuantity(Number(payload.quantity))
      const unitPriceMinor = moneyToMinorUnits(Number(payload.unitPrice))
      const totalMinor = Math.round(quantity * unitPriceMinor)
      if (!Number.isSafeInteger(totalMinor)) throw new ApiError(httpStatus.BAD_REQUEST, 'Purchase total is too large')
      const [purchase] = await MaterialPurchase.create([{
        organizationId,
        supplierId: supplier._id,
        materialId: material._id,
        ...(payload.propertyId ? { propertyId: payload.propertyId } : {}),
        ...(payload.flatId ? { flatId: String(payload.flatId).trim() } : {}),
        quantity,
        unit: material.unit,
        unitPriceMinor,
        totalMinor,
        purchaseDate: payload.purchaseDate,
        ...(payload.expectedDeliveryDate ? { expectedDeliveryDate: payload.expectedDeliveryDate } : {}),
        ...(payload.paymentDueDate ? { paymentDueDate: payload.paymentDueDate } : {}),
        receivedQuantity: 0,
        status: 'Ordered',
        ...(payload.invoiceNumber ? { invoiceNumber: String(payload.invoiceNumber).trim() } : {}),
        ...(payload.notes ? { notes: String(payload.notes).trim() } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        createdBy: actorObjectId(actorId),
        updatedBy: actorObjectId(actorId),
      }], { session })
      return { purchaseId: String(purchase._id), replayed: false }
    })
    const purchaseId = txResult.purchaseId
    const stored = await MaterialPurchase.findOne({ _id: purchaseId, organizationId }).lean()
    const [data] = await enrichPurchases(organizationId, stored ? [stored] : [])
    if (!txResult.replayed) await emit(organizationId, actorId, 'material_purchase', purchaseId, 'material_purchase.created', `Material purchase ${purchaseId} created`)
    await syncSupplierPaymentReminder(organizationId, purchaseId)
    return { data, replayed: txResult.replayed }
  } catch (error: any) {
    if (error?.code === 11000 && idempotencyKey) {
      const existing = await MaterialPurchase.findOne({ organizationId, idempotencyKey }).lean()
      if (existing) return { data: (await enrichPurchases(organizationId, [existing]))[0], replayed: true }
    }
    throw error
  }
}

const updatePurchase = async (organizationId: string, purchaseId: string, actorId: string, payload: any) => {
  const purchase = await MaterialPurchase.findOne({ _id: objectId(purchaseId, 'purchase id'), organizationId })
  if (!purchase) throw new ApiError(httpStatus.NOT_FOUND, 'Material purchase not found')
  if (purchase.status === 'Cancelled') throw new ApiError(httpStatus.CONFLICT, 'Cancelled purchases cannot be edited')
  if (payload.expectedDeliveryDate !== undefined) purchase.expectedDeliveryDate = payload.expectedDeliveryDate || null
  if (payload.paymentDueDate !== undefined) purchase.paymentDueDate = payload.paymentDueDate || null
  if (payload.invoiceNumber !== undefined) purchase.invoiceNumber = String(payload.invoiceNumber || '').trim()
  if (payload.notes !== undefined) purchase.notes = String(payload.notes || '').trim()
  purchase.updatedBy = actorObjectId(actorId)
  await purchase.save()
  await syncSupplierPaymentReminder(organizationId, purchaseId)
  return (await enrichPurchases(organizationId, [purchase.toObject()]))[0]
}

const receivePurchase = async (organizationId: string, purchaseId: string, actorId: string, payload: any, headerIdempotencyKey?: string) => {
  const idempotencyKey = String(payload.idempotencyKey || headerIdempotencyKey || '').trim() || undefined
  try {
    const result = await requiredTransaction(async (session) => {
      if (idempotencyKey) {
        const existing: any = await MaterialPurchaseReceipt.findOne({ organizationId, idempotencyKey }).session(session).lean()
        if (existing) {
          if (String(existing.purchaseId) !== purchaseId) throw new ApiError(httpStatus.CONFLICT, 'This idempotency key belongs to another purchase receipt')
          return { receiptId: String(existing._id), replayed: true }
        }
      }
      const purchase: any = await MaterialPurchase.findOne({ _id: objectId(purchaseId, 'purchase id'), organizationId }).session(session)
      if (!purchase) throw new ApiError(httpStatus.NOT_FOUND, 'Material purchase not found')
      if (purchase.status === 'Cancelled') throw new ApiError(httpStatus.CONFLICT, 'Cancelled purchases cannot receive stock')
      if (purchase.status === 'Received') throw new ApiError(httpStatus.CONFLICT, 'This purchase has already been fully received')
      const quantity = roundQuantity(Number(payload.quantity))
      const remaining = roundQuantity(Number(purchase.quantity) - Number(purchase.receivedQuantity || 0))
      if (quantity <= 0 || quantity > remaining + 0.000001) throw new ApiError(httpStatus.BAD_REQUEST, `Receipt quantity cannot exceed the remaining ${remaining} ${purchase.unit}`)
      const receiptId = new mongoose.Types.ObjectId()
      const receivedAt = payload.receivedAt || new Date()
      const stock = await MaterialInventoryService.recordPurchaseReceiptInSession(organizationId, String(purchase.materialId), actorId, {
        quantity,
        unitPriceMinor: Number(purchase.unitPriceMinor),
        propertyId: purchase.propertyId ? String(purchase.propertyId) : undefined,
        flatId: purchase.flatId || undefined,
        occurredAt: receivedAt,
        notes: payload.notes ? `Supplier receipt: ${String(payload.notes).trim()}` : `Supplier purchase ${purchase._id}`,
        sourceId: String(receiptId),
      }, session)
      await MaterialPurchaseReceipt.create([{
        _id: receiptId,
        organizationId,
        purchaseId: purchase._id,
        materialId: purchase.materialId,
        quantity,
        receivedAt,
        ...(payload.notes ? { notes: String(payload.notes).trim() } : {}),
        stockMovementId: stock.movement._id,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        createdBy: actorObjectId(actorId),
      }], { session })
      purchase.receivedQuantity = roundQuantity(Number(purchase.receivedQuantity || 0) + quantity)
      const completed = purchase.receivedQuantity >= Number(purchase.quantity) - 0.000001
      purchase.status = completed ? 'Received' : 'Partially Received'
      purchase.actualDeliveryDate = completed ? receivedAt : null
      purchase.updatedBy = actorObjectId(actorId)
      await purchase.save({ session })
      return { receiptId: String(receiptId), replayed: false }
    })
    const purchase = await MaterialPurchase.findOne({ _id: purchaseId, organizationId }).lean()
    const [data] = await enrichPurchases(organizationId, purchase ? [purchase] : [])
    if (purchase) await MaterialInventoryService.syncLowStockReminder(organizationId, String(purchase.materialId))
    if (!result.replayed) await emit(organizationId, actorId, 'material_purchase', purchaseId, 'material_purchase.received', 'Material purchase received')
    return { data, receiptId: result.receiptId, replayed: result.replayed }
  } catch (error: any) {
    if (error?.code === 11000 && idempotencyKey) {
      const existing = await MaterialPurchaseReceipt.findOne({ organizationId, idempotencyKey }).lean()
      if (existing && String(existing.purchaseId) === purchaseId) {
        const purchase = await MaterialPurchase.findOne({ _id: purchaseId, organizationId }).lean()
        return { data: (await enrichPurchases(organizationId, purchase ? [purchase] : []))[0], receiptId: String(existing._id), replayed: true }
      }
    }
    throw error
  }
}

const recordPurchasePayment = async (organizationId: string, purchaseId: string, actorId: string, payload: any, headerIdempotencyKey?: string) => {
  const idempotencyKey = String(payload.idempotencyKey || headerIdempotencyKey || '').trim() || undefined
  try {
    const result = await requiredTransaction(async (session) => {
      if (idempotencyKey) {
        const existing: any = await FinanceTransaction.findOne({ organizationId, sourceType: 'material_purchase_payment', idempotencyKey }).session(session).lean()
        if (existing) {
          if (String(existing.sourceId) !== purchaseId) throw new ApiError(httpStatus.CONFLICT, 'This idempotency key belongs to another supplier payment')
          return { transactionId: String(existing._id), replayed: true }
        }
      }
      const purchase: any = await MaterialPurchase.findOne({ _id: objectId(purchaseId, 'purchase id'), organizationId }).session(session)
      if (!purchase) throw new ApiError(httpStatus.NOT_FOUND, 'Material purchase not found')
      if (purchase.status === 'Cancelled') throw new ApiError(httpStatus.CONFLICT, 'Cancelled purchases cannot be paid')
      // Serialize supplier-payment mutations on the purchase without storing a paid balance.
      // This makes concurrent distinct payments conflict/retry before outstanding is recalculated.
      await MaterialPurchase.updateOne(
        { _id: purchase._id, organizationId },
        { $inc: { paymentMutationVersion: 1 } },
        { session },
      )
      const [supplier] = await Promise.all([ensureSupplier(organizationId, String(purchase.supplierId), session, false), ensureProperty(organizationId, purchase.propertyId ? String(purchase.propertyId) : undefined, session)])
      const paidMap = await purchasePaymentMap(organizationId, [purchase._id], session)
      const alreadyPaidMinor = paidMap.get(String(purchase._id)) || 0
      const amountMinor = moneyToMinorUnits(Number(payload.amount))
      const outstandingMinor = Math.max(0, Number(purchase.totalMinor) - alreadyPaidMinor)
      if (amountMinor > outstandingMinor) throw new ApiError(httpStatus.BAD_REQUEST, 'Payment cannot exceed the outstanding purchase amount')
      const transaction: any = await FinanceService.createLinkedExpenseTransactionInSession(organizationId, actorId, {
        sourceType: 'material_purchase_payment',
        sourceId: String(purchase._id),
        amountMinor,
        transactionDate: payload.paidAt || new Date(),
        paymentMethod: payload.paymentMethod,
        bankAccountId: payload.bankAccountId,
        category: 'Construction Materials',
        description: `Material purchase payment - ${supplier.name}`,
        reference: payload.reference || purchase.invoiceNumber || '',
        vendorId: String(supplier._id),
        propertyId: purchase.propertyId ? String(purchase.propertyId) : undefined,
        idempotencyKey,
      }, session)
      return { transactionId: String(transaction._id), replayed: false }
    })
    const purchase = await MaterialPurchase.findOne({ _id: purchaseId, organizationId }).lean()
    const [data] = await enrichPurchases(organizationId, purchase ? [purchase] : [])
    if (!result.replayed) await emit(organizationId, actorId, 'material_purchase', purchaseId, 'material_purchase.payment_recorded', 'Supplier payment recorded')
    await syncSupplierPaymentReminder(organizationId, purchaseId)
    return { data, paymentId: result.transactionId, replayed: result.replayed }
  } catch (error: any) {
    if (error?.code === 11000 && idempotencyKey) {
      const existing = await FinanceTransaction.findOne({ organizationId, sourceType: 'material_purchase_payment', idempotencyKey }).lean()
      if (existing && String(existing.sourceId) === purchaseId) {
        const purchase = await MaterialPurchase.findOne({ _id: purchaseId, organizationId }).lean()
        return { data: (await enrichPurchases(organizationId, purchase ? [purchase] : []))[0], paymentId: String(existing._id), replayed: true }
      }
    }
    throw error
  }
}

const voidPurchasePayment = async (organizationId: string, purchaseId: string, paymentId: string, actorId: string, reason: string) => {
  await requiredTransaction(async (session) => {
    const purchase = await MaterialPurchase.findOne({ _id: objectId(purchaseId, 'purchase id'), organizationId }).select('_id').session(session).lean()
    if (!purchase) throw new ApiError(httpStatus.NOT_FOUND, 'Material purchase not found')
    await FinanceService.voidLinkedExpenseTransactionInSession(organizationId, actorId, paymentId, 'material_purchase_payment', purchaseId, reason, session)
    return true
  })
  const purchase = await MaterialPurchase.findOne({ _id: purchaseId, organizationId }).lean()
  await emit(organizationId, actorId, 'material_purchase', purchaseId, 'material_purchase.payment_voided', 'Supplier payment voided')
  await syncSupplierPaymentReminder(organizationId, purchaseId)
  return (await enrichPurchases(organizationId, purchase ? [purchase] : []))[0]
}

const cancelPurchase = async (organizationId: string, purchaseId: string, actorId: string, reason: string) => {
  const result = await requiredTransaction(async (session) => {
    const purchase: any = await MaterialPurchase.findOne({ _id: objectId(purchaseId, 'purchase id'), organizationId }).session(session)
    if (!purchase) throw new ApiError(httpStatus.NOT_FOUND, 'Material purchase not found')
    if (purchase.status === 'Cancelled') return purchase
    if (Number(purchase.receivedQuantity || 0) > 0) throw new ApiError(httpStatus.CONFLICT, 'A purchase with received stock cannot be cancelled. Use inventory adjustment if stock must be corrected.')
    const paidMap = await purchasePaymentMap(organizationId, [purchase._id], session)
    if ((paidMap.get(String(purchase._id)) || 0) > 0) throw new ApiError(httpStatus.CONFLICT, 'Void supplier payments before cancelling this purchase')
    purchase.status = 'Cancelled'
    purchase.notes = [purchase.notes, `Cancelled: ${reason.trim()}`].filter(Boolean).join('\n')
    purchase.updatedBy = actorObjectId(actorId)
    await purchase.save({ session })
    return purchase
  })
  await emit(organizationId, actorId, 'material_purchase', purchaseId, 'material_purchase.cancelled', `Material purchase cancelled: ${reason}`)
  await OperationsQueueService.cancel(organizationId, 'supplier_payment_due', purchaseId)
  return (await enrichPurchases(organizationId, [result.toObject ? result.toObject() : result]))[0]
}

const latestPricesForMaterial = async (organizationId: string, materialId: string) => {
  const material = await ensureMaterial(organizationId, materialId)
  const rows = await MaterialPurchase.find({ organizationId, materialId: material._id, status: { $ne: 'Cancelled' } }).sort({ purchaseDate: -1, createdAt: -1 }).limit(1000).lean()
  const latest = new Map<string, any>()
  for (const row of rows) if (!latest.has(String(row.supplierId))) latest.set(String(row.supplierId), row)
  const supplierIds = [...latest.keys()].map((id) => new mongoose.Types.ObjectId(id))
  const suppliers = await FinanceVendor.find({ organizationId, _id: { $in: supplierIds }, isSupplier: true }).select('_id name status phone').lean()
  const supplierMap = new Map(suppliers.map((row: any) => [String(row._id), row]))
  return {
    material: { _id: material._id, name: material.name, unit: material.unit },
    prices: [...latest.values()].map((row: any) => ({ supplier: supplierMap.get(String(row.supplierId)) || null, unitPriceMinor: row.unitPriceMinor, purchaseDate: row.purchaseDate, purchaseId: row._id })).filter((row) => row.supplier),
  }
}

const propertyCostSummary = async (organizationId: string, query: any) => {
  const match: any = { organizationId, status: { $ne: 'Cancelled' } }
  let property: any = null
  if (query.propertyId) {
    property = await ensureProperty(organizationId, query.propertyId)
    match.propertyId = objectId(query.propertyId, 'property id')
  }
  if (query.startDate || query.endDate) match.purchaseDate = { ...(query.startDate ? { $gte: new Date(query.startDate) } : {}), ...(query.endDate ? { $lte: new Date(query.endDate) } : {}) }
  const rows = await MaterialPurchase.aggregate([
    { $match: match },
    { $group: {
      _id: '$materialId',
      totalCostMinor: { $sum: '$totalMinor' },
      receivedCostRaw: { $sum: { $multiply: ['$receivedQuantity', '$unitPriceMinor'] } },
      orderedQuantity: { $sum: '$quantity' },
      receivedQuantity: { $sum: '$receivedQuantity' },
      purchaseCount: { $sum: 1 },
    } },
    { $sort: { totalCostMinor: -1 } },
  ])
  const materials = rows.length ? await Material.find({ organizationId, _id: { $in: rows.map((row: any) => row._id) } }).select('_id name unit category').lean() : []
  const materialMap = new Map(materials.map((row: any) => [String(row._id), row]))
  const data = rows.map((row: any) => ({
    material: materialMap.get(String(row._id)) || null,
    totalCostMinor: Number(row.totalCostMinor || 0),
    receivedCostMinor: Math.round(Number(row.receivedCostRaw || 0)),
    orderedQuantity: roundQuantity(Number(row.orderedQuantity || 0)),
    receivedQuantity: roundQuantity(Number(row.receivedQuantity || 0)),
    purchaseCount: Number(row.purchaseCount || 0),
  }))
  return { property, totalCostMinor: data.reduce((sum, row) => sum + row.totalCostMinor, 0), receivedCostMinor: data.reduce((sum, row) => sum + row.receivedCostMinor, 0), materials: data }
}

export const SupplierManagementService = {
  listSuppliers,
  listAvailableVendors,
  listMaterialOptions,
  createSupplier,
  updateSupplier,
  getSupplierProfile,
  listPurchases,
  createPurchase,
  updatePurchase,
  receivePurchase,
  recordPurchasePayment,
  voidPurchasePayment,
  cancelPurchase,
  syncSupplierPaymentReminder,
  latestPricesForMaterial,
  propertyCostSummary,
}
