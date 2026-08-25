import net from 'net'
import tls from 'tls'
import config from '../config'
import { Metrics } from './metrics'

type RedisValue = string | number | null | RedisValue[]
type Pending = { resolve: (value: RedisValue) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

type Parsed = { value: RedisValue | Error; next: number }

const parseResp = (buffer: Buffer, offset = 0): Parsed | null => {
  if (offset >= buffer.length) return null
  const prefix = String.fromCharCode(buffer[offset])
  const lineEnd = buffer.indexOf('\r\n', offset)
  if (lineEnd < 0) return null
  const line = buffer.subarray(offset + 1, lineEnd).toString()
  if (prefix === '+' || prefix === ':' || prefix === '-') {
    const value = prefix === ':' ? Number(line) : prefix === '-' ? new Error(line) : line
    return { value, next: lineEnd + 2 }
  }
  if (prefix === '$') {
    const length = Number(line)
    if (length === -1) return { value: null, next: lineEnd + 2 }
    if (!Number.isFinite(length) || length < 0) return { value: new Error('Invalid Redis bulk response'), next: lineEnd + 2 }
    const end = lineEnd + 2 + length + 2
    if (buffer.length < end) return null
    return { value: buffer.subarray(lineEnd + 2, lineEnd + 2 + length).toString(), next: end }
  }
  if (prefix === '*') {
    const count = Number(line)
    if (count === -1) return { value: null, next: lineEnd + 2 }
    let cursor = lineEnd + 2
    const values: RedisValue[] = []
    for (let i = 0; i < count; i += 1) {
      const parsed = parseResp(buffer, cursor)
      if (!parsed) return null
      if (parsed.value instanceof Error) return parsed
      values.push(parsed.value)
      cursor = parsed.next
    }
    return { value: values, next: cursor }
  }
  return { value: new Error(`Unsupported Redis RESP prefix: ${prefix}`), next: lineEnd + 2 }
}

const encode = (parts: Array<string | number>): string => {
  const normalized = parts.map(String)
  return `*${normalized.length}\r\n${normalized.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`
}

class RedisConnection {
  private socket: net.Socket | tls.TLSSocket | null = null
  private buffer = Buffer.alloc(0)
  private pending: Pending[] = []
  private connectPromise: Promise<void> | null = null
  private initialized = false
  private unhealthyUntil = 0

  private rejectPending(error: Error): void {
    const pending = this.pending.splice(0)
    pending.forEach((item) => { clearTimeout(item.timer); item.reject(error) })
  }

  private reset(error?: Error): void {
    this.initialized = false
    this.connectPromise = null
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.destroy()
      this.socket = null
    }
    this.buffer = Buffer.alloc(0)
    if (error) this.rejectPending(error)
  }

  private onData = (chunk: Buffer): void => {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.pending.length) {
      const parsed = parseResp(this.buffer)
      if (!parsed) return
      this.buffer = this.buffer.subarray(parsed.next)
      const request = this.pending.shift()!
      clearTimeout(request.timer)
      if (parsed.value instanceof Error) request.reject(parsed.value)
      else request.resolve(parsed.value)
    }
  }

  private sendRaw(parts: Array<string | number>): Promise<RedisValue> {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error('Redis connection is not available'))
    return new Promise<RedisValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.pending.findIndex((item) => item.resolve === resolve)
        if (index >= 0) this.pending.splice(index, 1)
        reject(new Error('Redis command timed out'))
        this.unhealthyUntil = Date.now() + 5000
        this.reset()
      }, config.redis.command_timeout_ms)
      this.pending.push({ resolve, reject, timer })
      this.socket!.write(encode(parts), (error) => {
        if (error) {
          clearTimeout(timer)
          const index = this.pending.findIndex((item) => item.resolve === resolve)
          if (index >= 0) this.pending.splice(index, 1)
          reject(error)
        }
      })
    })
  }

  private async connect(): Promise<void> {
    if (!config.redis.enabled) return
    if (this.initialized && this.socket && !this.socket.destroyed) return
    if (Date.now() < this.unhealthyUntil) throw new Error('Redis is in reconnect backoff')
    if (this.connectPromise) return this.connectPromise

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.unhealthyUntil = Date.now() + 5000
        this.reset(error)
        reject(error)
      }
      const socket = config.redis.tls
        ? tls.connect({ host: config.redis.host, port: config.redis.port, servername: config.redis.servername || config.redis.host, rejectUnauthorized: config.redis.reject_unauthorized })
        : net.createConnection({ host: config.redis.host, port: config.redis.port })
      this.socket = socket
      socket.setNoDelay(true)
      socket.setKeepAlive(true, 15000)
      socket.once('error', onError)
      socket.setTimeout(config.redis.connect_timeout_ms, () => onError(new Error('Redis connect timed out')))
      const event = config.redis.tls ? 'secureConnect' : 'connect'
      socket.once(event, async () => {
        socket.setTimeout(0)
        socket.removeListener('error', onError)
        socket.on('error', (error) => { this.unhealthyUntil = Date.now() + 5000; this.reset(error) })
        socket.on('close', () => { if (this.initialized) this.reset(new Error('Redis connection closed')) })
        socket.on('data', this.onData)
        try {
          if (config.redis.password) {
            await this.sendRaw(config.redis.username ? ['AUTH', config.redis.username, config.redis.password] : ['AUTH', config.redis.password])
          }
          if (config.redis.db) await this.sendRaw(['SELECT', config.redis.db])
          const pong = await this.sendRaw(['PING'])
          if (pong !== 'PONG') throw new Error('Redis did not answer PING')
          this.initialized = true
          this.unhealthyUntil = 0
          resolve()
        } catch (error) {
          onError(error as Error)
        }
      })
    }).finally(() => { this.connectPromise = null })

    return this.connectPromise
  }

  async command(parts: Array<string | number>): Promise<RedisValue | null> {
    if (!config.redis.enabled) return null
    await this.connect()
    return this.sendRaw(parts)
  }

  async ping(): Promise<boolean> {
    if (!config.redis.enabled) return true
    try { return (await this.command(['PING'])) === 'PONG' } catch { return false }
  }

  close(): void { this.reset(new Error('Redis client shutdown')) }
}

const connection = new RedisConnection()
const prefix = (namespace: string, key: string): string => `${config.redis.key_prefix}:${config.redis.cache_namespace}:${namespace}:${key}`

const getJson = async <T>(namespace: string, key: string): Promise<T | null> => {
  try {
    const value = await connection.command(['GET', prefix(namespace, key)])
    if (typeof value !== 'string') { Metrics.cache(namespace, 'miss'); return null }
    Metrics.cache(namespace, 'hit')
    try { return JSON.parse(value) as T } catch { return null }
  } catch {
    Metrics.cache(namespace, 'error')
    return null
  }
}

const setJson = async (namespace: string, key: string, value: unknown, ttlSeconds: number): Promise<void> => {
  if (!config.redis.enabled) return
  try { await connection.command(['SET', prefix(namespace, key), JSON.stringify(value), 'EX', Math.max(1, ttlSeconds)]) } catch { Metrics.cache(namespace, 'error') }
}

const del = async (namespace: string, ...keys: string[]): Promise<void> => {
  if (!config.redis.enabled || !keys.length) return
  try { await connection.command(['DEL', ...keys.map((key) => prefix(namespace, key))]) } catch { Metrics.cache(namespace, 'error') }
}


/**
 * Delete all keys in one application cache namespace that match a relative
 * pattern. SCAN is used instead of KEYS so tenant purges do not block Redis in
 * production even when a workspace has accumulated many website-cache keys.
 */
const deleteMatching = async (namespace: string, keyPattern: string): Promise<number> => {
  if (!config.redis.enabled || !keyPattern) return 0
  let cursor = '0'
  let deleted = 0
  try {
    do {
      const response = await connection.command(['SCAN', cursor, 'MATCH', prefix(namespace, keyPattern), 'COUNT', 250])
      if (!Array.isArray(response) || response.length < 2) break
      cursor = String(response[0] ?? '0')
      const keys = Array.isArray(response[1]) ? response[1].filter((value): value is string => typeof value === 'string') : []
      if (keys.length) {
        await connection.command(['DEL', ...keys])
        deleted += keys.length
      }
    } while (cursor !== '0')
    return deleted
  } catch {
    Metrics.cache(namespace, 'error')
    return deleted
  }
}

export const RedisClient = {
  command: (parts: Array<string | number>) => connection.command(parts),
  ping: () => connection.ping(),
  close: () => connection.close(),
  getJson,
  setJson,
  del,
  deleteMatching,
  key: prefix,
}
