import mongoose from 'mongoose'
import { assertIsolatedTestDatabase } from './isolatedTestDatabase'

async function main() {
  const url = assertIsolatedTestDatabase(process.env.TEST_DATABASE_URL)
  if (!process.argv.includes('--reset-fixtures')) throw new Error('Use --reset-fixtures to replace ONLY the two named local visual fixtures')
  process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = url
  process.env.WORKER_ENABLED = 'false'; process.env.REDIS_ENABLED = 'false'
  process.env.EMAIL_DEV_MODE = 'true'; process.env.SMS_DEV_MODE = 'true'
  const { Organization } = await import('../module/organization/organization.model')
  const { User } = await import('../module/user/user.model')
  const { Property } = await import('../module/property/property.model')
  // Register profile virtuals and all transaction collections without starting a server.
  await import('../../app')
  await mongoose.connect(url, { autoIndex: true })
  const ids = ['org_phase1_visual_modern', 'org_phase1_visual_luxury']
  for (const model of Object.values(mongoose.models)) {
    if (model.schema.path('organizationId')) await model.deleteMany({ organizationId: { $in: ids } })
  }
  for (let i = 0; i < ids.length; i += 1) {
    const organizationId = ids[i]
    const slug = i === 0 ? 'phase1-modern' : 'phase1-luxury'
    const owner = await User.create({ name: 'Local Fixture Advisor', email: `${slug}@example.test`, phoneNumber: `+880171990000${i}`,
      organizationId, userRole: 'agency_owner', status: 'active', isVerified: true, password: 'local-fixture-never-use-in-production' })
    await Organization.create({ organizationId, agencyName: i === 0 ? 'Phase One Modern' : 'Phase One Luxury',
      email: `${slug}@example.test`, phone: owner.phoneNumber, sub_domain: slug, ownerId: owner._id,
      agencyType: 'residential', websiteStatus: 'published', templateId: `template-${i + 1}`,
      subscription: { plan: 'trial', status: 'trialing', trialEndsAt: new Date('2099-01-01'), currentPeriodEnd: new Date('2099-01-01'), maxProperties: 100, maxAgents: 5 },
      websiteSettings: { renderMode: 'template', publicationRevision: 1, lastPublishedAt: new Date('2026-01-01'), content: {
        home: { heroTitle: i === 0 ? 'Phase One Modern Homes' : 'Phase One Luxury Homes', heroSubtitle: 'Local visual regression fixture, not a live agency.',
          heroImage: '/marketing/gulshan-apartment.svg', showAgents: false },
      } },
    })
    for (let p = 0; p < 3; p += 1) await Property.create({ organizationId, agentId: owner._id,
      title: `Fixture Residence ${p + 1}`, slug: `${slug}-residence-${p + 1}`, propertyType: 'Apartment', listingType: 'ForSale', status: 'Available',
      price: 9000000 + p * 1500000, currency: 'BDT', city: 'Dhaka', country: 'Bangladesh', address: 'Visual fixture address',
      bedrooms: 3, bathrooms: 2, area: 1600 + p * 200, areaUnit: 'sqft', images: ['/marketing/gulshan-apartment.svg'], isFeatured: true,
    })
  }
  console.log(JSON.stringify({ fixtureOnly: true, sites: ['http://localhost:3000/portal/phase1-modern', 'http://localhost:3000/portal/phase1-luxury'] }, null, 2))
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }).finally(() => mongoose.disconnect())
