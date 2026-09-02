import { Schema, model } from 'mongoose'
import type {
  IPropertyInvestment,
  IPropertyInvestor,
  IPropertyInvestorDistribution,
  IPropertyOwnership,
  IPropertyOwnershipProfile,
} from './propertyOwnership.interface'

const actorRef = { type: Schema.Types.ObjectId, ref: 'User', required: true } as const
const optionalActorRef = { type: Schema.Types.ObjectId, ref: 'User', default: null } as const

const jointVentureSchema = new Schema({
  landOwnerName: { type: String, trim: true, maxlength: 160, default: '' },
  developerName: { type: String, trim: true, maxlength: 160, default: '' },
  landOwnerSharePercent: { type: Number, min: 0, max: 100 },
  developerSharePercent: { type: Number, min: 0, max: 100 },
  landownerUnitAllocation: { type: Number, min: 0, max: 100000 },
  developerUnitAllocation: { type: Number, min: 0, max: 100000 },
  availableUnits: { type: Number, min: 0, max: 100000 },
}, { _id: false })

const propertyOwnershipProfileSchema = new Schema<IPropertyOwnershipProfile>({
  organizationId: { type: String, required: true, trim: true, index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
  ownershipModel: { type: String, enum: ['AGENCY_OWNED', 'CLIENT_OWNED', 'DEVELOPER_OWNED', 'JOINT_VENTURE', 'MULTIPLE_OWNERS'], required: true, default: 'CLIENT_OWNED' },
  jointVenture: { type: jointVentureSchema, default: undefined },
  notes: { type: String, trim: true, maxlength: 3000, default: '' },
  createdBy: actorRef,
  updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
propertyOwnershipProfileSchema.index({ organizationId: 1, propertyId: 1 }, { unique: true, name: 'property_ownership_profile_tenant_property_unique' })

const propertyOwnershipSchema = new Schema<IPropertyOwnership>({
  organizationId: { type: String, required: true, trim: true, index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
  ownerType: { type: String, enum: ['INDIVIDUAL', 'COMPANY'], required: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'Contact', default: null },
  ownerName: { type: String, required: true, trim: true, maxlength: 160 },
  identityKey: { type: String, required: true, trim: true, lowercase: true, maxlength: 240 },
  ownershipPercentage: { type: Number, required: true, min: 0.000001, max: 100 },
  investedAmount: { type: Number, min: 0 },
  acquisitionCost: { type: Number, min: 0 },
  notes: { type: String, trim: true, maxlength: 3000, default: '' },
  createdBy: actorRef,
  updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
propertyOwnershipSchema.index({ organizationId: 1, propertyId: 1, identityKey: 1 }, { unique: true, name: 'property_owner_tenant_property_identity_unique' })
propertyOwnershipSchema.index({ organizationId: 1, propertyId: 1, createdAt: 1 }, { name: 'property_owner_tenant_property_created' })

const propertyInvestorSchema = new Schema<IPropertyInvestor>({
  organizationId: { type: String, required: true, trim: true, index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
  investorType: { type: String, enum: ['INDIVIDUAL', 'COMPANY'], required: true },
  investorId: { type: Schema.Types.ObjectId, ref: 'Contact', default: null },
  investorName: { type: String, required: true, trim: true, maxlength: 160 },
  identityKey: { type: String, required: true, trim: true, lowercase: true, maxlength: 240 },
  ownershipPercentage: { type: Number, min: 0, max: 100 },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
  notes: { type: String, trim: true, maxlength: 3000, default: '' },
  createdBy: actorRef,
  updatedBy: optionalActorRef,
}, { timestamps: true, versionKey: false })
propertyInvestorSchema.index({ organizationId: 1, propertyId: 1, identityKey: 1 }, { unique: true, name: 'property_investor_tenant_property_identity_unique' })
propertyInvestorSchema.index({ organizationId: 1, propertyId: 1, status: 1, createdAt: 1 }, { name: 'property_investor_tenant_property_status_created' })

const movementFields = {
  organizationId: { type: String, required: true, trim: true, index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
  investorId: { type: Schema.Types.ObjectId, ref: 'PropertyInvestor', required: true, index: true },
  amount: { type: Number, required: true, min: 0.01 },
  currency: { type: String, enum: ['BDT'], default: 'BDT' },
  transactionDate: { type: Date, required: true, index: true },
  paymentMethod: { type: String, enum: ['cash', 'bank', 'bkash', 'nagad', 'card', 'cheque', 'other'], required: true },
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'FinanceBankAccount', default: null },
  reference: { type: String, trim: true, maxlength: 200, default: '' },
  notes: { type: String, trim: true, maxlength: 3000, default: '' },
  financeTransactionId: { type: Schema.Types.ObjectId, ref: 'FinanceTransaction', required: true, unique: true },
  accountingJournalId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', default: null },
  status: { type: String, enum: ['POSTED', 'REVERSED'], default: 'POSTED', index: true },
  reversedAt: { type: Date, default: null },
  reversedBy: optionalActorRef,
  reversalReason: { type: String, trim: true, maxlength: 500, default: '' },
  reversalJournalId: { type: Schema.Types.ObjectId, ref: 'FinanceJournalEntry', default: null },
  createdBy: actorRef,
} as const

const propertyInvestmentSchema = new Schema<IPropertyInvestment>({
  ...movementFields,
  investmentType: { type: String, enum: ['INITIAL', 'ADDITIONAL'], required: true },
}, { timestamps: true, versionKey: false })
propertyInvestmentSchema.index({ organizationId: 1, propertyId: 1, investorId: 1, transactionDate: -1 }, { name: 'property_investment_tenant_property_investor_date' })

const propertyInvestorDistributionSchema = new Schema<IPropertyInvestorDistribution>({
  ...movementFields,
  distributionType: { type: String, enum: ['CAPITAL_RETURN', 'PROFIT_DISTRIBUTION'], required: true },
}, { timestamps: true, versionKey: false })
propertyInvestorDistributionSchema.index({ organizationId: 1, propertyId: 1, investorId: 1, transactionDate: -1 }, { name: 'property_distribution_tenant_property_investor_date' })

export const PropertyOwnershipProfile = model<IPropertyOwnershipProfile>('PropertyOwnershipProfile', propertyOwnershipProfileSchema)
export const PropertyOwnership = model<IPropertyOwnership>('PropertyOwnership', propertyOwnershipSchema)
export const PropertyInvestor = model<IPropertyInvestor>('PropertyInvestor', propertyInvestorSchema)
export const PropertyInvestment = model<IPropertyInvestment>('PropertyInvestment', propertyInvestmentSchema)
export const PropertyInvestorDistribution = model<IPropertyInvestorDistribution>('PropertyInvestorDistribution', propertyInvestorDistributionSchema)
