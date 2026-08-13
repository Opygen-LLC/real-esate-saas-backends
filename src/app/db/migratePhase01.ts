import mongoose from 'mongoose'
import config from '../../config'
import { normalizeBangladeshPhone, normalizeEmail, normalizeSubdomain, RESERVED_SUBDOMAINS } from '../helpers/identity'
import { sha256 } from '../helpers/crypto'
import { User } from '../module/user/user.model'
import { Organization } from '../module/organization/organization.model'
import { SubscriptionPlan } from '../module/subscriptionPlan/subscriptionPlan.model'

async function migrate() {
  await mongoose.connect(config.database_string)
  const apply = process.env.MIGRATION_APPLY === 'true'
  const users = await User.find({}).select('_id email phoneNumber').lean()
  const identities = new Set<string>()
  const userUpdates: Array<{ id: mongoose.Types.ObjectId; email: string; phoneNumber: string }> = []
  for (const user of users) {
    const email = normalizeEmail(user.email)
    const phoneNumber = normalizeBangladeshPhone(user.phoneNumber)
    for (const identity of [`email:${email}`, `phone:${phoneNumber}`]) {
      if (identities.has(identity)) throw new Error(`Duplicate global identity must be resolved before migration: ${identity}`)
      identities.add(identity)
    }
    userUpdates.push({ id: user._id, email, phoneNumber })
  }

  const organizations = await Organization.find({}).select('_id agencyName sub_domain').lean()
  const subdomains = new Set<string>()
  const orgUpdates = organizations.map(org => {
    let value = normalizeSubdomain(org.sub_domain || org.agencyName) || `agency-${org._id.toString().slice(-6)}`
    if (RESERVED_SUBDOMAINS.has(value) || subdomains.has(value)) value = `${value.slice(0, 41)}-${sha256(org._id.toString()).slice(0, 6)}`
    if (subdomains.has(value)) throw new Error(`Unable to create unique subdomain for ${org._id}`)
    subdomains.add(value); return { id: org._id, subdomain: value }
  })

  console.log(`Phase 0/1 migration validated: ${userUpdates.length} users, ${orgUpdates.length} organizations.`)
  if (!apply) { console.log('Dry run only. Set MIGRATION_APPLY=true after reviewing duplicates and invalid Bangladesh phones.'); return }

  await User.bulkWrite(userUpdates.map(item => ({ updateOne: { filter: { _id: item.id }, update: { $set: { email: item.email, phoneNumber: item.phoneNumber } } } })))
  await Organization.bulkWrite(orgUpdates.map(item => ({ updateOne: { filter: { _id: item.id }, update: { $set: { sub_domain: item.subdomain },
    $unset: { customDomain: '', subscriptionPlan: '', subscriptionStatus: '' } } } })))
  await Organization.updateMany({ 'subscription.status': 'inactive' }, { $set: { 'subscription.status': 'suspended' } })
  await SubscriptionPlan.updateMany({ hasSmsAutomation: { $exists: false } }, { $set: { hasSmsAutomation: false } })
  await SubscriptionPlan.updateMany({ hasPremiumTemplates: { $exists: false } }, { $set: { hasPremiumTemplates: false } })
  await SubscriptionPlan.updateMany({ maxStorageMb: { $exists: false } }, { $set: { maxStorageMb: 1024 } })
  await SubscriptionPlan.updateMany({ maxMonthlyVisitors: { $exists: false } }, { $set: { maxMonthlyVisitors: 10000 } })
  for (const index of ['organizationId_1_phoneNumber_1', 'organizationId_1_email_1']) {
    try { await User.collection.dropIndex(index) } catch (error: any) { if (error?.codeName !== 'IndexNotFound') throw error }
  }
  await User.collection.createIndex({ phoneNumber: 1 }, { unique: true })
  await User.collection.createIndex({ email: 1 }, { unique: true })
  await Organization.collection.createIndex({ sub_domain: 1 }, { unique: true })
  console.log('Phase 0/1 migration applied successfully.')
}

migrate().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => mongoose.disconnect())
