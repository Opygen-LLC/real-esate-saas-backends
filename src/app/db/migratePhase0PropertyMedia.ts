import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase0-property-media'
const MAX_IMAGES = 20
const multipleFeaturedFilter = {
  $expr: {
    $gt: [
      {
        $size: {
          $filter: {
            input: { $ifNull: ['$images', []] },
            as: 'image',
            cond: { $eq: ['$$image.isFeatured', true] },
          },
        },
      },
      1,
    ],
  },
}

type LegacyImage = { _id?: unknown; url?: string; isFeatured?: boolean; order?: number; [key: string]: unknown }
type MediaLink = { id: string; url: string; provider: 'youtube' | 'vimeo' | 'matterport' | 'kuula' | 'other'; type: 'video' | 'virtual_tour' | '360'; title: string; isHero: boolean }

const inferMediaLink = (url: string, index: number): MediaLink => {
  let provider: MediaLink['provider'] = 'other'
  let type: MediaLink['type'] = 'video'
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host === 'youtu.be' || host.endsWith('youtube.com')) provider = 'youtube'
    else if (host.endsWith('vimeo.com')) provider = 'vimeo'
    else if (host.endsWith('matterport.com')) { provider = 'matterport'; type = 'virtual_tour' }
    else if (host.endsWith('kuula.co')) { provider = 'kuula'; type = '360' }
  } catch { provider = 'other' }
  return { id: `legacy-${index + 1}`, url, provider, type, title: '', isHero: false }
}

const trimImages = (images: LegacyImage[]): LegacyImage[] => {
  const prioritized = images
    .map((image, index) => ({ image, index }))
    .sort((a, b) => Number(Boolean(b.image.isFeatured)) - Number(Boolean(a.image.isFeatured)) || Number(a.image.order ?? a.index) - Number(b.image.order ?? b.index) || a.index - b.index)
    .slice(0, MAX_IMAGES)
    .map(item => item.image)
  const featuredIndex = prioritized.findIndex(image => image.isFeatured === true)
  return prioritized.map((image, order) => ({ ...image, order, isFeatured: featuredIndex === order }))
}

const normalizeFeaturedImages = (images: LegacyImage[]): LegacyImage[] => {
  const featured = images
    .map((image, index) => ({ image, index }))
    .filter(item => item.image.isFeatured === true)
    .sort((a, b) => Number(a.image.order ?? a.index) - Number(b.image.order ?? b.index) || a.index - b.index)
  if (featured.length <= 1) return images
  const keepIndex = featured[0].index
  return images.map((image, index) => ({ ...image, isFeatured: index === keepIndex }))
}

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, 'APPLY_PROPERTY_MEDIA_V1')
  await mongoose.connect(config.database_string, { autoIndex: false, serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')
  const properties = db.collection('properties')

  const [overLimitCount, multipleFeaturedCount, legacyVideoCount] = await Promise.all([
    properties.countDocuments({ $expr: { $gt: [{ $size: { $ifNull: ['$images', []] } }, MAX_IMAGES] } }),
    properties.countDocuments(multipleFeaturedFilter),
    properties.countDocuments({ videos: { $type: 'array', $ne: [] }, $or: [{ mediaLinks: { $exists: false } }, { mediaLinks: { $size: 0 } }] }),
  ])

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} photosOverLimit=${overLimitCount} multipleFeaturedGalleries=${multipleFeaturedCount} legacyVideoDocuments=${legacyVideoCount}`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data changed. Use --apply --confirm=APPLY_PROPERTY_MEDIA_V1 after reviewing the counts.`)
    return
  }

  const backup = await backupDocuments({
    collection: properties,
    filter: { $or: [
      { $expr: { $gt: [{ $size: { $ifNull: ['$images', []] } }, MAX_IMAGES] } },
      multipleFeaturedFilter,
      { videos: { $type: 'array', $ne: [] } },
    ] } as never,
    migrationName: MIGRATION,
    backupDir: cli.backupDir,
  })
  if (backup.count === 0 && (overLimitCount > 0 || multipleFeaturedCount > 0 || legacyVideoCount > 0)) throw new Error('Backup validation failed: expected affected documents but backup is empty')

  let trimmed = 0
  let normalizedFeatured = 0
  let migratedVideos = 0
  const cursor = properties.find({ $or: [
    { $expr: { $gt: [{ $size: { $ifNull: ['$images', []] } }, MAX_IMAGES] } },
    multipleFeaturedFilter,
    { videos: { $type: 'array', $ne: [] } },
  ] } as never)

  for await (const property of cursor) {
    const update: Record<string, unknown> = {}
    const images = Array.isArray(property.images) ? property.images as LegacyImage[] : []
    if (images.length > MAX_IMAGES) {
      update.images = trimImages(images)
      trimmed += 1
      if (images.filter(image => image.isFeatured === true).length > 1) normalizedFeatured += 1
    } else if (images.filter(image => image.isFeatured === true).length > 1) {
      update.images = normalizeFeaturedImages(images)
      normalizedFeatured += 1
    }
    const videos = Array.isArray(property.videos) ? property.videos.filter((item): item is string => typeof item === 'string' && /^https:\/\//i.test(item)) : []
    if (videos.length > 0 && (!Array.isArray(property.mediaLinks) || property.mediaLinks.length === 0)) {
      update.mediaLinks = videos.slice(0, 10).map(inferMediaLink)
      migratedVideos += 1
    }
    if (Object.keys(update).length > 0) await properties.updateOne({ _id: property._id }, { $set: update })
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    backup,
    before: { photosOverLimit: overLimitCount, multipleFeaturedGalleries: multipleFeaturedCount, legacyVideoDocuments: legacyVideoCount },
    changed: { trimmedPhotoDocuments: trimmed, normalizedFeaturedGalleries: normalizedFeatured, migratedVideoDocuments: migratedVideos },
  })
  console.log(`[${MIGRATION}] completed backup=${backup.file} manifest=${manifest}`)
}

run().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { await mongoose.disconnect().catch(() => undefined) })
