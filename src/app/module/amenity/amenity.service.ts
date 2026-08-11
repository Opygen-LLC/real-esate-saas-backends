import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IAmenity } from './amenity.interface'
import { Amenity } from './amenity.model'

const DEFAULT_AMENITIES = [
  { name: 'Swimming Pool', category: 'wellness', icon: 'Waves' },
  { name: 'Fitness Gym & Yoga Studio', category: 'wellness', icon: 'Dumbbell' },
  { name: 'Covered Garage Parking', category: 'facilities', icon: 'Car' },
  { name: 'Private Landscaped Garden', category: 'outdoor', icon: 'Trees' },
  { name: '24/7 Security & CCTV', category: 'security', icon: 'ShieldCheck' },
  { name: 'Spacious Balcony / Terrace', category: 'outdoor', icon: 'Sun' },
  { name: 'Central Air Conditioning', category: 'features', icon: 'Wind' },
  { name: 'High-Speed Passenger Elevator', category: 'facilities', icon: 'ArrowUpDown' },
  { name: 'Smart Home Automation', category: 'features', icon: 'Cpu' },
  { name: 'High-Speed Fiber Internet', category: 'facilities', icon: 'Wifi' },
  { name: 'Panoramic Ocean / Skyline View', category: 'outdoor', icon: 'Eye' },
  { name: 'Pet Friendly Community', category: 'features', icon: 'Heart' },
  { name: 'Solar Panels & Energy Star', category: 'eco', icon: 'SunMedium' },
  { name: 'Dedicated Co-Working Lounge', category: 'facilities', icon: 'Laptop' },
]

const getAllAmenities = async (organizationId: string): Promise<IAmenity[]> => {
  let amenities = await Amenity.find({ organizationId, isActive: true }).sort({ category: 1, name: 1 })

  if (!amenities || amenities.length === 0) {
    const seedData = DEFAULT_AMENITIES.map((a) => ({
      ...a,
      category: a.category as any,
      organizationId,
      isDefault: true,
      isActive: true,
    }))
    await Amenity.insertMany(seedData)
    amenities = await Amenity.find({ organizationId, isActive: true }).sort({ category: 1, name: 1 })
  }

  return amenities
}

const createAmenity = async (
  organizationId: string,
  payload: { name: string; category?: string; icon?: string }
): Promise<IAmenity> => {
  const existing = await Amenity.findOne({ organizationId, name: payload.name.trim() })
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Amenity already exists')
  }

  const result = await Amenity.create({
    ...payload,
    category: (payload.category as any) || 'features',
    organizationId,
    isDefault: false,
    isActive: true,
  })

  return result
}

const deleteAmenity = async (organizationId: string, id: string): Promise<IAmenity | null> => {
  const result = await Amenity.findOneAndDelete({ _id: id, organizationId })
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Amenity not found')
  }
  return result
}

export const AmenityService = {
  getAllAmenities,
  createAmenity,
  deleteAmenity,
}
