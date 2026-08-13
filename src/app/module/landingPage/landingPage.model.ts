import mongoose, { Schema, Model } from 'mongoose'

export interface ILandingPage {
  organizationId: string
  title: string
  slug: string
  content?: string
  metaTitle?: string
  metaDescription?: string
  status: boolean
}

const landingPageSchema = new Schema<ILandingPage>(
  {
    organizationId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    slug: { type: String, required: true },
    content: { type: String, default: '' },
    metaTitle: { type: String, default: '' },
    metaDescription: { type: String, default: '' },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
)

landingPageSchema.index({ organizationId: 1, slug: 1 }, { unique: true })
landingPageSchema.index({ organizationId: 1, _id: 1 })

export const LandingPage: Model<ILandingPage> = mongoose.model<ILandingPage>(
  'LandingPage',
  landingPageSchema
)
