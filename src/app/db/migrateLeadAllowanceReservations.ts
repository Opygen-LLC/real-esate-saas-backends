import mongoose from 'mongoose'
import config from '../../config'
import { Lead } from '../module/lead/lead.model'
import { Organization } from '../module/organization/organization.model'
import { LeadAllowanceReservation } from '../module/entitlement/leadAllowanceReservation.model'

const apply = process.argv.includes('--apply')

const run = async () => {
  await mongoose.connect(config.database_string)
  try {
    const organizationsMissingRevision = await Organization.countDocuments({ leadQuotaRevision: { $exists: false } })
    const leadsWithoutAllowanceMetadata = await Lead.countDocuments({ leadAllowanceReservationId: { $exists: false } })
    console.log(JSON.stringify({
      apply,
      organizationsMissingRevision,
      historicalLeadsPreservedWithoutAllowanceMetadata: leadsWithoutAllowanceMetadata,
      note: 'Historical Leads are not charged retroactively. Phase 12 applies to new Lead creation only.',
    }, null, 2))

    if (!apply) return
    await Organization.updateMany({ leadQuotaRevision: { $exists: false } }, { $set: { leadQuotaRevision: 0 } })
    await Promise.all([
      Organization.createIndexes(),
      Lead.createIndexes(),
      LeadAllowanceReservation.createIndexes(),
    ])
    console.log('Phase 12 lead allowance migration applied successfully')
  } finally {
    await mongoose.disconnect()
  }
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
