import { describe, expect, it, vi } from 'vitest'
import { UploadController } from '../../app/module/upload/upload.controller'
import { StorageService } from '../../app/module/upload/upload.service'
import { EntitlementService } from '../../app/module/entitlement/entitlement.service'
import { Organization } from '../../app/module/organization/organization.model'
import { Request, Response } from 'express'

vi.mock('../../app/module/upload/upload.service', () => ({
  StorageService: {
    uploadFile: vi.fn(),
    uploadMultipleFiles: vi.fn(),
  },
}))

vi.mock('../../app/module/entitlement/entitlement.service', () => ({
  EntitlementService: {
    assertStorage: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../app/module/organization/organization.model', () => ({
  Organization: {
    updateOne: vi.fn().mockResolvedValue({}),
  },
}))

describe('Upload Controller Unit Tests', () => {
  it('returns publicUrl only on uploadSingle success', async () => {
    vi.mocked(StorageService.uploadFile).mockResolvedValue({
      publicUrl: 'https://storage.googleapis.com/realestate-saas/uploads/12345-test.jpg',
      fileName: '12345-test.jpg',
      sizeBytes: 1024,
      mimeType: 'image/jpeg',
    })

    let statusCode = 0
    let responseBody: any = null

    const req = {
      tenant: { organizationId: 'org-123', userId: 'user-123', role: 'agency_admin', permissions: [] },
      file: {
        originalname: 'test.jpg',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake image content'),
        size: 1024,
      },
    } as unknown as Request

    const res = {
      status: (code: number) => {
        statusCode = code
        return {
          json: (body: any) => {
            responseBody = body
          },
        }
      },
    } as unknown as Response

    const next = vi.fn()

    await UploadController.uploadSingle(req, res, next)

    expect(statusCode).toBe(201)
    expect(responseBody).toHaveProperty('publicUrl')
    expect(responseBody.publicUrl).toBe('https://storage.googleapis.com/realestate-saas/uploads/12345-test.jpg')
  })

  it('returns publicUrls array on uploadMultiple success', async () => {
    vi.mocked(StorageService.uploadMultipleFiles).mockResolvedValue([
      {
        publicUrl: 'https://storage.googleapis.com/realestate-saas/uploads/12345-test1.jpg',
        fileName: '12345-test1.jpg',
        sizeBytes: 1024,
        mimeType: 'image/jpeg',
      },
    ])

    let statusCode = 0
    let responseBody: any = null

    const req = {
      tenant: { organizationId: 'org-123', userId: 'user-123', role: 'agency_admin', permissions: [] },
      files: [
        {
          originalname: 'test1.jpg',
          mimetype: 'image/jpeg',
          buffer: Buffer.from('fake image content 1'),
          size: 1024,
        },
      ],
    } as unknown as Request

    const res = {
      status: (code: number) => {
        statusCode = code
        return {
          json: (body: any) => {
            responseBody = body
          },
        }
      },
    } as unknown as Response

    const next = vi.fn()

    await UploadController.uploadMultiple(req, res, next)

    expect(statusCode).toBe(201)
    expect(responseBody).toHaveProperty('publicUrls')
    expect(responseBody.publicUrls).toEqual(['https://storage.googleapis.com/realestate-saas/uploads/12345-test1.jpg'])
  })
})
