import { Schema, model } from 'mongoose'
import { IContact, ContactModel } from './contact.interface'
import { LEAD_STATUS_VALUES } from '../lead/leadStatus.contract'
import {
  CONTACT_RELATIONSHIP_STATE,
  CONTACT_RELATIONSHIP_STATE_VALUES,
} from './contactRelationship.contract'

const contactSchema = new Schema<IContact, ContactModel>(
  {
    organizationId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    normalizedEmail: { type: String, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    normalizedPhone: { type: String, trim: true },
    type: {
      type: String,
      enum: ['Buyer', 'Seller', 'Tenant', 'Landlord', 'Investor', 'Partner', 'Other'],
      default: 'Buyer',
    },
    address: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    country: { type: String, default: 'Bangladesh' },
    company: { type: String, default: '' },
    notes: { type: String, default: '' },
    tags: { type: [String], default: [] },

    relationshipState: {
      type: String,
      enum: CONTACT_RELATIONSHIP_STATE_VALUES,
      default: CONTACT_RELATIONSHIP_STATE.ACTIVE,
      required: true,
      index: true,
    },
    sourceLeadId: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    source: {
      type: String,
      enum: ['Website','WhatsApp','Facebook','Instagram','Google','Referral','WalkIn','Portal','Phone','Email','Ad','Other'],
    },
    propertyInterest: [{ type: Schema.Types.ObjectId, ref: 'Property' }],
    followUpDate: { type: Date, index: true },
    convertedAt: { type: Date, index: true },
    convertedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    statusAtConversion: { type: String, enum: LEAD_STATUS_VALUES },
  },
  { timestamps: true }
)

contactSchema.index({ organizationId: 1, relationshipState: 1, updatedAt: -1 }, { name: 'contact_tenant_relationship_updated' })
contactSchema.index({ organizationId: 1, relationshipState: 1, updatedAt: -1, _id: -1 }, { name: 'contact_tenant_relationship_updated_stable' })
contactSchema.index({ organizationId: 1, relationshipState: 1, assignedTo: 1, updatedAt: -1, _id: -1 }, { name: 'contact_tenant_relationship_assignee_updated_stable' })
contactSchema.index({ organizationId: 1, name: 1 })
contactSchema.index({ organizationId: 1, phone: 1 })
contactSchema.index({ organizationId: 1, normalizedPhone: 1 }, { name: 'contact_tenant_normalized_phone' })
contactSchema.index({ organizationId: 1, normalizedEmail: 1 }, { name: 'contact_tenant_normalized_email' })
contactSchema.index({ organizationId: 1, assignedTo: 1, updatedAt: -1 }, { name: 'contact_tenant_assignee_updated' })
contactSchema.index({ organizationId: 1, followUpDate: 1, assignedTo: 1 }, { name: 'contact_tenant_followup_assignee' })
contactSchema.index({ organizationId: 1, source: 1 }, { name: 'contact_tenant_source' })
contactSchema.index(
  { organizationId: 1, relationshipState: 1, assignedTo: 1, followUpDate: 1 },
  { name: 'contact_tenant_relationship_assignee_followup' },
)
contactSchema.index(
  { organizationId: 1, relationshipState: 1, source: 1, updatedAt: -1 },
  { name: 'contact_tenant_relationship_source_updated' },
)
contactSchema.index(
  { organizationId: 1, relationshipState: 1, assignedTo: 1, convertedAt: -1 },
  { name: 'contact_tenant_relationship_assignee_converted' },
)
contactSchema.index(
  { organizationId: 1, relationshipState: 1, statusAtConversion: 1, convertedAt: -1 },
  { name: 'contact_tenant_relationship_status_converted' },
)
contactSchema.index(
  { organizationId: 1, sourceLeadId: 1 },
  {
    name: 'contact_tenant_source_lead_unique',
    unique: true,
    partialFilterExpression: { sourceLeadId: { $type: 'objectId' } },
  },
)

export const Contact = model<IContact, ContactModel>('Contact', contactSchema)
