export interface ILeadAddonDefinition {
  name: string
  slug: string
  leadCapacity: number
  priceMonthly: number
  currency: 'BDT'
  eligiblePlans: string[]
  displayOrder: number
  isActive: boolean
  archivedAt?: Date | null
  archivedBy?: string | null
  createdBy?: string
  updatedBy?: string
  createdAt?: Date
  updatedAt?: Date
}
