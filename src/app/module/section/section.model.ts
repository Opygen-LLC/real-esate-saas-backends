import mongoose, { Schema, Model } from 'mongoose'

export interface ISection {
  organizationId: string
  name: string
  type: 'PropertyGrid' | 'PropertySearch' | 'AgentList' | 'Testimonials' | 'ContactForm' | 'CustomBanner'
  title: string
  subtitle?: string
  limit?: number
  order?: number
  status: boolean
  content?: Record<string, unknown>
}

const sectionSchema = new Schema<ISection>(
  {
    organizationId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ['PropertyGrid', 'PropertySearch', 'AgentList', 'Testimonials', 'ContactForm', 'CustomBanner'],
      default: 'PropertyGrid',
    },
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    limit: { type: Number, default: 6 },
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
    content: { type: Object, default: {} },
  },
  { timestamps: true }
)
sectionSchema.index({ organizationId: 1, _id: 1 })

export const Section: Model<ISection> = mongoose.model<ISection>('Section', sectionSchema)
