import mongoose from 'mongoose'
import config from '../../config'
import { normalizePropertyMediaLink } from '../module/property/propertyMedia.service'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase4-property-media-2'
const CONFIRM = 'APPLY_PROPERTY_MEDIA_2'
const MAX_IMAGES = 20
const MAX_MEDIA = 10

type LegacyImage = { isFeatured?: boolean; order?: number; [key: string]: unknown }

const normalizeImages = (value: unknown): LegacyImage[] => {
  const images = Array.isArray(value) ? value as LegacyImage[] : []
  const selected = images
    .map((image, index) => ({ image, index }))
    .sort((a, b) => Number(Boolean(b.image.isFeatured)) - Number(Boolean(a.image.isFeatured)) || Number(a.image.order ?? a.index) - Number(b.image.order ?? b.index) || a.index - b.index)
    .slice(0, MAX_IMAGES)
    .map(row => row.image)
  let featuredUsed = false
  return selected.map((image, order) => {
    const isFeatured = Boolean(image.isFeatured) && !featuredUsed
    if (isFeatured) featuredUsed = true
    return { ...image, order, isFeatured }
  })
}

const normalizeMedia = (property: any) => {
  const source: any[] = []
  if (Array.isArray(property.mediaLinks)) source.push(...property.mediaLinks)
  const existingUrls = new Set(source.map(item => String(item?.url || '').trim()).filter(Boolean))
  if (Array.isArray(property.videos)) {
    for (const url of property.videos) {
      const normalized = String(url || '').trim()
      if (normalized && !existingUrls.has(normalized)) {
        source.push({ id: `legacy-${source.length + 1}`, url: normalized, type: 'video', title: '', isHero: false })
        existingUrls.add(normalized)
      }
    }
  }
  const result: any[] = []
  let dropped = 0
  let heroUsed = false
  for (const item of source) {
    if (result.length >= MAX_MEDIA) break
    try {
      const normalized = normalizePropertyMediaLink({ ...item, isHero: Boolean(item?.isHero) && !heroUsed }, result.length)
      if (normalized.isHero) heroUsed = true
      result.push(normalized)
    } catch {
      dropped += 1
    }
  }
  return { result, dropped, truncated: Math.max(0, source.length - MAX_MEDIA) }
}

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, CONFIRM)
  await mongoose.connect(config.database_string, { autoIndex: false, serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')
  const properties = db.collection('properties')
  const filter = { $or: [
    { videos: { $exists: true } },
    { mediaLinks: { $exists: true } },
    { $expr: { $gt: [{ $size: { $ifNull: ['$images', []] } }, MAX_IMAGES] } },
    { $expr: { $gt: [
      { $size: { $filter: { input: { $ifNull: ['$images', []] }, as: 'image', cond: { $eq: ['$$image.isFeatured', true] } } } },
      1,
    ] } },
  ] } as never
  const affected = await properties.countDocuments(filter)
  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} affected=${affected}`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data changed. Re-run with --apply --confirm=${CONFIRM} after reviewing the count.`)
    return
  }

  const backup = await backupDocuments({ collection: properties, filter, migrationName: MIGRATION, backupDir: cli.backupDir })
  if (backup.count !== affected) throw new Error(`Backup validation failed: expected ${affected} documents, backed up ${backup.count}`)

  let changed = 0
  let droppedInvalidMedia = 0
  let truncatedMedia = 0
  let trimmedGalleries = 0
  const cursor = properties.find(filter)
  for await (const property of cursor) {
    const images = normalizeImages(property.images)
    const media = normalizeMedia(property)
    droppedInvalidMedia += media.dropped
    truncatedMedia += media.truncated
    if (Array.isArray(property.images) && property.images.length > MAX_IMAGES) trimmedGalleries += 1
    await properties.updateOne(
      { _id: property._id },
      { $set: { images, mediaLinks: media.result }, $unset: { videos: '' } },
    )
    changed += 1
  }

  const legacyRemaining = await properties.countDocuments({ videos: { $exists: true } })
  const overPhotoLimit = await properties.countDocuments({ $expr: { $gt: [{ $size: { $ifNull: ['$images', []] } }, MAX_IMAGES] } })
  const multipleFeatured = await properties.countDocuments({ $expr: { $gt: [
    { $size: { $filter: { input: { $ifNull: ['$images', []] }, as: 'image', cond: { $eq: ['$$image.isFeatured', true] } } } },
    1,
  ] } })
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    backup,
    changed,
    droppedInvalidMedia,
    truncatedMedia,
    trimmedGalleries,
    verification: { legacyVideoFieldsRemaining: legacyRemaining, photoGalleriesOverLimit: overPhotoLimit, galleriesWithMultipleFeatured: multipleFeatured },
  })
  if (legacyRemaining || overPhotoLimit || multipleFeatured) throw new Error(`Post-migration verification failed. manifest=${manifest}`)
  console.log(`[${MIGRATION}] completed changed=${changed} backup=${backup.file} manifest=${manifest}`)
}

run().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { await mongoose.disconnect().catch(() => undefined) })
