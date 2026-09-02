import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')

describe('Review public URL contract', () => {
  it('builds review invitations from the browser-app origin, not CLIENT_URL/API IPs', () => {
    const reviewService = read('src/app/module/review/review.service.ts')
    expect(reviewService).toContain('config.public_site_origin')
    expect(reviewService).not.toContain('config.client_url.replace')
  })

  it('rejects public VM IPs from customer-facing origin configuration', () => {
    const config = read('src/config/index.ts')
    expect(config).toContain("const canonicalPlatformOrigin = 'https://realestate.opygen.com'")
    expect(config).toContain('isIpv4 && !isPrivateNetworkHost(parsed.hostname)')
    expect(config).toContain('return canonicalPlatformOrigin')
  })
})
