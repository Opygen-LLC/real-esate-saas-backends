import { Schema, model, models, type Model } from 'mongoose'

export interface ILeadImportSessionDocument {
  sessionId: string
  organizationId: string
  userId: string
  payload: any
  createdAt: Date
  expiresAt: Date
}

const leadImportSessionSchema = new Schema<ILeadImportSessionDocument>({
  sessionId: { type: String, required: true, trim: true },
  organizationId: { type: String, required: true, trim: true },
  userId: { type: String, required: true, trim: true },
  payload: { type: Schema.Types.Mixed, required: true },
  createdAt: { type: Date, required: true, default: Date.now },
  expiresAt: { type: Date, required: true },
}, {
  collection: 'lead_import_sessions',
  versionKey: false,
})

// Production connects with autoIndex disabled, so migrateCrmPerformanceHardening
// creates these explicitly. Keeping schema indexes also protects development/test.
leadImportSessionSchema.index(
  { organizationId: 1, userId: 1, sessionId: 1 },
  { name: 'lead_import_session_owner_unique', unique: true },
)
leadImportSessionSchema.index(
  { expiresAt: 1 },
  { name: 'lead_import_session_expiry_ttl', expireAfterSeconds: 0 },
)

export const LeadImportSession = (models.LeadImportSession as Model<ILeadImportSessionDocument> | undefined)
  || model<ILeadImportSessionDocument>('LeadImportSession', leadImportSessionSchema)
