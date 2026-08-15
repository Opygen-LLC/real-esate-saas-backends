import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'

export type MigrationCli = {
  apply: boolean
  confirm?: string
  backupDir: string
}

const optionValue = (name: string): string | undefined => {
  const prefix = `--${name}=`
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
}

export const migrationCli = (): MigrationCli => ({
  apply: process.argv.includes('--apply'),
  confirm: optionValue('confirm'),
  backupDir: optionValue('backup-dir') || process.env.MIGRATION_BACKUP_DIR || path.join(process.cwd(), 'migration-backups'),
})

export const requireConfirmation = (cli: MigrationCli, expected: string): void => {
  if (!cli.apply) return
  if (cli.confirm !== expected) {
    throw new Error(`Refusing destructive migration. Re-run with --apply --confirm=${expected}`)
  }
}

const safeStamp = (): string => new Date().toISOString().replace(/[:.]/g, '-')

export const backupDocuments = async (options: {
  collection: any
  filter: Record<string, unknown>
  migrationName: string
  backupDir: string
  projection?: Record<string, 0 | 1>
}): Promise<{ file: string; count: number; sha256: string }> => {
  const targetDir = path.resolve(options.backupDir)
  await fs.mkdir(targetDir, { recursive: true, mode: 0o700 })
  const file = path.join(targetDir, `${options.migrationName}-${options.collection.collectionName}-${safeStamp()}.jsonl`)
  const handle = await fs.open(file, 'wx', 0o600)
  const hash = crypto.createHash('sha256')
  let count = 0
  try {
    const cursor = options.collection.find(options.filter, options.projection ? { projection: options.projection } : undefined)
    for await (const document of cursor) {
      const line = `${JSON.stringify(document)}\n`
      hash.update(line)
      await handle.write(line)
      count += 1
    }
  } finally {
    await handle.close()
  }
  const sha256 = hash.digest('hex')
  await fs.writeFile(
    `${file}.sha256`,
    `${sha256}  ${path.basename(file)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  return { file, count, sha256 }
}

export const writeMigrationManifest = async (
  backupDir: string,
  migrationName: string,
  payload: Record<string, unknown>,
): Promise<string> => {
  const targetDir = path.resolve(backupDir)
  await fs.mkdir(targetDir, { recursive: true, mode: 0o700 })
  const file = path.join(targetDir, `${migrationName}-manifest-${safeStamp()}.json`)
  await fs.writeFile(file, `${JSON.stringify({ migrationName, generatedAt: new Date().toISOString(), ...payload }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  })
  return file
}
