import mongoose, { Schema, Model } from 'mongoose'

export interface IBanner {
  organizationId: string
  title: string
  subtitle?: string
  image: string
  link?: string
  btnText?: string
  status: boolean
  createdAt?: Date
  updatedAt?: Date
}

const bannerSchema = new Schema<IBanner>(
  {
    organizationId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    image: { type: String, required: true },
    link: { type: String, default: '' },
    btnText: { type: String, default: 'View Properties' },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
)
bannerSchema.index({ organizationId: 1, _id: 1 })

export const Banner: Model<IBanner> = mongoose.model<IBanner>('Banner', bannerSchema)
