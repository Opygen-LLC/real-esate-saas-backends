import { DatabaseBackupService } from './databaseBackup.service'
import { logger } from '../../../shared/logger'

const main = async (): Promise<void> => {
  try {
    const manifest = await DatabaseBackupService.runOnce()
    logger.info('database_backup_runner_success', {
      runId: manifest.runId,
      backupDatabase: manifest.backupDatabase,
      archiveBytes: manifest.archiveBytes,
    })
  } catch (error) {
    logger.error('database_backup_runner_failed', { error })
    process.exitCode = 1
  }
}

void main()
