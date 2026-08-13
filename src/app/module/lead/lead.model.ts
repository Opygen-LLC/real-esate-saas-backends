import { Schema, model } from 'mongoose'
import { ILead, LeadModel } from './lead.interface'

const leadSchema = new Schema<ILead, LeadModel>(
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
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    source: {
      type: String,
      enum: [
        'Website',
        'WhatsApp',
        'Facebook',
        'Instagram',
        'Google',
        'Referral',
        'WalkIn',
        'Portal',
        'Phone',
        'Email',
        'Ad',
        'Other',
      ],
      default: 'Website',
    },
    budgetMin: {
      type: Number,
      default: 0,
    },
    budgetMax: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      enum: ['BDT'],
      default: 'BDT',
    },
    propertyInterest: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Property',
      },
    ],
    locationPreference: {
      type: String,
      default: '',
    },
    propertyType: {
      type: String,
      default: 'Apartment',
    },
    bedrooms: {
      type: Number,
      default: 1,
    },
    leadStatus: {
      type: String,
      enum: [
        'New',
        'Contacted',
        'Qualified',
        'ViewingScheduled',
        'ViewingCompleted',
        'OfferMade',
        'Negotiation',
        'Won',
        'Lost',
      ],
      default: 'New',
      required: true,
      index: true,
    },
    assignedAgent: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    contactId: {
      type: Schema.Types.ObjectId,
      ref: 'Contact',
    },
    lastContact: {
      type: Date,
      default: Date.now,
    },
    nextFollowUp: {
      type: Date,
    },
    notes: {
      type: String,
      default: '',
    },
    lostReason: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
)

leadSchema.index({ organizationId: 1, leadStatus: 1 })
leadSchema.index({ organizationId: 1, assignedAgent: 1 })
leadSchema.index({ organizationId: 1, _id: 1 })

export const Lead = model<ILead, LeadModel>('Lead', leadSchema)
