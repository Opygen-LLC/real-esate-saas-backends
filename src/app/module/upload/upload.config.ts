import { Storage } from '@google-cloud/storage'
import path from 'path'
import fs from 'fs'

const projectId = process.env.PROJECTS_ID || process.env.GCP_PROJECT_ID || 'opy-realestate-505614'
const bucketName = process.env.BUCKET_NAME || process.env.GCP_BUCKET_NAME || 'realestate-saas'
const keyFileNameRaw = process.env.KEYFILENAME || process.env.GCP_KEY_FILE || 'opy-realestate-505614-d4e3b5e9f13d.json'

let keyFilename = path.resolve(process.cwd(), keyFileNameRaw)
if (!fs.existsSync(keyFilename)) {
  const rootKey = path.resolve(process.cwd(), '..', keyFileNameRaw)
  if (fs.existsSync(rootKey)) {
    keyFilename = rootKey
  }
}

const storageOptions: { projectId?: string; keyFilename?: string } = {}
if (projectId) storageOptions.projectId = projectId
if (fs.existsSync(keyFilename)) storageOptions.keyFilename = keyFilename

export const storage = new Storage(storageOptions)
export const bucket = storage.bucket(bucketName)
export const storageConfig = {
  projectId,
  bucketName,
  keyFilename,
}
