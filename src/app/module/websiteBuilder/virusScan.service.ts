import net from 'net'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { ObjectStorageService } from './objectStorage.service'

const writeChunk = (socket: net.Socket, chunk: Buffer) => {
  const size = Buffer.alloc(4)
  size.writeUInt32BE(chunk.length, 0)
  socket.write(size)
  socket.write(chunk)
}

export const scanStoredObject = async (key: string): Promise<{ status: 'clean' | 'skipped'; detail: string }> => {
  if (!config.assets.clamav_host) {
    if (config.isProduction) throw new ApiError(503, 'Virus scanning is not configured')
    return { status: 'skipped', detail: 'CLAMAV_HOST is not configured in development' }
  }

  const response = await fetch(ObjectStorageService.presignDownload(key, 180))
  if (!response.ok || !response.body) throw new ApiError(502, 'Unable to read uploaded asset for virus scanning')

  return new Promise(async (resolve, reject) => {
    const socket = net.createConnection({ host: config.assets.clamav_host, port: config.assets.clamav_port })
    let result = ''
    const fail = (error: Error) => { socket.destroy(); reject(new ApiError(502, `Virus scanner failed: ${error.message}`)) }
    socket.setTimeout(20000, () => fail(new Error('timeout')))
    socket.on('error', fail)
    socket.on('data', (chunk) => { result += chunk.toString() })
    socket.on('close', () => {
      if (/FOUND/i.test(result)) return reject(new ApiError(422, 'Uploaded asset failed malware scanning'))
      if (!/OK/i.test(result)) return reject(new ApiError(502, `Virus scanner returned an invalid response: ${result.slice(0, 120)}`))
      resolve({ status: 'clean', detail: result.trim() })
    })

    socket.on('connect', async () => {
      try {
        socket.write('zINSTREAM\0')
        for await (const chunk of response.body as any) writeChunk(socket, Buffer.from(chunk))
        const end = Buffer.alloc(4)
        socket.write(end)
        socket.end()
      } catch (error) {
        fail(error as Error)
      }
    })
  })
}
