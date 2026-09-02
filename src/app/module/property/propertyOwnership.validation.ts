import { z } from 'zod'

const objectId = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Invalid id')
const optionalObjectId = z.union([objectId, z.literal(''), z.null()]).optional()
const money = z.coerce.number().finite().positive().max(1_000_000_000_000)
const optionalMoney = z.coerce.number().finite().min(0).max(1_000_000_000_000).optional()
const percent = z.coerce.number().finite().min(0).max(100)
const positivePercent = z.coerce.number().finite().gt(0).max(100)
const notes = z.string().trim().max(3000).optional()
const paymentMethod = z.enum(['cash', 'bank', 'bkash', 'nagad', 'card', 'cheque', 'other'])
const transactionDate = z.coerce.date()

const jointVenture = z.object({
  landOwnerName: z.string().trim().max(160).optional(),
  developerName: z.string().trim().max(160).optional(),
  landOwnerSharePercent: percent.optional(),
  developerSharePercent: percent.optional(),
  landownerUnitAllocation: z.coerce.number().int().min(0).max(100000).optional(),
  developerUnitAllocation: z.coerce.number().int().min(0).max(100000).optional(),
  availableUnits: z.coerce.number().int().min(0).max(100000).optional(),
}).optional()

const profileBody = z.object({
  ownershipModel: z.enum(['AGENCY_OWNED', 'CLIENT_OWNED', 'DEVELOPER_OWNED', 'JOINT_VENTURE', 'MULTIPLE_OWNERS']),
  jointVenture,
  notes,
}).superRefine((value, ctx) => {
  if (value.ownershipModel !== 'JOINT_VENTURE') return
  const jv = value.jointVenture
  if (!jv?.landOwnerName?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['jointVenture', 'landOwnerName'], message: 'Land owner is required for a joint venture' })
  if (!jv?.developerName?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['jointVenture', 'developerName'], message: 'Developer is required for a joint venture' })
  if (jv?.landOwnerSharePercent === undefined || jv?.developerSharePercent === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['jointVenture'], message: 'Both land owner and developer share percentages are required' })
  } else if (Math.abs(jv.landOwnerSharePercent + jv.developerSharePercent - 100) > 0.000001) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['jointVenture'], message: 'Land owner and developer shares must total 100%' })
  }
  const ownerUnits = jv?.landownerUnitAllocation ?? 0
  const developerUnits = jv?.developerUnitAllocation ?? 0
  const available = jv?.availableUnits ?? 0
  if (ownerUnits || developerUnits || available) {
    if (available > ownerUnits + developerUnits) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['jointVenture', 'availableUnits'], message: 'Available units cannot exceed total JV unit allocation' })
    }
  }
})

const ownerBody = z.object({
  ownerType: z.enum(['INDIVIDUAL', 'COMPANY']),
  ownerId: optionalObjectId,
  ownerName: z.string().trim().min(2).max(160),
  ownershipPercentage: positivePercent,
  investedAmount: optionalMoney,
  acquisitionCost: optionalMoney,
  notes,
})

const ownerUpdateBody = ownerBody.partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one owner field to update')

const investorBody = z.object({
  investorType: z.enum(['INDIVIDUAL', 'COMPANY']),
  investorId: optionalObjectId,
  investorName: z.string().trim().min(2).max(160),
  ownershipPercentage: percent.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  notes,
})

const investorUpdateBody = investorBody.partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one investor field to update')

const movementCommon = {
  amount: money,
  transactionDate,
  paymentMethod,
  bankAccountId: optionalObjectId,
  reference: z.string().trim().max(200).optional(),
  notes,
}

export const PropertyOwnershipValidation = {
  propertyId: z.object({ params: z.object({ id: objectId }) }),
  profile: z.object({ params: z.object({ id: objectId }), body: profileBody }),
  createOwner: z.object({ params: z.object({ id: objectId }), body: ownerBody }),
  updateOwner: z.object({ params: z.object({ id: objectId, ownerId: objectId }), body: ownerUpdateBody }),
  deleteOwner: z.object({ params: z.object({ id: objectId, ownerId: objectId }) }),
  createInvestor: z.object({ params: z.object({ id: objectId }), body: investorBody }),
  updateInvestor: z.object({ params: z.object({ id: objectId, investorId: objectId }), body: investorUpdateBody }),
  createInvestment: z.object({ params: z.object({ id: objectId, investorId: objectId }), body: z.object({ investmentType: z.enum(['INITIAL', 'ADDITIONAL']), ...movementCommon }) }),
  createDistribution: z.object({ params: z.object({ id: objectId, investorId: objectId }), body: z.object({ distributionType: z.enum(['CAPITAL_RETURN', 'PROFIT_DISTRIBUTION']), ...movementCommon }) }),
  reverseInvestment: z.object({ params: z.object({ id: objectId, investorId: objectId, investmentId: objectId }), body: z.object({ reason: z.string().trim().min(10).max(500) }) }),
  reverseDistribution: z.object({ params: z.object({ id: objectId, investorId: objectId, distributionId: objectId }), body: z.object({ reason: z.string().trim().min(10).max(500) }) }),
  activity: z.object({ params: z.object({ id: objectId }), query: z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }) }),
}
