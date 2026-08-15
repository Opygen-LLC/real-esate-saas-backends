import { describe, expect, it, vi } from 'vitest'
import { UploadController } from '../../app/module/upload/upload.controller'
import { StorageService } from '../../app/module/upload/upload.service'
import { Request, Response } from 'express'

describe('Upload Controller Unit Tests', () => {
  it('returns publicUrl only on uploadSingle success', async () => {
    vi.spyOn(StorageService, 'uploadFile').mockResolvedValue({
      publicUrl: 'https://storage.googleapis.com/realestate-saas/uploads/12345-test.jpg',
    })

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
    vi.spyOn(StorageService, 'uploadMultipleFiles').mockResolvedValue([
      {
        publicUrl: 'https://storage.googleapis.com/realestate-saas/uploads/12345-test1.jpg',
      },
    ])

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
