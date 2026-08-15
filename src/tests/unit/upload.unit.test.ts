import { describe, expect, it, vi } from 'vitest'
import { UploadController } from '../../app/module/upload/upload.controller'
import { StorageService } from '../../app/module/upload/upload.service'
import { Request, Response } from 'express'

vi.spyOn(StorageService, 'uploadFile').mockResolvedValue({
  fileName: 'uploads/12345-test.jpg',
  originalName: 'test.jpg',
  publicUrl: 'https://storage.googleapis.com/realestate-saas/uploads/12345-test.jpg',
  url: 'https://storage.googleapis.com/realestate-saas/uploads/12345-test.jpg',
  size: 1024,
  mimetype: 'image/jpeg',
})

vi.spyOn(StorageService, 'uploadMultipleFiles').mockResolvedValue([
  {
    fileName: 'uploads/12345-test1.jpg',
    originalName: 'test1.jpg',
    publicUrl: 'https://storage.googleapis.com/realestate-saas/uploads/12345-test1.jpg',
    url: 'https://storage.googleapis.com/realestate-saas/uploads/12345-test1.jpg',
    size: 1024,
    mimetype: 'image/jpeg',
  },
])

vi.spyOn(StorageService, 'getSignedUrl').mockResolvedValue('https://storage.googleapis.com/signed-url-demo')
vi.spyOn(StorageService, 'deleteFile').mockResolvedValue(true)

describe('Upload Controller Unit Tests', () => {
  it('handles uploadSingle successfully when file is attached', async () => {
    let statusCode = 0
    let responseBody: any = null

    const req = {
      file: {
        originalname: 'test.jpg',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake image content'),
        size: 1024,
      },
    } as unknown as Request

    const res = {
      getHeader: () => undefined,
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
    expect(responseBody?.success).toBe(true)
    expect(responseBody?.data?.publicUrl).toContain('https://storage.googleapis.com/')
  })

  it('handles uploadMultiple successfully when files array is attached', async () => {
    let statusCode = 0
    let responseBody: any = null

    const req = {
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
      getHeader: () => undefined,
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
    expect(responseBody?.success).toBe(true)
    expect(Array.isArray(responseBody?.data)).toBe(true)
  })
})
