import net from 'net'
import config from '../../../config'

let unhealthyUntil = 0

const encode = (parts: string[]) => `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`

const parseOne = (buffer: Buffer): { value: any; bytes: number } | null => {
  if (!buffer.length) return null
  const lineEnd = buffer.indexOf('\r\n')
  if (lineEnd < 0) return null
  const prefix = String.fromCharCode(buffer[0])
  const line = buffer.subarray(1, lineEnd).toString()
  if (prefix === '+' || prefix === ':') return { value: prefix === ':' ? Number(line) : line, bytes: lineEnd + 2 }
  if (prefix === '-') return { value: new Error(line), bytes: lineEnd + 2 }
  if (prefix === '$') {
    const length = Number(line)
    if (length === -1) return { value: null, bytes: lineEnd + 2 }
    const end = lineEnd + 2 + length + 2
    if (buffer.length < end) return null
    return { value: buffer.subarray(lineEnd + 2, lineEnd + 2 + length).toString(), bytes: end }
  }
  return null
}

const redisCommand = async (parts: string[]): Promise<any> => {
  if (!config.redis.enabled || Date.now() < unhealthyUntil) return null
  const commands: string[][] = []
  if (config.redis.password) commands.push(['AUTH', config.redis.password])
  if (config.redis.db) commands.push(['SELECT', String(config.redis.db)])
  commands.push(parts)

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: config.redis.host, port: config.redis.port })
    let pending = commands.length
    let result: any = null
    let buffer = Buffer.alloc(0)
    const done = (value: any, unhealthy = false) => { if (unhealthy) unhealthyUntil = Date.now() + 30_000; socket.destroy(); resolve(value) }
    socket.setTimeout(800, () => done(null, true))
    socket.on('error', () => done(null, true))
    socket.on('connect', () => socket.write(commands.map(encode).join('')))
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (pending > 0) {
        const parsed = parseOne(buffer)
        if (!parsed) return
        buffer = buffer.subarray(parsed.bytes)
        pending -= 1
        result = parsed.value
        if (result instanceof Error) return done(null)
      }
      done(result)
    })
  })
}

const key = (scope: 'draft' | 'published', organizationId: string, value: string) => `website:${scope}:${organizationId}:${value}`

export const WebsiteCache = {
  get: async <T>(scope: 'draft' | 'published', organizationId: string, value: string): Promise<T | null> => {
    const raw = await redisCommand(['GET', key(scope, organizationId, value)])
    if (!raw || typeof raw !== 'string') return null
    try { return JSON.parse(raw) as T } catch { return null }
  },
  set: async (scope: 'draft' | 'published', organizationId: string, value: string, data: unknown, ttlSeconds: number) => {
    await redisCommand(['SET', key(scope, organizationId, value), JSON.stringify(data), 'EX', String(ttlSeconds)])
  },
  del: async (scope: 'draft' | 'published', organizationId: string, value: string) => {
    await redisCommand(['DEL', key(scope, organizationId, value)])
  },
}
