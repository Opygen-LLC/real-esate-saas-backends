import ApiError from '../../../errors/ApiError'
import type { IPropertyMediaLink, IPropertyMediaProvider, IPropertyMediaType } from './property.interface'

type MediaInput = Partial<IPropertyMediaLink> & { id?: string; url?: string; type?: IPropertyMediaType }

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const VIMEO_ID = /^\d{6,12}$/
const SAFE_ID = /^[A-Za-z0-9_-]{4,128}$/

const httpsUrl = (value: string): URL => {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new ApiError(400, 'Enter a valid hosted media URL') }
  if (url.protocol !== 'https:' || url.username || url.password) throw new ApiError(400, 'Hosted media links must use HTTPS without embedded credentials')
  return url
}

const youtubeId = (url: URL): string | null => {
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  let id = ''
  if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || ''
  else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v') || ''
    else {
      const parts = url.pathname.split('/').filter(Boolean)
      if (['embed', 'shorts', 'live'].includes(parts[0] || '')) id = parts[1] || ''
    }
  }
  return YOUTUBE_ID.test(id) ? id : null
}

const vimeoId = (url: URL): string | null => {
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  const id = host === 'player.vimeo.com' && parts[0] === 'video' ? parts[1] : [...parts].reverse().find(part => VIMEO_ID.test(part))
  return id && VIMEO_ID.test(id) ? id : null
}

const matterportId = (url: URL): string | null => {
  const host = url.hostname.toLowerCase()
  if (host !== 'my.matterport.com' || !url.pathname.startsWith('/show')) return null
  const id = url.searchParams.get('m') || ''
  return SAFE_ID.test(id) ? id : null
}

const kuulaId = (url: URL): string | null => {
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host !== 'kuula.co') return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (!['share', 'post'].includes(parts[0] || '')) return null
  return SAFE_ID.test(parts[1] || '') ? parts[1] : null
}

const inferred = (url: URL, requestedType?: IPropertyMediaType): { provider: IPropertyMediaProvider; type: IPropertyMediaType; embedUrl?: string } => {
  const yt = youtubeId(url)
  if (yt) return { provider: 'youtube', type: 'video', embedUrl: `https://www.youtube-nocookie.com/embed/${yt}?rel=0` }
  const vi = vimeoId(url)
  if (vi) return { provider: 'vimeo', type: 'video', embedUrl: `https://player.vimeo.com/video/${vi}` }
  const mp = matterportId(url)
  if (mp) return { provider: 'matterport', type: 'virtual_tour', embedUrl: `https://my.matterport.com/show/?m=${encodeURIComponent(mp)}&play=1` }
  const ku = kuulaId(url)
  if (ku) return { provider: 'kuula', type: '360', embedUrl: `https://kuula.co/share/${encodeURIComponent(ku)}?logo=0&info=1&fs=1&vr=1&sd=1&thumbs=1` }
  return { provider: 'other', type: requestedType || 'video' }
}

export const normalizePropertyMediaLink = (input: MediaInput, index = 0): IPropertyMediaLink => {
  const id = String(input.id || `media-${index + 1}`).trim()
  if (!id || id.length > 80) throw new ApiError(400, 'Hosted media item ID is invalid')
  const original = httpsUrl(String(input.url || ''))
  const detected = inferred(original, input.type)
  if (input.isHero && !detected.embedUrl) throw new ApiError(400, 'Only YouTube, Vimeo, Matterport, or Kuula media can be shown as the property hero')
  return {
    id,
    url: original.toString(),
    provider: detected.provider,
    type: detected.type,
    title: String(input.title || '').trim().slice(0, 160),
    isHero: Boolean(input.isHero),
    ...(detected.embedUrl ? { embedUrl: detected.embedUrl } : {}),
  }
}

export const normalizePropertyMediaLinks = (items?: MediaInput[]): IPropertyMediaLink[] | undefined => {
  if (items === undefined) return undefined
  if (items.length > 10) throw new ApiError(400, 'A property can have up to 10 hosted media links')
  const normalized = items.map(normalizePropertyMediaLink)
  if (new Set(normalized.map(item => item.id)).size !== normalized.length) throw new ApiError(400, 'Hosted media item IDs must be unique')
  if (normalized.filter(item => item.isHero).length > 1) throw new ApiError(400, 'Only one hosted media item can be shown as the property hero')
  return normalized
}

export const PropertyMediaService = { normalizePropertyMediaLink, normalizePropertyMediaLinks }
