import type mongoose from 'mongoose'

export interface IFinanceBillingProfile {
  organizationId: string
  legalName: string
  email?: string
  phone?: string
  address?: string
  taxId?: string
  createdBy: mongoose.Types.ObjectId | string
  updatedBy?: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}

export interface IFinanceIssuerSnapshot {
  legalName: string
  email?: string
  phone?: string
  address?: string
  taxId?: string
}
