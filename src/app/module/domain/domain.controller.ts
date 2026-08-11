import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { Organization } from '../organization/organization.model'

const addCustomDomain = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { domain } = req.body

  const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '')

  const organization = await Organization.findOneAndUpdate(
    { organizationId },
    {
      domain: cleanDomain,
      domain_Verify: false,
      domain_dns: [
        { type: 'A', name: '@', value: '76.76.21.21' },
        { type: 'CNAME', name: 'www', value: 'cname.realestate-saas.com' },
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
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string

  const organization = await Organization.findOneAndUpdate(
    { organizationId },
    { domain_Verify: true },
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
