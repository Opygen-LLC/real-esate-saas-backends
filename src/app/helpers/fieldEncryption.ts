import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import config from '../../config'

const key = (): Buffer => createHash('sha256').update(config.security.data_encryption_key).digest()

export const encryptField = (plainText?: string): string => {
  const value = plainText?.trim()
  if (!value) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

export const decryptField = (sealed?: string): string => {
  if (!sealed) return ''
  const [version, iv, tag, encrypted] = sealed.split('.')
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Invalid encrypted field')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
}

export const maskSensitive = (value: string): string => {
  if (!value) return ''
  if (value.length <= 4) return '•'.repeat(value.length)
  return `${'•'.repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`
}
