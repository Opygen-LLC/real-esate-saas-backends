import mongoose from 'mongoose'
import config from '../../config'
import { OtpChallenge } from '../module/auth/otpChallenge.model'
import { Organization } from '../module/organization/organization.model'

async function migrate() {
  await mongoose.connect(config.database_string, { autoIndex: false })
  try {
    await Promise.all([
      OtpChallenge.collection.createIndex(
        { email: 1, purpose: 1, channel: 1, createdAt: -1 },
        { name: 'email_1_purpose_1_channel_1_createdAt_-1', background: true },
      ),
      Organization.collection.createIndex(
        { websiteStatus: 1 },
        { name: 'websiteStatus_1', background: true },
      ),
    ])
    const result = await Organization.updateMany(
      { $or: [{ websiteStatus: { $exists: false } }, { websiteStatus: null }] },
      { $set: { websiteStatus: 'provisioned' } },
    )
    console.log(`Email OTP auth migration complete. Backfilled ${result.modifiedCount} organizations.`)
  } finally {
    await mongoose.disconnect()
  }
}

migrate().catch((error) => {
  console.error('Email OTP auth migration failed', error)
  process.exitCode = 1
})
