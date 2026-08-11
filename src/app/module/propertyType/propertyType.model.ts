import { Schema, model } from 'mongoose'
import { IPropertyType, PropertyTypeModel } from './propertyType.interface'

const propertyTypeSchema = new Schema<IPropertyType, PropertyTypeModel>(
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
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    icon: {
      type: String,
      default: 'Building',
    },
    description: {
      type: String,
      default: '',
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

propertyTypeSchema.index({ organizationId: 1, slug: 1 }, { unique: true })

export const PropertyType = model<IPropertyType, PropertyTypeModel>(
  'PropertyType',
  propertyTypeSchema
)
