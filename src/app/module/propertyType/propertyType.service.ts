import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IPropertyType } from './propertyType.interface'
import { PropertyType } from './propertyType.model'

const DEFAULT_TYPES = [
  { name: 'Apartment', slug: 'apartment', icon: 'Building' },
  { name: 'Single Family House', slug: 'house', icon: 'Home' },
  { name: 'Luxury Villa', slug: 'villa', icon: 'Castle' },
  { name: 'Condominium', slug: 'condo', icon: 'Building2' },
  { name: 'Townhouse', slug: 'townhouse', icon: 'Home' },
  { name: 'Land & Plots', slug: 'land', icon: 'Trees' },
  { name: 'Commercial Building', slug: 'commercial', icon: 'Store' },
  { name: 'Office Space', slug: 'office', icon: 'Briefcase' },
  { name: 'Warehouse / Industrial', slug: 'warehouse', icon: 'Warehouse' },
  { name: 'New Development', slug: 'development', icon: 'HardHat' },
]

const getAllPropertyTypes = async (organizationId: string): Promise<IPropertyType[]> => {
  let types = await PropertyType.find({ organizationId, isActive: true }).sort({ name: 1 })

  if (!types || types.length === 0) {
    const seedData = DEFAULT_TYPES.map((t) => ({
      ...t,
      organizationId,
      isDefault: true,
      isActive: true,
    }))
    await PropertyType.insertMany(seedData)
    types = await PropertyType.find({ organizationId, isActive: true }).sort({ name: 1 })
  }

  return types
}

const createPropertyType = async (
  organizationId: string,
  payload: { name: string; description?: string; icon?: string }
): Promise<IPropertyType> => {
  const slug = payload.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')

  const existing = await PropertyType.findOne({ organizationId, slug })
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Property type already exists')
  }

  const result = await PropertyType.create({
    ...payload,
    slug,
    organizationId,
    isDefault: false,
    isActive: true,
  })

  return result
}

const deletePropertyType = async (organizationId: string, id: string): Promise<IPropertyType | null> => {
  const result = await PropertyType.findOneAndDelete({ _id: id, organizationId })
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Property type not found')
  }
  return result
}

export const PropertyTypeService = {
  getAllPropertyTypes,
  createPropertyType,
  deletePropertyType,
}
