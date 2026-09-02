export const INQUIRY_PURPOSES = [
  'BUY_PROPERTY',
  'LAND_PLOT',
  'RENT_PROPERTY',
  'SELL_PROPERTY',
  'SCHEDULE_VIEWING',
  'BUILDING_DESIGN',
  'CONSTRUCTION',
] as const

export type InquiryPurpose = (typeof INQUIRY_PURPOSES)[number]

export const INQUIRY_PROJECT_TYPES = [
  'RESIDENTIAL_BUILDING',
  'APARTMENT_BUILDING',
  'COMMERCIAL_BUILDING',
  'OFFICE',
  'HOTEL_RESORT',
  'MIXED_USE',
  'INDUSTRIAL',
  'OTHER',
] as const
export type InquiryProjectType = (typeof INQUIRY_PROJECT_TYPES)[number]

export const DESIGN_REQUIREMENTS = [
  'ARCHITECTURAL_DESIGN',
  'STRUCTURAL_DESIGN',
  'INTERIOR_DESIGN',
  'MEP_DESIGN',
  'COMPLETE_BUILDING_DESIGN',
] as const
export type DesignRequirement = (typeof DESIGN_REQUIREMENTS)[number]

export const CONSTRUCTION_TYPES = [
  'NEW_CONSTRUCTION',
  'RENOVATION',
  'EXTENSION',
  'STRUCTURAL_WORK',
  'INTERIOR_FIT_OUT',
  'TURNKEY_CONSTRUCTION',
] as const
export type ConstructionType = (typeof CONSTRUCTION_TYPES)[number]

export const CONSTRUCTION_STAGES = [
  'PLANNING',
  'DESIGN',
  'FOUNDATION',
  'STRUCTURE',
  'MASONRY',
  'FINISHING',
  'RENOVATION',
  'OTHER',
] as const
export type ConstructionStage = (typeof CONSTRUCTION_STAGES)[number]

export interface InquiryProjectDetails {
  projectType?: InquiryProjectType
  landSize?: string
  numberOfFloors?: number
  approximateBuiltUpArea?: string
  designRequirement?: DesignRequirement
  constructionType?: ConstructionType
  constructionStage?: ConstructionStage
  expectedStartDate?: string
  budgetRange?: string
  location?: string
}

export const inquiryPurposeLabel = (value?: string) => ({
  BUY_PROPERTY: 'Buy Property',
  LAND_PLOT: 'Land / Plot',
  RENT_PROPERTY: 'Rent Property',
  SELL_PROPERTY: 'Sell Property',
  SCHEDULE_VIEWING: 'Schedule Viewing',
  BUILDING_DESIGN: 'Building Design',
  CONSTRUCTION: 'Construction',
}[String(value || '')] || 'Website')
