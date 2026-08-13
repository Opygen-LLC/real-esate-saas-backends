import mongoose from 'mongoose'
import config from '../../config'
import { Organization } from '../module/organization/organization.model'
import { Property } from '../module/property/property.model'
import { Lead } from '../module/lead/lead.model'

const propertyTypeMap: Record<string, string> = {
  Land: 'LandPlot', Development: 'UnderConstruction', House: 'ReadyFlat', Villa: 'ReadyFlat',
  Condo: 'Apartment', Townhouse: 'ReadyFlat', Industrial: 'Warehouse',
}

const run = async () => {
  await mongoose.connect(config.database_string)
  await Promise.all([
    Organization.updateMany({}, { $set: { country: 'Bangladesh' }, $setOnInsert: { defaultLanguage: 'en' } }),
    Property.updateMany({}, { $set: { currency: 'BDT', country: 'Bangladesh' } }),
    Property.updateMany({ moderationStatus: { $exists: false } }, { $set: { moderationStatus: 'pending', moderationReason: 'Requires initial platform review' } }),
    Lead.updateMany({}, { $set: { currency: 'BDT' } }),
  ])
  for (const [legacy, localized] of Object.entries(propertyTypeMap)) await Property.updateMany({ propertyType: legacy }, { $set: { propertyType: localized } })
  console.log('Phase 2 migration completed: BDT enforced and legacy listings queued for moderation.')
  await mongoose.disconnect()
}
run().catch(error => { console.error(error); process.exit(1) })
