import { afterAll, describe, expect, it } from 'vitest'
import { ObjectStorageService } from '../../app/module/websiteBuilder/objectStorage.service'

const enabled = process.env.R2_INTEGRATION_TESTS === 'true'
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
const publicPrefix = `integration/r2/${runId}/`
const privatePrefix = `tenants/r2-integration/properties/documents/${runId}/`
const publicKey = `${publicPrefix}public.txt`
const secondPublicKey = `${publicPrefix}prefix-delete.txt`
const privateKey = `${privatePrefix}private.txt`
const text = (value: string) => Buffer.from(value, 'utf8')

const fetchOk = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`R2 HTTP ${response.status}: ${await response.text()}`)
  return response
}

describe.skipIf(!enabled)('Cloudflare R2 object storage integration', () => {
  afterAll(async () => {
    await Promise.allSettled([
      ObjectStorageService.removePrefix(publicPrefix),
      ObjectStorageService.removePrefix(privatePrefix),
    ])
  })

  it('reports the canonical R2 provider as configured', () => {
    const status = ObjectStorageService.configurationStatus()
    expect(status.provider).toBe('r2')
    expect(status.configured).toBe(true)
    expect(status.bucket).toBe(process.env.R2_PUBLIC_BUCKET_NAME)
    expect(status.privateBucket).toBe(process.env.R2_PRIVATE_BUCKET_NAME)
  })

  it('supports PUT, HEAD, GET, exists and DELETE in the public bucket', async () => {
    await ObjectStorageService.putBuffer(publicKey, text('r2-public'), 'text/plain')
    expect(await ObjectStorageService.exists(publicKey)).toBe(true)
    const metadata = await ObjectStorageService.head(publicKey)
    expect(metadata?.size).toBe(text('r2-public').byteLength)
    expect((await ObjectStorageService.readBuffer(publicKey)).toString('utf8')).toBe('r2-public')
    expect(ObjectStorageService.publicUrl(publicKey)).toContain('/integration/r2/')
    await ObjectStorageService.remove(publicKey)
    expect(await ObjectStorageService.exists(publicKey)).toBe(false)
  })

  it('routes private keys to the private bucket and signs private downloads', async () => {
    await ObjectStorageService.putBuffer(privateKey, text('r2-private'), 'text/plain')
    expect(await ObjectStorageService.exists(privateKey)).toBe(true)
    expect(() => ObjectStorageService.publicUrl(privateKey)).toThrow()
    const downloadUrl = await ObjectStorageService.presignDownload(privateKey, 120)
    const response = await fetchOk(downloadUrl)
    expect(await response.text()).toBe('r2-private')
  })

  it('creates a presigned PUT URL that uploads directly to R2', async () => {
    const uploadUrl = await ObjectStorageService.presignUpload(publicKey, 'text/plain').getUploadUrl()
    await fetchOk(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: 'r2-presigned-put',
    })
    expect((await ObjectStorageService.readBuffer(publicKey)).toString('utf8')).toBe('r2-presigned-put')
  })

  it('deletes an entire prefix across paginated R2 listings', async () => {
    await Promise.all([
      ObjectStorageService.putBuffer(publicKey, text('a'), 'text/plain'),
      ObjectStorageService.putBuffer(secondPublicKey, text('b'), 'text/plain'),
    ])
    expect(await ObjectStorageService.prefixHasObjects(publicPrefix)).toBe(true)
    await ObjectStorageService.removePrefix(publicPrefix)
    expect(await ObjectStorageService.prefixHasObjects(publicPrefix)).toBe(false)
  })
})
