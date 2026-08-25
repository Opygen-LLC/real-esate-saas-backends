export type BackupCollectionInventory = {
  name: string
  type: string
  documents: number | null
  indexSignatures: string[]
  optionsSignature: string
}

export type BackupCollectionVerification = {
  name: string
  sourceDocumentsBefore: number | null
  sourceDocumentsAfter: number | null
  restoredDocuments: number | null
  countWithinObservedRange: boolean
  indexesMatch: boolean
  optionsMatch: boolean
}

export type GcsProtectionResult = {
  checked: boolean
  protected: boolean
  mode: 'off' | 'warn' | 'require'
  bucket?: string
  versioningEnabled?: boolean
  retentionSeconds?: number
  softDeleteSeconds?: number
  message: string
}

export type RestoreVerificationResult = {
  passed: boolean
  verifiedAt: string
  missingCollections: string[]
  unexpectedCollections: string[]
  collections: BackupCollectionVerification[]
  sourceTotalBefore: number
  sourceTotalAfter: number
  restoredTotal: number
}

export type DatabaseBackupManifest = {
  schemaVersion: 2
  runId: string
  status: 'running' | 'success' | 'failed'
  startedAt: string
  finishedAt?: string
  timezone: string
  schedule: string
  sourceDatabase: string
  backupDatabase: string
  transferMode: 'atlas_stream'
  archiveFile?: string
  archiveRetained?: boolean
  archiveBytes?: number
  archiveSha256?: string
  mongoDumpVersion?: string
  mongoRestoreVersion?: string
  sourceCollectionsBefore?: BackupCollectionInventory[]
  sourceCollectionsAfter?: BackupCollectionInventory[]
  restoreVerification?: RestoreVerificationResult
  gcsProtection: GcsProtectionResult
  retention?: {
    retentionDays: number
    minRecoveryPoints: number
    deletedBackupDatabases: string[]
    deletedArchiveFiles: string[]
  }
  error?: {
    name: string
    message: string
  }
  retentionDeletedAt?: string
}
