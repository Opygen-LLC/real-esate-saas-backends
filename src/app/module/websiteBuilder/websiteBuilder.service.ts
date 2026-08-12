import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { WebsitePage } from './websitePage.model'
import { WebsiteRevision } from './websiteRevision.model'
import { WebsiteAsset } from './websiteAsset.model'
import { Organization } from '../organization/organization.model'
import { WebsiteBuilderValidation, checkGuardrails } from './websiteBuilder.validation'
import { IWebsitePage } from './websitePage.interface'

const getAllPages = async (organizationId: string) => {
  let pages = await WebsitePage.find({ organizationId }).sort({ createdAt: 1 })
  
  // Auto-seed initial home page if none exists
  if (!pages || pages.length === 0) {
    const defaultPage = await WebsitePage.create({
      organizationId,
      slug: '/',
      title: 'Home',
      status: 'draft',
      draftDocument: {
        schemaVersion: 1,
        pages: [
          {
            id: 'home',
            slug: '/',
            title: 'Home Page',
            nodes: [
              {
                id: 'section-hero',
                type: 'section',
                label: 'Hero Section',
                props: { fullWidth: true },
                styles: {
                  desktop: {
                    paddingTop: 80,
                    paddingBottom: 80,
                    backgroundColor: '#0f172a',
                    textColor: '#ffffff',
                  },
                },
                children: [
                  {
                    id: 'container-hero',
                    type: 'container',
                    label: 'Hero Container',
                    props: {},
                    styles: {
                      desktop: {
                        maxWidth: 1120,
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 20,
                      },
                    },
                    children: [
                      {
                        id: 'heading-1',
                        type: 'heading',
                        label: 'Hero Title',
                        props: { level: 1, text: 'Find Your Signature Residence' },
                        styles: { desktop: { fontSize: 52, fontWeight: '800', textColor: '#ffffff' } },
                      },
                      {
                        id: 'paragraph-1',
                        type: 'paragraph',
                        label: 'Hero Subtitle',
                        props: { text: 'Discover premier luxury homes and waterfront villas curated for discerning buyers.' },
                        styles: { desktop: { fontSize: 16, textColor: '#94a3b8' } },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        theme: {
          primaryColor: '#0f172a',
          secondaryColor: '#2563eb',
          accentColor: '#7c3aed',
          fontFamily: 'Inter',
        },
      },
    })
    pages = [defaultPage]
  }

  return pages
}

const getPageById = async (organizationId: string, pageId: string) => {
  const page = await WebsitePage.findOne({ _id: pageId, organizationId })
  if (!page) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Website page not found')
  }
  return page
}

const saveDraft = async (organizationId: string, pageId: string, document: any, userId?: string) => {
  // Section 3: Guardrail & Zod validation
  const guardrail = checkGuardrails(document)
  if (!guardrail.valid) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Document Guardrail Error: ${guardrail.message}`)
  }

  const page = await WebsitePage.findOne({ _id: pageId, organizationId })
  if (!page) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Website page not found')
  }

  page.draftDocument = document
  page.status = 'draft'
  if (userId) page.updatedBy = userId as any

  const result = await page.save()
  return result
}

const publishPage = async (organizationId: string, pageId: string, userId?: string) => {
  const page = await WebsitePage.findOne({ _id: pageId, organizationId })
  if (!page) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Website page not found')
  }

  // Count existing revisions for version number
  const revisionCount = await WebsiteRevision.countDocuments({ organizationId, pageId: page._id })
  const newVersion = revisionCount + 1

  // 1. Create immutable snapshot revision
  await WebsiteRevision.create({
    organizationId,
    pageId: page._id,
    document: page.draftDocument,
    version: newVersion,
    createdBy: userId,
    message: `Published Version v${newVersion}`,
  })

  // 2. Atomically promote draft to published
  page.publishedDocument = page.draftDocument
  page.status = 'published'
  if (userId) page.updatedBy = userId as any

  const result = await page.save()
  return result
}

const addAsset = async (organizationId: string, payload: any, userId?: string) => {
  const asset = await WebsiteAsset.create({
    ...payload,
    organizationId,
    uploadedBy: userId,
  })
  return asset
}

const deleteAsset = async (organizationId: string, assetId: string) => {
  const result = await WebsiteAsset.findOneAndDelete({ _id: assetId, organizationId })
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Asset not found or unauthorized')
  }
  return result
}

const getPublicPage = async (subdomain: string, slug: string = '/') => {
  const targetSlug = !slug || slug === 'home' ? '/' : slug

  const org = await Organization.findOne({
    $or: [
      { sub_domain: { $regex: `^${subdomain}$`, $options: 'i' } },
      { domain: { $regex: `^${subdomain}$`, $options: 'i' } },
      { customDomain: { $regex: `^${subdomain}$`, $options: 'i' } },
      { organizationId: subdomain },
    ],
  })

  if (!org) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Agency website not found')
  }

  const page = await WebsitePage.findOne({
    $or: [{ organizationId: org.organizationId }, { organizationId: org._id.toString() }, { organizationId: subdomain }],
    slug: targetSlug,
  })

  if (!page || !page.publishedDocument) {
    return {
      organization: {
        agencyName: org.agencyName,
        logo: org.logo,
        primaryColor: org.primaryColor,
        secondaryColor: org.secondaryColor,
        sub_domain: org.sub_domain,
      },
      page: null,
    }
  }

  return {
    organization: {
      agencyName: org.agencyName,
      logo: org.logo,
      primaryColor: org.primaryColor,
      secondaryColor: org.secondaryColor,
      sub_domain: org.sub_domain,
    },
    page: {
      title: page.title,
      slug: page.slug,
      publishedDocument: page.publishedDocument,
    },
  }
}

export const WebsiteBuilderService = {
  getAllPages,
  getPageById,
  saveDraft,
  publishPage,
  addAsset,
  deleteAsset,
  getPublicPage,
}
