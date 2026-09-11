import express, { type ErrorRequestHandler } from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'net'
import { uploadMultiple, uploadSingle } from '../../app/module/upload/upload.middleware'
import ApiError from '../../errors/ApiError'

let server: ReturnType<ReturnType<typeof express>['listen']>
let baseUrl = ''

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
      fieldErrors: error.fieldErrors || {},
    })
    return
  }
  res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Internal server error' })
}

const makeFile = (_name = 'test.jpg', type = 'image/jpeg', size = 32) => new Blob([new Uint8Array(size).fill(1)], { type })

beforeAll(async () => {
  const app = express()
  app.post('/single', uploadSingle, (req, res) => res.status(201).json({ folder: req.body.folder, fileCount: Object.values(req.files || {}).flat().length }))
  app.post('/multiple', uploadMultiple, (req, res) => res.status(201).json({ folder: req.body.folder, fileCount: Object.values(req.files || {}).flat().length }))
  app.use(errorHandler)
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

describe('generic upload multipart contract', () => {
  it('accepts one image plus one folder field', async () => {
    const body = new FormData()
    body.append('file', makeFile(), 'test.jpg')
    body.append('folder', 'avatar')
    const response = await fetch(`${baseUrl}/single`, { method: 'POST', body })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ folder: 'avatar', fileCount: 1 })
  })

  it('accepts ten images plus one folder field', async () => {
    const body = new FormData()
    for (let index = 0; index < 10; index += 1) body.append('files', makeFile(`test-${index}.jpg`), `test-${index}.jpg`)
    body.append('folder', 'property')
    const response = await fetch(`${baseUrl}/multiple`, { method: 'POST', body })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ folder: 'property', fileCount: 10 })
  })

  it('maps excess metadata fields to TOO_MANY_FIELDS instead of 500', async () => {
    const body = new FormData()
    body.append('file', makeFile(), 'test.jpg')
    body.append('folder', 'general')
    body.append('extra', 'not-allowed')
    const response = await fetch(`${baseUrl}/single`, { method: 'POST', body })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('TOO_MANY_FIELDS')
  })

  it('rejects an invalid folder with a field-level error', async () => {
    const body = new FormData()
    body.append('file', makeFile(), 'test.jpg')
    body.append('folder', 'arbitrary-folder')
    const response = await fetch(`${baseUrl}/single`, { method: 'POST', body })
    const payload = await response.json()
    expect(response.status).toBe(400)
    expect(payload.code).toBe('INVALID_UPLOAD_FOLDER')
    expect(payload.fieldErrors.folder).toBeTruthy()
  })

  it('maps files larger than 5 MB to FILE_TOO_LARGE/413', async () => {
    const body = new FormData()
    body.append('file', makeFile('large.jpg', 'image/jpeg', 5 * 1024 * 1024 + 1), 'large.jpg')
    body.append('folder', 'general')
    const response = await fetch(`${baseUrl}/single`, { method: 'POST', body })
    expect(response.status).toBe(413)
    expect((await response.json()).code).toBe('FILE_TOO_LARGE')
  })

  it('rejects unexpected file fields without returning 500', async () => {
    const body = new FormData()
    body.append('unexpected', makeFile(), 'test.jpg')
    body.append('folder', 'general')
    const response = await fetch(`${baseUrl}/single`, { method: 'POST', body })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_UPLOAD_FIELD')
  })

  it('rejects invalid file types without returning 500', async () => {
    const body = new FormData()
    body.append('file', makeFile('test.gif', 'image/gif'), 'test.gif')
    body.append('folder', 'general')
    const response = await fetch(`${baseUrl}/single`, { method: 'POST', body })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_UPLOAD_FILE_TYPE')
  })
})
