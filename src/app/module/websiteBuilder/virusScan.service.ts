import net from 'net'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { ObjectStorageService } from './objectStorage.service'
import { Resilience } from '../../../shared/resilience'

const writeChunk = (socket: net.Socket, chunk: Buffer) => {
  const size = Buffer.alloc(4)
  size.writeUInt32BE(chunk.length, 0)
  socket.write(size)
  socket.write(chunk)
}

const withClamSocket = <T>(run: (socket: net.Socket, resolve: (value: T) => void, reject: (error: unknown) => void) => void, timeoutMs = 5000): Promise<T> => {
  if (!config.assets.clamav_host) return Promise.reject(new ApiError(503, 'Virus scanning is not configured'))
  return new Promise<T>((resolve, reject) => {
    const socket = net.createConnection({ host: config.assets.clamav_host, port: config.assets.clamav_port })
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(error instanceof ApiError ? error : new ApiError(502, `Virus scanner failed: ${(error as Error)?.message || 'unknown error'}`))
    }
    socket.setTimeout(timeoutMs, () => fail(new Error('timeout')))
    socket.once('error', fail)
    socket.once('connect', () => {
      try { run(socket, (value) => { if (!settled) { settled = true; socket.destroy(); resolve(value) } }, fail) }
      catch (error) { fail(error) }
    })
  })
}

let lastHealth: { at: number; value: { configured: boolean; healthy: boolean; latencyMs: number; detail?: string } } | null = null
export const virusScannerHealth = async () => {
  if (!config.assets.clamav_host) return { configured: false, healthy: false, latencyMs: 0, detail: 'not_configured' }
  const now = Date.now()
  if (lastHealth && now - lastHealth.at < config.assets.health_cache_ms) return lastHealth.value
  const started = performance.now()
  try {
    const pong = await withClamSocket<string>((socket, resolve, reject) => {
      let result = ''
      socket.on('data', chunk => { result += chunk.toString() })
      socket.on('close', () => {
        const normalized = result.replace(/\0/g, '').trim()
        normalized === 'PONG' ? resolve('PONG') : reject(new Error(`unexpected response: ${normalized.slice(0, 80)}`))
      })
      socket.write('zPING\0')
      socket.end()
    }, config.assets.health_timeout_ms)
    const value = { configured: true, healthy: pong === 'PONG', latencyMs: Math.round(performance.now() - started) }
    lastHealth = { at: now, value }
    return value
  } catch (error: any) {
    const value = { configured: true, healthy: false, latencyMs: Math.round(performance.now() - started), detail: String(error?.message || 'unreachable').slice(0, 160) }
    lastHealth = { at: now, value }
    return value
  }
}

export const scanStoredObject = async (key: string): Promise<{ status: 'clean' | 'skipped'; detail: string }> => {
  if (!config.assets.clamav_host) {
    if (config.isProduction) throw new ApiError(503, 'Virus scanning is not configured')
    return { status: 'skipped', detail: 'CLAMAV_HOST is not configured in development' }
  }

  const response = await Resilience.fetch('object-storage', ObjectStorageService.presignDownload(key, 180), {}, { timeoutMs: 15000 })
  if (!response.ok || !response.body) throw new ApiError(502, 'Unable to read uploaded asset for virus scanning')

  return withClamSocket<{ status: 'clean'; detail: string }>((socket, resolve, reject) => {
    let result = ''
    socket.on('data', chunk => { result += chunk.toString() })
    socket.on('close', () => {
      if (/FOUND/i.test(result)) return reject(new ApiError(422, 'Uploaded asset failed malware scanning'))
      if (!/OK/i.test(result)) return reject(new ApiError(502, `Virus scanner returned an invalid response: ${result.slice(0, 120)}`))
      resolve({ status: 'clean', detail: result.trim() })
    })
    socket.write('zINSTREAM\0')
    ;(async () => {
      try {
        for await (const chunk of response.body as any) writeChunk(socket, Buffer.from(chunk))
        socket.write(Buffer.alloc(4))
        socket.end()
      } catch (error) { reject(error) }
    })()
  }, 20_000)
}
