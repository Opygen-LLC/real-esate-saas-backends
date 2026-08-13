import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { Organization } from '../organization/organization.model'
import { requireTenant } from '../../middlewares/auth'
import { EntitlementService } from '../entitlement/entitlement.service'
import config from '../../../config'
import dns from 'dns/promises'
import ApiError from '../../../errors/ApiError'

const addCustomDomain = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  await EntitlementService.assertFeature(organizationId, 'customDomain')
  const { domain } = req.body

  const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '')

  const organization = await Organization.findOneAndUpdate(
    { organizationId },
    {
      domain: cleanDomain,
      domain_Verify: false,
      domain_dns: [
        { type: 'A', name: '@', value: config.domains.a_target },
        { type: 'CNAME', name: 'www', value: config.domains.cname_target },
      ],
    },
    { new: true }
  )

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain configuration initiated',
    data: organization,
  })
})

const verifyCustomDomain = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  await EntitlementService.assertFeature(organizationId, 'customDomain')
  const current = await Organization.findOne({ organizationId })
  if (!current?.domain) throw new ApiError(400, 'No custom domain is configured')
  let verified = false
  try {
    const [addresses, cnames] = await Promise.allSettled([dns.resolve4(current.domain), dns.resolveCname(`www.${current.domain}`)])
    verified = (addresses.status === 'fulfilled' && addresses.value.includes(config.domains.a_target)) ||
      (cnames.status === 'fulfilled' && cnames.value.some(value => value.replace(/\.$/, '') === config.domains.cname_target))
  } catch { verified = false }
  if (!verified) throw new ApiError(409, 'Required DNS records are not visible yet')

  const organization = await Organization.findOneAndUpdate(
    { organizationId },
    { domain_Verify: verified },
    { new: true }
  )

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain verified successfully',
    data: organization,
  })
})

export const DomainController = {
  addCustomDomain,
  verifyCustomDomain,
}
