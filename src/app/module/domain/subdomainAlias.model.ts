import { Schema, model } from 'mongoose'

const subdomainAliasSchema = new Schema({
  alias: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  organizationId: { type: String, required: true, index: true },
  canonicalSubdomain: { type: String, required: true, lowercase: true, trim: true },
}, { timestamps: true })

export const SubdomainAlias = model('SubdomainAlias', subdomainAliasSchema)
