import mongoose from 'mongoose'
import type { FinancePaymentMethod } from '../finance/finance.interface'

export type PropertyOwnershipModel = 'AGENCY_OWNED' | 'CLIENT_OWNED' | 'DEVELOPER_OWNED' | 'JOINT_VENTURE' | 'MULTIPLE_OWNERS'
export type PropertyPartyType = 'INDIVIDUAL' | 'COMPANY'
export type PropertyInvestorStatus = 'ACTIVE' | 'INACTIVE'
export type PropertyInvestmentType = 'INITIAL' | 'ADDITIONAL'
export type PropertyDistributionType = 'CAPITAL_RETURN' | 'PROFIT_DISTRIBUTION'
export type PropertyInvestorMovementStatus = 'POSTED' | 'REVERSED'

export interface IPropertyJointVenture {
  landOwnerName?: string
  developerName?: string
  landOwnerSharePercent?: number
  developerSharePercent?: number
  landownerUnitAllocation?: number
  developerUnitAllocation?: number
  availableUnits?: number
}

export interface IPropertyOwnershipProfile {
  organizationId: string
  propertyId: mongoose.Types.ObjectId | string
  ownershipModel: PropertyOwnershipModel
  jointVenture?: IPropertyJointVenture
  notes?: string
  createdBy: mongoose.Types.ObjectId | string
  updatedBy?: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}

export interface IPropertyOwnership {
  organizationId: string
  propertyId: mongoose.Types.ObjectId | string
  ownerType: PropertyPartyType
  ownerId?: mongoose.Types.ObjectId | string | null
  ownerName: string
  identityKey: string
  ownershipPercentage: number
  investedAmount?: number
  acquisitionCost?: number
  notes?: string
  createdBy: mongoose.Types.ObjectId | string
  updatedBy?: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}

export interface IPropertyInvestor {
  organizationId: string
  propertyId: mongoose.Types.ObjectId | string
  investorType: PropertyPartyType
  investorId?: mongoose.Types.ObjectId | string | null
  investorName: string
  identityKey: string
  ownershipPercentage?: number
  status: PropertyInvestorStatus
  notes?: string
  createdBy: mongoose.Types.ObjectId | string
  updatedBy?: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}

export interface IPropertyInvestment {
  organizationId: string
  propertyId: mongoose.Types.ObjectId | string
  investorId: mongoose.Types.ObjectId | string
  investmentType: PropertyInvestmentType
  amount: number
  currency: 'BDT'
  transactionDate: Date
  paymentMethod: FinancePaymentMethod
  bankAccountId?: mongoose.Types.ObjectId | string | null
  reference?: string
  notes?: string
  financeTransactionId: mongoose.Types.ObjectId | string
  accountingJournalId?: mongoose.Types.ObjectId | string | null
  status: PropertyInvestorMovementStatus
  reversedAt?: Date | null
  reversedBy?: mongoose.Types.ObjectId | string | null
  reversalReason?: string
  reversalJournalId?: mongoose.Types.ObjectId | string | null
  createdBy: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}

export interface IPropertyInvestorDistribution {
  organizationId: string
  propertyId: mongoose.Types.ObjectId | string
  investorId: mongoose.Types.ObjectId | string
  distributionType: PropertyDistributionType
  amount: number
  currency: 'BDT'
  transactionDate: Date
  paymentMethod: FinancePaymentMethod
  bankAccountId?: mongoose.Types.ObjectId | string | null
  reference?: string
  notes?: string
  financeTransactionId: mongoose.Types.ObjectId | string
  accountingJournalId?: mongoose.Types.ObjectId | string | null
  status: PropertyInvestorMovementStatus
  reversedAt?: Date | null
  reversedBy?: mongoose.Types.ObjectId | string | null
  reversalReason?: string
  reversalJournalId?: mongoose.Types.ObjectId | string | null
  createdBy: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}
