import { sanitizePublicUrl } from '../../shared/publicContentSanitize'

export const serializePublicBanner = (banner: any) => ({
  _id: String(banner._id),
  title: String(banner.title || '').slice(0, 160),
  subtitle: String(banner.subtitle || '').slice(0, 500),
  image: sanitizePublicUrl(banner.image, { allowRelative: true }),
  link: sanitizePublicUrl(banner.link, { allowRelative: true, allowContactSchemes: true }),
  btnText: String(banner.btnText || '').slice(0, 80),
  status: true,
})
