import { Schema, model } from 'mongoose'
import { IActivity, ActivityModel } from './activity.interface'

const activitySchema = new Schema<IActivity, ActivityModel>(
  {
    organizationId: {
      type: String,
      required: true,
      index: true,
    },
    leadId: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      index: true,
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
    },
    contactId: {
      type: Schema.Types.ObjectId,
      ref: 'Contact',
      index: true,
    },
    type: {
      type: String,
      enum: [
        'call',
        'email',
        'whatsapp',
        'meeting',
        'note',
        'status_change',
        'viewing',
        'offer',
        'system',
      ],
      default: 'note',
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      default: '',
    },
    agentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
)

activitySchema.index({ organizationId: 1, leadId: 1, createdAt: -1 })
activitySchema.index({ organizationId: 1, contactId: 1, createdAt: -1 }, { name: 'activity_tenant_contact_created' })
activitySchema.index(
  { organizationId: 1, 'metadata.migrationKey': 1 },
  {
    name: 'activity_tenant_migration_key_unique',
    unique: true,
    partialFilterExpression: { 'metadata.migrationKey': { $type: 'string' } },
  },
)

export const Activity = model<IActivity, ActivityModel>('Activity', activitySchema)
