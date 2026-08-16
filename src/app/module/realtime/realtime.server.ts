import type { Server as HttpServer } from 'http'
import { Secret } from 'jsonwebtoken'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'
import { Server as SocketIOServer } from 'socket.io'
import config from '../../../config'
import { errorLogger, logger } from '../../../shared/logger'
import { jwtHelpers } from '../../helpers/jwtHelpers'
import { Organization } from '../organization/organization.model'
import { User } from '../user/user.model'
import { RealtimeService } from './realtime.service'

let io: SocketIOServer | undefined
let pubClient: any
let subClient: any

const safeOrigin = async (origin?: string): Promise<boolean> => {
  if (!origin) return true
  const normalized = origin.replace(/\/$/, '')
  if (config.allowed_origins.includes('*') || config.allowed_origins.includes(normalized)) return true

  let hostname = ''
  try { hostname = new URL(normalized).hostname.toLowerCase() } catch { return false }
  if (!hostname) return false

  let publicHost = ''
  try { publicHost = new URL(config.domains.public_site_origin).hostname.toLowerCase() } catch { publicHost = '' }
  const candidates = [hostname]
  if (publicHost && hostname.endsWith(`.${publicHost}`)) {
    candidates.push(hostname.slice(0, -(publicHost.length + 1)))
  }

  const found = await Organization.exists({
    isBlocked: { $ne: true },
    websiteStatus: { $ne: 'suspended' },
    $or: [
      { customDomain: hostname },
      { domain: hostname },
      { sub_domain: { $in: candidates } },
      { organizationId: { $in: candidates } },
    ],
  })
  return Boolean(found)
}

const redisOptions = (): any => ({
  username: config.redis.username || undefined,
  password: config.redis.password || undefined,
  database: config.redis.db,
  socket: {
    host: config.redis.host,
    port: config.redis.port,
    tls: config.redis.tls,
    servername: config.redis.servername || undefined,
    rejectUnauthorized: config.redis.reject_unauthorized,
    connectTimeout: config.redis.connect_timeout_ms,
    reconnectStrategy: (retries: number) => Math.min(1000 + retries * 250, 5000),
  },
})

const attachRedisAdapter = async (server: SocketIOServer) => {
  if (!config.redis.enabled) {
    if (config.isProduction) throw new Error('Realtime requires Redis in production')
    logger.warn('realtime_redis_adapter_disabled_development_only')
    return
  }
  pubClient = createClient(redisOptions())
  subClient = pubClient.duplicate()
  pubClient.on('error', (error) => errorLogger.error('realtime_redis_pub_error', { error }))
  subClient.on('error', (error) => errorLogger.error('realtime_redis_sub_error', { error }))
  await Promise.all([pubClient.connect(), subClient.connect()])
  server.adapter(createAdapter(pubClient, subClient, { key: `${config.redis.key_prefix}:socket.io` }))
  logger.info('realtime_redis_adapter_ready')
}

const resolveTenant = async (identifier: string) => {
  const normalized = identifier.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
  if (!normalized || normalized.length > 253 || !/^[a-z0-9.-]+$/.test(normalized)) return null
  const subdomain = normalized.includes('.') ? normalized.split('.')[0] : normalized
  return Organization.findOne({
    isBlocked: { $ne: true },
    websiteStatus: { $ne: 'suspended' },
    $or: [
      { organizationId: normalized },
      { sub_domain: normalized },
      { sub_domain: subdomain },
      { domain: normalized },
      { customDomain: normalized },
    ],
  }).select('organizationId sub_domain domain customDomain websiteStatus').lean()
}

const initializeRealtimeServer = async (httpServer: HttpServer) => {
  io = new SocketIOServer(httpServer, {
    path: '/socket.io',
    serveClient: false,
    transports: ['websocket', 'polling'],
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 128_000,
    cors: {
      credentials: true,
      methods: ['GET', 'POST'],
      origin: (origin, callback) => {
        void safeOrigin(origin).then((allowed) => callback(allowed ? null : new Error('Origin not allowed'), allowed)).catch(() => callback(new Error('Origin validation failed'), false))
      },
    },
  })

  await attachRedisAdapter(io)

  const dashboard = io.of('/dashboard')
  dashboard.use(async (socket, next) => {
    try {
      const ticket = typeof socket.handshake.auth?.ticket === 'string' ? socket.handshake.auth.ticket : ''
      if (!ticket) return next(new Error('REALTIME_AUTH_REQUIRED'))
      const payload: any = jwtHelpers.verifyToken(ticket, config.jwt.secret as Secret)
      if (payload.typ !== 'realtime_ticket' || payload.aud !== 'dashboard_socket' || !payload._id) return next(new Error('REALTIME_TICKET_INVALID'))
      const user = await User.findById(payload._id).select('_id organizationId userRole status isVerified').lean()
      if (!user || user.status !== 'active' || !user.isVerified) return next(new Error('REALTIME_ACCOUNT_UNAVAILABLE'))
      if (payload.organizationId !== user.organizationId || payload.userRole !== user.userRole) return next(new Error('REALTIME_AUTH_CHANGED'))
      if (user.userRole !== 'super-admin') {
        const tenantActive = await Organization.exists({ organizationId: user.organizationId, isBlocked: { $ne: true } })
        if (!tenantActive) return next(new Error('REALTIME_TENANT_UNAVAILABLE'))
      }
      socket.data.userId = String(user._id)
      socket.data.organizationId = user.organizationId
      socket.data.userRole = user.userRole
      return next()
    } catch {
      return next(new Error('REALTIME_TICKET_EXPIRED'))
    }
  })

  dashboard.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`)
    if (socket.data.organizationId) socket.join(`org:${socket.data.organizationId}`)
    socket.join(`role:${socket.data.userRole}`)
    socket.emit('resync', { revision: Date.now(), occurredAt: new Date().toISOString() })
  })

  const publicNamespace = io.of('/public')
  publicNamespace.on('connection', (socket) => {
    let subscriptionCount = 0
    socket.on('tenant:subscribe', async (payload: { identifier?: string }, acknowledge?: (value: unknown) => void) => {
      subscriptionCount += 1
      if (subscriptionCount > 20) {
        acknowledge?.({ ok: false, code: 'RATE_LIMITED' })
        return socket.disconnect(true)
      }
      const identifier = typeof payload?.identifier === 'string' ? payload.identifier : ''
      const tenant = await resolveTenant(identifier)
      if (!tenant) return acknowledge?.({ ok: false, code: 'TENANT_NOT_FOUND' })
      const prior = socket.data.publicTenantRoom as string | undefined
      if (prior) await socket.leave(prior)
      const room = `public:org:${tenant.organizationId}`
      await socket.join(room)
      socket.data.publicTenantRoom = room
      socket.emit('resync', { revision: Date.now(), occurredAt: new Date().toISOString() })
      return acknowledge?.({ ok: true, organizationId: tenant.organizationId })
    })
  })

  RealtimeService.configure(io, dashboard, publicNamespace)
  logger.info('realtime_server_ready', { path: '/socket.io' })
  return io
}

const closeRealtimeServer = async () => {
  const clients = [subClient, pubClient].filter(Boolean) as any[]
  subClient = undefined
  pubClient = undefined
  if (io) {
    const current = io
    io = undefined
    current.disconnectSockets(true)
    current.engine.close()
    current.removeAllListeners()
  }
  clients.forEach((client) => {
    try { if (client.isOpen) client.destroy() } catch { /* noop */ }
  })
}

export { initializeRealtimeServer, closeRealtimeServer }
