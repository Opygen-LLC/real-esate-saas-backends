import mongoose from 'mongoose'
import config from '../../config'
import { LeadTopupPricing } from '../module/leadTopupPricing/leadTopupPricing.model'
import { LeadPurchaseRequest } from '../module/leadPurchaseRequest/leadPurchaseRequest.model'
import { LeadTopupGrant } from '../module/leadTopupGrant/leadTopupGrant.model'

const run = async () => {
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  })
  try {
    await Promise.all([
      LeadTopupPricing.createIndexes(),
      LeadPurchaseRequest.createIndexes(),
      LeadTopupGrant.createIndexes(),
    ])
    console.log(JSON.stringify({ migration: 'lead-topups', status: 'ok', collections: ['leadtopuppricings', 'leadpurchaserequests', 'leadtopupgrants'] }, null, 2))
  } finally {
    await mongoose.disconnect()
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
