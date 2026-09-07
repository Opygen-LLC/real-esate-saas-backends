import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { BlockList, isIP } from 'node:net'
import ApiError from '../../errors/ApiError'

const MAX_BYTES = 20 * 1024 * 1024
const TIMEOUT_MS = 10_000
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(address, prefix, 'ipv4')
// Exclude IPv6 special-purpose/documentation and transition mechanisms. Only
// native global-unicast addresses are accepted; mapped/NAT64/local IPs are not.
blocked.addSubnet('2001::', 23, 'ipv6')
blocked.addSubnet('2001:db8::', 32, 'ipv6')
blocked.addSubnet('2002::', 16, 'ipv6')
const globalIpv6 = new BlockList()
globalIpv6.addSubnet('2000::', 3, 'ipv6')

export const isPublicImageAddress = (address: string): boolean => {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  if (family === 6) return globalIpv6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
  return false
}

const resolveImageUrl = async (value: string) => {
  let url: URL
  try { url = new URL(value) } catch { throw new ApiError(400, 'Enter a valid image URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new ApiError(400, 'Remote images require HTTPS without credentials or custom ports')
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (!hostname || hostname === 'localhost' || /\.(localhost|local|internal)$/.test(hostname)) throw new ApiError(400, 'Private network image URLs are not allowed')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), TIMEOUT_MS) }),
    ])
    if (!addresses.length || addresses.some(entry => !isPublicImageAddress(entry.address))) throw new Error('Non-public destination')
    return { url, address: addresses[0] }
  } catch { throw new ApiError(400, 'Image URL must resolve only to public internet addresses') }
  finally { if (timer) clearTimeout(timer) }
}

type Download = { status: number; location?: string; mimeType: string; buffer: Buffer }
const download = (target: Awaited<ReturnType<typeof resolveImageUrl>>): Promise<Download> => new Promise((resolve, reject) => {
  let finished = false
  const fail = (error: Error) => { if (!finished) { finished = true; clearTimeout(timer); reject(error) } }
  const complete = (value: Download) => { if (!finished) { finished = true; clearTimeout(timer); resolve(value) } }
  let activeRequest: ReturnType<typeof request> | undefined
  const timer = setTimeout(() => { fail(new ApiError(400, 'Image download timed out')); activeRequest?.destroy() }, TIMEOUT_MS)
  try {
  const req = request(target.url, {
    method: 'GET', agent: false, family: target.address.family,
    rejectUnauthorized: true,
    // Resolve exactly once. The original HTTPS hostname is retained for Host,
    // SNI and certificate verification; only the TCP destination is pinned.
    lookup: (_hostname, options, callback) => {
      if (options.all) callback(null, [target.address])
      else callback(null, target.address.address, target.address.family)
    },
    headers: { accept: [...TYPES].join(','), 'accept-encoding': 'identity' },
  }, response => {
    const status = response.statusCode || 0
    const mimeType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if ([301, 302, 303, 307, 308].includes(status)) {
      complete({ status, location: response.headers.location, mimeType, buffer: Buffer.alloc(0) }); response.destroy(); return
    }
    if (status < 200 || status >= 300 || !TYPES.has(mimeType)) {
      fail(new ApiError(400, 'URL must return a JPEG, PNG, WebP, or AVIF image')); response.destroy(); return
    }
    const encoding = String(response.headers['content-encoding'] || 'identity').toLowerCase()
    if (encoding !== 'identity') { fail(new ApiError(400, 'Compressed HTTP image responses are not supported')); response.destroy(); return }
    if (Number(response.headers['content-length'] || 0) > MAX_BYTES) { fail(new ApiError(413, 'Remote image exceeds the 20 MB limit')); response.destroy(); return }
    const chunks: Buffer[] = []; let size = 0
    response.on('data', (chunk: Buffer) => {
      if (finished) return
      size += chunk.length
      if (size > MAX_BYTES) { fail(new ApiError(413, 'Remote image exceeds the 20 MB limit')); response.destroy(); return }
      chunks.push(chunk)
    })
    response.on('error', () => fail(new ApiError(400, 'Image response was interrupted')))
    response.on('aborted', () => fail(new ApiError(400, 'Image response was interrupted')))
    response.on('end', () => complete({ status, mimeType, buffer: Buffer.concat(chunks) }))
  })
  activeRequest = req
  req.on('error', () => fail(new ApiError(400, 'Image URL could not be downloaded')))
  req.end()
  } catch { fail(new ApiError(400, 'Image connection could not be initialized')) }
})

export const readRemoteImage = async (input: string) => {
  let target = await resolveImageUrl(input)
  let response: Download | undefined
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    response = await download(target)
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    if (!response.location || redirects === 3) throw new ApiError(400, 'Image URL has too many redirects')
    // Every redirect gets the same DNS/address validation and pinned connection.
    let next: URL
    try { next = new URL(response.location, target.url) } catch { throw new ApiError(400, 'Image redirect is invalid') }
    target = await resolveImageUrl(next.toString())
  }
  if (!response) throw new ApiError(400, 'Image response is unavailable')
  const { buffer, mimeType } = response
  const validMagic = mimeType === 'image/jpeg' ? buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : mimeType === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
      : mimeType === 'image/webp' ? buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
        : buffer.subarray(4, 12).toString().startsWith('ftypavi')
  if (!validMagic) throw new ApiError(400, 'Downloaded content does not match its declared image type')
  let filename = target.url.pathname.split('/').filter(Boolean).pop() || 'imported-image'
  try { filename = decodeURIComponent(filename) } catch { /* Keep escaped name. */ }
  filename = filename.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120)
  const extension = mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.avif'
  if (!/\.(jpe?g|png|webp|avif)$/i.test(filename)) filename += extension
  return { buffer, mimeType, filename, size: buffer.length }
}
