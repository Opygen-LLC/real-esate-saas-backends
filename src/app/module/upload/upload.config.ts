import { S3Client } from '@aws-sdk/client-s3'
import config from '../../../config'

/**
 * Low-level R2 client export retained for legacy upload modules that import this
 * file directly. New business code should use ObjectStorageService instead.
 */
export const storageConfig = {
  provider: 'r2' as const,
  region: 'auto' as const,
  endpoint: config.assets.r2_endpoint,
  publicBucketName: config.assets.r2_public_bucket_name,
  privateBucketName: config.assets.r2_private_bucket_name,
}

export const storage = new S3Client({
  region: storageConfig.region,
  endpoint: storageConfig.endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.assets.r2_access_key_id,
    secretAccessKey: config.assets.r2_secret_access_key,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  maxAttempts: 3,
})

// Compatibility alias for old callers. This is now the configured public R2 bucket name.
export const bucket = storageConfig.publicBucketName
