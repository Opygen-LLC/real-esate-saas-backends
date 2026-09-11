import config from '../../../config'
import { errorLogger, logger } from '../../../shared/logger'
import { DirectUploadProcessor } from './upload.processor.service'

let timer: NodeJS.Timeout | null = null
let running = false
let lastRunAt: string | null = null
let lastSuccessAt: string | null = null
let lastError = ''

const tick = async () => {
  if (running) return
  running = true
  lastRunAt = new Date().toISOString()
  try {
    await DirectUploadProcessor.processBatch(config.assets.image_processor_batch_size)
    lastSuccessAt = new Date().toISOString()
    lastError = ''
  } catch (error: any) {
    lastError = String(error?.message || 'image_processor_failed').slice(0, 240)
    errorLogger.error('direct_image_processor_tick_failed', { error })
  } finally {
    running = false
  }
}

export const startUploadProcessingWorker = (): (() => void) => {
  if (!config.runtime.worker_enabled || timer) return () => undefined
  const pollMs = config.assets.image_processor_poll_ms
  timer = setInterval(() => { void tick() }, pollMs)
  timer.unref?.()
  void tick()
  logger.info('direct_image_processor_started', { pollMs, batchSize: config.assets.image_processor_batch_size })
  return () => {
    if (timer) clearInterval(timer)
    timer = null
    logger.info('direct_image_processor_stopped')
  }
}

export const getUploadProcessingWorkerHealth = () => ({
  enabled: config.runtime.worker_enabled,
  scheduled: Boolean(timer),
  running,
  healthy: !config.runtime.worker_enabled || (Boolean(timer) && !lastError),
  lastRunAt,
  lastSuccessAt,
  lastError,
})
