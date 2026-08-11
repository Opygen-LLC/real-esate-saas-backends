import { Schema, model } from 'mongoose'
import { IAmenity, AmenityModel } from './amenity.interface'

const amenitySchema = new Schema<IAmenity, AmenityModel>(
  {
    organizationId: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ['features', 'facilities', 'security', 'wellness', 'outdoor', 'eco'],
      default: 'features',
    },
    icon: {
      type: String,
      default: 'CheckCircle',
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
)

amenitySchema.index({ organizationId: 1, name: 1 }, { unique: true })

export const Amenity = model<IAmenity, AmenityModel>('Amenity', amenitySchema)
