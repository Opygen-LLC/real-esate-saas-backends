import mongoose from 'mongoose'
import config from '../../config'
import { DomainRecord } from '../module/domain/domain.model'

const run = async () => {
  await mongoose.connect(config.database_string)
  const cursor = DomainRecord.collection.find({})
  let updated = 0

  for await (const record of cursor) {
    const active = record.status === 'verified' && record.tlsStatus === 'active'
    const lifecycleStatus = active
      ? 'ACTIVE'
      : record.status === 'verified'
        ? 'TLS_PROVISIONING'
        : 'PENDING_DNS'

    await DomainRecord.collection.updateOne(
      { _id: record._id },
      {
        $set: {
          lifecycleStatus,
          provider: record.provider || config.domains.provider,
          providerRegistrationStatus: active || record.status === 'verified' ? 'registered' : (record.providerRegistrationStatus || 'pending'),
          publicRoutingStatus: active ? 'active' : (record.publicRoutingStatus || 'pending'),
          failureReason: record.failureReason || '',
          nextCheckAt: new Date(),
          ...(active ? {
            providerRegisteredAt: record.providerRegisteredAt || record.verifiedAt || record.updatedAt || new Date(),
            tlsActiveAt: record.tlsActiveAt || record.verifiedAt || record.updatedAt || new Date(),
            activeAt: record.activeAt || record.verifiedAt || record.updatedAt || new Date(),
          } : {}),
        },
      },
    )
    updated += 1
  }

  console.log(`Phase 9 domain lifecycle migration updated ${updated} record(s).`)
  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
