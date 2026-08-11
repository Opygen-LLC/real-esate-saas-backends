import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import config from '../../config'
import { User } from '../module/user/user.model'
import { Organization } from '../module/organization/organization.model'
import { Property } from '../module/property/property.model'
import { Lead } from '../module/lead/lead.model'
import { Viewing } from '../module/viewing/viewing.model'
import { Task } from '../module/task/task.model'
import { Activity } from '../module/activity/activity.model'
import { PropertyType } from '../module/propertyType/propertyType.model'
import { Amenity } from '../module/amenity/amenity.model'
import { SubscriptionPlan } from '../module/subscriptionPlan/subscriptionPlan.model'

const seedDatabase = async () => {
  try {
    console.log('🌱 Starting Real Estate SaaS Database Seeding...')

    const dbUri = config.database_string || 'mongodb://127.0.0.1:27017/real-estate-saas'
    await mongoose.connect(dbUri)
    console.log('Connected to MongoDB database.')

    // 1. Seed Subscription Plans
    console.log('Seeding Subscription Plans...')
    await SubscriptionPlan.deleteMany({})

    const plans = await SubscriptionPlan.create([
      {
        planId: 'starter',
        name: 'Starter Plan',
        priceMonthly: 49,
        priceYearly: 470,
        currency: 'USD',
        description: 'Ideal for independent agents & small boutique real estate agencies.',
        features: [
          'Up to 3 Agent Accounts',
          'Up to 100 Active Listings',
          'Up to 500 Leads CRM',
          'Standard Agency Landing Page',
          'Email & Phone Support',
        ],
        maxAgents: 3,
        maxProperties: 100,
        maxLeads: 500,
        hasCustomDomain: true,
        hasAdvancedAnalytics: false,
        hasWhatsAppIntegration: true,
        hasLeadAutomations: false,
        isPopular: false,
        status: 'active',
      },
      {
        planId: 'growth',
        name: 'Growth Plan',
        priceMonthly: 129,
        priceYearly: 1240,
        currency: 'USD',
        description: 'Perfect for growing agencies with active sales pipelines & team leads.',
        features: [
          'Up to 10 Agent Accounts',
          'Unlimited Active Listings',
          'Up to 5,000 Leads CRM',
          'Custom Domain DNS Mapping',
          'WhatsApp & SMS Integration',
          'Advanced CRM Kanban & Viewing Schedules',
        ],
        maxAgents: 10,
        maxProperties: 1000,
        maxLeads: 5000,
        hasCustomDomain: true,
        hasAdvancedAnalytics: true,
        hasWhatsAppIntegration: true,
        hasLeadAutomations: true,
        isPopular: true,
        status: 'active',
      },
      {
        planId: 'enterprise',
        name: 'Enterprise Plan',
        priceMonthly: 299,
        priceYearly: 2870,
        currency: 'USD',
        description: 'Designed for large brokerages & multi-location real estate networks.',
        features: [
          'Unlimited Agent Accounts',
          'Unlimited Listings & Leads',
          'Dedicated Account Manager',
          'White-Label Portal & Multi-Domain',
          'Custom API Access & Webhooks',
        ],
        maxAgents: 999,
        maxProperties: 99999,
        maxLeads: 99999,
        hasCustomDomain: true,
        hasAdvancedAnalytics: true,
        hasWhatsAppIntegration: true,
        hasLeadAutomations: true,
        isPopular: false,
        status: 'active',
      },
    ])

    // 2. Seed Organization
    console.log('Seeding Flagship Demo Organization...')
    await Organization.deleteMany({ organizationId: 'org_apex_luxury_2026' })

    const org = await Organization.create({
      organizationId: 'org_apex_luxury_2026',
      agencyName: 'Apex Luxury Realty',
      agencyType: 'residential',
      licenseNumber: 'FL-BRK-990011',
      email: 'contact@apexluxury.com',
      phone: '+1 (555) 234-5678',
      address: '742 Evergreen Terrace, Suite 400',
      city: 'Miami',
      state: 'FL',
      country: 'USA',
      zipCode: '33101',
      subscriptionPlan: 'growth',
      subscriptionStatus: 'active',
      logo: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=300&q=80',
      branding: {
        primaryColor: '#2563eb',
        secondaryColor: '#0f172a',
        heroTitle: 'Find Your Pinnacle Luxury Residence',
        heroSubtitle: 'Curated exclusive beachfront estates, modern penthouses, and private villas in South Florida.',
      },
      customDomain: 'apexluxuryrealty.com',
      sub_domain: 'demo',
      templateId: 'template-1',
      domainVerified: true,
      status: 'active',
    })

    // Seed additional agencies for Templates 2, 3, 4
    await Organization.deleteMany({ sub_domain: { $in: ['biscaynebay', 'metropolitan', 'urbanboutique'] } })
    await Organization.create([
      {
        organizationId: 'org_biscayne_bay_2026',
        agencyName: 'Biscayne Bay Properties',
        agencyType: 'residential',
        email: 'info@biscaynebay.com',
        phone: '+1 (305) 555-9988',
        sub_domain: 'biscaynebay',
        templateId: 'template-2',
        status: 'active',
        subscriptionPlan: 'starter',
      },
      {
        organizationId: 'org_metropolitan_2026',
        agencyName: 'Metropolitan Real Estate',
        agencyType: 'commercial',
        email: 'sales@metropolitan.io',
        phone: '+1 (305) 555-1122',
        sub_domain: 'metropolitan',
        templateId: 'template-3',
        status: 'active',
        subscriptionPlan: 'enterprise',
      },
      {
        organizationId: 'org_urban_boutique_2026',
        agencyName: 'Urban Boutique Realty',
        agencyType: 'residential',
        email: 'hello@urbanboutique.com',
        phone: '+1 (305) 555-4433',
        sub_domain: 'urbanboutique',
        templateId: 'template-4',
        status: 'active',
        subscriptionPlan: 'growth',
      },
    ])

    const organizationId = org.organizationId

    // 3. Seed Users (Super-Admin, Agency Owner & Agent)
    console.log('Seeding Users...')
    await User.deleteMany({ organizationId })
    await User.deleteMany({ userRole: 'super-admin' })

    const saltRounds = Number(config.bcrypt_salt_rounds) || 10
    const hashedPassword = await bcrypt.hash('Password123!', saltRounds)

    const superAdminUser = await User.create({
      organizationId: 'platform_master',
      name: 'Global System SuperAdmin',
      email: 'superadmin@realestatesaas.com',
      password: hashedPassword,
      phoneNumber: '+1 (555) 000-1111',
      userRole: 'super-admin',
      status: 'active',
      profileImgURL: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&q=80',
      designation: 'SaaS Platform Owner',
    })

    const ownerUser = await User.create({
      organizationId,
      name: 'Elena Rostova',
      email: 'owner@apexluxury.com',
      password: hashedPassword,
      phoneNumber: '+1 (555) 987-6543',
      userRole: 'agency_owner',
      status: 'active',
      profileImgURL: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=200&q=80',
      designation: 'Managing Director & Founder',
      licenseNumber: 'FL-RE-987654',
    })

    const agentUser = await User.create({
      organizationId,
      name: 'Marcus Vance',
      email: 'agent@apexluxury.com',
      password: hashedPassword,
      phoneNumber: '+1 (555) 456-7890',
      userRole: 'agent',
      status: 'active',
      profileImgURL: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=200&q=80',
      designation: 'Senior Luxury Property Advisor',
      licenseNumber: 'FL-RE-456789',
    })

    // 4. Seed Property Types & Amenities
    console.log('Seeding Property Types & Amenities...')
    await PropertyType.deleteMany({ organizationId })
    await Amenity.deleteMany({ organizationId })

    await PropertyType.create([
      { organizationId, name: 'Luxury Villa', slug: 'luxury-villa', icon: 'Home', isDefault: true },
      { organizationId, name: 'Penthouse', slug: 'penthouse', icon: 'Building', isDefault: true },
      { organizationId, name: 'Modern Apartment', slug: 'modern-apartment', icon: 'Building2', isDefault: true },
      { organizationId, name: 'Waterfront Estate', slug: 'waterfront-estate', icon: 'Waves', isDefault: true },
      { organizationId, name: 'Commercial Tower', slug: 'commercial-tower', icon: 'Briefcase', isDefault: true },
    ])

    await Amenity.create([
      { organizationId, name: 'Infinity Pool', category: 'outdoor', icon: 'Waves', isDefault: true },
      { organizationId, name: 'Private Dock & Marina', category: 'outdoor', icon: 'Anchor', isDefault: true },
      { organizationId, name: '24/7 Security & Concierge', category: 'security', icon: 'Shield', isDefault: true },
      { organizationId, name: 'Smart Home Automation', category: 'features', icon: 'Cpu', isDefault: true },
      { organizationId, name: 'Fitness Spa & Sauna', category: 'wellness', icon: 'Activity', isDefault: true },
      { organizationId, name: 'Helipad Access', category: 'facilities', icon: 'Plane', isDefault: true },
    ])

    // 5. Seed Properties
    console.log('Seeding Sample Properties...')
    await Property.deleteMany({ organizationId })

    const properties = await Property.create([
      {
        organizationId,
        title: 'The Grand Venetian Penthouse',
        slug: 'the-grand-venetian-penthouse',
        description: 'Unrivaled 360-degree panoramic ocean views from the top floor of Miami Beach’s premier architectural landmark. Features a private rooftop infinity pool and custom Italian finishes.',
        propertyType: 'Penthouse',
        listingType: 'ForSale',
        status: 'Available',
        price: 4850000,
        currency: 'USD',
        bedrooms: 4,
        bathrooms: 5,
        area: 5200,
        areaUnit: 'sqft',
        yearBuilt: 2024,
        parking: 3,
        furnished: true,
        address: '120 Venetian Way, PH-01',
        city: 'Miami Beach',
        state: 'FL',
        country: 'USA',
        zipCode: '33139',
        agentId: agentUser._id,
        isFeatured: true,
        images: [
          { url: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1000&q=80', isFeatured: true, order: 0 },
          { url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1000&q=80', isFeatured: false, order: 1 },
          { url: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1000&q=80', isFeatured: false, order: 2 },
        ],
        amenities: ['Infinity Pool', 'Smart Home Automation', '24/7 Security & Concierge', 'Fitness Spa & Sauna'],
      },
      {
        organizationId,
        title: 'Coral Gables Mediterranean Estate',
        slug: 'coral-gables-mediterranean-estate',
        description: 'Exquisite classic architectural masterpiece surrounded by lush tropical gardens, cascading fountains, and a resort-style swimming pool.',
        propertyType: 'Luxury Villa',
        listingType: 'ForSale',
        status: 'Available',
        price: 3200000,
        currency: 'USD',
        bedrooms: 5,
        bathrooms: 6,
        area: 6800,
        areaUnit: 'sqft',
        yearBuilt: 2022,
        parking: 4,
        furnished: false,
        address: '4450 Granada Blvd',
        city: 'Coral Gables',
        state: 'FL',
        country: 'USA',
        zipCode: '33146',
        agentId: ownerUser._id,
        isFeatured: true,
        images: [
          { url: 'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=1000&q=80', isFeatured: true, order: 0 },
          { url: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1000&q=80', isFeatured: false, order: 1 },
        ],
        amenities: ['Private Dock & Marina', 'Infinity Pool', '24/7 Security & Concierge'],
      },
      {
        organizationId,
        title: 'Brickell Financial Centre Luxury Residence',
        slug: 'brickell-financial-centre-residence',
        description: 'Sleek floor-to-ceiling glass apartment overlooking Biscayne Bay. Fully integrated smart technology and direct elevator access.',
        propertyType: 'Modern Apartment',
        listingType: 'ForRent',
        status: 'Available',
        price: 12500,
        currency: 'USD',
        bedrooms: 2,
        bathrooms: 2,
        area: 1850,
        areaUnit: 'sqft',
        yearBuilt: 2023,
        parking: 2,
        furnished: true,
        address: '1421 Brickell Ave, Apt 3402',
        city: 'Miami',
        state: 'FL',
        country: 'USA',
        zipCode: '33131',
        agentId: agentUser._id,
        isFeatured: false,
        images: [
          { url: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1000&q=80', isFeatured: true, order: 0 },
        ],
        amenities: ['Smart Home Automation', 'Fitness Spa & Sauna'],
      },
      {
        organizationId,
        title: 'Star Island Private Waterfront Compound',
        slug: 'star-island-private-waterfront-compound',
        description: 'Trophy waterfront compound featuring 200 feet of prime deep-water frontage, dual yacht slips, guest house, and tennis court.',
        propertyType: 'Waterfront Estate',
        listingType: 'ForSale',
        status: 'UnderOffer',
        price: 18900000,
        currency: 'USD',
        bedrooms: 7,
        bathrooms: 9,
        area: 12400,
        areaUnit: 'sqft',
        yearBuilt: 2025,
        parking: 6,
        furnished: true,
        address: '28 Star Island Dr',
        city: 'Miami Beach',
        state: 'FL',
        country: 'USA',
        zipCode: '33139',
        agentId: ownerUser._id,
        isFeatured: true,
        images: [
          { url: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1000&q=80', isFeatured: true, order: 0 },
        ],
        amenities: ['Private Dock & Marina', 'Infinity Pool', 'Helipad Access', 'Smart Home Automation'],
      },
      {
        organizationId,
        title: 'Coconut Grove Modern Sanctuary',
        slug: 'coconut-grove-modern-sanctuary',
        description: 'Contemporary eco-luxury villa featuring natural oak wood paneling, floor-to-ceiling glass doors, organic garden, and solar battery storage.',
        propertyType: 'Luxury Villa',
        listingType: 'ForSale',
        status: 'Sold',
        price: 2750000,
        currency: 'USD',
        bedrooms: 4,
        bathrooms: 4,
        area: 4100,
        areaUnit: 'sqft',
        yearBuilt: 2023,
        parking: 2,
        furnished: false,
        address: '3560 Main Hwy',
        city: 'Miami',
        state: 'FL',
        country: 'USA',
        zipCode: '33133',
        agentId: agentUser._id,
        isFeatured: false,
        images: [
          { url: 'https://images.unsplash.com/photo-1600585154526-990dced4db0d?w=1000&q=80', isFeatured: true, order: 0 },
        ],
        amenities: ['Smart Home Automation', 'Infinity Pool'],
      },
    ])

    // 6. Seed CRM Leads
    console.log('Seeding CRM Leads...')
    await Lead.deleteMany({ organizationId })

    const leads = await Lead.create([
      {
        organizationId,
        name: 'Alexander Wright',
        email: 'alex.wright@techventures.io',
        phone: '+1 (305) 555-0199',
        source: 'Website',
        budgetMin: 4000000,
        budgetMax: 6000000,
        currency: 'USD',
        propertyInterest: [properties[0]._id],
        locationPreference: 'Miami Beach',
        propertyType: 'Penthouse',
        bedrooms: 4,
        leadStatus: 'ViewingScheduled',
        assignedAgent: agentUser._id,
        notes: 'Tech executive relocating from New York. Highly interested in Venice Penthouse.',
      },
      {
        organizationId,
        name: 'Sophia Martinez',
        email: 'sophia.martinez@globalinvest.com',
        phone: '+1 (305) 555-0144',
        source: 'WhatsApp',
        budgetMin: 2500000,
        budgetMax: 3500000,
        currency: 'USD',
        propertyInterest: [properties[1]._id],
        locationPreference: 'Coral Gables',
        propertyType: 'Luxury Villa',
        bedrooms: 5,
        leadStatus: 'Qualified',
        assignedAgent: ownerUser._id,
        notes: 'Inquiring for a primary family home near private international schools.',
      },
      {
        organizationId,
        name: 'David & Emma Sterling',
        email: 'dsterling@sterlinggroup.com',
        phone: '+1 (305) 555-0888',
        source: 'Referral',
        budgetMin: 15000000,
        budgetMax: 22000000,
        currency: 'USD',
        propertyInterest: [properties[3]._id],
        locationPreference: 'Star Island',
        propertyType: 'Waterfront Estate',
        bedrooms: 7,
        leadStatus: 'OfferMade',
        assignedAgent: ownerUser._id,
        notes: 'Submitted initial verbal offer for Star Island Compound.',
      },
      {
        organizationId,
        name: 'Michael Chen',
        email: 'm.chen@venturecapital.com',
        phone: '+1 (305) 555-0322',
        source: 'Google',
        budgetMin: 10000,
        budgetMax: 15000,
        currency: 'USD',
        propertyInterest: [properties[2]._id],
        locationPreference: 'Brickell',
        propertyType: 'Modern Apartment',
        bedrooms: 2,
        leadStatus: 'Contacted',
        assignedAgent: agentUser._id,
        notes: 'Looking for a 1-year rental lease starting next month.',
      },
      {
        organizationId,
        name: 'Olivia Bennett',
        email: 'olivia.b@designstudio.co',
        phone: '+1 (305) 555-0711',
        source: 'Instagram',
        budgetMin: 2500000,
        budgetMax: 3000000,
        currency: 'USD',
        propertyInterest: [properties[4]._id],
        locationPreference: 'Coconut Grove',
        propertyType: 'Luxury Villa',
        bedrooms: 4,
        leadStatus: 'Won',
        assignedAgent: agentUser._id,
        notes: 'Transaction completed for Coconut Grove Modern Sanctuary.',
      },
    ])

    // 7. Seed Viewings, Activities & Tasks
    console.log('Seeding Viewings, Activities & Tasks...')
    await Viewing.deleteMany({ organizationId })
    await Activity.deleteMany({ organizationId })
    await Task.deleteMany({ organizationId })

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const dateStr = tomorrow.toISOString().split('T')[0]

    await Viewing.create({
      organizationId,
      propertyId: properties[0]._id,
      leadId: leads[0]._id,
      agentId: agentUser._id,
      date: dateStr,
      startTime: '14:00',
      endTime: '15:00',
      status: 'Confirmed',
      clientName: leads[0].name,
      clientPhone: leads[0].phone,
      clientEmail: leads[0].email,
      notes: 'VIP client walkthrough of Grand Venetian Penthouse rooftop & master suite.',
    })

    await Task.create([
      {
        organizationId,
        title: 'Prepare Purchase Agreement Draft for Star Island Estate',
        description: 'Coordinate with Sterling group attorney for closing terms.',
        dueDate: dateStr,
        dueTime: '11:00',
        priority: 'urgent',
        status: 'Pending',
        assignedAgent: ownerUser._id,
        linkedLead: leads[2]._id,
        linkedProperty: properties[3]._id,
      },
      {
        organizationId,
        title: 'Follow up with Alexander Wright after Venetian Viewing',
        description: 'Send HOA documents and financial statements for PH-01.',
        dueDate: dateStr,
        dueTime: '16:30',
        priority: 'high',
        status: 'Pending',
        assignedAgent: agentUser._id,
        linkedLead: leads[0]._id,
        linkedProperty: properties[0]._id,
      },
    ])

    await Activity.create([
      {
        organizationId,
        leadId: leads[0]._id,
        performedBy: agentUser._id,
        activityType: 'ViewingScheduled',
        title: 'Private Viewing Scheduled',
        description: 'Confirmed private tour of Grand Venetian Penthouse for tomorrow at 2:00 PM.',
      },
      {
        organizationId,
        leadId: leads[2]._id,
        performedBy: ownerUser._id,
        activityType: 'OfferReceived',
        title: 'Initial Offer Submitted',
        description: 'Lead submitted formal purchase proposal for Star Island Compound.',
      },
    ])

    console.log('✅ DATABASE SEEDING COMPLETED SUCCESSFULLY!')
    console.log('--------------------------------------------------')
    console.log(`Demo Agency Organization ID: ${organizationId}`)
    console.log(`Agency Owner Login: owner@apexluxury.com / Password123!`)
    console.log(`Agent Login:        agent@apexluxury.com / Password123!`)
    console.log('--------------------------------------------------')

    await mongoose.disconnect()
    process.exit(0)
  } catch (error) {
    console.error('❌ Error during database seeding:', error)
    process.exit(1)
  }
}

seedDatabase()
